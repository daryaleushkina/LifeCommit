import Foundation
import Testing
@testable import LifeCommitKit

@Suite("Клиент API")
struct APIClientTests {
    let base = URL(string: "https://lifecommit.test/api")!

    @Test("настоящий ответ /today (снят с локального стенда) читается целиком")
    func decodeToday() throws {
        let today = try APIClient.decoder.decode(TodayResponse.self, from: fixture("today"))
        #expect(today.tasks.map(\.kind) == [.check, .count, .abstain])
        let water = try #require(today.tasks.first { $0.kind == .count })
        #expect(water.unit == "стаканов")
        #expect(water.value == 3)
        #expect(water.target == 8)
        #expect(today.tasks.first { $0.kind == .abstain }?.status == .clean)
        #expect(today.tasks.first { $0.kind == .abstain }?.lastSlipOn == "2026-09-20")
        #expect(today.todos.map(\.title).sorted() == ["Купить корм Тесле", "Позвонить в банк"])
        #expect(today.todos.first { $0.time != nil }?.time == "15:00")
        #expect(today.limits.maxTasks == nil)
    }

    @Test("настоящий ответ /session и /heatmap")
    func decodeSessionAndHeat() throws {
        let s = try APIClient.decoder.decode(SessionResponse.self, from: fixture("session"))
        #expect(s.user.firstName == "Даша")
        #expect(s.user.timezone == "Asia/Ho_Chi_Minh")
        #expect(s.isNew)
        let heat = try APIClient.decoder.decode(HeatmapResponse.self, from: fixture("heatmap"))
        #expect(!heat.today.isEmpty)
    }

    @Test("ключ сессии уходит заголовком Bearer, подменённый Telegram — tma; тело — JSON в snake_case")
    func headersAndBody() async throws {
        let stub = Stub { _ in Stub.json(201, ["id": 42]) }
        let api = APIClient(base: base, session: stub.session)
        api.setCredential(.session("key-123"))
        let id = try await api.createTask(TaskInput(title: "Читать", kind: .count, target: 20, lastSlipOn: nil))
        #expect(id == 42)
        let call = try #require(stub.calls.first)
        #expect(call.method == "POST")
        #expect(call.url.absoluteString == "https://lifecommit.test/api/tasks")
        #expect(call.headers["Authorization"] == "Bearer key-123")
        let body = try JSONSerialization.jsonObject(with: call.body) as? [String: Any]
        #expect(body?["title"] as? String == "Читать")
        #expect(body?["kind"] as? String == "count")
        #expect(body?["target"] as? Double == 20)
        #expect(body?["per_week"] == nil)

        api.setCredential(.telegramInitData("user=1"))
        _ = try await api.createTask(TaskInput(title: "x", kind: .check))
        #expect(stub.calls.last?.headers["Authorization"] == "tma user=1")
    }

