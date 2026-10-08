// «Вместе» против подменённого сервера (FakeServer): отметки с откатом и подсказкой, гонки перечитывания с правкой,
// настройки группы, выход, удаление общего дела, блоки групп на «Сегодня» и в календаре, заявки в друзья, «Что
// показать», приглашения по ссылке, выход из аккаунта.
import LifeCommitKit
import SwiftUI
import Testing
@testable import LifeCommit

@MainActor
@Suite("Модель: «Вместе»", .timeLimit(.minutes(1)))
struct TogetherModelTests {
    static let day = "2026-10-05"
    static let me = 777
    static let anya = GroupMember(id: 5, name: "Аня")

    static func trash(done: Bool = false) -> GroupDayItem {
        GroupDayItem(id: 11, title: "Вынести мусор", mode: .one, people: [me, 5], canMark: true, done: done, doneBy: done ? [me] : [], start: day)
    }

    static func dishes() -> GroupDayItem {
        GroupDayItem(id: 12, title: "Помыть посуду", mode: .assign, recurring: true, people: [me], rotate: true, turn: me, canMark: true, start: day, rrule: "FREQ=DAILY", assignees: [me, 5])
    }

    static func family(_ items: [GroupDayItem] = [trash(), dishes()], chat: String? = nil) -> GroupToday {
        GroupToday(id: 1, title: "Семья", role: .owner, members: [GroupMember(id: me, name: "Даша"), anya], items: items, planned: 2, done: 0,
                   settings: GroupSettings(tgChatTitle: chat), upcoming: [])
    }

    /// Сервер с группой «Семья» (и на «Сегодня»), модель уже загружена.
    func setup(_ group: GroupToday = family()) -> (FakeServer, AppModel) {
        var onToday = group
        onToday.settings = nil
        onToday.upcoming = nil
        let server = FakeServer(today: TodayResponse(day: Self.day, tasks: [TodayTask(id: 1, title: "Пить воду", kind: .count, target: 8)], groups: [onToday]))
        server.groups.withLock { $0[group.id] = group }
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.showForTests(user: server.user, today: server.today)
        return (server, m)
    }

