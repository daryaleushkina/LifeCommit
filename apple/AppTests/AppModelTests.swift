// Модель приложения против подменённого сервера (FakeServer): загрузка, гонки перечитывания «Сегодня» с правками,
// удаление и «Скрыть» с «Вернуть», вход через приложение Telegram, свернули — вернули.
import LifeCommitKit
import SwiftUI
import Testing
@testable import LifeCommit

@MainActor
@Suite("Модель приложения", .timeLimit(.minutes(1)))
struct AppModelTests {
    static let day = "2026-10-05"

    static func today(todos: [Todo] = []) -> TodayResponse {
        TodayResponse(
            day: day,
            tasks: [
                TodayTask(id: 1, title: "Сходить в спортзал", kind: .check),
                TodayTask(id: 2, title: "Пить воду", kind: .count, unit: "стаканов", target: 8),
            ],
            todos: todos
        )
    }

    func model(_ server: FakeServer) -> AppModel {
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.showForTests(user: server.user, today: server.today)
        return m
    }

    @Test("загрузка: сессия и «Сегодня»; за картой не ходит — её пока не показывает ни один экран")
    func loadWithoutHeatmap() async {
        let server = FakeServer(today: Self.today())
        let m = AppModel(api: server.api, tokens: MemoryTokenStore())
        m.api.setCredential(.session("key"))
        await m.load()
        #expect(m.phase == .ready)
        #expect(m.today == server.today)
        #expect(!server.calls.contains { $0.hasPrefix("GET heatmap") })
    }

    @Test("перечитали «Сегодня», пока добавляли дело: старый ответ не стирает дело — спрашиваем заново")
    func refreshDuringAddTodo() async {
        let server = FakeServer(today: Self.today())
        let m = model(server)
        let gate = server.hold("GET today")
        let refreshing = Task { await m.refresh() }
        await server.seen("GET today")
        await m.addTodo("Купить хлеб")
        await gate.open()
        await refreshing.value
        #expect(m.today.todos.map(\.title) == ["Купить хлеб"])
        #expect(m.today.todos.first?.id == server.today.todos.first?.id)
    }

    @Test("перечитали «Сегодня», пока дело ещё создаётся: ждём сервер и спрашиваем заново — дело не пропадает")
    func refreshWhileTodoInFlight() async {
        let server = FakeServer(today: Self.today())
        let m = model(server)
        let post = server.hold("POST todos")
        let adding = Task { await m.addTodo("Купить хлеб") }
        await server.seen("POST todos")
        let refreshing = Task { await m.refresh() }
        await server.seen("GET today")
        await post.open()
        await adding.value
        await refreshing.value
        #expect(m.today.todos.map(\.title) == ["Купить хлеб"])
        #expect(m.today.todos.first?.id ?? 0 > 0, "у дела настоящий id с сервера")
    }

    @Test("отметка задним числом: перечитка после неё не стирает отметку за сегодня, сделанную в это время")
    func markDayKeepsTodayMark() async {
        let server = FakeServer(today: Self.today())
        let m = model(server)
        let gate = server.hold("GET today")
        let gym = m.today.tasks[0]
        let marking = Task { await m.markDay(gym, day: "2026-10-04", yes: true) }
        await server.seen("GET today")
        await m.log(m.today.tasks[1], value: 8, status: nil)
        await gate.open()
        await marking.value
        #expect(m.today.tasks[1].value == 8)
        #expect(m.today.tasks[1].logged)
    }

    @Test("удалили дело: строка не мигает — скрыта, пока «Сегодня» не перечитано без неё")
    func removeTodoNoFlicker() async {
        let todo = Todo(id: 5, title: "Купить хлеб", day: Self.day)
        let server = FakeServer(today: Self.today(todos: [todo]))
        let m = model(server)
        let gate = server.hold("GET today")
        m.removeTodo(todo)
        #expect(m.removal?.text == "«Купить хлеб» удалено")
        let flushing = m.flushRemoval()
        await server.seen("GET today")
        #expect(m.isRemoved("todo:5"), "перечитка ещё идёт — строка должна оставаться скрытой")
        await gate.open()
        await flushing?.value
        #expect(!m.isRemoved("todo:5"))
        #expect(m.today.todos.isEmpty)
        #expect(server.calls.contains("DELETE todos/5"))
    }

