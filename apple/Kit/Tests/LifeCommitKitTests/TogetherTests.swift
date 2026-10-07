// Раздел «Вместе»: ответы сервера (сняты с локального стенда — Fixtures/*.json), порядок дел, шторка группового дела,
// цвета, ссылки-приглашения, карта «Месяц · Год», друзья, вызовы API.
import Foundation
import Testing
@testable import LifeCommitKit

private let base = URL(string: "https://lifecommit.test/api")!

@Suite("Вместе: ответы сервера")
struct TogetherDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try APIClient.decoder.decode(type, from: fixture(name))
    }

    @Test("экран группы: люди, дела всех видов, настройки, «Скоро»; счётчик «1 из 3»")
    func group() throws {
        let g = try decode(GroupToday.self, "group")
        #expect(g.title == "Семья" && g.role == .owner && g.members.map(\.name) == ["Даша", "Аня"])
        #expect(g.planned == 3 && g.done == 1)
        #expect(g.settings == GroupSettings(adminsOnlyEdit: false, tgChatTitle: nil))
        let modes = Dictionary(g.items.map { ($0.title, $0) }, uniquingKeysWith: { a, _ in a })
        #expect(modes["Вынести мусор"]?.mode == .one && modes["Вынести мусор"]?.time == "19:00" && modes["Вынести мусор"]?.done == true)
        let dishes = try #require(modes["Помыть посуду"])
        #expect(dishes.rotate && dishes.recurring && dishes.turn == g.members[0].id && dishes.rrule == "FREQ=DAILY")
        #expect(modes["Купить хлеб"]?.forMe == false && modes["Купить хлеб"]?.people == [g.members[1].id])
        let goal = try #require(modes["Отпуск"])
        #expect(goal.mode == .goal && goal.target == 150_000 && goal.total == 5000 && goal.unit == nil)
        let upcoming = try #require(g.upcoming)
        #expect(upcoming.first?.items.map(\.title) == ["Помыть посуду", "Семейный ужин"])
        // «Скоро» — без повторяющихся (они и так каждый день): остаётся ужин.
        #expect(GroupLogic.soon(upcoming).flatMap { $0.items.map(\.title) } == ["Семейный ужин"])
    }

    @Test("список групп и «Сегодня»: без настроек и «Скоро»")
    func list() throws {
        let list = try decode([GroupToday].self, "groups")
        #expect(list.count == 1 && list[0].settings == nil && list[0].upcoming == nil)
        #expect(try decode(TodayResponse.self, "today").groups.isEmpty)
    }

    @Test("календарь: свои дела и дела групп по дням")
    func calendar() throws {
        let range = try decode(CalendarRange.self, "calendar")
        #expect(range.groups.map(\.day) == ["2026-10-06", "2026-10-07"])
        #expect(range.groups[0].group.title == "Семья" && range.groups[0].group.members.count == 2)
        #expect(range.groups[1].items.map(\.title) == ["Семейный ужин"])
    }

    @Test("приглашение, друзья, заявки, экран друга, найденный человек, чужая ссылка")
    func friends() throws {
        let inv = try decode(Invitation.self, "invitation")
        #expect(inv.inviter == "Даша" && inv.group.title == "Семья" && inv.members.map(\.name) == ["Даша"] && !inv.member)
        let friends = try decode(FriendsResponse.self, "friends")
        #expect(friends.friends.first?.firstName == "Аня" && friends.friends.first?.days.count == 14 && friends.friends.first?.due == 1)
        #expect(friends.link.contains("startapp=f_") && friends.prompt)
        #expect(try decode(FriendsResponse.self, "friends-incoming").incoming.first?.via == .username)
        let profile = try decode(FriendProfile.self, "friend")
        #expect(profile.person.firstName == "Аня" && profile.heat.count == 1)
        #expect(profile.habits.first.map { ($0.kind, $0.value, $0.target, $0.unit) } ?? (.check, 0, 0, nil) == (.count, 3, 8, "стаканов"))
        #expect(try decode(FoundPerson.self, "find").status == .none)
        #expect(try decode(FoundPerson.self, "friend-link").status == .friends)
    }
}

@Suite("Вместе: групповые дела")
struct GroupLogicTests {
    private func item(_ id: Int, _ title: String, _ mode: GroupMode = .one, time: String? = nil, done: Bool = false, recurring: Bool = false, forMe: Bool = true, people: [Int] = [1, 2], turn: Int? = nil, doneBy: [Int] = []) -> GroupDayItem {
        GroupDayItem(id: id, title: title, mode: mode, time: time, recurring: recurring, people: people, turn: turn, forMe: forMe, done: done, doneBy: doneBy, start: "2026-10-06")
    }

