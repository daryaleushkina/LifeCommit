import Foundation
import Testing
@testable import LifeCommitKit

@Suite("Вход через Telegram (OpenID, PKCE)")
struct TelegramOAuthTests {
    @Test("PKCE: challenge — base64url(SHA-256(verifier)), пример из RFC 7636")
    func pkceVector() {
        let p = TelegramOAuth.PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(p.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test("случайный verifier — 43 знака base64url, каждый раз новый")
    func pkceRandom() {
        let a = TelegramOAuth.PKCE.random(), b = TelegramOAuth.PKCE.random()
        #expect(a.verifier.count == 43)
        #expect(a.verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(a.verifier != b.verifier)
    }

    @Test("адрес входа: наш бот, наш адрес возврата, только openid и profile, S256")
    func authURL() throws {
        let p = TelegramOAuth.PKCE(verifier: "v")
        let url = TelegramOAuth.authURL(clientId: "7000000001", pkce: p)
        let c = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(c.host == "oauth.telegram.org")
        #expect(c.path == "/auth")
        let q = Dictionary(uniqueKeysWithValues: (c.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(q["client_id"] == "7000000001")
        #expect(q["redirect_uri"] == "lifecommit://tglogin")
        #expect(q["response_type"] == "code")
        #expect(q["scope"] == "openid profile")
        #expect(q["code_challenge"] == p.challenge)
        #expect(q["code_challenge_method"] == "S256")
        #expect(TelegramOAuth.crossAppURL(clientId: "1", pkce: p).path == "/crossapp")
    }

    @Test("адрес возврата: код; отказ Telegram или пустой код — ошибка, а не вход")
    func callback() throws {
        #expect(try TelegramOAuth.code(from: URL(string: "lifecommit://tglogin?code=abc&state=x")!) == "abc")
        #expect(throws: TelegramOAuth.Failure.denied("access_denied")) { try TelegramOAuth.code(from: URL(string: "lifecommit://tglogin?error=access_denied")!) }
        #expect(throws: TelegramOAuth.Failure.denied("no_code")) { try TelegramOAuth.code(from: URL(string: "lifecommit://tglogin")!) }
        #expect(throws: TelegramOAuth.Failure.denied("no_code")) { try TelegramOAuth.code(from: URL(string: "lifecommit://tglogin?code=")!) }
    }

    @Test("обмен кода: форма с verifier и адресом возврата → id_token")
    func exchange() async throws {
        let stub = Stub { _ in Stub.json(200, ["id_token": "h.p.s"]) }
        let p = TelegramOAuth.PKCE(verifier: "ver+/=")
        let token = try await TelegramOAuth.exchange(session: stub.session, code: "c0de", clientId: "7000000001", pkce: p)
        #expect(token == "h.p.s")
        let call = try #require(stub.calls.first)
        #expect(call.url.absoluteString == "https://oauth.telegram.org/token")
        #expect(call.headers["Content-Type"] == "application/x-www-form-urlencoded")
        var form = URLComponents()
        form.percentEncodedQuery = String(data: call.body, encoding: .utf8)
        let q = Dictionary(uniqueKeysWithValues: (form.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(q["grant_type"] == "authorization_code")
        #expect(q["code"] == "c0de")
        #expect(q["code_verifier"] == "ver+/=")
        #expect(q["redirect_uri"] == "lifecommit://tglogin")
        #expect(q["client_id"] == "7000000001")
    }

    @Test("обмен кода: отказ Telegram, чужой ответ, нет связи — свои ошибки")
    func exchangeFailures() async throws {
        let p = TelegramOAuth.PKCE(verifier: "v")
        let denied = Stub { _ in Stub.json(400, ["error": "invalid_grant"]) }
        await #expect(throws: TelegramOAuth.Failure.denied("invalid_grant")) {
            try await TelegramOAuth.exchange(session: denied.session, code: "c", clientId: "1", pkce: p)
        }
        let garbage = Stub { _ in (200, Data("<html>".utf8)) }
        await #expect(throws: TelegramOAuth.Failure.badResponse) {
            try await TelegramOAuth.exchange(session: garbage.session, code: "c", clientId: "1", pkce: p)
        }
        let offline = Stub { _ in throw URLError(.timedOut) }
        await #expect(throws: TelegramOAuth.Failure.network) {
            try await TelegramOAuth.exchange(session: offline.session, code: "c", clientId: "1", pkce: p)
        }
        // Вход закрыли, пока шёл обмен, — это отмена, а не «нет связи».
        let cancelled = Stub { _ in throw URLError(.cancelled) }
        await #expect(throws: TelegramOAuth.Failure.cancelled) {
            try await TelegramOAuth.exchange(session: cancelled.session, code: "c", clientId: "1", pkce: p)
        }
    }

    @Test("ссылка в приложение Telegram: есть — берём; нет или ошибка — входим через браузерный лист")
    func crossApp() async throws {
        let p = TelegramOAuth.PKCE(verifier: "v")
        let ok = Stub { _ in Stub.json(200, ["url": "tg://oauth?token=1"]) }
        #expect(await TelegramOAuth.crossAppLink(session: ok.session, clientId: "1", pkce: p) == URL(string: "tg://oauth?token=1"))
        let none = Stub { _ in Stub.json(200, [String: String]()) }
        #expect(await TelegramOAuth.crossAppLink(session: none.session, clientId: "1", pkce: p) == nil)
        let fail = Stub { _ in Stub.json(500, ["error": "x"]) }
        #expect(await TelegramOAuth.crossAppLink(session: fail.session, clientId: "1", pkce: p) == nil)
    }
}

@Suite("Ключ в Keychain")
struct TokenStoreTests {
    @Test("в памяти: сохранить, прочитать, забыть")
    func memory() throws {
        let store = MemoryTokenStore()
        #expect(try store.load() == nil)
        try store.save("a")
        try store.save("b")
        #expect(try store.load() == "b")
        try store.clear()
        #expect(try store.load() == nil)
    }

    @Test("Keychain: сохранить поверх, прочитать, забыть (свой сервис, чтобы не трогать настоящий ключ)")
    func keychain() throws {
        let store = KeychainTokenStore(service: "app.lifecommit.tests.\(UUID().uuidString)")
        defer { try? store.clear() }
        #expect(try store.load() == nil)
        try store.save("first")
        try store.save("second")
        #expect(try store.load() == "second")
        try store.clear()
        #expect(try store.load() == nil)
        try store.clear()
    }
}
