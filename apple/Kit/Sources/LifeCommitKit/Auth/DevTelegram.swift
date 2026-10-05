// Подменённый Telegram для локального стенда и тестов — как mockEnv мини-аппа и worker/test/harness.ts: сервер с
// DEV_AUTH_BYPASS=1 принимает эту «подпись». На проде она не проходит (hash ненастоящий) — и в сборке для людей
// приложение её не шлёт (только #if DEBUG).
import Foundation

public enum DevTelegram {
    public static let mockHash = "mock-hash-not-valid-for-backend"

    /// Строка initData для `Authorization: tma …` от имени пользователя Telegram с этим id.
    public static func initData(userId: Int, firstName: String = "Тест", languageCode: String = "ru", now: Date = Date()) -> String {
        let user = "{\"id\":\(userId),\"first_name\":\(jsonString(firstName)),\"language_code\":\(jsonString(languageCode)),\"username\":\"u\(userId)\"}"
        var c = URLComponents()
        c.queryItems = [
            URLQueryItem(name: "auth_date", value: String(Int(now.timeIntervalSince1970))),
            URLQueryItem(name: "hash", value: mockHash),
            URLQueryItem(name: "signature", value: "mock-signature"),
            URLQueryItem(name: "user", value: user),
        ]
        // URLSearchParams на сервере читает «+» как пробел — кодируем его явно.
        return (c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    }

    private static func jsonString(_ s: String) -> String {
        let data = try? JSONEncoder().encode(s)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }
}
