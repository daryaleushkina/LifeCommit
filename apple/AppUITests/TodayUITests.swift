// «Сегодня» как человек: отметить привычки трёх видов, отметить и добавить дело, смахнуть с «Вернуть», первая
// привычка через «Чего я хочу?», выйти. Сервер — локальный стенд (Stand.swift), проверка — и на экране, и в базе.
import XCTest

@MainActor
final class TodayUITests: XCTestCase {
    var stand: Stand!
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        stand = Stand()
        try stand.session()
    }

    override func tearDown() {
        stand?.deleteAccount()
    }

    private func seedHabits() throws -> (water: Int, gym: Int, smoke: Int) {
        let water = try stand.call("POST", "tasks", ["title": "Пить воду", "kind": "count", "target": 8, "unit": "стаканов"]) as? [String: Any]
        let gym = try stand.call("POST", "tasks", ["title": "Сходить в спортзал", "kind": "check", "target": 1]) as? [String: Any]
        let smoke = try stand.call("POST", "tasks", ["title": "Не курить", "kind": "abstain", "target": 1]) as? [String: Any]
        try stand.call("POST", "todos", ["title": "Купить корм Тесле"])
        return (water?["id"] as? Int ?? 0, gym?["id"] as? Int ?? 0, smoke?["id"] as? Int ?? 0)
    }

    private func task(_ id: Int) throws -> [String: Any]? { try stand.tasks().first { $0["id"] as? Int == id } }

    func testMarksReachTheServer() throws {
        let ids = try seedHabits()
        app = stand.launch()

        // «Делать»: галочка; повторный тап снимает.
        let gym = app.el("habit.done", "Сходить в спортзал")
        XCTAssertTrue(gym.waitForExistence(timeout: 15))
        gym.tap()
        eventually("спортзал отмечен") { try self.task(ids.gym)?["value"] as? Double == 1 }
        gym.tap()
        eventually("отметка спортзала снята") { try self.task(ids.gym)?["value"] as? Double == 0 }

        // «Считать»: галочка — сделано целиком.
        app.el("habit.done", "Пить воду").tap()
        eventually("вода — 8 из 8") { try self.task(ids.water)?["value"] as? Double == 8 }

        // «Бросить»: «Да, получилось» — clean, под названием — «N дней без этого».
        app.el("habit.yes").tap()
        eventually("не курить — получилось") { try self.task(ids.smoke)?["status"] as? String == "clean" }
        XCTAssertTrue(app.staticTexts["1 день без этого"].waitForExistence(timeout: 5))

        // Дело: кружок — сделано.
        app.el("todo.check", "Сделано: Купить корм Тесле", exact: true).tap()
        eventually("дело сделано") { try self.stand.todos().first?["done"] as? Bool == true }
    }

    func testCountByTyping() throws {
        let ids = try seedHabits()
        app = stand.launch()
        let pencil = app.el("habit.pencil", "Пить воду")
        XCTAssertTrue(pencil.waitForExistence(timeout: 15), "нет карандаша")
        pencil.tap()
        let field = app.el("habit.countInput")
        XCTAssertTrue(field.waitForExistence(timeout: 5), "карандаш не открыл поле")
        field.typeText("5\n")
        eventually("вода — 5") { try self.task(ids.water)?["value"] as? Double == 5 }
        // На карточке — «5 из 8 стаканов» (значение кнопки для VoiceOver — тот же текст).
        let value = app.buttons.matching(NSPredicate(format: "value BEGINSWITH %@", "5 из 8 стаканов")).firstMatch
        XCTAssertTrue(value.waitForExistence(timeout: 5), "на карточке не «5 из 8 стаканов»")
    }

    func testAddTodoKeepsFieldOpen() throws {
        _ = try seedHabits()
        app = stand.launch()
        let add = app.el("todo.add")
        XCTAssertTrue(add.waitForExistence(timeout: 15))
        add.tap()
        let field = app.textFields["todo.input"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Купить молоко\n")
        // Поле осталось открытым — следующее дело сразу.
        field.typeText("Позвонить маме\n")
        eventually("оба дела на сервере") {
            Set(try self.stand.todos().compactMap { $0["title"] as? String }).isSuperset(of: ["Купить молоко", "Позвонить маме"])
        }
        // Строка дела — кнопка (нажатие открывает шторку дела), её текст — подпись кнопки.
        XCTAssertTrue(app.el("todo.row", "Купить молоко").exists)
    }

    func testSwipeDeleteWithUndo() throws {
        let ids = try seedHabits()
        app = stand.launch()
        let card = app.card("habit.card", "Сходить в спортзал")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "нет карточки привычки")

        // Короткий свайп — под строкой «Удалить»; нажали — строка пропала сразу, внизу «Вернуть»; вернули — сервер
        // ничего не узнал.
        drag(card, from: 0.9, to: 0.6)
        let pill = app.buttons["swipe.delete"]
        XCTAssertTrue(pill.waitForExistence(timeout: 5), "короткий свайп не открыл «Удалить»")
        pill.tap()
        let undo = app.buttons["undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5), "нет плашки «Вернуть»")
        undo.tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        // Сервер ничего не узнал — без ожидания вслепую: новое удаление сразу отправляет прежнее отложенное. Если бы
        // «Вернуть» его не отменило, спортзал ушёл бы на сервер раньше воды (её отправит удаление «Не курить»).
        drag(app.card("habit.card", "Пить воду"), from: 0.95, to: 0.05)
        drag(app.card("habit.card", "Не курить"), from: 0.95, to: 0.05)
        eventually("вода удалена на сервере") { try self.task(ids.water) == nil }
        XCTAssertNotNil(try task(ids.gym), "вернули — привычка осталась на сервере")

        // Свайп до конца — удаляется без кнопки; не вернули — через 5 секунд удалена на сервере.
        drag(card, from: 0.95, to: 0.05)
        XCTAssertTrue(app.buttons["undo"].waitForExistence(timeout: 5), "свайп до конца не удалил")
        eventually("удалена на сервере", timeout: 12) { try self.task(ids.gym) == nil }
        XCTAssertFalse(app.card("habit.card", "Сходить в спортзал").exists)
    }

    /// Провести пальцем по строке слева направо по доле её ширины (from → to), как человек: нажал и повёл.
    private func drag(_ element: XCUIElement, from: CGFloat, to: CGFloat) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: from, dy: 0.5))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: to, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .default, thenHoldForDuration: 0.05)
    }

    func testFirstHabitThroughWhatDoIWant() throws {
        // Пустой человек — первый экран «Чего я хочу?».
        app = stand.launch()
        let intent = app.buttons["onboarding.intent.count"]
        XCTAssertTrue(intent.waitForExistence(timeout: 15))
        intent.tap()
        let title = app.textFields["editor.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let save = app.buttons["editor.save"]
        XCTAssertFalse(save.isEnabled, "без названия сохранить нельзя")
        title.tap()
        title.typeText("Читать")
        save.tap()
        eventually("привычка на сервере") { try self.stand.tasks().first?["title"] as? String == "Читать" }
        XCTAssertTrue(app.el("habit.done", "Читать").waitForExistence(timeout: 5), "после сохранения — «Сегодня» с новой привычкой")
        XCTAssertEqual(try stand.tasks().first?["target"] as? Double, 10)
    }

    func testSkipOnboardingShowsToday() throws {
        app = stand.launch()
        let skip = app.buttons["onboarding.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 15))
        skip.tap()
        XCTAssertTrue(app.staticTexts["На сегодня всё"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["today.addTask"].exists)
    }

    /// Правила вёрстки, как checkScreen: ничего шире экрана; последнее на экране видно и не лежит под нижней панелью.
    func testLayoutRules() throws {
        _ = try seedHabits()
        for i in 0..<8 { try stand.call("POST", "tasks", ["title": "Привычка \(i + 1)", "kind": "check", "target": 1]) }
        try stand.call("POST", "tasks", ["title": "Бег", "kind": "check", "target": 1])
        let archived = try stand.call("POST", "tasks", ["title": "Отложенная", "kind": "check", "target": 1]) as? [String: Any]
        try stand.call("POST", "tasks/\(archived?["id"] as? Int ?? 0)/archive")
        app = stand.launch()
        XCTAssertTrue(app.el("habit.done", "Пить воду").waitForExistence(timeout: 15))

        let window = app.windows.firstMatch.frame
        for text in app.staticTexts.allElementsBoundByIndex where text.exists && !text.frame.isEmpty {
            XCTAssertLessThanOrEqual(text.frame.maxX, window.maxX + 0.5, "«\(text.label)» шире экрана")
            XCTAssertGreaterThanOrEqual(text.frame.minX, window.minX - 0.5, "«\(text.label)» шире экрана")
        }

        // Список листается до конца, последнее («Отложенные · 1») — над нижней панелью и нажимается.
        let last = app.buttons["today.archive"]
        let tabBar = app.buttons["tab.today"].frame
        var tries = 0
        while !(last.exists && last.isHittable && last.frame.maxY <= tabBar.minY) && tries < 10 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(last.isHittable, "последнее на экране не видно")
        XCTAssertLessThanOrEqual(last.frame.maxY, tabBar.minY, "последнее лежит под нижней панелью")
        last.tap()
        XCTAssertTrue(app.el("archive.restore", "Отложенная").waitForExistence(timeout: 5))
    }

    func testSignOut() throws {
        app = stand.launch()
        XCTAssertTrue(app.buttons["onboarding.skip"].waitForExistence(timeout: 15))
        app.buttons["onboarding.skip"].tap()
        app.buttons["tab.me"].tap()
        app.buttons["me.logout"].tap()
        app.buttons["Выйти"].tap()
        XCTAssertTrue(app.buttons["signin.telegram"].waitForExistence(timeout: 5), "после выхода — экран входа")
    }
}
