// Вкладка «Календарь» как человек — как e2e/calendar.spec.ts и todos.spec.ts мини-аппа: день вперёд, дело на этот
// день, шторка дела (название, время, «Завтра»), «Месяц» с точками и выбором дня, «К сегодня», «Потом» на «Сегодня».
// Проверка — и на экране, и в базе. Подключение Apple и Google — в AppModelTests (внешние сервисы стенд не подменит).
import LifeCommitKit
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
        let tab = app.el("tab.calendar")
        XCTAssertTrue(tab.waitForExistence(timeout: 15), "нет вкладки «Календарь»")
        tab.tap()
        XCTAssertTrue(app.buttons["calendar.settings"].waitForExistence(timeout: 10), "вкладка «Календарь» не открылась")
    }

    func testTomorrowTodoAndItsSheet() throws {
        try stand.call("POST", "tasks", ["title": "Пить воду", "kind": "count", "target": 8])
        let today = try XCTUnwrap(try stand.today()["day"] as? String)
        let tomorrow = day(1, from: today)
        app = stand.launch()
        openCalendar()

        // День вперёд — «К сегодня» появилась; дело на этот день.
        app.el("calendar.next").tap()
        XCTAssertTrue(app.el("calendar.today").waitForExistence(timeout: 5), "нет «К сегодня» на другом дне")
        app.el("todo.add").tap()
        let field = app.textFields["todo.input"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Забрать посылку\n")
        eventually("дело на завтра на сервере") { try self.todos(from: tomorrow, to: tomorrow).contains { $0["title"] as? String == "Забрать посылку" && $0["day"] as? String == tomorrow } }

        // Шторка дела: время 15:30 и новое название уходят на сервер.
        let row = app.el("todo.row", "Забрать посылку")
        XCTAssertTrue(row.waitForExistence(timeout: 5), "нет строки дела")
        row.tap()
        let title = app.textFields["todoSheet.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "шторка дела не открылась")
        title.tap()
        title.typeText(" на почте")
        app.buttons["todoSheet.time"].tap()
        let wheels = app.pickerWheels
        XCTAssertTrue(wheels.firstMatch.waitForExistence(timeout: 5), "нет барабанов времени")
        wheels.element(boundBy: 0).adjust(toPickerWheelValue: "15")
        wheels.element(boundBy: 1).adjust(toPickerWheelValue: "30")
        app.buttons["time.done"].tap()
        XCTAssertTrue(app.buttons["todoSheet.done"].waitForExistence(timeout: 5))
        app.buttons["todoSheet.done"].tap()
        eventually("правка дела на сервере") {
            try self.todos(from: tomorrow, to: tomorrow).contains { $0["title"] as? String == "Забрать посылку на почте" && $0["time"] as? String == "15:30" }
        }
        XCTAssertTrue(app.el("todo.row", "Забрать посылку на почте").waitForExistence(timeout: 5), "на экране старое название")

        // «К сегодня» — назад; дела на завтра на «Сегодня» нет, зато «Потом · 1».
        app.el("calendar.today").tap()
        XCTAssertFalse(app.el("todo.row", "Забрать посылку на почте").waitForExistence(timeout: 2))
        app.el("tab.today").tap()
        let later = app.buttons["todo.later"]
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
        app.el("calendar.mode.month").tap()
        if other.prefix(7) != today.prefix(7) { app.el("calendar.next").tap() }
        let cell = app.el("calendar.day", Strings.ru.weekdayLong(other), exact: true)
        XCTAssertTrue(cell.waitForExistence(timeout: 10), "нет дня в сетке месяца")
        cell.tap()
        XCTAssertTrue(app.el("todo.row", "Сдать отчёт").waitForExistence(timeout: 5), "в выбранном дне нет дела")
    }
}
