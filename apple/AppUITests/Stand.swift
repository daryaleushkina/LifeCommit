// Локальный стенд для UI-сценариев — как фикстура `me` в e2e: у каждого теста свой человек (подменённый Telegram),
// данные — через API, после теста — удаление аккаунта. Адрес стенда — переменная LC_API_BASE (её передаёт
// apple/scripts/test.sh как TEST_RUNNER_LC_API_BASE), по умолчанию http://localhost:5173/api.
import Foundation
import LifeCommitKit
import XCTest

struct Stand {
    let base: URL
    let userId: Int
    private let initData: String

    init(userId: Int = 9_000_000_000_000 + Int.random(in: 0..<1_000_000_000)) {
        let raw = ProcessInfo.processInfo.environment["LC_API_BASE"] ?? "http://localhost:5173/api"
        base = URL(string: raw)!
        self.userId = userId
        initData = DevTelegram.initData(userId: userId, firstName: "Даша")
    }

    /// Запрос к API от имени этого человека; ответ — JSON (или nil у пустого).
    @discardableResult
    func call(_ method: String, _ path: String, _ body: Any? = nil) throws -> Any? {
        // «calendar?from=…»: путь и параметры — по отдельности (appending(path:) закодировал бы «?» в %3F).
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        var components = URLComponents(url: base.appending(path: parts[0]), resolvingAgainstBaseURL: false)!
        if parts.count > 1 { components.query = parts[1] }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("tma \(initData)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = XCTestExpectation()
        nonisolated(unsafe) var result: (Data?, URLResponse?, Error?)
        URLSession.shared.dataTask(with: request) { data, response, error in
            result = (data, response, error)
            done.fulfill()
        }.resume()
        guard XCTWaiter.wait(for: [done], timeout: 20) == .completed else { throw StandError.timeout(path) }
        if let error = result.2 { throw error }
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        let text = result.0.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        guard (200..<300).contains(status) else { throw StandError.http(method, path, status, text) }
        guard let data = result.0, !data.isEmpty else { return nil }
        return try JSONSerialization.jsonObject(with: data)
    }

    func session() throws {
        try call("POST", "session", ["timezone": TimeZone.current.identifier])
    }

    func today() throws -> [String: Any] {
        try call("GET", "today") as? [String: Any] ?? [:]
    }

    func tasks() throws -> [[String: Any]] { try today()["tasks"] as? [[String: Any]] ?? [] }
    func todos() throws -> [[String: Any]] { try today()["todos"] as? [[String: Any]] ?? [] }

    func deleteAccount() {
        // Уборка необязательна для проверки, но не тихо: не вышло — в лог прогона.
        do { try call("DELETE", "account") } catch { print("stand cleanup failed for \(userId): \(error)") }
    }

    /// Приложение от имени этого человека, на стенде, без анимаций.
    @MainActor
    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-LCAPIBase", base.absoluteString, "-LCDevUser", String(userId), "-LCUITest", "YES", "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launch()
        return app
    }
}

enum StandError: Error {
    case timeout(String)
    case http(String, String, Int, String)
}

extension XCTestCase {
    /// Ждать, пока условие на сервере станет верным (сервер догоняет экран), — без пауз вслепую.
    func eventually(_ what: String, timeout: TimeInterval = 10, _ check: @escaping () throws -> Bool, file: StaticString = #filePath, line: UInt = #line) {
        let end = Date().addingTimeInterval(timeout)
        var last: Error?
        while Date() < end {
            do {
                if try check() { return }
            } catch {
                last = error
            }
            _ = XCTWaiter.wait(for: [XCTestExpectation()], timeout: 0.3)
        }
        XCTFail("не дождались: \(what)\(last.map { " (\($0))" } ?? "")", file: file, line: line)
    }
}
