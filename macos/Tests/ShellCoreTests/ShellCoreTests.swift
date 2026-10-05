// Логика оболочки Mac: что принимаем от страницы, что открываем снаружи, куда сохраняем. `pnpm mac:test`.
import Foundation
import ShellCore
import XCTest

final class ShellMessageTests: XCTestCase {
  func testKnownMessages() {
    XCTAssertEqual(ShellMessage(body: ["type": "ready"]), .ready)
    XCTAssertEqual(ShellMessage(body: ["type": "back", "visible": true]), .back(visible: true))
    XCTAssertEqual(ShellMessage(body: ["type": "back", "visible": NSNumber(value: false)]), .back(visible: false))
    XCTAssertEqual(ShellMessage(body: ["type": "colors", "header": "#F6F4EE"]), .colors(header: Rgb(hex: "#F6F4EE")!))
    XCTAssertEqual(ShellMessage(body: ["type": "open", "url": "tg://resolve?domain=LifeCommit_bot"]), .open(URL(string: "tg://resolve?domain=LifeCommit_bot")!, fallback: nil))
    XCTAssertEqual(
      ShellMessage(body: ["type": "open", "url": "tg://resolve?domain=LifeCommit_bot", "fallback": "https://t.me/LifeCommit_bot"]),
      .open(URL(string: "tg://resolve?domain=LifeCommit_bot")!, fallback: URL(string: "https://t.me/LifeCommit_bot")!)
    )
    // запасной адрес — только веб
    XCTAssertEqual(
      ShellMessage(body: ["type": "open", "url": "tg://resolve?domain=x", "fallback": "file:///etc/passwd"]),
      .open(URL(string: "tg://resolve?domain=x")!, fallback: nil)
    )
    XCTAssertEqual(
      ShellMessage(body: ["type": "download", "url": "https://lifecommit.app/share/x.jpg", "name": "../../Library/evil.jpg"]),
      .download(URL(string: "https://lifecommit.app/share/x.jpg")!, name: "evil.jpg")
    )
  }

  func testRejectsMalformedAndUnknown() {
    let bad: [Any] = [
      "ready",
      ["type": 1],
      ["type": "close"],
      ["type": "back"],
      ["type": "back", "visible": "yes"],
      ["type": "colors", "header": "red"],
      ["type": "colors", "header": "#12345"],
      ["type": "open"],
      ["type": "open", "url": "file:///etc/passwd"],
      ["type": "open", "url": "x-apple.systempreferences:com.apple.preference.security"],
      ["type": "download", "url": "https://lifecommit.app/x.jpg"],
    ]
    for body in bad { XCTAssertNil(ShellMessage(body: body), "\(body)") }
  }

  func testRgb() {
    let c = Rgb(hex: "#237A46")!
    XCTAssertEqual(c.red, 0x23 / 255, accuracy: 0.0001)
    XCTAssertEqual(c.green, 0x7A / 255, accuracy: 0.0001)
    XCTAssertEqual(c.blue, 0x46 / 255, accuracy: 0.0001)
    XCTAssertNil(Rgb(hex: "237A46"))
    XCTAssertNil(Rgb(hex: "#GGGGGG"))
  }
}

final class LinksTests: XCTestCase {
  let app = URL(string: "https://lifecommit.app/app/?desktop=mac")!
  let dev = URL(string: "http://localhost:5181/app/?desktop=mac")!

  func testOutside() {
    for ok in ["https://t.me/x", "http://example.com", "tg://resolve?domain=x", "mailto:a@b.c"] {
      XCTAssertTrue(Links.canOpenOutside(URL(string: ok)!), ok)
    }
    for no in ["file:///Applications", "javascript:alert(1)", "smb://server/share", "x-apple.systempreferences:"] {
      XCTAssertFalse(Links.canOpenOutside(URL(string: no)!), no)
    }
  }