    @Test("форма слова: 1 книга, 2 книги, 5 книг, 11 книг, 21 книга, 2,5 книги")
    func plural() {
        let forms = ["книга", "книги", "книг"]
        #expect([1, 2, 5, 11, 21, 104, 112].map { GroupLogic.plural(Double($0), forms) } == ["книга", "книги", "книг", "книг", "книга", "книги", "книг"])
        #expect(GroupLogic.plural(2.5, forms) == "книги")
        #expect(GroupLogic.plural(3, ["раз"]) == "раз")
    }

    @Test("число цели: просто, с валютой, со словом")
    func goalNumber() {
        #expect(GroupLogic.goalNumber(62_400, unit: nil, strings: .ru) == "62\u{00a0}400")
        #expect(GroupLogic.goalNumber(62_400, unit: GoalUnit(type: "money", forms: ["рубль", "рубля", "рублей"], currency: "₽"), strings: .ru) == "62\u{00a0}400 ₽")
        #expect(GroupLogic.goalNumber(12, unit: GoalUnit(type: "books", forms: ["книга", "книги", "книг"]), strings: .ru) == "12 книг")
        #expect(GroupLogic.goalNumber(1500, unit: nil, strings: .en) == "1,500")
    }

    @Test("порядок на «Сегодня»: только моё; цели сверху, по времени, без времени, мероприятия, сделанные вниз")
    func todayOrder() {
        let items = [
            item(1, "сделано", done: true), item(2, "ужин", .event, time: "20:00"), item(3, "без времени"),
            item(4, "в 9", time: "09:00"), item(5, "цель", .goal), item(6, "не моё", forMe: false), item(7, "в 8", time: "08:00"),
        ]
        #expect(GroupLogic.todayOrder(items).map(\.title) == ["цель", "в 8", "в 9", "без времени", "ужин", "сделано"])
        // Экран группы: цели — отдельно, остальные тем же порядком, и чужие тоже.
        #expect(GroupLogic.screenOrder(items).map(\.title) == ["в 8", "в 9", "без времени", "не моё", "ужин", "сделано"])
        #expect(GroupLogic.goals(items).map(\.title) == ["цель"])
    }

    @Test("«Тебе: …» — моё единственное несделанное (не цель и не мероприятие)")
    func forYou() {
        let group = GroupToday(id: 1, title: "Семья", items: [
            item(1, "всем", .assign, people: [1, 2]), item(2, "сделано", .assign, done: true, people: [1]),
            item(3, "ужин", .event, people: [1]), item(4, "мне", .assign, people: [1]),
        ])
        #expect(GroupLogic.forYou(group, me: 1)?.title == "мне")
        #expect(GroupLogic.forYou(group, me: 2) == nil)
    }

    @Test("отметка на экране: сделал — в «сделали», снял — убрал себя; кто что сделал сегодня")
    func marked() {
        let it = item(1, "мусор", doneBy: [2])
        let done = GroupLogic.marked(it, done: true, me: 1)
        #expect(done.done && done.doneBy == [2, 1])
        #expect(GroupLogic.marked(done, done: false, me: 1).doneBy == [2])
        #expect(GroupLogic.doneToday(GroupToday(id: 1, title: "", items: [done, item(2, "хлеб")]), by: 1) == ["мусор"])
    }

    @Test("подпись дела: мероприятие, кто-то один, очередь (моя и чужая), одному (мне и другому), каждому; кто сделал")
    func badges() {
        let members = [GroupMember(id: 1, name: "Даша"), GroupMember(id: 2, name: "Аня")]
        let t = Strings.ru
        #expect(GroupLogic.badge(item(1, "", .event), members: members, me: 1, strings: t) == .gray("мероприятие"))
        #expect(GroupLogic.badge(item(1, "", .one), members: members, me: 1, strings: t) == .gray("кто-то один"))
        #expect(GroupLogic.badge(item(1, "", .goal), members: members, me: 1, strings: t) == nil)
        #expect(GroupLogic.badge(item(1, "", .assign, people: [1], turn: 1), members: members, me: 1, strings: t) == .mine("твоя очередь"))
        #expect(GroupLogic.badge(item(1, "", .assign, people: [2], turn: 2), members: members, me: 1, strings: t) == .gray("очередь: Аня"))
        #expect(GroupLogic.badge(item(1, "", .assign, people: [1]), members: members, me: 1, strings: t) == .mine("тебе"))
        #expect(GroupLogic.badge(item(1, "", .assign, people: [2]), members: members, me: 1, strings: t) == .other("Аня"))
        #expect(GroupLogic.badge(item(1, "", .assign, people: [1, 2]), members: members, me: 1, strings: t) == .all("каждому"))
        #expect(GroupLogic.doneLine(item(1, "", doneBy: [2, 1, 9]), members: members, me: 1, strings: t) == "сделано: Аня, Я, …")
        #expect(GroupLogic.doneLine(item(1, ""), members: members, me: 1, strings: t) == nil)
    }

