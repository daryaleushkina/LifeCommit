// Куда ходит приложение и как входит. Прод — https://lifecommit.app/api (Info.plist LCAPIBase). Для разработки и
// UI-тестов — аргументы запуска (они попадают в UserDefaults, и оба работают только в сборке Debug):
// -LCAPIBase http://localhost:5181/api, -LCDevUser 123 — войти подменённым Telegram (только не на прод: сервер с
// DEV_AUTH_BYPASS).
import Foundation

enum Config {
    static var apiBase: URL {
        #if DEBUG
        let allowOverride = true
        #else
        let allowOverride = false
        #endif
        return apiBase(
            override: UserDefaults.standard.string(forKey: "LCAPIBase"),
            plist: Bundle.main.object(forInfoDictionaryKey: "LCAPIBase") as? String,
            allowOverride: allowOverride
        )
    }

    /// Подмена адреса (аргумент запуска -LCAPIBase) — только в сборке для разработки: в сборке для людей настройки
    /// приложения может переписать любая программа на Mac (`defaults write`), и ключ сессии ушёл бы на чужой сервер.
    static func apiBase(override: String?, plist: String?, allowOverride: Bool) -> URL {
        if allowOverride, let override, let url = URL(string: override) { return url }
        if let plist, let url = URL(string: plist) { return url }
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
        device(macOS: true, iOSAppOnMac: false)
        #else
        device(macOS: false, iOSAppOnMac: ProcessInfo.processInfo.isiOSAppOnMac)
        #endif
    }

    /// iPhone-приложение, запущенное на Mac с Apple Silicon, — тоже компьютер: ключ компьютера аккаунт не удаляет
    /// (docs/mobile.md), а метку сервер берёт с клиента.
    static func device(macOS: Bool, iOSAppOnMac: Bool) -> String {
        macOS || iOSAppOnMac ? "mac" : "ios"
    }
}
