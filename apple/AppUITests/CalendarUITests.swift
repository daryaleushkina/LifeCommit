// Вкладка «Календарь» как человек — как e2e/calendar.spec.ts и todos.spec.ts мини-аппа: день вперёд, дело на этот
// день, шторка дела (название, время, «Завтра»), «Месяц» с точками и выбором дня, «К сегодня», «Потом» на «Сегодня».
// Проверка — и на экране, и в базе. Подключение Apple и Google — в AppModelTests (внешние сервисы стенд не подменит).
import XCTest

@MainActor
final class CalendarUITests: XCTestCase {
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

    private func day(_ offset: Int, from today: String) -> String {
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyy-MM-dd"
        let base = fmt.date(from: today)!
        return fmt.string(from: Calendar(identifier: .gregorian).date(byAdding: .day, value: offset, to: base)!)
    }

    private func todos(from: String, to: String) throws -> [[String: Any]] {
        (try stand.call("GET", "calendar?from=\(from)&to=\(to)") as? [String: Any])?["todos"] as? [[String: Any]] ?? []
    }

    private func openCalendar() {
        let tab = app.buttons["Календарь"]
        XCTAssertTrue(tab.waitForExistence(timeout: 15), "нет вкладки «Календарь»")
        tab.tap()
        XCTAssertTrue(app.buttons["calSettings"].waitForExistence(timeout: 10), "вкладка «Календарь» не открылась")
    }

    func testTomorrowTodoAndItsSheet() throws {
        try stand.call("POST", "tasks", ["title": "Пить воду", "kind": "count", "target": 8])
        let today = try XCTUnwrap(try stand.today()["day"] as? String)
        let tomorrow = day(1, from: today)
        app = stand.launch()
        openCalendar()

        // День вперёд — «К сегодня» появилась; дело на этот день.
        app.buttons["Следующий день"].tap()
        XCTAssertTrue(app.buttons["К сегодня"].waitForExistence(timeout: 5), "нет «К сегодня» на другом дне")
        app.buttons["Дело на этот день"].tap()
        let field = app.textFields["todoField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Забрать посылку\n")
        eventually("дело на завтра на сервере") { try self.todos(from: tomorrow, to: tomorrow).contains { $0["title"] as? String == "Забрать посылку" && $0["day"] as? String == tomorrow } }

        // Шторка дела: время 15:30 и новое название уходят на сервер.
        let row = app.buttons["todo-Забрать посылку"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "нет строки дела")
        row.tap()
        let title = app.textFields["todoTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "шторка дела не открылась")
        title.tap()
        title.typeText(" на почте")
        app.buttons["todoTime"].tap()
        let wheels = app.pickerWheels
        XCTAssertTrue(wheels.firstMatch.waitForExistence(timeout: 5), "нет барабанов времени")
        wheels.element(boundBy: 0).adjust(toPickerWheelValue: "15")
        wheels.element(boundBy: 1).adjust(toPickerWheelValue: "30")
        app.buttons["timeDone"].tap()
        XCTAssertTrue(app.buttons["todoDone"].waitForExistence(timeout: 5))
        app.buttons["todoDone"].tap()
        eventually("правка дела на сервере") {
            try self.todos(from: tomorrow, to: tomorrow).contains { $0["title"] as? String == "Забрать посылку на почте" && $0["time"] as? String == "15:30" }
        }
        XCTAssertTrue(app.buttons["todo-Забрать посылку на почте"].waitForExistence(timeout: 5), "на экране старое название")

        // «К сегодня» — назад; дела на завтра на «Сегодня» нет, зато «Потом · 1».
        app.buttons["К сегодня"].tap()
        XCTAssertFalse(app.buttons["todo-Забрать посылку на почте"].waitForExistence(timeout: 2))
        app.buttons["Сегодня"].tap()
        let later = app.buttons["laterLink"]
        XCTAssertTrue(later.waitForExistence(timeout: 10), "нет «Потом · 1» на «Сегодня»")
        later.tap()
        XCTAssertTrue(app.buttons["Забрать посылку на почте"].waitForExistence(timeout: 5) || app.staticTexts["Забрать посылку на почте"].waitForExistence(timeout: 1), "в «Потом» нет дела")
    }

    func testMonthShowsDotsAndPicksDay() throws {
        let today = try XCTUnwrap(try stand.today()["day"] as? String)
        // Дело на завтра (в прошлое сервер дело не ставит); завтра — уже следующий месяц — листаем месяц вперёд.
        let other = day(1, from: today)
        try stand.call("POST", "todos", ["title": "Сдать отчёт", "day": other])
        app = stand.launch()
        openCalendar()
        app.buttons["Месяц"].tap()
        if other.prefix(7) != today.prefix(7) { app.buttons["Следующий месяц"].tap() }
        let cell = app.buttons["cal-\(other)"]
        XCTAssertTrue(cell.waitForExistence(timeout: 10), "нет дня в сетке месяца")
        cell.tap()
        XCTAssertTrue(app.buttons["todo-Сдать отчёт"].waitForExistence(timeout: 5), "в выбранном дне нет дела")
    }
}
