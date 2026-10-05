// Экран привычки как человек: открыть с «Сегодня», отметить сегодня, отметить прошедший день задним числом и убрать
// отметку, перейти в редактор. Проверка — на экране и в базе.
import XCTest

@MainActor
final class DetailUITests: XCTestCase {
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

    private func history(_ id: Int) throws -> [[String: Any]] {
        (try stand.call("GET", "tasks/\(id)/history") as? [String: Any])?["logs"] as? [[String: Any]] ?? []
    }

    func testMarkTodayAndBackdate() throws {
        let created = try stand.call("POST", "tasks", ["title": "Сходить в спортзал", "kind": "check", "target": 1]) as? [String: Any]
        let id = try XCTUnwrap(created?["id"] as? Int)
        let today = try XCTUnwrap(try stand.today()["day"] as? String)
        app = stand.launch()

        let title = app.buttons["Сходить в спортзал"]
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        title.tap()
        XCTAssertTrue(app.staticTexts["Каждый день"].waitForExistence(timeout: 5), "нет подписи «как часто»")

        // Отметка «сегодня» с экрана привычки — та же, что на «Сегодня».
        app.buttons["Сходить в спортзал — сделано"].tap()
        eventually("сегодня отмечено") { try self.history(id).contains { $0["day"] as? String == today && $0["value"] as? Double == 1 } }

        // Прошедший день — задним числом (привычка новая, но месяц назад отмечать можно).
        let past = try XCTUnwrap(Calendar.current.date(byAdding: .day, value: -1, to: Date()))
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        let yesterday = fmt.string(from: past)
        // Вчера — прошлый месяц (сегодня 1-е): листаем календарь назад.
        if yesterday.prefix(7) != today.prefix(7) { app.buttons["Предыдущий месяц"].tap() }
        let cell = app.buttons["day-\(yesterday)"]
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "вчерашний день нельзя нажать")
        cell.tap()
        app.buttons["Сделано"].tap()
        eventually("вчера отмечено задним числом") { try self.history(id).contains { $0["day"] as? String == yesterday } }

        cell.tap()
        XCTAssertTrue(app.buttons["Убрать отметку"].waitForExistence(timeout: 5))
        app.buttons["Убрать отметку"].tap()
        eventually("отметка за вчера снята") { try !self.history(id).contains { $0["day"] as? String == yesterday } }

        // Карандаш — редактор этой привычки.
        app.buttons["edit"].tap()
        XCTAssertTrue(app.textFields["title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["title"].value as? String, "Сходить в спортзал")
    }
}
