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
        // Подменённый сервер: экраны, которые подгружают своё при открытии (календарь), в сеть не ходят.
        let m = AppModel(api: FakeServer(today: today).api, tokens: MemoryTokenStore())
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

    // MARK: Календарь

    static let calendarTodos = [
        Todo(id: 21, title: "Планёрка", day: "2026-10-05", time: "10:00", durationMin: 30, recurring: true, source: .google),
        Todo(id: 22, title: "Забрать посылку", day: "2026-10-05", time: "15:30"),
        Todo(id: 23, title: "Врач", day: "2026-10-05", source: .apple),
        Todo(id: 24, title: "Купить корм Тесле", day: "2026-10-05", done: true),
        Todo(id: 25, title: "Сдать отчёт", day: "2026-10-08"),
        Todo(id: 26, title: "День рождения мамы", day: "2026-10-14", source: .apple),
        Todo(id: 27, title: "Йога", day: "2026-10-20", time: "08:00"),
    ]

    static let googleAccount = CalendarAccount(
        id: 1, provider: .google, login: "dasha@gmail.com", status: .ok, lastSyncAt: ISO8601DateFormatter().string(from: Date()),
        defaultUrl: "g1",
        collections: [
            CalendarCollection(url: "g1", name: "Личный", color: "#E67C73"),
            CalendarCollection(url: "g2", name: "Работа", color: "#33B679"),
            CalendarCollection(url: "g3", name: "Праздники", enabled: false, writable: false),
        ]
    )

    static let appleAccount = CalendarAccount(
        id: 2, provider: .apple, login: "dasha@icloud.com", status: .authFailed, lastSyncAt: nil, defaultUrl: "a1",
        collections: [CalendarCollection(url: "a1", name: "Дом", color: "#34C759")]
    )

    func calendarModel(accounts: [CalendarAccount]? = [googleAccount, appleAccount]) -> AppModel {
        let m = model()
        let day = CalendarDays.bounds(.day, anchor: "2026-10-05")
        let month = CalendarDays.bounds(.month, anchor: "2026-10-05")
        m.setCalendarForTests(ranges: [(day.from, day.to, Self.calendarTodos.filter { $0.day == "2026-10-05" }), (month.from, month.to, Self.calendarTodos)], accounts: accounts)
        return m
    }

    @Test("«Календарь»: день — метки календарей, дела и события дня", arguments: [ColorScheme.light, .dark])
    func calendarDay(scheme: ColorScheme) {
        check(CalendarView(), model: calendarModel(), scheme: scheme, named: "calendar-day")
    }

    @Test("«Календарь»: месяц — точки, выбранный день; ничего не подключено — плашка «Подключите календарь»", arguments: [ColorScheme.light])
    func calendarMonth(scheme: ColorScheme) {
        check(CalendarView(mode: .month), model: calendarModel(accounts: []), scheme: scheme, named: "calendar-month")
    }

    @Test("Шторка дела: своё (день, время, место) и событие календаря (место, созвон, участники, описание)", arguments: [ColorScheme.light, .dark])
    func todoSheet(scheme: ColorScheme) {
        let own = Todo(id: 22, title: "Забрать посылку", day: "2026-10-06", time: "15:30", details: TodoDetails(location: "Почта на Тверской"))
        check(TodoSheet(todo: own, today: "2026-10-05", carried: true, onSave: { _ in }, onDelete: {}), model: model(), scheme: scheme, named: "todo-sheet", sheet: true)
        let event = Todo(id: 21, title: "Планёрка", day: "2026-10-05", time: "10:00", durationMin: 30, recurring: true, source: .google, details: TodoDetails(
            location: "Офис, переговорная 3", link: "https://meet.google.com/abc-defg-hij", peopleCount: 6, people: ["Аня", "Борис", "Вика", "Гоша"],
            notes: "Повестка: итоги недели, планы на следующую. Каждый — по две минуты.", openUrl: "https://calendar.google.com/event?eid=1"))
        check(TodoSheet(todo: event, today: "2026-10-05", carried: true, onSave: { _ in }, onDelete: {}), model: model(), scheme: scheme, named: "event-sheet", sheet: true)
    }

    @Test("«Календари»: подключены Google и Apple (Apple перестал пускать); ничего не подключено; Google — выбрать календари", arguments: [ColorScheme.light, .dark])
    func calendarsSheet(scheme: ColorScheme) {
        check(CalendarsSheet(), model: calendarModel(), scheme: scheme, named: "calendars-connected", sheet: true)
        if scheme == .light {
            check(CalendarsSheet(), model: calendarModel(accounts: []), scheme: scheme, named: "calendars-empty", sheet: true)
            var setup = Self.googleAccount
            setup.status = .setup
            check(CalendarsSheet(), model: calendarModel(accounts: [setup]), scheme: scheme, named: "calendars-google-setup", sheet: true)
        }
    }

    @Test("Подключение Apple: шаги, сайт Apple ID, почта и пароль приложения", arguments: [ColorScheme.light])
    func appleForm(scheme: ColorScheme) {
        check(AppleForm(login: ""), model: model(), scheme: scheme, named: "apple-form", sheet: true)
    }

    @Test("«Потом»: дела на следующие дни, по дням", arguments: [ColorScheme.light])
    func laterSheet(scheme: ColorScheme) {
        let m = model()
        m.setCalendarForTests(later: [
            Todo(id: 31, title: "Забрать посылку", day: "2026-10-06", time: "15:30"),
            Todo(id: 32, title: "Сдать отчёт", day: "2026-10-08"),
            Todo(id: 33, title: "Купить подарок", day: "2026-10-08"),
        ])
        check(LaterSheet(), model: m, scheme: scheme, named: "later", sheet: true)
    }

    // MARK: Снимок

    /// sheet — шторка: в приложении она на своей подложке (presentationBackground — palette.surface), а не на фоне экрана.
    private func check(_ view: some View, model: AppModel, scheme: ColorScheme, named name: String, sheet: Bool = false) {
        let screen = ZStack {
            if sheet { Palette.of(scheme).surface } else { GlowBackground() }
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
