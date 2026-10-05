// Официальный вход Telegram (OpenID Connect) — как SDK TelegramMessenger/telegram-login-ios (MIT), но своим кодом:
// без глобального состояния, с тестами и одинаково для iPhone и Mac.
//   1. PKCE: случайный verifier, challenge = base64url(SHA-256(verifier)).
//   2. Есть приложение Telegram (только iPhone) — /crossapp даёт ссылку, Telegram сам вернёт в приложение
//      redirect_uri?code=…; нет — страница oauth.telegram.org/auth в ASWebAuthenticationSession.
//   3. Код + verifier → POST oauth.telegram.org/token → id_token (без секрета: так Telegram пускает приложения).
//   4. id_token → наш сервер (APIClient.signInWithTelegram) → ключ сессии.
import CryptoKit
import Foundation

public enum TelegramOAuth {
    public static let base = URL(string: "https://oauth.telegram.org")!
    /// Куда Telegram возвращает код. Пока нет платного аккаунта Apple (Associated Domains) — своя схема; её же нужно
    /// внести в @BotFather → Login Widget → Allowed URLs (docs/mobile.md).
    public static let redirectURI = "lifecommit://tglogin"
    public static let callbackScheme = "lifecommit"
    /// openid — кто вошёл; profile — имя, @username, фото (для нового пользователя). Телефон не просим.
    public static let scopes = ["openid", "profile"]

    public struct PKCE: Sendable, Equatable {
        public let verifier: String
        public let challenge: String

        public init(verifier: String) {
            self.verifier = verifier
            self.challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        }

        /// 32 случайных байта → 43 знака base64url.
        public static func random() -> PKCE {
            var bytes = [UInt8](repeating: 0, count: 32)
            var rng = SystemRandomNumberGenerator()
            for i in bytes.indices { bytes[i] = UInt8.random(in: .min ... .max, using: &rng) }
            return PKCE(verifier: base64url(Data(bytes)))
        }

        static func base64url(_ data: Data) -> String {
            data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
    }

    static func query(clientId: String, pkce: PKCE, redirectURI: String) -> [URLQueryItem] {
        [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
    }

    /// Страница входа Telegram (браузерный лист): QR или номер телефона.
    public static func authURL(clientId: String, pkce: PKCE, redirectURI: String = redirectURI) -> URL {
        var c = URLComponents(url: base.appending(path: "auth"), resolvingAgainstBaseURL: false)!
        c.queryItems = query(clientId: clientId, pkce: pkce, redirectURI: redirectURI)
        return c.url!
    }

    /// Запрос ссылки в приложение Telegram (iPhone с установленным Telegram).
    public static func crossAppURL(clientId: String, pkce: PKCE, redirectURI: String = redirectURI) -> URL {
        var c = URLComponents(url: base.appending(path: "crossapp"), resolvingAgainstBaseURL: false)!
        c.queryItems = query(clientId: clientId, pkce: pkce, redirectURI: redirectURI)
        return c.url!
    }

    public enum Failure: Error, Sendable, Equatable {
        /// Человек закрыл вход.
        case cancelled
        /// Telegram вернул ошибку (например, access_denied) или ответ без кода.
        case denied(String)
        /// Связи с Telegram нет.
        case network
        /// Telegram ответил не так, как ждали.
        case badResponse
    }

    /// Код из адреса возврата `lifecommit://tglogin?code=…`; отказ — Failure.denied.
    public static func code(from callback: URL) throws(Failure) -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value { throw .denied(error) }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw .denied("no_code") }
        return code
    }

    /// Ссылка в Telegram из ответа /crossapp; нет её — входим через браузерный лист.
    public static func crossAppLink(session: URLSession, clientId: String, pkce: PKCE) async -> URL? {
        // Запасной путь задуман: не вышло — входим через браузерный лист, а почему — в лог.
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(from: crossAppURL(clientId: clientId, pkce: pkce))
        } catch {
            apiLog.notice("telegram crossapp fallback: \(String(describing: error), privacy: .public)")
            return nil
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 200, let body = try? JSONDecoder().decode(CrossApp.self, from: data), let link = body.url.flatMap(URL.init(string:)) else {
            apiLog.notice("telegram crossapp fallback: status \(status)")
            return nil
        }
        return link
    }

    private struct CrossApp: Decodable {
        let url: String?
    }

    /// Обмен кода на id_token (PKCE, без секрета).
    public static func exchange(session: URLSession, code: String, clientId: String, pkce: PKCE, redirectURI: String = redirectURI) async throws(Failure) -> String {
        var request = URLRequest(url: base.appending(path: "token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "code_verifier", value: pkce.verifier),
        ]
        // В форме «+» — это пробел: кодируем его явно, иначе base64url-код с «+» (у Telegram его нет, но мало ли) сломается.
        request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw .cancelled
        } catch let error as URLError where error.code == .cancelled {
            throw .cancelled
        } catch {
            apiLog.error("telegram token exchange failed: \(String(describing: error), privacy: .public)")
            throw .network
        }
        guard let http = response as? HTTPURLResponse else { throw .badResponse }
        let body = try? JSONDecoder().decode(TokenResponse.self, from: data)
        if let token = body?.id_token, http.statusCode == 200, !token.isEmpty { return token }
        if let error = body?.error { throw .denied(error) }
        apiLog.error("telegram token exchange: unexpected answer, status \(http.statusCode)")
        throw .badResponse
    }

    private struct TokenResponse: Decodable {
        let id_token: String?
        let error: String?
    }
}
