// «Вместе» как человек: завести группу, добавить дело и отметить; принять заявку в друзья; вступить в группу по
// ссылке-приглашению (lifecommit://join/<код>). Сервер — локальный стенд (Stand.swift), второй человек — свой Stand;
// проверка — и на экране, и в базе.
import XCTest

@MainActor
final class TogetherUITests: XCTestCase {
    var stand: Stand!
    var other: Stand?
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        stand = Stand()
        try stand.session()
    }

    override func tearDown() {
        stand?.deleteAccount()
        other?.deleteAccount()
    }

    /// Пустой человек: первый экран «Чего я хочу?» — пропустить и открыть «Вместе».
    private func openTogether() {
        app = stand.launch()
        let skip = app.buttons["onboarding.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 15))
        skip.tap()
        app.buttons["tab.together"].tap()
    }

    private func groups(_ s: Stand) throws -> [[String: Any]] { try s.call("GET", "groups") as? [[String: Any]] ?? [] }

    func testCreateGroupAddItemAndMark() throws {
        openTogether()
        // Раздел «Группы · Друзья» запоминается на устройстве — выбираем явно.
        let section = app.el("together.groups")
        XCTAssertTrue(section.waitForExistence(timeout: 10))
        section.tap()
        let create = app.buttons["group.new"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        let title = app.textFields["groupNew.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.typeText("Семья")
        app.buttons["groupNew.create"].tap()
        // Сразу экран новой группы.
        XCTAssertTrue(app.staticTexts["Семья"].waitForExistence(timeout: 10))
        eventually("группа на сервере") { try self.groups(self.stand).first?["title"] as? String == "Семья" }

        app.buttons["group.addItem"].tap()
        let item = app.textFields["groupItem.title"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.typeText("Вынести мусор")
        app.buttons["groupItem.save"].tap()
        let check = app.el("group.itemCheck", "Сделано: Вынести мусор", exact: true)
        XCTAssertTrue(check.waitForExistence(timeout: 10), "дело появилось на экране группы с галочкой")
        eventually("дело на сервере") {
            let items = try self.groups(self.stand).first?["items"] as? [[String: Any]] ?? []
            return items.contains { $0["title"] as? String == "Вынести мусор" }
        }

        check.tap()
        eventually("отметка на сервере") {
            let items = try self.groups(self.stand).first?["items"] as? [[String: Any]] ?? []
            return items.first { $0["title"] as? String == "Вынести мусор" }?["done"] as? Bool == true
        }
        XCTAssertTrue(app.el("group.itemCheck", "Не сделано: Вынести мусор", exact: true).waitForExistence(timeout: 5))

        // На «Сегодня» — блок группы с этим делом.
        app.buttons["nav.back"].tap()
        app.buttons["tab.today"].tap()
        XCTAssertTrue(app.el("group.block", "Семья").waitForExistence(timeout: 10))
    }

    func testAcceptFriendRequest() throws {
        let friend = Stand()
        other = friend
        try friend.session()
        try friend.call("POST", "friends/requests", ["username": "u\(stand.userId)"])

        openTogether()
        let switcher = app.el("together.friends")
        XCTAssertTrue(switcher.waitForExistence(timeout: 10))
        switcher.tap()
        let requests = app.buttons["friends.requests"]
        XCTAssertTrue(requests.waitForExistence(timeout: 10), "нет строки «Заявки · 1»")
        requests.tap()
        let accept = app.el("request.accept", "Даша")
        XCTAssertTrue(accept.waitForExistence(timeout: 10))
        accept.tap()
        eventually("друзья на сервере") {
            let list = try self.stand.call("GET", "friends") as? [String: Any]
            return (list?["friends"] as? [[String: Any]] ?? []).contains { $0["id"] as? Int == friend.userId }
        }
        // Первый друг — один раз спрашиваем, что ему показать; «Назад» ничего не меняет.
        app.buttons["nav.back"].tap()
        let showBack = app.buttons["show.back"]
        XCTAssertTrue(showBack.waitForExistence(timeout: 10), "нет «Что показать друзьям?»")
        showBack.tap()
        XCTAssertTrue(app.el("friend.row", "Даша").waitForExistence(timeout: 10), "друг в списке")
    }

    func testJoinByInviteLink() throws {
        let owner = Stand()
        other = owner
        try owner.session()
        let created = try owner.call("POST", "groups", ["title": "Бег по выходным", "kind": "other"]) as? [String: Any]
        let groupId = try XCTUnwrap(created?["id"] as? Int)
        let invite = try owner.call("POST", "groups/\(groupId)/invite") as? [String: Any]
        let code = try XCTUnwrap(invite?["code"] as? String)

        openTogether()
        app.open(try XCTUnwrap(URL(string: "lifecommit://join/\(code)")))
        let join = app.buttons["join.join"]
        XCTAssertTrue(join.waitForExistence(timeout: 15), "ссылка не открыла приглашение")
        XCTAssertTrue(app.staticTexts["Бег по выходным"].exists)
        join.tap()
        XCTAssertTrue(app.buttons["group.settings"].waitForExistence(timeout: 10), "после вступления — экран группы")
        eventually("в группе на сервере") { try self.groups(self.stand).contains { $0["id"] as? Int == groupId } }

        // Чужой код — «Приглашение не найдено.», а не пустой экран.
        app.open(try XCTUnwrap(URL(string: "lifecommit://join/nosuchcode1")))
        XCTAssertTrue(app.staticTexts["Приглашение не найдено."].waitForExistence(timeout: 10))
    }
}