  func testIsApp() {
    XCTAssertTrue(Links.isApp(URL(string: "https://lifecommit.app/app/")!, app: app))
    XCTAssertTrue(Links.isApp(URL(string: "https://LifeCommit.app:443/share/a.jpg")!, app: app))
    XCTAssertTrue(Links.isApp(URL(string: "about:blank")!, app: app))
    XCTAssertTrue(Links.isApp(URL(string: "http://localhost:5181/api/today")!, app: dev))
    XCTAssertFalse(Links.isApp(URL(string: "http://lifecommit.app/app/")!, app: app))
    XCTAssertFalse(Links.isApp(URL(string: "https://lifecommit.app.evil.com/")!, app: app))
    XCTAssertFalse(Links.isApp(URL(string: "https://t.me/LifeCommit_bot")!, app: app))
    XCTAssertFalse(Links.isApp(URL(string: "http://localhost:5173/")!, app: dev))
  }

  func testSameOrigin() {
    XCTAssertTrue(Links.sameOrigin(scheme: "https", host: "lifecommit.app", port: 0, app: app))
    XCTAssertTrue(Links.sameOrigin(scheme: "https", host: "lifecommit.app", port: 443, app: app))
    XCTAssertTrue(Links.sameOrigin(scheme: "http", host: "localhost", port: 5181, app: dev))
    XCTAssertFalse(Links.sameOrigin(scheme: "https", host: "evil.com", port: 0, app: app))
    XCTAssertFalse(Links.sameOrigin(scheme: "http", host: "lifecommit.app", port: 0, app: app))
    XCTAssertFalse(Links.sameOrigin(scheme: "http", host: "localhost", port: 5173, app: dev))
  }
}

final class FilesTests: XCTestCase {
  func testSafeName() {
    XCTAssertEqual(Files.safeName("lifecommit.jpg"), "lifecommit.jpg")
    XCTAssertEqual(Files.safeName("/tmp/a/b.jpg"), "b.jpg")
    XCTAssertEqual(Files.safeName("..\\..\\c.jpg"), "c.jpg")
    XCTAssertEqual(Files.safeName(".hidden"), "hidden")
    XCTAssertEqual(Files.safeName(""), "lifecommit.jpg")
    XCTAssertEqual(Files.safeName("../"), "lifecommit.jpg")
    XCTAssertEqual(Files.safeName(String(repeating: "a", count: 300)).count, 100)
  }

  func testUnique() {
    let dir = URL(fileURLWithPath: "/Users/me/Downloads")
    var taken: Set<String> = []
    let exists = { (u: URL) in taken.contains(u.lastPathComponent) }
    XCTAssertEqual(Files.unique("lifecommit.jpg", in: dir, exists: exists).lastPathComponent, "lifecommit.jpg")
    taken = ["lifecommit.jpg", "lifecommit 2.jpg"]
    XCTAssertEqual(Files.unique("lifecommit.jpg", in: dir, exists: exists).lastPathComponent, "lifecommit 3.jpg")
    taken = ["notes"]
    XCTAssertEqual(Files.unique("notes", in: dir, exists: exists).lastPathComponent, "notes 2")
  }
}

final class AppConfigTests: XCTestCase {
  func testStartURL() {
    XCTAssertEqual(AppConfig.startURL(environment: [:], defaults: nil), AppConfig.production)
    XCTAssertEqual(AppConfig.startURL(environment: ["LIFECOMMIT_URL": "http://localhost:5181/app/?desktop=mac"], defaults: "https://x.test/"), URL(string: "http://localhost:5181/app/?desktop=mac"))
    XCTAssertEqual(AppConfig.startURL(environment: [:], defaults: "https://x.test/app/"), URL(string: "https://x.test/app/"))
    XCTAssertEqual(AppConfig.startURL(environment: ["LIFECOMMIT_URL": "file:///etc"], defaults: "ftp://x"), AppConfig.production)
  }

  func testStrings() {
    XCTAssertEqual(Strings(language: "ru-RU").back, "Назад")
    XCTAssertEqual(Strings(language: "en-US").back, "Back")
    XCTAssertEqual(Strings(language: nil).quit, "Quit LifeCommit")
  }
}
