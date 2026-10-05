// Подменённый сервер для тестов модели: «Сегодня» и дела живут в памяти, а ответ на любой запрос можно придержать
// (hold → Gate) — так воспроизводятся гонки «перечитали, пока шла правка». Живой сети нет: у каждого сервера своя
// URLSession со своим URLProtocol; незнакомый путь отвечает 404.
import Foundation
import LifeCommitKit
import Synchronization

/// Дверь для ответа: запрос уже пришёл и ждёт, пока тест её откроет.
actor Gate {
    private var isOpen = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func open() {
        isOpen = true
        waiting.forEach { $0.resume() }
        waiting = []
    }
}

final class FakeServer: Sendable {
    struct Call: Sendable {
        let method: String
        /// Путь без /api: "today", "todos/5".
        let path: String
        var query: [String: String] = [:]
        let body: Data

        var key: String { "\(method) \(path)" }
        var json: [String: Any] { ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any]) ?? [:] }
    }

    static let base = URL(string: "https://lifecommit.test/api")!
    private static let servers = Mutex<[String: FakeServer]>([:])

    let session: URLSession
    let state: Mutex<TodayResponse>
    let user: UserSettings
    private let id = UUID().uuidString
    private let log = Mutex<[Call]>([])
    /// Сколько ближайших запросов с этим ключом придержать и чем.
    private let holds = Mutex<[String: (gate: Gate, left: Int)]>([:])
    private let watchers = Mutex<[(key: String, times: Int, done: CheckedContinuation<Void, Never>)]>([])
    private let nextId = Mutex(1000)
    /// Ближайшие запросы с этим ключом ответят ошибкой (сколько раз и с каким кодом).
    private let failures = Mutex<[String: (status: Int, code: String, left: Int)]>([:])
    /// История привычек для GET tasks/:id/history.
    let histories = Mutex<[Int: TaskHistory]>([:])
    /// Дела для GET calendar (по from…to); nil — путь не отвечает (404).
    let calendar = Mutex<[Todo]?>(nil)
    /// Подключённые календари для GET calendars; nil — 404.
    let accounts = Mutex<[CalendarAccount]?>(nil)
    /// «Потом» для GET todos/later; nil — 404.
    let later = Mutex<[Todo]?>(nil)
    /// Заготовленные ответы по ключу запроса («POST calendars/google/finish»).
    private let canned = Mutex<[String: (Int, Data)]>([:])

    init(today: TodayResponse, user: UserSettings = UserSettings(id: 777, firstName: "Даша")) {
        state = Mutex(today)
        self.user = user
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FakeProtocol.self]
        config.httpAdditionalHeaders = ["X-Fake": id]
        session = URLSession(configuration: config)
        Self.servers.withLock { $0[id] = self }
    }

    static func find(_ id: String) -> FakeServer? { servers.withLock { $0[id] } }

    var api: APIClient { APIClient(base: Self.base, session: session) }
    var today: TodayResponse { state.withLock { $0 } }
    var calls: [String] { log.withLock { $0.map(\.key) } }
    func calls(_ key: String) -> [Call] { log.withLock { $0.filter { $0.key == key } } }

    /// Придержать ответы на следующие `times` запросов `key` («GET today»), пока тест не откроет дверь.
    func hold(_ key: String, times: Int = 1) -> Gate {
        let gate = Gate()
        holds.withLock { $0[key] = (gate, times) }
        return gate
    }

    /// Следующие `times` запросов `key` («PUT logs», «GET tasks/1/history») ответят ошибкой `status` с кодом `code`;
    /// status 0 — нет связи.
    func fail(_ key: String, status: Int = 500, code: String = "internal", times: Int = 1) {
        failures.withLock { $0[key] = (status, code, times) }
    }

    /// На запрос `key` отвечать так (пока не заготовят другое).
    func answer(_ key: String, _ status: Int, _ object: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: object)
        canned.withLock { $0[key] = (status, data) }
    }

    /// Дождаться, пока придёт `times`-й запрос `key` (сам ответ может быть придержан).
    func seen(_ key: String, times: Int = 1) async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let already = log.withLock { $0.filter { $0.key == key }.count } >= times
            if already {
                done.resume()
            } else {
                watchers.withLock { $0.append((key, times, done)) }
            }
        }
    }

    func respond(_ call: Call) async -> (Int, Data) {
        let count = log.withLock { calls in
            calls.append(call)
            return calls.filter { $0.key == call.key }.count
        }
        let ready = watchers.withLock { list in
            let hit = list.filter { $0.key == call.key && $0.times <= count }
            list.removeAll { $0.key == call.key && $0.times <= count }
            return hit.map(\.done)
        }
        ready.forEach { $0.resume() }
        let gate = holds.withLock { holds -> Gate? in
            guard let h = holds[call.key], h.left > 0 else { return nil }
            holds[call.key] = (h.gate, h.left - 1)
            return h.gate
        }
        // Ответ на придержанный запрос сервер собирает сразу (как настоящий, пока ответ идёт по сети), а правки — после
        // двери: так «ответ устарел» и «правка ещё не дошла» воспроизводятся каждая сама по себе.
        let failure = failures.withLock { failures -> (Int, String)? in
            guard let f = failures[call.key], f.left > 0 else { return nil }
            failures[call.key] = (f.status, f.code, f.left - 1)
            return (f.status, f.code)
        }
        if let (status, code) = failure {
            await gate?.wait()
            return (status, try! JSONSerialization.data(withJSONObject: ["error": code]))
        }
        if call.method == "GET", let gate {
            let answer = handle(call)
            await gate.wait()
            return answer
        }
        await gate?.wait()
        return handle(call)
    }

    private func handle(_ call: Call) -> (Int, Data) {
        if let answer = canned.withLock({ $0[call.key] }) { return answer }
        let parts = call.path.split(separator: "/").map(String.init)
        let body = call.json
        switch (call.method, parts.first ?? "", parts.count) {
        case ("GET", "calendar", 1):
            guard let list = calendar.withLock({ $0 }) else { return Self.json(404, ["error": "not_found"]) }
            let from = call.query["from"] ?? "", to = call.query["to"] ?? ""
            return (200, try! Self.encoder.encode(CalendarRange(today: today.day, todos: list.filter { $0.day >= from && $0.day <= to })))
        case ("GET", "calendars", 1):
            guard let list = accounts.withLock({ $0 }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(list))
        case ("POST", "calendars", 2) where parts[1] == "sync":
            return Self.json(200, ["ok": true])
        case ("PATCH", "calendars", 3) where parts[2] == "collections":
            let id = Int(parts[1]) ?? 0
            accounts.withLock { list in
                list = list?.map { a in
                    guard a.id == id else { return a }
                    var next = a
                    next.collections = a.collections.map { c in
                        var col = c
                        if c.url == body["url"] as? String, let on = body["enabled"] as? Bool { col.enabled = on }
                        return col
                    }
                    return next
                }
            }
            return Self.json(200, ["ok": true])
        case ("GET", "todos", 2) where parts[1] == "later":
            guard let list = later.withLock({ $0 }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(list))
        case ("POST", "session", 1):
            let user = try! JSONSerialization.jsonObject(with: Self.encoder.encode(self.user))
            return Self.json(200, ["user": user, "is_new": false])
        case ("GET", "today", 1):
            return (200, try! Self.encoder.encode(today))
        case ("GET", "tasks", 3) where parts[2] == "history":
            guard let history = histories.withLock({ $0[Int(parts[1]) ?? 0] }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(history))
        case ("POST", "todos", 1):
            let id = nextId.withLock { n in
                n += 1
                return n
            }
            let today = self.today.day
            let todo = Todo(id: id, title: body["title"] as? String ?? "", day: body["day"] as? String ?? today)
            if todo.day == today { state.withLock { $0.todos.append(todo) } }
            if todo.day > today { later.withLock { $0 = $0.map { $0 + [todo] } } }
            calendar.withLock { $0 = $0.map { $0 + [todo] } }
            return Self.json(200, ["id": id])
        case ("PATCH", "todos", 2):
            let id = Int(parts[1]) ?? 0
            let edit = { (list: [Todo]) -> [Todo] in
                if body["hidden"] as? Bool == true { return list.filter { $0.id != id } }
                return list.map { d in
                    guard d.id == id else { return d }
                    var t = d
                    if let done = body["done"] as? Bool { t.done = done }
                    if let title = body["title"] as? String { t.title = title }
                    if let day = body["day"] as? String { t.day = day }
                    if body.keys.contains("time") { t.time = body["time"] as? String }
                    return t
                }
            }
            // Перенесённое на завтра уходит с «Сегодня» (там — сегодняшние и переехавшие со вчера).
            state.withLock { s in s.todos = edit(s.todos).filter { $0.day <= s.day } }
            calendar.withLock { $0 = $0.map(edit) }
            later.withLock { $0 = $0.map(edit) }
            return Self.json(200, [:])
        case ("DELETE", "todos", 2):
            state.withLock { s in s.todos.removeAll { $0.id == Int(parts[1]) } }
            calendar.withLock { $0 = $0?.filter { $0.id != Int(parts[1]) } }
            later.withLock { $0 = $0?.filter { $0.id != Int(parts[1]) } }
            return Self.json(200, [:])
        case ("PUT", "logs", 1):
            state.withLock { s in
                guard body["day"] == nil || body["day"] as? String == s.day,
                      let i = s.tasks.firstIndex(where: { $0.id == body["task_id"] as? Int }) else { return }
                let value = body["value"] as? Double
                let status = (body["status"] as? String).flatMap(AbstainStatus.init(rawValue:))
                s.tasks[i].value = value ?? (status == .clean ? 1 : 0)
                s.tasks[i].status = status
                s.tasks[i].logged = value != nil || status != nil
            }
            return Self.json(200, [:])
        default:
            return Self.json(404, ["error": "not_found"])
        }
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    private static func json(_ status: Int, _ object: [String: Any]) -> (Int, Data) {
        (status, try! JSONSerialization.data(withJSONObject: object))
    }
}

final class FakeProtocol: URLProtocol, @unchecked Sendable {
    // URLProtocol — класс Foundation с изменяемым состоянием; ответ отдаём из своей задачи, когда откроется дверь.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let id = request.value(forHTTPHeaderField: "X-Fake"), let server = FakeServer.find(id), let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        let path = url.path.hasPrefix("/api/") ? String(url.path.dropFirst(5)) : url.path
        let query = (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).reduce(into: [String: String]()) { $0[$1.name] = $1.value ?? "" }
        let call = FakeServer.Call(method: request.httpMethod ?? "GET", path: path, query: query, body: body)
        Task {
            let (status, data) = await server.respond(call)
            if status == 0 {
                client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
                return
            }
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