    @Test("отметка: value null снимает, status — строка, день — задним числом")
    func logBody() async throws {
        let stub = Stub { _ in Stub.json(200, ["ok": true]) }
        let api = APIClient(base: base, session: stub.session)
        try await api.log(taskId: 7, value: nil, status: .slip, day: "2026-10-01")
        let body = try JSONSerialization.jsonObject(with: try #require(stub.calls.first).body) as? [String: Any]
        #expect(body?["task_id"] as? Int == 7)
        #expect(body?["value"] is NSNull)
        #expect(body?["status"] as? String == "slip")
        #expect(body?["day"] as? String == "2026-10-01")
    }

    @Test("ошибка сервера — код из {error}, статус; без тела — http_<статус>")
    func serverErrors() async throws {
        let stub = Stub { call in
            call.url.path.hasSuffix("today") ? Stub.json(404, ["error": "not_found"]) : (502, Data("<html>".utf8))
        }
        let api = APIClient(base: base, session: stub.session)
        await #expect(throws: APIError(.http(status: 404, code: "not_found"))) { try await api.today() }
        await #expect(throws: APIError(.http(status: 502, code: "http_502"))) { try await api.heatmap(days: 7) }
    }

    @Test("ключ больше не пускает — выход; другой 401 (неверный пароль календаря) — нет")
    func signedOut() {
        #expect(APIError(.http(status: 401, code: "bad_session")).isSignedOut)
        #expect(APIError(.http(status: 401, code: "session_expired")).isSignedOut)
        #expect(APIError(.http(status: 401, code: "no_session")).isSignedOut)
        #expect(!APIError(.http(status: 401, code: "apple_auth")).isSignedOut)
        #expect(!APIError(.http(status: 403, code: "bad_session")).isSignedOut)
        #expect(!APIError(.network).isSignedOut)
    }

    @Test("200 с оборванным телом — не успех, а ошибка ответа (как в мини-аппе)")
    func brokenBody() async throws {
        let stub = Stub { _ in (200, Data("{\"day\":".utf8)) }
        let api = APIClient(base: base, session: stub.session)
        await #expect(throws: APIError(.badResponse)) { try await api.today() }
    }

    @Test("нет связи — ошибка сети")
    func offline() async throws {
        let stub = Stub { _ in throw URLError(.notConnectedToInternet) }
        let api = APIClient(base: base, session: stub.session)
        await #expect(throws: APIError(.network)) { try await api.today() }
    }

    @Test("ответ без тела ({ok}) — успех для вызовов без результата")
    func emptyOk() async throws {
        let stub = Stub { _ in (204, Data()) }
        let api = APIClient(base: base, session: stub.session)
        try await api.deleteTask(id: 3)
        #expect(stub.calls.first?.method == "DELETE")
        #expect(stub.calls.first?.url.path == "/api/tasks/3")
    }

    @Test("вход через Telegram: id_token, устройство и язык — на сервер, без ключа")
    func signIn() async throws {
        let stub = Stub { _ in Stub.json(200, ["token": "k", "is_new": true]) }
        let api = APIClient(base: base, session: stub.session)
        let res = try await api.signInWithTelegram(idToken: "a.b.c", device: "ios", language: "ru-RU")
        #expect(res == SignedIn(token: "k", isNew: true))
        let call = try #require(stub.calls.first)
        #expect(call.url.path == "/api/auth/telegram")
        #expect(call.headers["Authorization"] == nil)
        let body = try JSONSerialization.jsonObject(with: call.body) as? [String: String]
        #expect(body == ["id_token": "a.b.c", "device": "ios", "language": "ru-RU"])
    }

    @Test("правка дела: «весь день» — это time: null, а не пропущенное поле")
    func todoPatch() async throws {
        let stub = Stub { _ in Stub.json(200, ["ok": true]) }
        let api = APIClient(base: base, session: stub.session)
        try await api.updateTodo(id: 5, ["time": nil, "done": true])
        let body = try JSONSerialization.jsonObject(with: try #require(stub.calls.first).body) as? [String: Any]
        #expect(body?["time"] is NSNull)
        #expect(body?["done"] as? Bool == true)
    }
}

@Suite("Подменённый Telegram")
struct DevTelegramTests {
    @Test("initData как у mockEnv: id, имя, язык, ненастоящая подпись")
    func initData() throws {
        let raw = DevTelegram.initData(userId: 123, firstName: "Даша + Аня", languageCode: "en", now: Date(timeIntervalSince1970: 1_000))
        var c = URLComponents()
        c.percentEncodedQuery = raw
        let items = Dictionary(uniqueKeysWithValues: (c.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(items["hash"] == DevTelegram.mockHash)
        #expect(items["auth_date"] == "1000")
        let user = try JSONSerialization.jsonObject(with: Data(try #require(items["user"]).utf8)) as? [String: Any]
        #expect(user?["id"] as? Int == 123)
        #expect(user?["first_name"] as? String == "Даша + Аня")
        #expect(user?["language_code"] as? String == "en")
        #expect(!raw.contains("+"))
    }
}
