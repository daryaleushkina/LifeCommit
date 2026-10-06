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
    /// «Вместе»: экраны групп (GET groups/:id, список — GET groups); нет группы — 404.
    let groups = Mutex<[Int: GroupToday]>([:])
    /// Дела групп для GET calendar.
    let calendarGroups = Mutex<[GroupDayBlock]>([])
    /// Друзья (GET friends); nil — 404.
    let friends = Mutex<FriendsResponse?>(nil)
    /// Экраны друзей (GET friends/:id); нет — 404.
    let profiles = Mutex<[Int: FriendProfile]>([:])
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
            let blocks = calendarGroups.withLock { $0 }.filter { $0.day >= from && $0.day <= to }
            return (200, try! Self.encoder.encode(CalendarRange(today: today.day, todos: list.filter { $0.day >= from && $0.day <= to }, groups: blocks)))
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
        case (_, "groups", _), (_, "invites", _):
            return handleGroups(call, parts, body)
        case (_, "friends", _):
            return handleFriends(call, parts, body)
        default:
            return Self.json(404, ["error": "not_found"])
        }
    }

    private func newId() -> Int {
        nextId.withLock { n in
            n += 1
            return n
        }
    }

    /// Правка группы — и на её экране, и в блоке на «Сегодня».
    private func editGroup(_ id: Int, _ f: (inout GroupToday) -> Void) {
        groups.withLock { if var g = $0[id] { f(&g); $0[id] = g } }
        state.withLock { s in
            s.groups = s.groups.map { g in
                guard g.id == id else { return g }
                var next = g
                f(&next)
                next.settings = nil
                next.upcoming = nil
                return next
            }
        }
    }

    private func handleGroups(_ call: Call, _ parts: [String], _ body: [String: Any]) -> (Int, Data) {
        let id = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        let item = parts.count > 3 ? Int(parts[3]) ?? 0 : 0
        switch (call.method, parts.count, parts.count > 2 ? parts[2] : "", parts.count > 4 ? parts[4] : "") {
        case ("GET", 1, _, _):
            let list = groups.withLock { $0.values.sorted { $0.id < $1.id } }.map { g -> GroupToday in
                var x = g
                x.settings = nil
                x.upcoming = nil
                return x
            }
            return (200, try! Self.encoder.encode(list))
        case ("POST", 1, _, _):
            let gid = newId()
            let g = GroupToday(id: gid, title: body["title"] as? String ?? "", role: .owner, members: [GroupMember(id: user.id, name: user.firstName)], settings: GroupSettings(), upcoming: [])
            groups.withLock { $0[gid] = g }
            return Self.json(201, ["id": gid])
        case ("GET", 2, _, _) where parts[0] == "groups":
            guard let g = groups.withLock({ $0[id] }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(g))
        case ("PATCH", 2, _, _):
            editGroup(id) { g in
                if let title = body["title"] as? String { g.title = title }
                if let on = body["admins_only_edit"] as? Bool { g.settings?.adminsOnlyEdit = on }
            }
            return Self.json(200, ["ok": true])
        case ("DELETE", 2, _, _), ("POST", 3, "leave", _):
            groups.withLock { $0[id] = nil }
            state.withLock { s in s.groups.removeAll { $0.id == id } }
            return Self.json(200, ["ok": true])
        case ("POST", 3, "invite", _):
            return Self.json(201, ["code": "abc234xyz9", "link": "https://t.me/LifeCommit_bot?startapp=g_abc234xyz9", "expires_at": "2026-10-12T00:00:00Z"])
        case ("POST", 4, "chat", _) where parts[3] == "check":
            let title = groups.withLock { $0[id]?.settings?.tgChatTitle }
            return Self.json(200, ["tg_chat_title": title as Any? ?? NSNull()])
        case ("DELETE", 3, "chat", _):
            editGroup(id) { $0.settings?.tgChatTitle = nil }
            return Self.json(200, ["ok": true])
        case ("POST", 3, "items", _):
            let iid = newId()
            let it = GroupDayItem(id: iid, title: body["title"] as? String ?? "", mode: GroupMode(rawValue: body["mode"] as? String ?? "") ?? .one,
                                  time: body["time"] as? String, people: [user.id], canMark: true, start: body["day"] as? String ?? today.day,
                                  rrule: body["rrule"] as? String, assignees: body["assignees"] as? [Int] ?? [])
            editGroup(id) { $0.items.append(it) }
            return Self.json(201, ["id": iid])
        case ("PATCH", 4, "items", _):
            editGroup(id) { g in
                g.items = g.items.map { x in
                    guard x.id == item else { return x }
                    var next = x
                    if let title = body["title"] as? String { next.title = title }
                    return next
                }
            }
            return Self.json(200, ["ok": true])
        case ("DELETE", 4, "items", _), ("POST", 5, "items", "skip"):
            editGroup(id) { $0.items.removeAll { $0.id == item } }
            return Self.json(200, ["ok": true])
        case ("PUT", 5, "items", "mark"):
            let done = body["done"] as? Bool ?? true
            let me = user.id
            editGroup(id) { g in
                g.items = g.items.map { x in x.id == item ? GroupLogic.marked(x, done: done, me: me) : x }
                g.done += done ? 1 : -1
            }
            return Self.json(200, ["ok": true, "taken": false])
        case ("POST", 5, "items", "entries"):
            let amount = body["amount"] as? Double ?? 0
            editGroup(id) { g in
                g.items = g.items.map { x in
                    guard x.id == item else { return x }
                    var next = x
                    next.total = (x.total ?? 0) + amount
                    return next
                }
            }
            return Self.json(201, ["ok": true])
        default:
            return Self.json(404, ["error": "not_found"])
        }
    }

    private func handleFriends(_ call: Call, _ parts: [String], _ body: [String: Any]) -> (Int, Data) {
        let id = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        let request = parts.count > 2 ? Int(parts[2]) ?? 0 : 0
        switch (call.method, parts.count) {
        case ("GET", 1):
            guard let data = friends.withLock({ $0 }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(data))
        case ("GET", 2):
            guard let p = profiles.withLock({ $0[id] }) else { return Self.json(404, ["error": "not_found"]) }
            return (200, try! Self.encoder.encode(p))
        case ("POST", 4) where parts[1] == "requests" && parts[3] == "accept":
            friends.withLock { f in
                guard let r = f?.incoming.first(where: { $0.id == request }) else { return }
                f?.incoming.removeAll { $0.id == request }
                f?.friends.append(FriendCard(id: r.id, firstName: r.firstName, username: r.username, days: Array(repeating: 0, count: 14)))
            }
            return Self.json(200, ["ok": true])
        case ("DELETE", 3) where parts[1] == "requests":
            friends.withLock { f in
                f?.incoming.removeAll { $0.id == request }
                f?.outgoing.removeAll { $0.id == request }
            }
            return Self.json(200, ["ok": true])
        case ("DELETE", 2):
            friends.withLock { $0?.friends.removeAll { $0.id == id } }
            profiles.withLock { $0[id] = nil }
            return Self.json(200, ["ok": true])
        case ("POST", 3) where parts[2] == "block":
            friends.withLock { $0?.friends.removeAll { $0.id == id } }
            profiles.withLock { $0[id] = nil }
            return Self.json(200, ["ok": true])
        case ("PUT", 2) where parts[1] == "shown":
            let ids = body["task_ids"] as? [Int] ?? []
            state.withLock { s in
                for i in s.tasks.indices { s.tasks[i].visibility = ids.contains(s.tasks[i].id) ? .friends : .private }
            }
            friends.withLock { $0?.prompt = false }
            return Self.json(200, ["ok": true])
        case ("POST", 2) where parts[1] == "prompted":
            friends.withLock { $0?.prompt = false }
            return Self.json(200, ["ok": true])
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
