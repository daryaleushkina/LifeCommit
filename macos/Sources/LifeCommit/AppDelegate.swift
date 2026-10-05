import AppKit
import ShellCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let strings = Strings(language: Locale.preferredLanguages.first)
  private var main: MainWindowController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let url = AppConfig.startURL(environment: ProcessInfo.processInfo.environment, defaults: UserDefaults.standard.string(forKey: "url"))
    let controller = MainWindowController(url: url, strings: strings)
    main = controller
    NSApp.mainMenu = makeMenu(strings: strings, target: controller)
    controller.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  // Закрыли окно — приложение живёт, как обычно на Mac; клик по значку в Dock открывает окно снова.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag { main?.showWindow(nil) }
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

/// Меню: без «Правки» в WKWebView не работают ⌘C / ⌘V / ⌘A.
@MainActor
func makeMenu(strings s: Strings, target: MainWindowController) -> NSMenu {
  let menu = NSMenu()
  func submenu(_ title: String, _ items: [NSMenuItem]) {
    let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let sub = NSMenu(title: title)
    items.forEach(sub.addItem)
    holder.submenu = sub
    menu.addItem(holder)
  }
  func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    i.target = target
    return i
  }

  submenu("LifeCommit", [
    item(s.about, #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
    .separator(),
    item(s.hide, #selector(NSApplication.hide(_:)), "h"),
    item(s.hideOthers, #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
    item(s.showAll, #selector(NSApplication.unhideAllApplications(_:)), ""),
    .separator(),
    item(s.quit, #selector(NSApplication.terminate(_:)), "q"),
  ])
  submenu(s.edit, [
    item(s.undo, Selector(("undo:")), "z"),
    item(s.redo, Selector(("redo:")), "z", [.command, .shift]),
    .separator(),
    item(s.cut, #selector(NSText.cut(_:)), "x"),
    item(s.copy, #selector(NSText.copy(_:)), "c"),
    item(s.paste, #selector(NSText.paste(_:)), "v"),
    item(s.selectAll, #selector(NSText.selectAll(_:)), "a"),
  ])
  submenu(s.view, [
    item(s.back, #selector(MainWindowController.goBack(_:)), "[", target: target),
    item(s.reload, #selector(MainWindowController.reload(_:)), "r", target: target),
    .separator(),
    item(s.fullScreen, #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
  ])
  let windowItems = [
    item(s.minimize, #selector(NSWindow.performMiniaturize(_:)), "m"),
    item(s.zoom, #selector(NSWindow.performZoom(_:)), ""),
    item(s.close, #selector(NSWindow.performClose(_:)), "w"),
    .separator(),
    item(s.bringAllToFront, #selector(NSApplication.arrangeInFront(_:)), ""),
  ]
  submenu(s.window, windowItems)
  NSApp.windowsMenu = menu.items.last?.submenu
  return menu
}