    @Test("число из поля: пробелы и запятая; в поле — только цифры, пробел, точка, запятая")
    func numbers() {
        #expect(GroupLogic.number("150 000") == 150_000)
        #expect(GroupLogic.number("2,5") == 2.5)
        #expect(GroupLogic.number("") == 0 && GroupLogic.number("abc") == 0)
        #expect(GroupLogic.numberInput("1a5 0,0.-") == "15 0,0.")
        #expect(GroupLogic.numberInput("١٢") == "")
    }

    @Test("повтор ↔ RRULE; «раз в неделю» — по дню недели выбранного дня")
    func repeats() {
        #expect(GroupRepeat.weekly.rrule(day: "2026-10-07") == "FREQ=WEEKLY;BYDAY=WE")
        #expect(GroupRepeat.once.rrule(day: "2026-10-07") == nil)
        for r in GroupRepeat.allCases where r != .weekly {
            #expect(GroupRepeat(rrule: r.rrule(day: "2026-10-07")) == r)
        }
        #expect(GroupRepeat(rrule: "FREQ=WEEKLY;BYDAY=FR") == .weekly)
        #expect(GroupRepeat(rrule: "freq=daily") == .daily)
        #expect(GroupRepeat.weekly.hasDay && GroupRepeat.once.hasDay && !GroupRepeat.daily.hasDay)
    }
}

@Suite("Вместе: шторка группового дела")
struct GroupItemFormTests {
    let members = [GroupMember(id: 1, name: "Даша"), GroupMember(id: 2, name: "Аня"), GroupMember(id: 3, name: "Петя")]

    @Test("новое: «кто-то один», сегодня; без названия сохранить нельзя; цель — только с числом; назначить — хоть кому-то")
    func valid() {
        var f = GroupItemForm(me: 1, today: "2026-10-06")
        #expect(f.mode == .one && f.people == [1] && f.day == "2026-10-06" && !f.valid(members))
        f.title = "  Вынести мусор "
        #expect(f.valid(members))
        f.mode = .goal
        #expect(!f.valid(members))
        f.target = "150 000"
        #expect(f.valid(members))
        f.mode = .assign
        f.people = []
        #expect(!f.valid(members))
        f.all = true
        #expect(f.valid(members))
    }

    @Test("люди: нажали при «Все» — выбор начинается со всех, «Все» снимается; «По очереди» — от двоих")
    func people() {
        var f = GroupItemForm(me: 1, today: "2026-10-06")
        f.mode = .assign
        #expect(!f.canRotate(members))
        f.all = true
        #expect(f.chosen(members) == [1, 2, 3] && f.canRotate(members))
        f.toggle(2, members: members)
        #expect(!f.all && f.chosen(members) == [1, 3])
        f.toggle(3, members: members)
        #expect(f.chosen(members) == [1] && !f.canRotate(members))
        f.mode = .event
        #expect(!f.canRotate(members))
    }