    /// Дождаться, пока условие станет верным (правки, которые модель отправляет в фоне), — без пауз вслепую.
    func until(_ what: Comment, _ check: () -> Bool) async {
        for _ in 0..<2000 {
            if check() { return }
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(2))
        }
        Issue.record(what)
    }

    @Test("отметка на экране группы: галочка сразу, сервер принял; потом «Сегодня» и экран — с сервера")
    func mark() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        let put = server.hold("PUT groups/1/items/11/mark")
        let marking = Task { await m.together.mark(groupId: 1, Self.trash()) }
        await server.seen("PUT groups/1/items/11/mark")
        #expect(m.together.details[1]?.items.first?.done == true, "галочка — до ответа сервера")
        #expect(m.together.details[1]?.items.first?.doneBy == [Self.me])
        await put.open()
        await marking.value
        #expect(server.calls("PUT groups/1/items/11/mark").first?.json["done"] as? Bool == true)
        #expect(m.today.groups.first?.items.first?.done == true, "«Сегодня» перечитано")
        #expect(m.together.note == nil)
    }

    @Test("отметка не дошла — галочка назад и «Что-то пошло не так»; не на мне — «Это дело сегодня не на тебе»")
    func markFails() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.fail("PUT groups/1/items/11/mark")
        await m.together.mark(groupId: 1, Self.trash())
        #expect(m.together.details[1]?.items.first?.done == false)
        #expect(m.together.note == TogetherModel.Note(groupId: 1, text: Strings.ru.error))
        server.fail("PUT groups/1/items/12/mark", status: 403, code: "not_yours")
        await m.together.mark(groupId: 1, Self.dishes())
        #expect(m.together.details[1]?.items.last?.done == false)
        #expect(m.together.note?.text == "Это дело сегодня не на тебе")
    }

    @Test("«кто-то один» уже сделал до меня — «Уже кто-то сделал»")
    func taken() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.answer("PUT groups/1/items/11/mark", 200, ["ok": true, "taken": true])
        await m.together.mark(groupId: 1, Self.trash())
        #expect(m.together.note?.text == "Уже кто-то сделал")
    }

    @Test("перечитка экрана группы, начатая до отметки, не затирает её")
    func staleReload() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        let gate = server.hold("GET groups/1")
        let reading = Task {
            await m.together.loadGroup(1)
            #expect(m.together.details[1]?.items.first?.done == true, "по завершении чтения старый ответ не снял отметку")
        }
        await server.seen("GET groups/1", times: 2)
        let mark = server.hold("PUT groups/1/items/11/mark")
        let marking = Task { await m.together.mark(groupId: 1, Self.trash()) }
        await server.seen("PUT groups/1/items/11/mark")
        await gate.open()
        // Перечитка теперь ждёт правку: держать её до await reading означало бы ждать друг друга.
        #expect(m.together.details[1]?.items.first?.done == true, "старый ответ без отметки не лёг поверх неё")
        await mark.open()
        await reading.value
        await marking.value
        #expect(m.together.details[1]?.items.first?.done == true)
    }

    @Test("группы нет (404) — «не найдено»; моргнула сеть, а экран уже был — остаётся как был")
    func missing() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.fail("GET groups/1", status: 0, code: "")
        await m.together.loadGroup(1)
        #expect(!m.together.missing.contains(1) && m.together.details[1] != nil)
        await m.together.loadGroup(42)
        #expect(m.together.missing.contains(42))
    }

    @Test("выйти не вышло — остаёмся, подсказка; вышло — группы нет ни в списке, ни на «Сегодня»")
    func leave() async {
        let (server, m) = setup()
        await m.together.loadList()
        await m.together.loadGroup(1)
        server.fail("POST groups/1/leave")
        #expect(await m.together.leave(groupId: 1, remove: false) == false)
        #expect(m.together.details[1] != nil && m.together.note?.text == Strings.ru.error)
        #expect(await m.together.leave(groupId: 1, remove: false))
        #expect(m.together.details[1] == nil && m.together.list?.isEmpty == true)
        await until("«Сегодня» перечитано без группы") { m.today.groups.isEmpty }
    }

    @Test("переименовать: сразу; не вышло — старое название и подсказка; «только админы» — так же")
    func settings() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.fail("PATCH groups/1", times: 2)
        m.together.rename(groupId: 1, title: "  Семья 🏡 ")
        #expect(m.together.details[1]?.title == "Семья 🏡")
        await until("название вернулось") { m.together.details[1]?.title == "Семья" }
        #expect(m.together.note?.text == Strings.ru.error)
        #expect(m.together.settingsFailed == 1, "ошибка видна и в открытой шторке настроек, а не только под ней")
        m.together.setAdminsOnly(groupId: 1, true)
        #expect(m.together.details[1]?.settings?.adminsOnlyEdit == true)
        await until("переключатель вернулся") { m.together.details[1]?.settings?.adminsOnlyEdit == false }
        // То же название — на сервер ничего не уходит.
        m.together.rename(groupId: 1, title: "Семья")
        #expect(server.calls("PATCH groups/1").count == 2)
    }

    @Test("отключить чат: сразу «Подключить»; не вышло — чат обратно и подсказка")
    func chatOff() async {
        let (server, m) = setup(Self.family(chat: "Семейный чат"))
        await m.together.loadGroup(1)
        server.fail("DELETE groups/1/chat")
        await m.together.disconnectChat(groupId: 1)
        #expect(m.together.details[1]?.settings?.tgChatTitle == "Семейный чат" && m.together.note?.text == Strings.ru.error)
        #expect(m.together.settingsFailed == 1)
        await m.together.disconnectChat(groupId: 1)
        #expect(m.together.details[1]?.settings?.tgChatTitle == nil)
    }

    @Test("удалили общее дело: строка скрыта сразу; в группе, где правят админы, сервер отказал — так и сказано")
    func removeNotAllowed() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.fail("DELETE groups/1/items/11", status: 403, code: "admins_only")
        m.together.removeItem(groupId: 1, Self.trash(), skipDay: nil)
        #expect(m.isRemoved(TogetherModel.removalKey(1, 11)))
        await m.flushRemoval()?.value
        #expect(m.removalFailed && m.removalFailedText == "В этой группе дела удаляют только админы")
        #expect(!m.isRemoved(TogetherModel.removalKey(1, 11)), "строка вернулась")
    }

    @Test("повторяющееся «только сегодня» — skip с днём строки, а не удаление у всех")
    func skipToday() async {
        let (server, m) = setup()
        m.together.removeItem(groupId: 1, Self.dishes(), skipDay: "2026-10-06")
        await m.flushRemoval()?.value
        #expect(server.calls("POST groups/1/items/12/skip").first?.json["day"] as? String == "2026-10-06")
        #expect(server.calls("DELETE groups/1/items/12").isEmpty)
        #expect(!m.removalFailed)
    }

    @Test("«Сегодня»: отметка в блоке группы — сразу; не на мне — галочка назад и плашка «не на тебе»")
    func markOnToday() async {
        let (server, m) = setup()
        let put = server.hold("PUT groups/1/items/11/mark")
        let marking = Task { await m.markGroupOnToday(groupId: 1, Self.trash()) }
        await server.seen("PUT groups/1/items/11/mark")
        #expect(m.today.groups.first?.items.first?.done == true)
        await put.open()
        await marking.value
        #expect(m.today.groups.first?.items.first?.done == true)
        server.fail("PUT groups/1/items/12/mark", status: 403, code: "not_yours")
        await m.markGroupOnToday(groupId: 1, Self.dishes())
        #expect(m.today.groups.first?.items.last?.done == false)
        #expect(m.banner == "Это дело сегодня не на тебе")
    }

    @Test("календарь: дела групп приходят вместе с днями; отметка в прошлый день уходит с этим днём")
    func calendar() async {
        let (server, m) = setup()
        server.calendar.withLock { $0 = [] }
        let block = GroupDayBlock(day: "2026-10-04", group: .init(id: 1, title: "Семья"), items: [Self.trash()])
        server.calendarGroups.withLock { $0 = [block] }
        await m.showRange(from: "2026-10-04", to: "2026-10-04")
        #expect(m.calendarGroups(from: "2026-10-04", to: "2026-10-04") == [block])
        await m.markGroupOnDay(groupId: 1, Self.trash(), day: "2026-10-04")
        #expect(server.calls("PUT groups/1/items/11/mark").first?.json["day"] as? String == "2026-10-04")
        #expect(server.calls("GET calendar").count == 2, "день перечитан после отметки")
    }

    @Test("заявка: приняли — пропала сразу; ответ друзей, начатый раньше, её не вернёт; не дошло — вернулась и ошибка")
    func answer() async {
        let (server, m) = setup()
        server.friends.withLock { $0 = FriendsResponse(incoming: [FriendRequest(id: 5, firstName: "Аня"), FriendRequest(id: 6, firstName: "Петя")]) }
        await m.together.reloadFriends()
        let stale = server.hold("GET friends")
        let reading = Task { await m.together.reloadFriends() }
        await server.seen("GET friends", times: 2)
        let accept = server.hold("POST friends/requests/5/accept")
        m.together.answer(5, accept: true)
        #expect(m.together.incoming.map(\.id) == [6], "пропала сразу")
        await stale.open()
        await reading.value
        #expect(m.together.incoming.map(\.id) == [6], "старый ответ с заявкой её не вернул")
        await accept.open()
        await until("друг в списке") { m.together.friends?.friends.map(\.id) == [5] }
        server.fail("DELETE friends/requests/6")
        m.together.answer(6, accept: false)
        await until("заявка вернулась") { m.together.answerFailed }
        #expect(m.together.incoming.map(\.id) == [6])
    }

    @Test("«Что показать»: спросили один раз; не сохранилось — снова открыто с тем же выбором и ошибкой; «Назад» — без ошибки")
    func shown() async {
        let (server, m) = setup()
        server.friends.withLock { $0 = FriendsResponse(friends: [FriendCard(id: 5, firstName: "Аня")], prompt: true) }
        await m.together.reloadFriends()
        m.together.promptIfNeeded()
        #expect(m.together.showOpen)
        server.fail("PUT friends/shown")
        m.together.saveShown([1])
        #expect(!m.together.showOpen)
        await until("шторка снова открыта") { m.together.showOpen }
        #expect(m.together.showFailed == [1])
        m.together.saveShown([1])
        await until("сохранилось и «Сегодня» перечитано") { m.today.tasks.first?.visibility == .friends }
        #expect(m.together.showFailed == nil && !m.together.showOpen)
        // Второй раз за запуск не спрашиваем, даже если сервер ещё не узнал.
        m.together.promptIfNeeded()
        #expect(!m.together.showOpen)
        server.fail("POST friends/prompted")
        let reads = server.calls("GET friends").count
        m.together.saveShown(nil)
        // Задача модели дошла до конца: после служебной отметки друзья перечитаны.
        await server.seen("GET friends", times: reads + 1)
        #expect(m.together.showFailed == nil && !m.together.showOpen)
    }

    @Test("экран друга: убрали из друзей (404) — «не работает»; заблокировать не вышло — false, экран остаётся")
    func friend() async {
        let (server, m) = setup()
        server.profiles.withLock { $0[5] = FriendProfile(person: Person(id: 5, firstName: "Аня"), today: Self.day) }
        await m.together.loadFriend(5)
        #expect(m.together.profiles[5] != nil)
        server.fail("POST friends/5/block")
        #expect(await m.together.leaveFriend(5, block: true) == false)
        #expect(m.together.profiles[5] != nil)
        await m.together.loadFriend(9)
        #expect(m.together.missingFriends.contains(9))
    }

    @Test("приглашение: пришло во время загрузки — открыто после неё; ссылка ведёт во «Вместе» на нужный экран")
    func invite() async throws {
        let server = FakeServer(today: TodayResponse(day: Self.day))
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.api.setCredential(.session("key"))
        let url = try #require(URL(string: "lifecommit://join/abc234xyz9"))
        let link = try #require(InviteLink(url: url))
        m.openInvite(link)
        #expect(m.path.isEmpty, "пока грузимся — ждём")
        await m.load()
        await until("экран приглашения открыт") { m.path == [.join("abc234xyz9")] }
        #expect(m.tab == .groups)
        m.openInvite(InviteLink(kind: .friend, code: "j8wuasb95a"))
        #expect(m.path == [.friendLink("j8wuasb95a")])
    }

    @Test("вступили: экран группы — сразу целиком, «Сегодня» перечитано")
    func join() async throws {
        let (server, m) = setup()
        server.answer("POST invites/abc234xyz9/join", 200, ["id": 1])
        let id = try await m.together.join(code: "abc234xyz9")
        #expect(id == 1 && m.together.details[1]?.title == "Семья")
        await server.seen("GET today")
    }

    @Test("удалили общее дело: после «Вернуть» строка не мелькает — скрыта, пока экраны не перечитаны без неё")
    func removalNoFlash() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        let delete = server.hold("DELETE groups/1/items/11")
        m.together.removeItem(groupId: 1, Self.trash(), skipDay: nil)
        let commit = m.flushRemoval()
        await server.seen("DELETE groups/1/items/11")
        for day in [Self.day, "2026-10-07", "2026-09-01", "2026-12-31"] {
            #expect(TogetherModel.isRemoved(m, 1, 11, day: day), "дело целиком скрыто во всех днях, пока удаляется")
        }
        await delete.open()
        await commit?.value
        #expect(!m.isRemoved(TogetherModel.removalKey(1, 11)))
        #expect(!m.today.groups[0].items.contains { $0.id == 11 }, "«Сегодня» уже без дела, когда строка перестала быть скрытой")
        #expect(!(m.together.details[1]?.items.contains { $0.id == 11 } ?? true), "экран группы — тоже")
        #expect(server.calls("DELETE groups/1/items/11").count == 1)
    }

    @Test("открыли другую группу, пока уходит удаление: её ответ не теряется — дождались правки и спросили заново")
    func loadDuringEdit() async {
        let (server, m) = setup()
        server.groups.withLock { $0[2] = GroupToday(id: 2, title: "Бег", role: .member, settings: GroupSettings(), upcoming: []) }
        let delete = server.hold("DELETE groups/1/items/11")
        m.together.removeItem(groupId: 1, Self.trash(), skipDay: nil)
        let commit = m.flushRemoval()
        await server.seen("DELETE groups/1/items/11")
        let opening = Task { await m.together.loadGroup(2) }
        await server.seen("GET groups/2")
        await delete.open()
        await commit?.value
        await opening.value
        #expect(m.together.details[2]?.title == "Бег", "экран группы не пустой")
        #expect(server.calls("GET groups/2").count == 2, "устаревшее чтение повторено после правки")
        #expect(!m.together.missing.contains(2))
    }

    @Test("«только сегодня» прячет один день: в другие дни и на «Сегодня» дело видно, пока идёт «Вернуть»")
    func skipHidesOneDay() {
        let (_, m) = setup()
        m.together.removeItem(groupId: 1, Self.dishes(), skipDay: "2026-10-07")
        #expect(m.isRemoved(TogetherModel.removalKey(1, 12, day: "2026-10-07")))
        #expect(!m.isRemoved(TogetherModel.removalKey(1, 12)))
        #expect(!m.isRemoved(TogetherModel.removalKey(1, 12, day: Self.day)))
        #expect(TogetherModel.isRemoved(m, 1, 12, day: "2026-10-07"))
        #expect(!TogetherModel.isRemoved(m, 1, 12, day: Self.day))
        m.undoRemoval()
    }

    @Test("прошлая ошибка настройки очищается при открытии шторки и при выходе из аккаунта")
    func clearSettingsFailed() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.fail("PATCH groups/1", times: 2)
        m.together.rename(groupId: 1, title: "Дом")
        await until("ошибка переименования") { m.together.settingsFailed == 1 }
        m.together.clearSettingsFailed()
        #expect(m.together.settingsFailed == nil)
        m.together.rename(groupId: 1, title: "Дом")
        await until("повторная ошибка переименования") { m.together.settingsFailed == 1 }
        m.together.reset()
        #expect(m.together.settingsFailed == nil)
    }

    @Test("две отметки подряд: перечитка после первой, пока вторая ещё у сервера, не снимает вторую галочку")
    func twoMarks() async {
        let second = GroupDayItem(id: 13, title: "Позвонить бабушке", mode: .one, people: [Self.me, 5], canMark: true, start: Self.day)
        let (server, m) = setup(Self.family([Self.trash(), second]))
        await m.together.loadGroup(1)
        let held = server.hold("PUT groups/1/items/13/mark")
        let b = Task { await m.together.mark(groupId: 1, second) }
        await server.seen("PUT groups/1/items/13/mark")
        // Первая отметка дошла и перечитала экран, пока вторая ещё идёт.
        let a = Task { await m.together.mark(groupId: 1, Self.trash()) }
        await server.seen("GET groups/1", times: 2)
        #expect(m.together.details[1]?.items.first { $0.id == 13 }?.done == true, "вторая галочка на месте")
        await held.open()
        await a.value
        await b.value
        #expect(m.together.details[1]?.items.first { $0.id == 13 }?.done == true)
    }

    @Test("проверка чата, ушедшая до «Отключить», не возвращает отключённый чат")
    func checkChatAfterDisconnect() async {
        let (server, m) = setup(Self.family(chat: "Семейный чат"))
        await m.together.loadGroup(1)
        let check = server.hold("POST groups/1/chat/check")
        let checking = Task { await m.together.checkChat(groupId: 1) }
        await server.seen("POST groups/1/chat/check")
        server.answer("POST groups/1/chat/check", 200, ["tg_chat_title": "Семейный чат"])
        await m.together.disconnectChat(groupId: 1)
        await check.open()
        await checking.value
        #expect(m.together.details[1]?.settings?.tgChatTitle == nil)
    }

    @Test("отметка на «Сегодня» при плохой связи: фоновое чтение группы не пишет «группа не найдена»")
    func backgroundLoadIsQuiet() async {
        let (server, m) = setup()
        server.fail("GET groups/1", status: 0, code: "")
        await m.markGroupOnToday(groupId: 1, Self.trash())
        #expect(!m.together.missing.contains(1))
        await m.together.loadGroup(42)
        #expect(m.together.missing.contains(42), "открытый экран группы, которой нет, по-прежнему говорит «не найдена»")
    }

    @Test("вступил новичок (первый экран «Чего я хочу?») — после «Вступить» не возвращаемся в него")
    func joinEndsOnboarding() async throws {
        let server = FakeServer(today: TodayResponse(day: Self.day))
        server.groups.withLock { $0[1] = Self.family() }
        server.answer("POST invites/abc234xyz9/join", 200, ["id": 1])
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.showForTests(user: server.user, today: server.today, onboarding: true)
        _ = try await m.together.join(code: "abc234xyz9")
        #expect(!m.onboarding)
    }

    @Test("приглашение пришло при запуске, а ключ протух — после нового входа оно всё равно открывается")
    func inviteSurvivesSignOut() async throws {
        let server = FakeServer(today: TodayResponse(day: Self.day))
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.api.setCredential(.session("old"))
        m.openInvite(InviteLink(kind: .join, code: "abc234xyz9"))
        server.fail("POST session", status: 401, code: "bad_session")
        await m.load()
        #expect(m.phase == .signedOut)
        m.api.setCredential(.session("new"))
        await m.load()
        await until("экран приглашения открыт") { m.path == [.join("abc234xyz9")] }
    }

    @Test("«+ Положить»: вклад уходит и сумма перечитана; не дошёл — подсказка, сумма как была")
    func put() async {
        let goal = GroupDayItem(id: 14, title: "Отпуск", mode: .goal, people: [Self.me, 5], target: 150_000, total: 0, start: Self.day)
        let (server, m) = setup(Self.family([goal]))
        await m.together.loadGroup(1)
        await m.together.put(groupId: 1, itemId: 14, amount: 5000)
        #expect(server.calls("POST groups/1/items/14/entries").first?.json["amount"] as? Int == 5000)
        #expect(m.together.details[1]?.items.first?.total == 5000)
        #expect(m.together.note == nil)
        server.fail("POST groups/1/items/14/entries")
        await m.together.put(groupId: 1, itemId: 14, amount: 1000)
        #expect(m.together.note == TogetherModel.Note(groupId: 1, text: Strings.ru.error))
        #expect(m.together.details[1]?.items.first?.total == 5000)
    }

    @Test("друзья не загрузились, а показать нечего — ошибка, а не «пока нет друзей»; своя заявка не отменилась — сказано")
    func friendsFailures() async {
        let (server, m) = setup()
        await m.together.reloadFriends()
        #expect(m.together.friendsFailed && m.together.friends == nil)
        server.friends.withLock { $0 = FriendsResponse(outgoing: [Person(id: 10, firstName: "Коля")]) }
        await m.together.reloadFriends()
        #expect(!m.together.friendsFailed && m.together.friends?.outgoing.count == 1)
        server.fail("DELETE friends/requests/10")
        m.together.cancelRequest(10)
        await until("строка ошибки") { m.together.cancelFailed }
        #expect(m.together.friends?.outgoing.count == 1)
    }

    @Test("проверка чата: удалённый в Telegram чат пропадает из настроек")
    func checkChatClears() async {
        let (server, m) = setup(Self.family(chat: "Семейный чат"))
        await m.together.loadGroup(1)
        server.answer("POST groups/1/chat/check", 200, ["tg_chat_title": NSNull()])
        await m.together.checkChat(groupId: 1)
        #expect(m.together.details[1]?.settings?.tgChatTitle == nil)
    }

    @Test("вышли — группы и друзья прошлого человека забыты; ответ, ушедший до выхода, ничего не пишет")
    func signOut() async {
        let (server, m) = setup()
        await m.together.loadGroup(1)
        server.friends.withLock { $0 = FriendsResponse(friends: [FriendCard(id: 5, firstName: "Аня")]) }
        let gate = server.hold("GET friends")
        let reading = Task { await m.together.reloadFriends() }
        await server.seen("GET friends")
        m.signOutLocally()
        await gate.open()
        await reading.value
        #expect(m.together.details.isEmpty && m.together.friends == nil && m.together.list == nil)
    }
}
