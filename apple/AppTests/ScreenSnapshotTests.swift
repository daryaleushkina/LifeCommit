// Сравнение — попиксельное с допуском 0,1% площади на сглаживание (perceptualPrecision на симуляторе даёт ложные
// падения на разнице в 16 пикселей).
// Снимки экранов — как checkScreen в e2e/screens.spec.ts: эталоны лежат рядом (__Snapshots__), переснимать — только
// при намеренной правке вида (LC_RECORD=1 apple/scripts/test.sh) и написать об этом в коммите. iPhone (402×874, как
// iPhone 17 Pro) и Mac (окно 420×860), светлая и тёмная тема. Данные — свои, без сети.
import LifeCommitKit
import SnapshotTesting
import SwiftUI
import Testing
@testable import LifeCommit

@MainActor
@Suite("Снимки экранов", .serialized)
struct ScreenSnapshotTests {
    static let user = UserSettings(id: 777, firstName: "Даша", languageCode: "ru", timezone: "Asia/Ho_Chi_Minh")

    static let today = TodayResponse(
        day: "2026-10-05",
        tasks: [
            TodayTask(id: 1, title: "Сходить в спортзал", kind: .check, value: 1, logged: true),
            TodayTask(id: 2, title: "Пить воду", kind: .count, unit: "стаканов", target: 8, value: 3, logged: true),
            TodayTask(id: 3, title: "Читать", kind: .count, unit: "страниц", target: 20),
            TodayTask(id: 4, title: "Не курить", kind: .abstain, logged: true, status: .clean, cleanBefore: 14, lastSlipOn: "2026-09-20"),
            TodayTask(id: 5, title: "Английский", kind: .check, schedule: .perWeek, perWeek: 3),
            TodayTask(id: 6, title: "Медитация", kind: .check, schedule: .weekdays, weekdays: 0b0000101, due: false),
        ],
        archived: [ArchivedTask(id: 9, title: "Бегать по утрам")],
        todos: Todos.sorted([
            Todo(id: 11, title: "Купить корм Тесле", day: "2026-10-05"),
            Todo(id: 12, title: "Позвонить в банк", day: "2026-10-05", time: "15:00"),
            Todo(id: 13, title: "Записаться к врачу", day: "2026-10-05", done: true),
            Todo(id: 14, title: "Сдать документы", day: "2026-10-04"),
        ]),
        todosLater: 1
    )

    func model(onboarding: Bool = false, today: TodayResponse = Self.today) -> AppModel {
        let m = AppModel(api: APIClient(base: URL(string: "https://lifecommit.test/api")!), tokens: MemoryTokenStore())
        m.showForTests(user: Self.user, today: today, onboarding: onboarding)
        return m
    }

    @Test("«Сегодня»", arguments: [ColorScheme.light, .dark])
    func today(scheme: ColorScheme) {
        check(MainView(), model: model(), scheme: scheme, named: "today")
    }

    @Test("«Сегодня» пустое: «На сегодня всё»", arguments: [ColorScheme.light])
    func todayEmpty(scheme: ColorScheme) {
        check(MainView(), model: model(today: TodayResponse(day: "2026-10-05", archived: [ArchivedTask(id: 1, title: "x")])), scheme: scheme, named: "today-empty")
    }

    @Test("«Чего я хочу?» (первый экран)", arguments: [ColorScheme.light, .dark])
    func onboarding(scheme: ColorScheme) {
        check(MainView(), model: model(onboarding: true, today: TodayResponse(day: "2026-10-05")), scheme: scheme, named: "pick")
    }

    @Test("Редактор: новая «считать» и правка «бросить»", arguments: [ColorScheme.light, .dark])
    func editor(scheme: ColorScheme) {
        check(TaskEditorView(task: nil, kind: .count), model: model(), scheme: scheme, named: "editor-count")
        check(TaskEditorView(task: Self.today.tasks.first { $0.id == 4 }, kind: .check), model: model(), scheme: scheme, named: "editor-abstain")
    }