    @Test("что уходит: назначено двоим по очереди, каждый день; цель — сегодня, без времени и повтора")
    func input() {
        var f = GroupItemForm(me: 1, today: "2026-10-06")
        f.title = "Помыть посуду"
        f.mode = .assign
        f.people = [2, 1]
        f.rotate = true
        f.repeatRule = .daily
        f.time = "19:00"
        // Люди — в порядке выбора: по нему идёт очередь.
        #expect(f.input(members: members, today: "2026-10-06") == GroupItemInput(
            title: "Помыть посуду", mode: .assign, day: "2026-10-06", time: "19:00", rrule: "FREQ=DAILY", assignees: [2, 1], rotate: true
        ))
        f.mode = .one
        // «Кто-то один»: люди и очередь не уходят.
        #expect(f.input(members: members, today: "2026-10-06").assignees == [] && !f.input(members: members, today: "2026-10-06").rotate)
        f.mode = .goal
        f.target = "150 000"
        f.until = "2026-12-31"
        f.day = "2026-10-09"
        #expect(f.input(members: members, today: "2026-10-06") == GroupItemInput(
            title: "Помыть посуду", mode: .goal, day: "2026-10-06", target: 150_000, goalUntil: "2026-12-31"
        ))
    }

    @Test("правка: как задано у дела; «Все» — без отметок людей; цель — числом без пробелов")
    func edit() throws {
        let g = try APIClient.decoder.decode(GroupToday.self, from: fixture("group"))
        let dishes = try #require(g.items.first { $0.title == "Помыть посуду" })
        let f = GroupItemForm(item: dishes, me: g.members[0].id)
        #expect(f.mode == .assign && f.rotate && f.repeatRule == .daily && f.people == dishes.assignees && f.day == "2026-10-06")
        let goal = try #require(g.items.first { $0.mode == .goal })
        #expect(GroupItemForm(item: goal, me: 1).target == "150000")
        let trash = try #require(g.items.first { $0.mode == .one })
        #expect(GroupItemForm(item: trash, me: 7).people == [7] && GroupItemForm(item: trash, me: 7).time == "19:00")
        // «Семейный ужин» — мероприятие для всех (all_members): шторка открывается с «Все», и сохранение не сужает его до
        // одного человека — уходит all_members и пустой список людей.
        let dinner = try #require(g.upcoming?.flatMap(\.items).first { $0.title == "Семейный ужин" })
        #expect(dinner.allMembers)
        let form = GroupItemForm(item: dinner, me: g.members[0].id)
        #expect(form.all && form.chosen(g.members) == g.members.map(\.id))
        let input = form.input(members: g.members, today: "2026-10-06")
        #expect(input.allMembers && input.assignees.isEmpty && input.mode == .event)
    }

    @Test("«Все»: назначить — всем и будущим, по очереди среди всех; мероприятие — всем; «кто-то один» — «Все» не уходит")
    func all() {
        var f = GroupItemForm(me: 1, today: "2026-10-06")
        f.title = "Помыть посуду"
        f.mode = .assign
        f.people = [1]
        f.all = true
        f.rotate = true
        let assign = f.input(members: members, today: "2026-10-06")
        #expect(assign.allMembers && assign.assignees.isEmpty && assign.rotate, "очередь — среди троих, хотя отмечен один")
        f.mode = .event
        let event = f.input(members: members, today: "2026-10-06")
        #expect(event.allMembers && event.assignees.isEmpty && !event.rotate)
        f.mode = .one
        let one = f.input(members: members, today: "2026-10-06")
        #expect(!one.allMembers && one.assignees.isEmpty)
        // Сняли «Все» — уходят отмеченные, а не все.
        f.mode = .assign
        f.all = false
        f.people = [3, 1]
        let some = f.input(members: members, today: "2026-10-06")
        #expect(!some.allMembers && some.assignees == [3, 1] && some.rotate)
    }

    @Test("правка «по очереди»: люди уходят в порядке дела, а не вступления в группу (по нему сервер считает очередь)")
    func assigneesOrder() {
        let item = GroupDayItem(id: 3, title: "Посуда", mode: .assign, recurring: true, people: [3], rotate: true, turn: 3, start: "2026-10-06", rrule: "FREQ=DAILY", assignees: [3, 1])
        var f = GroupItemForm(item: item, me: 1)
        #expect(f.input(members: members, today: "2026-10-06").assignees == [3, 1])
        // Новый человек — в конец, снятый — уходит, порядок остальных тот же.
        f.toggle(2, members: members)
        f.toggle(3, members: members)
        #expect(f.input(members: members, today: "2026-10-06").assignees == [1, 2])
        // Ушедший из группы не уходит на сервер.
        let gone = GroupItemForm(item: GroupDayItem(id: 4, title: "x", mode: .assign, start: "2026-10-06", assignees: [9, 1]), me: 1)
        #expect(gone.input(members: members, today: "2026-10-06").assignees == [1])
    }

    @Test("повтор не меняли — правило уходит как было («вт и чт» из голоса); поменяли — собирается заново")
    func keepsRule() {
        let voice = GroupDayItem(id: 5, title: "Мусор", mode: .one, recurring: true, start: "2026-09-28", rrule: "FREQ=WEEKLY;BYDAY=TU,TH")
        var f = GroupItemForm(item: voice, me: 1)
        #expect(f.repeatRule == .weekly)
        f.title = "Вынести мусор"
        #expect(f.input(members: members, today: "2026-10-06").rrule == "FREQ=WEEKLY;BYDAY=TU,TH")
        f.day = "2026-10-07"
        #expect(f.input(members: members, today: "2026-10-06").rrule == "FREQ=WEEKLY;BYDAY=WE", "сменили день «раз в неделю» — правило по новому дню")
        f.day = "2026-09-28"
        f.repeatRule = .daily
        #expect(f.input(members: members, today: "2026-10-06").rrule == "FREQ=DAILY")
        let interval = GroupItemForm(item: GroupDayItem(id: 6, title: "x", mode: .one, recurring: true, start: "2026-09-28", rrule: "FREQ=DAILY;INTERVAL=2"), me: 1)
        #expect(interval.input(members: members, today: "2026-10-06").rrule == "FREQ=DAILY;INTERVAL=2")
    }

    @Test("тело запроса: пустое время, повтор, цель — явным null (иначе правка оставила бы старое)")
    func json() throws {
        let input = GroupItemInput(title: "Ужин", mode: .event, day: "2026-10-07", assignees: [], allMembers: true)
        let data = try JSONEncoder().encode(input.json)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["time"] is NSNull && object["rrule"] is NSNull && object["target"] is NSNull && object["goal_until"] is NSNull)
        #expect(object["all_members"] as? Bool == true && object["mode"] as? String == "event" && (object["assignees"] as? [Int]) == [])
    }
}

