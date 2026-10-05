// Приложение LifeCommit для Mac: окно с мини-аппом (тем же, что в Telegram), вход через Telegram.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