    @Test("Экран привычки: «считать» (столбики) и «бросить» (счёт, календарь)", arguments: [ColorScheme.light, .dark])
    func detail(scheme: ColorScheme) {
        let m = model()
        m.setHistoryForTests(2, TaskHistory(start: "2026-09-20", goals: [HistoryGoal(effectiveFrom: "2026-09-20", target: 8)], logs: [
            HistoryLog(day: "2026-09-28", value: 8), HistoryLog(day: "2026-09-30", value: 5), HistoryLog(day: "2026-10-01", value: 2),
            HistoryLog(day: "2026-10-02", value: 9), HistoryLog(day: "2026-10-04", value: 4),
        ]))
        m.setHistoryForTests(4, TaskHistory(start: "2026-09-25", goals: [], logs: [
            HistoryLog(day: "2026-09-27", value: 0, status: .slip), HistoryLog(day: "2026-10-01", value: 1, status: .clean), HistoryLog(day: "2026-10-03", value: 1, status: .clean),
        ]))
        check(TaskDetailView(taskId: 2), model: m, scheme: scheme, named: "detail-count")
        check(TaskDetailView(taskId: 4), model: m, scheme: scheme, named: "detail-abstain")
    }

    @Test("«Отложенные»", arguments: [ColorScheme.light, .dark])
    func archive(scheme: ColorScheme) {
        check(ArchiveView(), model: model(), scheme: scheme, named: "archive")
    }

    @Test("Вход", arguments: [ColorScheme.light, .dark])
    func signIn(scheme: ColorScheme) {
        let m = model()
        m.showForTests(user: Self.user, today: Self.today, phase: .signedOut)
        check(SignInView(), model: m, scheme: scheme, named: "sign-in")
    }

    // MARK: Снимок

    private func check(_ view: some View, model: AppModel, scheme: ColorScheme, named name: String) {
        let screen = ZStack {
            GlowBackground()
            view
        }
        .environment(model)
        .environment(\.palette, Palette.of(scheme))
        .environment(\.strings, model.strings)
        .environment(\.colorScheme, scheme)
        // Пятна фона — только на «Сегодня»: остальные эталоны на ровном фоне весят в десятки раз меньше.
        .environment(\.glowEnabled, name == "today")
        .font(.onest(16))
        .foregroundStyle(Palette.of(scheme).text)
        .tint(Palette.of(scheme).accent)

        let record: SnapshotTestingConfiguration.Record = ProcessInfo.processInfo.environment["LC_RECORD"] == "1" ? .all : .never
        withSnapshotTesting(record: record) {
            #if os(iOS)
            let controller = UIHostingController(rootView: screen)
            // Масштаб 1: эталоны в git весят в 9 раз меньше, чем при 3×, а вёрстку видно так же.
            let traits = UITraitCollection { t in
                t.userInterfaceStyle = scheme == .dark ? .dark : .light
                t.displayScale = 1
                // sRGB, а не Display P3: эталон одинаков на любом устройстве и переживает пережатие PNG.
                t.displayGamut = .SRGB
            }
            let config = ViewImageConfig(safeArea: .zero, size: CGSize(width: 402, height: 874), traits: traits)
            assertSnapshot(
                of: controller,
                as: .image(drawHierarchyInKeyWindow: true, precision: 0.999, size: config.size, traits: traits),
                named: "iphone-\(scheme == .dark ? "dark" : "light")-\(name)",
                testName: "screen"
            )
            #else
            let host = NSHostingView(rootView: screen.frame(width: 420, height: 860))
            host.frame = CGRect(x: 0, y: 0, width: 420, height: 860)
            host.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            assertSnapshot(
                of: host,
                as: .image(precision: 0.999),
                named: "mac-\(scheme == .dark ? "dark" : "light")-\(name)",
                testName: "screen"
            )
            #endif
        }
    }
}