    @Test("«Скрыть» событие календаря: у нас пропадает (hidden), из календаря не удаляется")
    func hideEvent() async throws {
        let event = Todo(id: 6, title: "Созвон", day: Self.day, time: "10:00", source: .google)
        let server = FakeServer(today: Self.today(todos: [event]))
        let m = model(server)
        m.hideTodo(event)
        #expect(m.removal?.text == "«Созвон» скрыто")
        #expect(m.isRemoved("todo:6"))
        await m.flushRemoval()?.value
        let patch = try #require(server.calls("PATCH todos/6").first)
        #expect(patch.json["hidden"] as? Bool == true)
        #expect(!server.calls.contains("DELETE todos/6"))
        #expect(m.today.todos.isEmpty)
    }

    @Test("«Вернуть» после «Скрыть» — на сервер ничего не уходит")
    func hideUndo() async {
        let event = Todo(id: 6, title: "Созвон", day: Self.day, source: .apple)
        let server = FakeServer(today: Self.today(todos: [event]))
        let m = model(server)
        m.hideTodo(event)
        m.undoRemoval()
        #expect(m.flushRemoval() == nil)
        #expect(!m.isRemoved("todo:6"))
        #expect(server.calls.isEmpty)
    }

    @Test("ушли в Telegram за входом: вернулись без кода — кнопка «Войти» снова нажимается; код забирается один раз")
    func telegramHandOff() {
        let m = AppModel(api: FakeServer(today: Self.today()).api, tokens: MemoryTokenStore())
        m.beginSignIn()
        #expect(m.signingIn)
        m.handOffToTelegram(.init(pkce: .random(), clientId: "8000000001"))
        #expect(!m.signingIn)
        #expect(m.takeTelegramPending()?.clientId == "8000000001")
        #expect(m.takeTelegramPending() == nil)
    }

    @Test("опустили шторку или открыли переключатель приложений — «Вернуть» ещё можно; свернули — удаление уходит")
    func scenePhases() async {
        let todo = Todo(id: 5, title: "Купить хлеб", day: Self.day)
        let server = FakeServer(today: Self.today(todos: [todo]))
        let m = model(server)
        m.removeTodo(todo)
        m.scenePhaseChanged(.inactive)
        #expect(m.removal != nil, "неактивно — ещё не фон: удаление не отправляем")
        m.scenePhaseChanged(.background)
        #expect(m.removal == nil)
        await server.seen("DELETE todos/5")
    }
}

/// Сервер отказал или связи нет — экран возвращается как был, сверху плашка «Что-то пошло не так» (CLAUDE.md, как
/// e2e/habits.spec.ts мини-аппа); ключ больше не пускает — на вход.
@MainActor
@Suite("Модель: отказы сервера", .timeLimit(.minutes(1)))
struct AppModelFailureTests {
    func model(_ server: FakeServer) -> AppModel {
        let m = AppModel(api: server.api, tokens: MemoryTokenStore("key"))
        m.showForTests(user: server.user, today: server.today)
        return m
    }

    @Test("отметка не дошла — откат и плашка")
    func logRollsBack() async {
        let server = FakeServer(today: AppModelTests.today())
        let m = model(server)
        server.fail("PUT logs")
        await m.log(m.today.tasks[1], value: 8, status: nil)
        #expect(m.today.tasks[1].value == 0)
        #expect(!m.today.tasks[1].logged)
        #expect(m.banner == m.strings.error)
    }

