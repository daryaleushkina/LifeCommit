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
        if call.method == "GET", let gate {
            let answer = handle(call)
            await gate.wait()
            return answer
        }
        await gate?.wait()
        return handle(call)
    }

    private func handle(_ call: Call) -> (Int, Data) {
        let parts = call.path.split(separator: "/").map(String.init)
        let body = call.json
        switch (call.method, parts.first ?? "", parts.count) {
        case ("POST", "session", 1):
            let user = try! JSONSerialization.jsonObject(with: Self.encoder.encode(self.user))
            return Self.json(200, ["user": user, "is_new": false])
        case ("GET", "today", 1):
            return (200, try! Self.encoder.encode(today))
        case ("POST", "todos", 1):
            let id = nextId.withLock { n in
                n += 1
                return n
            }
            state.withLock { $0.todos.append(Todo(id: id, title: body["title"] as? String ?? "", day: $0.day)) }
            return Self.json(200, ["id": id])
        case ("PATCH", "todos", 2):
            let id = Int(parts[1]) ?? 0
            state.withLock { s in
                if body["hidden"] as? Bool == true { s.todos.removeAll { $0.id == id } }
                if let done = body["done"] as? Bool, let i = s.todos.firstIndex(where: { $0.id == id }) { s.todos[i].done = done }
            }
            return Self.json(200, [:])
        case ("DELETE", "todos", 2):
            state.withLock { s in s.todos.removeAll { $0.id == Int(parts[1]) } }
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
        let call = FakeServer.Call(method: request.httpMethod ?? "GET", path: path, body: body)
        Task {
            let (status, data) = await server.respond(call)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
