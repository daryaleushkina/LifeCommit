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
        if scheme == .light {
            // Дело прошлого дня, открытое в календаре: ни «Сегодня», ни «Завтра» — его день в строке «Другой день».
            let past = Todo(id: 23, title: "Сдать отчёт", day: "2026-09-28", done: true)
            check(TodoSheet(todo: past, today: "2026-10-05", carried: false, onSave: { _ in }, onDelete: {}), model: model(), scheme: scheme, named: "todo-sheet-past", sheet: true)
        }
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

    // MARK: «Вместе»

    static let members = [GroupMember(id: 777, name: "Даша"), GroupMember(id: 5, name: "Аня"), GroupMember(id: 6, name: "Петя"), GroupMember(id: 8, name: "Бабушка")]

    static let family: GroupToday = {
        let day = "2026-10-05"
        let rub = GoalUnit(type: "money", forms: ["рубль", "рубля", "рублей"], currency: "₽")
        let items = [
            GroupDayItem(id: 1, title: "Отпуск в Грузии", mode: .goal, people: [777, 5, 6, 8], target: 150_000, total: 62_400, unit: rub, start: day),
            GroupDayItem(id: 2, title: "Вынести мусор", mode: .one, time: "19:00", people: [777, 5, 6, 8], canMark: true, done: true, doneBy: [5], start: day),
            GroupDayItem(id: 3, title: "Помыть посуду", mode: .assign, recurring: true, people: [777], rotate: true, turn: 777, canMark: true, start: day, rrule: "FREQ=DAILY", assignees: [777, 5]),
            GroupDayItem(id: 4, title: "Купить хлеб", mode: .assign, people: [5], forMe: false, start: day, assignees: [5]),
            GroupDayItem(id: 5, title: "Позвонить бабушке", mode: .assign, people: [777, 5, 6], canMark: true, doneBy: [6], start: day, assignees: [777, 5, 6]),
            GroupDayItem(id: 6, title: "Семейный ужин", mode: .event, time: "20:00", people: [777, 5, 6, 8], allMembers: true, start: day),
        ]
        let soon = GroupDayBlock(day: "2026-10-07", group: .init(id: 1, title: "Семья", members: members), items: [
            GroupDayItem(id: 7, title: "Поход в кино", mode: .event, time: "18:30", people: [777, 5, 6], start: "2026-10-07"),
            GroupDayItem(id: 3, title: "Помыть посуду", mode: .assign, recurring: true, people: [5], rotate: true, turn: 5, forMe: false, start: day, rrule: "FREQ=DAILY", assignees: [777, 5]),
        ])
        return GroupToday(id: 1, title: "Семья", role: .owner, members: members, items: items, planned: 4, done: 2,
                          settings: GroupSettings(adminsOnlyEdit: false, tgChatTitle: "Семья 🏡"), upcoming: [soon])
    }()

    static let sport = GroupToday(id: 2, title: "Бег по выходным", role: .member, members: Array(members.prefix(3)), items: [
        GroupDayItem(id: 21, title: "Пробежка 5 км", mode: .assign, time: "07:30", people: [777], canMark: true, start: "2026-10-05", assignees: [777]),
    ], planned: 3, done: 1, settings: GroupSettings(), upcoming: [])

    static let friendsData = FriendsResponse(
        friends: [
            FriendCard(id: 5, firstName: "Аня", username: "anna_k", done: 2, due: 3, days: [0, 1, 2, 0, 3, 5, 2, 1, 0, 4, 6, 2, 3, 1]),
            FriendCard(id: 6, firstName: "Петя", days: [0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0]),
        ],
        incoming: [FriendRequest(id: 9, firstName: "Маша", via: .link)],
        outgoing: [Person(id: 10, firstName: "Коля")],
        link: "https://t.me/LifeCommit_bot?startapp=f_j8wuasb95a"
    )

    static let anyaProfile: FriendProfile = {
        let heat = (0..<200).map { i in HeatDay(day: Days.add("2026-10-05", -i), score: Double([0, 1, 2, 4, 6, 0, 3][i % 7])) }
        return FriendProfile(person: Person(id: 5, firstName: "Аня", username: "anna_k"), today: "2026-10-05", heat: heat, habits: [
            FriendHabit(id: 1, title: "Пить воду", kind: .count, unit: "стаканов", target: 8, value: 3),
            FriendHabit(id: 2, title: "Бег", kind: .check, value: 1),
            FriendHabit(id: 3, title: "Не курить", kind: .abstain, status: .clean, cleanDays: 12),
        ])
    }()

    /// Модель «Вместе»: на экране и на подменённом сервере — одно и то же (экраны перечитывают своё при открытии).
    func togetherModel(today: TodayResponse = Self.today, groups: [GroupToday] = [family, sport], friends: FriendsResponse? = friendsData) -> AppModel {
        let server = FakeServer(today: today)
        server.groups.withLock { list in for g in groups { list[g.id] = g } }
        server.friends.withLock { $0 = friends }
        server.profiles.withLock { $0[5] = Self.anyaProfile }
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.showForTests(user: Self.user, today: today)
        m.together.setForTests(list: groups.map { g in
            var x = g
            x.settings = nil
            x.upcoming = nil
            return x
        }, details: groups, friends: friends, profiles: [Self.anyaProfile])
        return m
    }

    @Test("«Вместе»: группы с прогрессом, целью и «Тебе: …»; пусто", arguments: [ColorScheme.light, .dark])
    func together(scheme: ColorScheme) {
        check(TogetherView(section: "groups"), model: togetherModel(), scheme: scheme, named: "together-groups")
        if scheme == .light {
            check(TogetherView(section: "groups"), model: togetherModel(groups: []), scheme: scheme, named: "together-empty")
        }
    }

    @Test("Экран группы: цель, дела всех видов, «Скоро»; «Люди»", arguments: [ColorScheme.light, .dark])
    func group(scheme: ColorScheme) {
        check(GroupView(groupId: 1), model: togetherModel(), scheme: scheme, named: "group")
        if scheme == .light {
            check(GroupView(groupId: 1, tab: "people"), model: togetherModel(), scheme: scheme, named: "group-people")
        }
    }

    @Test("Настройки группы: владелец с чатом; участник без чата", arguments: [ColorScheme.light, .dark])
    func groupSettings(scheme: ColorScheme) {
        check(GroupSettingsSheet(group: Self.family, onLeft: {}), model: togetherModel(), scheme: scheme, named: "group-settings", sheet: true)
        if scheme == .light {
            check(GroupSettingsSheet(group: Self.sport, onLeft: {}), model: togetherModel(), scheme: scheme, named: "group-settings-member", sheet: true)
        }
    }

    @Test("Настройки группы: переименование не сохранилось, ошибка видна в шторке", arguments: [ColorScheme.light, .dark])
    func groupSettingsError(scheme: ColorScheme) async throws {
        let server = FakeServer(today: Self.today)
        server.groups.withLock { $0[Self.family.id] = Self.family }
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.showForTests(user: Self.user, today: Self.today)
        await m.together.loadGroup(Self.family.id)
        server.fail("PATCH groups/1")
        // Ошибка возникает в уже открытой шторке: при новом открытии onAppear очищает прошлую ошибку.
        let screen = snapshotScreen(GroupSettingsSheet(group: Self.family, onLeft: {}), model: m, scheme: scheme, named: "group-settings-error", sheet: true)
            .onAppear { m.together.rename(groupId: Self.family.id, title: "Новое название") }
        #if os(iOS)
        let controller = UIHostingController(rootView: screen.ignoresSafeArea())
        let previousWindow = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow }
        let window = UIWindow(windowScene: try #require(previousWindow?.windowScene))
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previousWindow?.makeKeyAndVisible()
        }
        controller.view.layoutIfNeeded()
        #else
        let host = NSHostingView(rootView: screen.frame(width: 420, height: 860))
        host.frame = CGRect(x: 0, y: 0, width: 420, height: 860)
        host.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        // Первое рисование запускает onAppear; этот кадр не становится эталоном.
        await withCheckedContinuation { continuation in
            Snapshotting<NSView, NSImage>.image.snapshot(host).run { _ in continuation.resume() }
        }
        #endif
        await TogetherModelTests().until("ошибка переименования видна в шторке") { m.together.settingsFailed == Self.family.id }
        try #require(m.together.settingsFailed == Self.family.id)
        #expect(m.together.details[Self.family.id]?.title == Self.family.title, "название откатилось после ошибки")
        withSnapshotTesting(record: recording) {
            #if os(iOS)
            controller.view.layoutIfNeeded()
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.preferredRange = .standard
            let image = UIGraphicsImageRenderer(bounds: controller.view.bounds, format: format).image { _ in
                _ = controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
            }
            assertSnapshot(of: image, as: .image(precision: 0.999), named: "iphone-\(scheme == .dark ? "dark" : "light")-group-settings-error", testName: "screen")
            #else
            assertSnapshot(of: host, as: .image(precision: 0.999), named: "mac-\(scheme == .dark ? "dark" : "light")-group-settings-error", testName: "screen")
            #endif
        }
        #expect(m.together.settingsFailed == Self.family.id, "снимали открытую шторку, не открывали её повторно")
    }

    @Test("Групповое дело: новое; правка «по очереди» каждый день; цель", arguments: [ColorScheme.light, .dark])
    func groupItem(scheme: ColorScheme) {
        let m = togetherModel()
        check(GroupItemSheet(group: Self.family, target: .edit(Self.family.items[2]), me: 777, today: "2026-10-05"), model: m, scheme: scheme, named: "group-item-rotate", sheet: true)
        if scheme == .light {
            check(GroupItemSheet(group: Self.family, target: .new, me: 777, today: "2026-10-05"), model: m, scheme: scheme, named: "group-item-new", sheet: true)
            check(GroupItemSheet(group: Self.family, target: .edit(Self.family.items[0]), me: 777, today: "2026-10-05"), model: m, scheme: scheme, named: "group-item-goal", sheet: true)
            check(PutSheet(item: Self.family.items[0]) { _ in }, model: m, scheme: scheme, named: "group-put", sheet: true)
        }
    }

    @Test("Вступить по приглашению", arguments: [ColorScheme.light, .dark])
    func join(scheme: ColorScheme) {
        let inv = Invitation(group: .init(id: 1, title: "Семья"), inviter: "Аня", members: [.init(id: 5, name: "Аня"), .init(id: 6, name: "Петя")])
        check(JoinView(code: "abc234xyz9", invitation: inv), model: togetherModel(), scheme: scheme, named: "join")
    }

    @Test("Друзья: поиск и «Позвать», заявки, друзья с картой двух недель, «ждём ответа»", arguments: [ColorScheme.light, .dark])
    func friends(scheme: ColorScheme) {
        check(TogetherView(section: "friends"), model: togetherModel(), scheme: scheme, named: "friends")
        if scheme == .light {
            check(RequestsView(), model: togetherModel(), scheme: scheme, named: "friend-requests")
            check(AddFriendSheet(), model: togetherModel(), scheme: scheme, named: "friend-add", sheet: true)
        }
    }

    @Test("Экран друга: карта «Месяц», открытые привычки", arguments: [ColorScheme.light, .dark])
    func friend(scheme: ColorScheme) {
        check(FriendView(friendId: 5), model: togetherModel(), scheme: scheme, named: "friend")
    }

    @Test("Чужая ссылка «Позвать друга» и «Что показать друзьям?»", arguments: [ColorScheme.light])
    func friendLink(scheme: ColorScheme) {
        check(FriendLinkView(code: "j8wuasb95a", who: FoundPerson(person: Person(id: 5, firstName: "Аня"), status: .none)), model: togetherModel(), scheme: scheme, named: "friend-link")
        check(ShowSheet(), model: togetherModel(), scheme: scheme, named: "friends-show")
    }

    @Test("Блоки групп на «Сегодня» и в дне календаря", arguments: [ColorScheme.light])
    func groupBlocks(scheme: ColorScheme) {
        var today = Self.today
        today.groups = [Self.family, Self.sport].map { g in
            var x = g
            x.settings = nil
            x.upcoming = nil
            return x
        }
        today.tasks = Array(today.tasks.prefix(2))
        check(TodayView(), model: togetherModel(today: today), scheme: scheme, named: "today-groups")
        let m = togetherModel(today: today)
        let day = CalendarDays.bounds(.day, anchor: "2026-10-05")
        m.setCalendarForTests(ranges: [(day.from, day.to, [])], groups: [(day.from, day.to, [
            GroupDayBlock(day: "2026-10-05", group: .init(id: 1, title: "Семья", members: Self.members), items: GroupLogic.todayOrder(Self.family.items)),
        ])], accounts: [])
        check(CalendarView(), model: m, scheme: scheme, named: "calendar-day-groups")
    }

    // MARK: Снимок

    /// sheet — шторка: в приложении она на своей подложке (presentationBackground — palette.surface), а не на фоне экрана.
    private func snapshotScreen(_ view: some View, model: AppModel, scheme: ColorScheme, named name: String, sheet: Bool) -> some View {
        ZStack {
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
    }

    // LC_RECORD=1 — переснять все (намеренная правка вида), LC_RECORD=missing — снять только новые экраны.
    private var recording: SnapshotTestingConfiguration.Record {
        switch ProcessInfo.processInfo.environment["LC_RECORD"] {
        case "1": .all
        case "missing": .missing
        default: .never
        }
    }

    private func check(_ view: some View, model: AppModel, scheme: ColorScheme, named name: String, sheet: Bool = false) {
        let screen = snapshotScreen(view, model: model, scheme: scheme, named: name, sheet: sheet)
        withSnapshotTesting(record: recording) {
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
