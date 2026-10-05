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
