// Клиент сервера LifeCommit (Cloudflare Worker, /api). Ошибка сервера всегда {"error":"<код>"} со статусом —
// здесь она становится APIError с этим кодом: экран решает, что показать, а не гадает по тексту.
import Foundation
import os
import Synchronization

let apiLog = Logger(subsystem: "app.lifecommit", category: "api")

/// Чем подписан запрос.
public enum Credential: Sendable, Equatable {
    /// Ключ сессии устройства (`Authorization: Bearer`), его выдаёт вход через Telegram.
    case session(String)
    /// Подпись Telegram (initData) — в нативном приложении только подменённая, для локального стенда и тестов.
    case telegramInitData(String)

    var header: String {
        switch self {
        case .session(let token): "Bearer \(token)"
        case .telegramInitData(let raw): "tma \(raw)"
        }
    }
}

public struct APIError: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Kind: Sendable, Equatable {
        /// Сервер ответил ошибкой: статус и код из {"error":"…"}.
        case http(status: Int, code: String)
        /// Нет связи, таймаут, обрыв.
        case network
        /// Ответ пришёл, но не тот: не JSON, обрезан, другие поля.
        case badResponse
    }

    public let kind: Kind

    public init(_ kind: Kind) { self.kind = kind }

    public var status: Int? { if case .http(let s, _) = kind { s } else { nil } }
    public var code: String? { if case .http(_, let c) = kind { c } else { nil } }

    /// Ключ больше не пускает — забыть его и показать вход. Другой 401 (например, `apple_auth` у календаря) — это
    /// ошибка дела, а не выход.
    public var isSignedOut: Bool {
        guard case .http(401, let code) = kind else { return false }
        return ["bad_session", "session_expired", "no_session"].contains(code)
    }

    public var description: String {
        switch kind {
        case .http(let s, let c): "HTTP \(s) \(c)"
        case .network: "network"
        case .badResponse: "bad response"
        }
    }
}

/// Ответ без тела (или тело не нужно): `{ok:true}`, 204.
public struct Empty: Decodable, Sendable, Equatable {
    public init() {}
    public init(from decoder: Decoder) throws {}
}

public final class APIClient: Sendable {
    /// Адрес API, например https://lifecommit.app/api.
    public let base: URL
    private let session: URLSession
    private let credential = Mutex<Credential?>(nil)

    public init(base: URL, session: URLSession = APIClient.defaultSession) {
        self.base = base
        self.session = session
    }

    public static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    public var currentCredential: Credential? { credential.withLock { $0 } }

    public func setCredential(_ value: Credential?) {
        credential.withLock { $0 = value }
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    /// Запрос к API. `body` — JSON; ответ декодируется в T. Ошибка — APIError (отмену пробрасывает как есть).
    public func send<T: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], json body: (any Encodable & Sendable)? = nil, as: T.Type = T.self
    ) async throws -> T {
        var request = URLRequest(url: url(path, query))
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(body)
        }
        return try await perform(request)
    }

    /// Запрос с сырым телом (аудио, картинка).
    public func upload<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], data: Data, contentType: String, as: T.Type = T.self) async throws -> T {
        var request = URLRequest(url: url(path, query))
        request.httpMethod = method
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        return try await perform(request)
    }

    func url(_ path: String, _ query: [URLQueryItem]) -> URL {
        var components = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        return components.url!
    }

    private func perform<T: Decodable>(_ base: URLRequest) async throws -> T {
        var request = base
        if let credential = currentCredential { request.setValue(credential.header, forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            apiLog.error("\(request.httpMethod ?? "", privacy: .public) \(request.url?.path ?? "", privacy: .public) failed: \(String(describing: error), privacy: .public)")
            throw APIError(.network)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError(.badResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? Self.decoder.decode(ServerError.self, from: data))?.error ?? "http_\(http.statusCode)"
            apiLog.notice("\(request.httpMethod ?? "", privacy: .public) \(request.url?.path ?? "", privacy: .public) → \(http.statusCode) \(code, privacy: .public)")
            throw APIError(.http(status: http.statusCode, code: code))
        }
        if T.self == Empty.self { return Empty() as! T }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            // 200 с оборванным или чужим телом — не успех (как в мини-аппе, src/api.ts). Причина — в лог: так видно, что
            // поменялась модель на сервере, а не пропала связь.
            apiLog.error("decode \(String(describing: T.self), privacy: .public) from \(request.url?.path ?? "", privacy: .public): \(String(describing: error), privacy: .public)")
            throw APIError(.badResponse)
        }
    }

    private struct ServerError: Decodable {
        let error: String
    }
}
