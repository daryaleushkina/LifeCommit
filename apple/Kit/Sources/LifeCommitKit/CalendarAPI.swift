// Раздел «Календарь»: модели и вызовы API — как CalendarAccount и calendar*/connectApple/… в src/api.ts.
// Пути и коды ошибок — docs/mobile.md («Дела и календарь», «Возврат после входа Google»).
import Foundation

public enum CalendarProvider: String, Codable, Sendable, CaseIterable {
    case apple, google
}

/// setup — Google подключён, но календари ещё не выбраны.
public enum CalendarStatus: String, Codable, Sendable {
    case ok
    case authFailed = "auth_failed"
    case error
    case setup
}

/// Календарь внутри подключения; writable — можно ли писать туда наши дела (чужие календари Google — только читать).
public struct CalendarCollection: Codable, Sendable, Equatable, Identifiable {
    public var url: String
    public var name: String
    public var color: String?
    public var enabled: Bool
    public var writable: Bool

    public var id: String { url }

    public init(url: String, name: String, color: String? = nil, enabled: Bool = true, writable: Bool = true) {
        self.url = url
        self.name = name
        self.color = color
        self.enabled = enabled
        self.writable = writable
    }
}

/// Подключённый календарь (GET /calendars).
public struct CalendarAccount: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var provider: CalendarProvider
    public var login: String
    public var status: CalendarStatus
    public var lastSyncAt: String?
    /// Куда пишем наши дела.
    public var defaultUrl: String?
    public var collections: [CalendarCollection]

    public init(
        id: Int, provider: CalendarProvider, login: String, status: CalendarStatus = .ok, lastSyncAt: String? = nil,
        defaultUrl: String? = nil, collections: [CalendarCollection] = []
    ) {
        self.id = id
        self.provider = provider
        self.login = login
        self.status = status
        self.lastSyncAt = lastSyncAt
        self.defaultUrl = defaultUrl
        self.collections = collections
    }
}

/// GET /calendar?from&to. Групповые дела (`groups`) придут вместе с разделом «Вместе» — пока их поле не читаем.
public struct CalendarRange: Codable, Sendable, Equatable {
    public var today: String
    /// Повторы раскрыты сервером; порядок — не отсортирован (Todos.sorted).
    public var todos: [Todo]

    public init(today: String, todos: [Todo]) {
        self.today = today
        self.todos = todos
    }
}

/// Возврат из входа Google в приложение: lifecommit://calendars?status=…[&pending=<код>] (docs/mobile.md). Сервер сам
/// календарь не подключает — подключает приложение кодом (finishGoogle) своим ключом: так чужая ссылка входа не
/// подключит календарь того, кто её открыл, к аккаунту автора ссылки.
public struct GoogleReturn: Sendable, Equatable {
    public enum Status: String, Sendable {
        case ok, denied, expired, failed
    }

    public let status: Status
    /// Одноразовый код подключения — только у ok.
    public let pending: String?

    public init(status: Status, pending: String?) {
        self.status = status
        self.pending = pending
    }

    /// Ссылка возврата → итог; чужая ссылка или неизвестный итог — nil. «ok» без кода (или с испорченным) подключить
    /// нечем — это сбой.
    public init?(url: URL) {
        guard url.scheme == "lifecommit", url.host() == "calendars",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let status = items.first(where: { $0.name == "status" })?.value.flatMap(Status.init(rawValue:))
        else { return nil }
        guard status == .ok else {
            self.init(status: status, pending: nil)
            return
        }
        let code = items.first { $0.name == "pending" }?.value ?? ""
        let valid = code.count == 43 && code.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
        self.init(status: valid ? .ok : .failed, pending: valid ? code : nil)
    }
}

/// Google подключён кодом: fresh — впервые (ждёт выбора календарей, «setup»), иначе — подключён заново.
public struct GoogleFinished: Codable, Sendable, Equatable {
    public var accountId: Int
    public var fresh: Bool

    public init(accountId: Int, fresh: Bool) {
        self.accountId = accountId
        self.fresh = fresh
    }
}

public extension APIClient {
    func calendar(from: String, to: String) async throws -> CalendarRange {
        try await send("GET", "calendar", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)])
    }

    func calendars() async throws -> [CalendarAccount] {
        try await send("GET", "calendars")
    }

    /// Адрес входа Google для приложения (state помечен — после Google человек вернётся ссылкой lifecommit://calendars).
    /// Открываем только https://accounts.google.com: другой адрес в ответе — не наш сервер или сбой.
    func googleSignInURL() async throws -> URL {
        struct Answer: Decodable { let url: String }
        let answer: Answer = try await send("GET", "calendars/google/url", query: [URLQueryItem(name: "client", value: "app")])
        guard let url = URL(string: answer.url), url.scheme == "https", url.host() == "accounts.google.com" else {
            throw APIError(.badResponse)
        }
        return url
    }

    /// Закончить вход Google кодом из ссылки возврата. 404 pending_not_found — чужой или использованный код,
    /// 410 pending_expired — дольше 15 минут.
    func finishGoogle(pending: String) async throws -> GoogleFinished {
        try await send("POST", "calendars/google/finish", json: JSONValue.object(["pending": .string(pending)]))
    }

    /// Apple — почта Apple ID и пароль приложения. 401 apple_auth — Apple не пустил (это не выход из LifeCommit).
    func connectApple(login: String, password: String) async throws {
        _ = try await send("POST", "calendars/apple", json: JSONValue.object(["login": .string(login), "password": .string(password)]), as: Empty.self)
    }

    /// Google подключён, календари выбраны — забрать события.
    func confirmGoogle(accountId: Int) async throws {
        _ = try await send("POST", "calendars/\(accountId)/confirm", as: Empty.self)
    }

    func toggleCollection(accountId: Int, url: String, enabled: Bool) async throws {
        _ = try await send("PATCH", "calendars/\(accountId)/collections", json: JSONValue.object(["url": .string(url), "enabled": .bool(enabled)]), as: Empty.self)
    }

    /// Куда писать наши дела.
    func setDefaultCalendar(accountId: Int, url: String) async throws {
        _ = try await send("PATCH", "calendars/\(accountId)/default", json: JSONValue.object(["url": .string(url)]), as: Empty.self)
    }

    func disconnectCalendar(_ provider: CalendarProvider) async throws {
        _ = try await send("DELETE", "calendars/\(provider.rawValue)", as: Empty.self)
    }

    /// Забрать свежие события из подключённых календарей.
    func syncCalendars() async throws {
        _ = try await send("POST", "calendars/sync", as: Empty.self)
    }
}
