// Куда ходит приложение и как входит. Прод — https://lifecommit.app/api (Info.plist LCAPIBase). Для разработки и
// UI-тестов — аргументы запуска (они попадают в UserDefaults): -LCAPIBase http://localhost:5181/api, -LCDevUser 123 —
// войти подменённым Telegram (только сборка Debug и только не на прод: сервер с DEV_AUTH_BYPASS).
import Foundation

enum Config {
    static var apiBase: URL {
        if let override = UserDefaults.standard.string(forKey: "LCAPIBase"), let url = URL(string: override) { return url }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "LCAPIBase") as? String, let url = URL(string: plist) { return url }
        return URL(string: "https://lifecommit.app/api")!
    }

    /// Пользователь Telegram для подменённого входа (локальный стенд). В сборке для людей — всегда nil.
    static var devUserId: Int? {
        #if DEBUG
        // Не integer(forKey:): строку из аргументов запуска он обрезает до 2 147 483 647 — вошли бы другим человеком.
        guard let raw = UserDefaults.standard.string(forKey: "LCDevUser"), let id = Int(raw), id > 0 else { return nil }
        return id
        #else
        return nil
        #endif
    }

    /// Приложение запущено хостом модульных тестов (снимки экранов): входа и сети нет, экраны собирают сами тесты.
    static var isUnitTestHost: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil && !isUITest
    }

    /// UI-тесты: без анимаций, «Пропустить» онбординга не запоминается между запусками.
    static var isUITest: Bool { UserDefaults.standard.bool(forKey: "LCUITest") }

    /// Устройство для сессии на сервере: ios, mac (android — у Android-приложения).
    static var device: String {
        #if os(macOS)
        "mac"
        #else
        "ios"
        #endif
    }
}
