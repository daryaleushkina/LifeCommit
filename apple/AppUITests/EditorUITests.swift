// Редактор привычки как человек — как e2e/habits.spec.ts «редактор: переименовать, «Отложить» и вернуть, удалить»:
// переименовать и сохранить, отложить и вернуть из «Отложенных», удалить насовсем с подтверждением. Проверка — и на
// экране, и в базе.
import XCTest

@MainActor
final class EditorUITests: XCTestCase {
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

    private func archived() throws -> [[String: Any]] { try stand.today()["archived"] as? [[String: Any]] ?? [] }
    private func task(_ id: Int) throws -> [String: Any]? { try stand.tasks().first { $0["id"] as? Int == id } }

    /// С «Сегодня» — экран привычки, оттуда карандашом в редактор.
    private func openEditor(_ title: String) {
        let card = app.buttons[title]
        XCTAssertTrue(card.waitForExistence(timeout: 15), "нет привычки «\(title)» на «Сегодня»")
        card.tap()
        let pencil = app.buttons["detail.edit"]
        XCTAssertTrue(pencil.waitForExistence(timeout: 5), "нет карандаша на экране привычки")
        pencil.tap()
        XCTAssertTrue(app.textFields["editor.title"].waitForExistence(timeout: 5), "редактор не открылся")
    }

    func testRenamePostponeRestoreDelete() throws {
        let created = try stand.call("POST", "tasks", ["title": "Читать", "kind": "count", "target": 20, "unit": "страниц"]) as? [String: Any]
        let id = try XCTUnwrap(created?["id"] as? Int)
        app = stand.launch()

        // Переименовать: на сервере новое название, на «Сегодня» — тоже.
        openEditor("Читать")
        let field = app.textFields["editor.title"]
        field.tap()
        field.typeText(" книги")
        app.buttons["editor.save"].tap()
        eventually("переименована на сервере") { try self.task(id)?["title"] as? String == "Читать книги" }
        XCTAssertTrue(app.buttons["Читать книги"].waitForExistence(timeout: 5), "на «Сегодня» старое название")

        // «Отложить»: с «Сегодня» пропала, на сервере — в отложенных; внизу «Отложенные · 1».
        openEditor("Читать книги")
        app.buttons["editor.postpone"].tap()
        eventually("отложена на сервере") { try self.archived().contains { $0["id"] as? Int == id } }
        let archive = app.buttons["today.archive"]
        XCTAssertTrue(archive.waitForExistence(timeout: 5), "нет ссылки «Отложенные»")
        XCTAssertFalse(app.buttons["Читать книги"].exists, "отложенная осталась на «Сегодня»")

        // «Вернуть» из «Отложенных» — снова на «Сегодня» и в списке привычек на сервере.
        archive.tap()
        let restore = app.el("archive.restore", "Читать книги")
        XCTAssertTrue(restore.waitForExistence(timeout: 5), "нет «Вернуть» в «Отложенных»")
        restore.tap()
        eventually("вернулась на сервере") { try self.task(id) != nil }
        XCTAssertTrue(app.buttons["Читать книги"].waitForExistence(timeout: 5), "вернули — а на «Сегодня» её нет")

        // «Удалить» — с подтверждением; насовсем: ни в привычках, ни в отложенных.
        openEditor("Читать книги")
        app.buttons["editor.delete"].tap()
        let confirm = app.buttons["Удалить"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "нет подтверждения удаления")
        confirm.tap()
        eventually("удалена на сервере") { try self.task(id) == nil && !self.archived().contains { $0["id"] as? Int == id } }
        XCTAssertTrue(app.buttons["today.addTask"].waitForExistence(timeout: 5) || app.buttons["onboarding.intent.count"].waitForExistence(timeout: 5), "после удаления не вернулись на «Сегодня»")
        XCTAssertFalse(app.buttons["Читать книги"].exists)
    }
}