    @Test("отметка задним числом без связи — история как была (не «отмечено»), плашка")
    func markDayRollsBackOffline() async {
        let server = FakeServer(today: AppModelTests.today())
        let m = model(server)
        let before = TaskHistory(start: "2026-09-20", goals: [HistoryGoal(effectiveFrom: "2026-09-20", target: 1)], logs: [HistoryLog(day: "2026-10-01", value: 1)])
        m.setHistoryForTests(1, before)
        server.fail("PUT logs", status: 0)
        server.fail("GET tasks/1/history", status: 0)
        await m.markDay(m.today.tasks[0], day: "2026-10-04", yes: true)
        #expect(m.histories[1] == before)
        #expect(m.banner == m.strings.error)
    }

    @Test("отметка задним числом не дошла, но связь есть — история перечитана с сервера")
    func markDayReloadsHistory() async {
        let server = FakeServer(today: AppModelTests.today())
        let m = model(server)
        let fresh = TaskHistory(start: "2026-09-20", goals: [], logs: [HistoryLog(day: "2026-09-30", value: 1)])
        server.histories.withLock { $0[1] = fresh }
        server.fail("PUT logs")
        await m.markDay(m.today.tasks[0], day: "2026-10-04", yes: true)
        #expect(m.histories[1] == fresh)
        #expect(m.banner == m.strings.error)
    }

    @Test("дело не отметилось — галочка снята обратно, плашка")
    func toggleRollsBack() async {
        let todo = Todo(id: 5, title: "Купить хлеб", day: AppModelTests.day)
        let server = FakeServer(today: AppModelTests.today(todos: [todo]))
        let m = model(server)
        server.fail("PATCH todos/5")
        await m.toggle(todo)
        #expect(m.today.todos.first?.done == false)
        #expect(m.banner == m.strings.error)
    }

    @Test("дело не добавилось — временной строки нет, плашка")
    func addTodoRollsBack() async {
        let server = FakeServer(today: AppModelTests.today())
        let m = model(server)
        server.fail("POST todos")
        await m.addTodo("Купить хлеб")
        #expect(m.today.todos.isEmpty)
        #expect(m.banner == m.strings.error)
    }

    @Test("удаление не прошло — экран перечитан с сервера (строка вернулась), «Что-то пошло не так» поверх экрана")
    func removalFails() async {
        let todo = Todo(id: 5, title: "Купить хлеб", day: AppModelTests.day)
        let server = FakeServer(today: AppModelTests.today(todos: [todo]))
        let m = model(server)
        // Пока строка висела под «Вернуть», с другого устройства добавили дело — перечитанный экран его покажет.
        server.state.withLock { $0.todos.append(Todo(id: 6, title: "Позвонить маме", day: AppModelTests.day)) }
        server.fail("DELETE todos/5")
        m.removeTodo(todo)
        await m.flushRemoval()?.value
        #expect(m.removalFailed)
        #expect(!m.isRemoved("todo:5"))
        #expect(m.today.todos.map(\.id) == [5, 6])
    }

    @Test("ключ больше не пускает (401 bad_session) — ключ забыт, экран входа")
    func signedOut() async throws {
        let server = FakeServer(today: AppModelTests.today())
        let tokens = MemoryTokenStore("key")
        let m = AppModel(api: server.api, tokens: tokens)
        m.showForTests(user: server.user, today: server.today)
        server.fail("PUT logs", status: 401, code: "bad_session")
        await m.log(m.today.tasks[0], value: 1, status: nil)
        #expect(m.phase == .signedOut)
        #expect(try tokens.load() == nil)
        #expect(m.today.tasks.isEmpty)
    }
}

@Suite("Адрес сервера")
struct ConfigTests {
    @Test("подмена адреса из настроек — только в сборке для разработки: в сборке для людей ключ уходит лишь на прод")
    func apiBaseOverride() {
        let evil = "https://evil.example/api"
        let prod = "https://lifecommit.app/api"
        #expect(Config.apiBase(override: evil, plist: prod, allowOverride: false).absoluteString == prod)
        #expect(Config.apiBase(override: evil, plist: prod, allowOverride: true).absoluteString == evil)
        #expect(Config.apiBase(override: nil, plist: nil, allowOverride: false).absoluteString == prod)
    }
}
