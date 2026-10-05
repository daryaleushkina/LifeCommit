// Переходы по маршрутам: экран, открытый по id, не меняет смысл, когда данные под ним поменялись. Проверка — картинкой
// окна до и после (без эталонов): экран должен остаться тем же. Только iPhone — логика маршрутов общая с Mac.
#if os(iOS)
import LifeCommitKit
import SwiftUI
import Testing
import UIKit
@testable import LifeCommit

@MainActor
@Suite("Переходы")
struct RouteTests {
    @Test("редактор привычки, которая пропала с «Сегодня» (отложили, удалили на другом устройстве), не становится «Новой привычкой»")
    func editorOfVanishedHabit() async throws {
        let user = UserSettings(id: 777, firstName: "Даша")
        let habit = TodayTask(id: 4, title: "Не курить", kind: .abstain, lastSlipOn: "2026-09-20")
        let m = AppModel(api: APIClient(base: FakeServer.base), tokens: MemoryTokenStore())
        m.showForTests(user: user, today: TodayResponse(day: "2026-10-05", tasks: [habit]))
        m.path = [.editTask(4)]
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "нет сцены хоста тестов")
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = UIHostingController(rootView: MainView()
            .environment(m)
            .environment(\.strings, m.strings)
            .environment(\.palette, Palette.of(.light))
            .environment(\.glowEnabled, false))
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let before = await picture(window)
        m.showForTests(user: user, today: TodayResponse(day: "2026-10-05"))
        let after = await picture(window)
        #expect(after == before, "экран редактора поменялся, когда привычка пропала с «Сегодня»")
    }

    /// Картинка окна после того, как SwiftUI применил изменения модели.
    private func picture(_ window: UIWindow) async -> Data {
        for _ in 0..<3 {
            await Task.yield()
            window.layoutIfNeeded()
        }
        return UIGraphicsImageRenderer(bounds: window.bounds).pngData { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
    }
}
#endif