@Suite("Вместе: разбор ответа терпит чужое")
struct TogetherTolerantTests {
    static func item(_ extra: String) -> String {
        #"{"id":1,"title":"Отпуск","mode":"goal","time":null,"duration_min":null,"due_day":null,"carried":false,"recurring":false,"people":[1],"all_members":false,"rotate":false,"turn":null,"for_me":true,"can_mark":false,"done":false,"done_by":[],"target":100,"total":5,"goal_until":null,"start":"2026-10-06","rrule":null,"assignees":[]"# + extra + "}"
    }

    @Test("кривая единица цели — без единицы, а не сбой всего «Сегодня»; незнакомый вид дела пропускается; незнакомая роль — участник")
    func tolerant() throws {
        let json = #"{"id":3,"title":"Семья","kind":"family","color":null,"role":"guest","members":[],"planned":0,"done":0,"items":["# +
            Self.item(#","unit":{"type":"x"}"#) + "," + Self.item(#","unit":5"#) + "," +
            Self.item(#","unit":{"type":"money","forms":["₽","₽","₽"],"currency":"₽"}"#) + "," +
            Self.item(#","unit":null"#).replacingOccurrences(of: #""mode":"goal""#, with: #""mode":"quest""#) + "]}"
        let g = try APIClient.decoder.decode(GroupToday.self, from: Data(json.utf8))
        #expect(g.role == .member)
        #expect(g.items.count == 3, "незнакомый вид дела пропущен, остальные на месте")
        #expect(g.items[0].unit == nil && g.items[1].unit == nil)
        #expect(g.items[2].unit?.currency == "₽")
        let block = try APIClient.decoder.decode(GroupDayBlock.self, from: Data((#"{"day":"2026-10-06","group":{"id":3,"title":"Семья","kind":"family","members":[]},"items":["# + Self.item(#","unit":{"type":"x"}"#) + "]}").utf8))
        #expect(block.items.first?.unit == nil)
    }
}

@Suite("Вместе: цвета, ссылки, карта, друзья")
struct TogetherMiscTests {
    @Test("цвет — по id, у отрицательных тот же; буква — первая, нет имени — «?»; фото — только https")
    func tints() {
        #expect(Tints.avatar(7) == Tints.avatar(-7) && Tints.avatar(7).bg == 0xDDE3F0)
        #expect(Tints.group(12).bg == 0xF5EBD3)
        #expect(Tints.initial("аня") == "А" && Tints.initial("") == "?" && Tints.initial("  ") == "?")
        #expect(Tints.photoURL("https://t.me/i/userpic/320/a.jpg") != nil)
        #expect(Tints.photoURL("http://t.me/a.jpg") == nil && Tints.photoURL("javascript:alert(1)") == nil && Tints.photoURL(nil) == nil)
    }

    @Test("ссылки-приглашения: lifecommit.app/j|f и lifecommit://join|friend; чужой хост, лишний путь, плохой код — нет")
    func invites() throws {
        #expect(InviteLink(url: try #require(URL(string: "https://lifecommit.app/j/abc234xyz9"))) == InviteLink(kind: .join, code: "abc234xyz9"))
        #expect(InviteLink(url: try #require(URL(string: "https://lifecommit.app/f/j8wuasb95a/"))) == InviteLink(kind: .friend, code: "j8wuasb95a"))
        #expect(InviteLink(url: try #require(URL(string: "lifecommit://join/abc234xyz9"))) == InviteLink(kind: .join, code: "abc234xyz9"))
        #expect(InviteLink(url: try #require(URL(string: "lifecommit://friend/A_b-9"))) == InviteLink(kind: .friend, code: "A_b-9"))
        for bad in [
            "https://evil.app/j/abc234xyz9", "http://lifecommit.app/j/abc234xyz9", "https://lifecommit.app.evil.com/j/abc234xyz9",
            "https://lifecommit.app/x/abc234xyz9", "https://lifecommit.app/j/abc/def", "https://lifecommit.app/j/ab",
            "lifecommit://calendars?status=ok", "lifecommit://join/../../account", "lifecommit://join/a%2Fb%2Fc%2Fd",
            "lifecommit://join/" + String(repeating: "a", count: 65), "lifecommit://group/abc234xyz9",
        ] {
            #expect(InviteLink(url: try #require(URL(string: bad), "\(bad)")) == nil, "\(bad)")
        }
    }

    @Test("карта: уровни по очкам, год с понедельника 52 недели назад, подписи месяцев, будущее не красим")
    func heat() {
        #expect([0, 0.5, 1, 2.9, 3, 5, 9].map(HeatMap.level) == [0, 1, 2, 2, 3, 4, 4])
        let start = HeatMap.yearStart("2026-10-07")
        #expect(Days.weekdayIndex(start) == 0 && Days.between(start, "2026-10-07") == 52 * 7 + 2)
        let weeks = HeatMap.weeks("2026-10-07")
        #expect(weeks.count == 53 && weeks.first?.month == "2025-10" && weeks.last?.monday == "2026-10-05")
        // Неделя с 28 сентября — в ней 1 октября: подпись «октябрь».
        #expect(weeks.first { $0.monday == "2026-09-28" }?.month == "2026-10")
        #expect(weeks.first { $0.monday == "2026-09-21" }?.month == nil)
        let levels = HeatMap.levels([HeatDay(day: "2026-10-06", score: 4)])
        #expect(HeatMap.cell("2026-10-06", levels: levels, today: "2026-10-07") == 3)
        #expect(HeatMap.cell("2026-10-05", levels: levels, today: "2026-10-07") == 0)
        #expect(HeatMap.cell("2026-10-08", levels: levels, today: "2026-10-07") == nil)
        let days = [HeatDay(day: "2026-09-30", score: 1), HeatDay(day: "2026-10-01", score: 0), HeatDay(day: "2026-10-02", score: 2)]
        #expect(HeatMap.activeDays(days, month: "2026-10") == 1 && HeatMap.activeDays(days, month: nil) == 2)
    }

    @Test("друзья: поиск по имени и @username; строка под привычкой друга; искать по @username — от 4 знаков")
    func friends() {
        let list = [FriendCard(id: 1, firstName: "Аня", username: "anna_k"), FriendCard(id: 2, firstName: "Петя")]
        #expect(FriendsLogic.search(list, "  ").count == 2)
        #expect(FriendsLogic.search(list, "аН").map(\.id) == [1])
        #expect(FriendsLogic.search(list, "@ANNA").map(\.id) == [1])
        #expect(FriendsLogic.search(list, "вася").isEmpty)
        let t = Strings.ru
        #expect(FriendsLogic.habitNote(FriendHabit(id: 1, title: "", kind: .count, unit: "стаканов", target: 8, value: 3), strings: t) == ("3 из 8 стаканов", false))
        #expect(FriendsLogic.habitNote(FriendHabit(id: 1, title: "", kind: .count, target: 8, value: 0), strings: t) == (nil, false))
        #expect(FriendsLogic.habitNote(FriendHabit(id: 1, title: "", kind: .check, value: 1), strings: t) == ("сделано", true))
        #expect(FriendsLogic.habitNote(FriendHabit(id: 1, title: "", kind: .abstain, status: .clean, cleanDays: 5), strings: t) == ("5 дней без этого", true))
        #expect(FriendsLogic.habitNote(FriendHabit(id: 1, title: "", kind: .abstain, cleanDays: 0), strings: t) == (nil, false))
        #expect(!FriendsLogic.searchable("@ann") && FriendsLogic.searchable("@anna") && FriendsLogic.searchable("anna"))
    }

    @Test("свайп по общему делу: повторяющееся — спросить «только сегодня или у всех», разовое и цель — сразу")
    func asksRemoval() {
        #expect(GroupLogic.asksRemoval(GroupDayItem(id: 1, title: "", mode: .one, recurring: true, start: "2026-10-06")))
        #expect(GroupLogic.asksRemoval(GroupDayItem(id: 1, title: "", mode: .event, recurring: true, start: "2026-10-06")))
        #expect(!GroupLogic.asksRemoval(GroupDayItem(id: 1, title: "", mode: .one, start: "2026-10-06")))
        #expect(!GroupLogic.asksRemoval(GroupDayItem(id: 1, title: "", mode: .goal, recurring: true, start: "2026-10-06")))
    }

    @Test("отметить в дне календаря — сегодня и неделю назад; раньше и в будущем — нет (сервер не примет)")
    func markWindow() {
        #expect(GroupLogic.canMark(on: "2026-10-06", today: "2026-10-06"))
        #expect(GroupLogic.canMark(on: "2026-09-29", today: "2026-10-06"))
        #expect(!GroupLogic.canMark(on: "2026-09-28", today: "2026-10-06"))
        #expect(!GroupLogic.canMark(on: "2026-10-07", today: "2026-10-06"))
    }

    @Test("ссылка «поделиться» в Telegram: «+», «&» и «=» в названии не ломают текст")
    func telegramShare() throws {
        let url = try #require(Links.telegramShare(link: "https://t.me/LifeCommit_bot?startapp=g_abc", text: "C++ & co = клуб · LifeCommit"))
        #expect(url.absoluteString.hasPrefix("https://t.me/share/url?url=https%3A%2F%2Ft.me%2FLifeCommit_bot%3Fstartapp%3Dg_abc&text="))
        #expect(url.absoluteString.contains("C%2B%2B%20%26%20co%20%3D%20"))
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(items.first { $0.name == "text" }?.value == "C++ & co = клуб · LifeCommit")
        #expect(items.first { $0.name == "url" }?.value == "https://t.me/LifeCommit_bot?startapp=g_abc")
    }

    @Test("короткое название месяца для карты года: «окт», «Oct»")
    func monthShort() {
        #expect(Strings.ru.monthShort("2026-10") == "окт")
        #expect(Strings.en.monthShort("2026-10") == "Oct")
        #expect(Strings.ru.monthShort("2026-05") == "мая" || Strings.ru.monthShort("2026-05") == "май")
    }

    @Test("тексты: склонения и числа как в мини-аппе")
    func strings() {
        #expect(Strings.ru.gr.people(1) == "1 человек" && Strings.ru.gr.people(3) == "3 человека" && Strings.ru.gr.people(5) == "5 человек")
        #expect(Strings.en.gr.people(1) == "1 person" && Strings.en.gr.people(2) == "2 people")
        #expect(Strings.ru.gr.progress(1, 3) == "1 из 3 сегодня" && Strings.ru.fr.requests(2) == "Заявки · 2")
        #expect(Strings.ru.together.activeDays(21) == "21 активный день" && Strings.en.together.activeDays(1) == "1 active day")
        #expect(Strings.ru.fr.status[.self] == "Это вы" && Strings.en.gr.modes[.goal] == "Shared goal")
    }
}

@Suite("Вместе: вызовы API")
struct TogetherAPITests {
    @Test("группы: пути и тела — как src/api.ts")
    func groups() async throws {
        let stub = Stub { call in
            switch (call.method, call.url.path()) {
            case ("POST", "/api/groups"), ("POST", "/api/groups/5/items"): Stub.json(201, ["id": 5])
            case ("POST", "/api/invites/abc234xyz9/join"): Stub.json(200, ["id": 5])
            case ("POST", "/api/groups/5/invite"): Stub.json(201, ["code": "abc234xyz9", "link": "https://t.me/LifeCommit_bot?startapp=g_abc234xyz9", "expires_at": "2026-10-13T00:00:00Z"])
            case ("POST", "/api/groups/5/chat/check"): Stub.json(200, ["tg_chat_title": "Семья 🏡"])
            case ("PUT", "/api/groups/5/items/9/mark"): Stub.json(200, ["ok": true, "taken": true])
            default: Stub.json(200, ["ok": true])
            }
        }
        let api = APIClient(base: base, session: stub.session)
        #expect(try await api.createGroup(title: "Семья") == 5)
        try await api.updateGroup(id: 5, ["admins_only_edit": .bool(true)])
        #expect(try await api.invite(groupId: 5).link.hasSuffix("g_abc234xyz9"))
        #expect(try await api.checkGroupChat(groupId: 5) == "Семья 🏡")
        try await api.disconnectGroupChat(groupId: 5)
        #expect(try await api.join(code: "abc234xyz9") == 5)
        #expect(try await api.createGroupItem(groupId: 5, GroupItemInput(title: "Мусор", mode: .one, day: "2026-10-06")) == 5)
        try await api.updateGroupItem(groupId: 5, itemId: 9, GroupItemInput(title: "Мусор", mode: .one, day: "2026-10-06"))
        try await api.skipGroupItem(groupId: 5, itemId: 9, day: "2026-10-06")
        #expect(try await api.markGroupItem(groupId: 5, itemId: 9, done: true).taken)
        _ = try await api.markGroupItem(groupId: 5, itemId: 9, done: false, day: "2026-10-05")
        try await api.addGoalEntry(groupId: 5, itemId: 9, amount: 5000)
        try await api.deleteGroupItem(groupId: 5, itemId: 9)
        try await api.leaveGroup(id: 5)
        try await api.deleteGroup(id: 5)
        #expect(stub.calls.map { "\($0.method) \($0.url.path())" } == [
            "POST /api/groups", "PATCH /api/groups/5", "POST /api/groups/5/invite", "POST /api/groups/5/chat/check",
            "DELETE /api/groups/5/chat", "POST /api/invites/abc234xyz9/join", "POST /api/groups/5/items", "PATCH /api/groups/5/items/9",
            "POST /api/groups/5/items/9/skip", "PUT /api/groups/5/items/9/mark", "PUT /api/groups/5/items/9/mark",
            "POST /api/groups/5/items/9/entries", "DELETE /api/groups/5/items/9", "POST /api/groups/5/leave", "DELETE /api/groups/5",
        ])
        let body = { (i: Int) in try JSONSerialization.jsonObject(with: stub.calls[i].body) as? [String: Any] }
        #expect(try body(0)?["title"] as? String == "Семья" && body(0)?["kind"] as? String == "other")
        #expect(try body(1)?["admins_only_edit"] as? Bool == true)
        #expect(try body(8)?["day"] as? String == "2026-10-06")
        #expect(try body(9)?["done"] as? Bool == true && body(9)?["day"] == nil)
        #expect(try body(10)?["done"] as? Bool == false && body(10)?["day"] as? String == "2026-10-05")
        #expect(try body(11)?["amount"] as? Int == 5000)
    }

    @Test("друзья: пути и тела; @username — параметром, а не в пути")
    func friends() async throws {
        let stub = Stub { call in
            let person: [String: Any] = ["id": 2, "first_name": "Аня", "username": "anna", "photo_url": NSNull()]
            return switch (call.method, call.url.path()) {
            case ("GET", "/api/friends/find"), ("GET", "/api/friends/link/j8wuasb95a"): Stub.json(200, ["person": person, "status": "none"])
            case ("POST", "/api/friends/requests"): Stub.json(201, ["status": "sent"])
            default: Stub.json(200, ["ok": true])
            }
        }
        let api = APIClient(base: base, session: stub.session)
        #expect(try await api.findPerson(username: "@anna").person.firstName == "Аня")
        #expect(try await api.friendLink(code: "j8wuasb95a").status == PersonStatus.none)
        #expect(try await api.requestFriend(username: "anna") == .sent)
        #expect(try await api.requestFriend(code: "j8wuasb95a") == .sent)
        try await api.acceptFriend(id: 2)
        try await api.dropFriendRequest(id: 2)
        try await api.removeFriend(id: 2)
        try await api.block(id: 2)
        try await api.setShown(taskIds: [7, 8])
        try await api.promptSeen()
        #expect(stub.calls.map { "\($0.method) \($0.url.path())" } == [
            "GET /api/friends/find", "GET /api/friends/link/j8wuasb95a", "POST /api/friends/requests", "POST /api/friends/requests",
            "POST /api/friends/requests/2/accept", "DELETE /api/friends/requests/2", "DELETE /api/friends/2", "POST /api/friends/2/block",
            "PUT /api/friends/shown", "POST /api/friends/prompted",
        ])
        #expect(URLComponents(url: stub.calls[0].url, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "username", value: "@anna")])
        let body = { (i: Int) in try JSONSerialization.jsonObject(with: stub.calls[i].body) as? [String: Any] }
        #expect(try body(2)?["username"] as? String == "anna" && body(3)?["code"] as? String == "j8wuasb95a")
        #expect(try body(8)?["task_ids"] as? [Int] == [7, 8])
    }

    @Test("приглашение устарело — 410 invite_expired; дело сегодня не моё — 403 not_yours")
    func refusals() async throws {
        let stub = Stub { call in
            call.url.path().hasPrefix("/api/invites") ? Stub.json(410, ["error": "invite_expired"]) : Stub.json(403, ["error": "not_yours"])
        }
        let api = APIClient(base: base, session: stub.session)
        await #expect(throws: APIError(.http(status: 410, code: "invite_expired"))) { try await api.invitation(code: "abc234xyz9") }
        await #expect(throws: APIError(.http(status: 403, code: "not_yours"))) { try await api.markGroupItem(groupId: 1, itemId: 2, done: true) }
    }
}
