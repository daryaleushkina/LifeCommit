// Логика оболочки без AppKit — то, что можно проверить тестами (macos/Tests). Страница говорит с оболочкой
// сообщениями `window.webkit.messageHandlers.lifecommit.postMessage({ type, … })` (src/desktop/session.ts → ShellMessage).
import Foundation

/// Сообщение от страницы. Всё, что пришло снаружи, проверяется: неизвестное или испорченное — nil.
public enum ShellMessage: Equatable, Sendable {
  /// Приложение нарисовало первый экран.
  case ready
  /// Показать или спрятать «назад» в заголовке окна.
  case back(visible: Bool)
  /// Цвет шапки — им красится заголовок окна.
  case colors(header: Rgb)
  /// Открыть адрес снаружи: браузер, Telegram (tg://), почта.
  case open(URL)
  /// Сохранить файл со своего сервера в «Загрузки».
  case download(URL, name: String)

  public init?(body: Any) {
    guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return nil }
    switch type {
    case "ready":
      self = .ready
    case "back":
      guard let visible = dict["visible"] as? Bool else { return nil }
      self = .back(visible: visible)
    case "colors":
      guard let hex = dict["header"] as? String, let rgb = Rgb(hex: hex) else { return nil }
      self = .colors(header: rgb)
    case "open":
      guard let raw = dict["url"] as? String, let url = URL(string: raw), Links.canOpenOutside(url) else { return nil }
      self = .open(url)
    case "download":
      guard let raw = dict["url"] as? String, let url = URL(string: raw), let name = dict["name"] as? String else { return nil }
      self = .download(url, name: Files.safeName(name))
    default:
      return nil
    }
  }
}

/// Цвет #RRGGBB.
public struct Rgb: Equatable, Sendable {
  public let red: Double, green: Double, blue: Double

  public init?(hex: String) {
    guard hex.count == 7, hex.first == "#", let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    red = Double((value >> 16) & 0xFF) / 255
    green = Double((value >> 8) & 0xFF) / 255
    blue = Double(value & 0xFF) / 255
  }
}

public enum Links {
  /// Наружу открываем только веб, Telegram и почту — не file:// и не схемы чужих приложений.
  public static func canOpenOutside(_ url: URL) -> Bool {
    ["https", "http", "tg", "mailto"].contains(url.scheme?.lowercased() ?? "")
  }

  /// Адрес — само приложение (тот же сервер, что открыт в окне): тогда он грузится в окне, остальное — снаружи.
  public static func isApp(_ url: URL, app: URL) -> Bool {
    if ["about", "blob", "data"].contains(url.scheme?.lowercased() ?? "") { return true }
    return sameOrigin(scheme: url.scheme ?? "", host: url.host ?? "", port: url.port ?? 0, app: app)
  }

  /// Источник (схема, сервер, порт; 0 — порт по умолчанию) — тот же, что у приложения. Так проверяется,
  /// от кого пришло сообщение и кому дать микрофон.
  public static func sameOrigin(scheme: String, host: String, port: Int, app: URL) -> Bool {
    let defaultPort = ["https": 443, "http": 80]
    func norm(_ p: Int, _ s: String) -> Int { p == 0 ? defaultPort[s] ?? 0 : p }
    let s = scheme.lowercased(), appScheme = app.scheme?.lowercased() ?? ""
    return s == appScheme && host.lowercased() == app.host?.lowercased() && norm(port, s) == norm(app.port ?? 0, appScheme)
  }
}

public enum Files {
  /// Имя файла от страницы: только имя, без папок и скрытых файлов; пустое — «lifecommit.jpg».
  public static func safeName(_ raw: String) -> String {
    let base = raw.split(whereSeparator: { $0 == "/" || $0 == "\\" || $0 == ":" }).last.map(String.init) ?? ""
    let trimmed = String(base.drop(while: { $0 == "." }).prefix(100)).trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? "lifecommit.jpg" : trimmed
  }

  /// Свободное имя в папке, как у Finder: «lifecommit.jpg», «lifecommit 2.jpg», «lifecommit 3.jpg»…
  public static func unique(_ name: String, in dir: URL, exists: (URL) -> Bool) -> URL {
    let first = dir.appendingPathComponent(name)
    if !exists(first) { return first }
    let ext = (name as NSString).pathExtension
    let stem = (name as NSString).deletingPathExtension
    var n = 2
    while true {
      let candidate = dir.appendingPathComponent(ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)")
      if !exists(candidate) { return candidate }
      n += 1
    }
  }
}

public enum AppConfig {
  /// Боевой адрес мини-аппа; ?desktop=mac — открыт в приложении для Mac.
  public static let production = URL(string: "https://lifecommit.app/app/?desktop=mac")!

  /// Что открыть: LIFECOMMIT_URL из окружения, потом `defaults write app.lifecommit.mac url …` (для разработки),
  /// иначе прод. Не http(s) — прод.
  public static func startURL(environment: [String: String], defaults: String?) -> URL {
    for raw in [environment["LIFECOMMIT_URL"], defaults] {
      if let raw, let url = URL(string: raw), ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil { return url }
    }
    return production
  }
}

/// Подписи меню и окна — по языку системы: русский или английский.
public struct Strings: Sendable {
  public let back, reload, about, hide, hideOthers, showAll, quit, edit, undo, redo, cut, copy, paste, selectAll, view, fullScreen, window, minimize, zoom, close, bringAllToFront, saveFailed, offline, retry: String

  public init(language: String?) {
    if language?.hasPrefix("ru") ?? false {
      (back, reload, about, hide, hideOthers, showAll, quit) = ("Назад", "Обновить", "О LifeCommit", "Скрыть LifeCommit", "Скрыть остальные", "Показать все", "Завершить LifeCommit")
      (edit, undo, redo, cut, copy, paste, selectAll) = ("Правка", "Отменить", "Повторить", "Вырезать", "Скопировать", "Вставить", "Выбрать все")
      (view, fullScreen, window, minimize, zoom, close, bringAllToFront) = ("Вид", "Во весь экран", "Окно", "Свернуть", "Изменить масштаб", "Закрыть окно", "Все окна — на передний план")
      (saveFailed, offline, retry) = ("Не получилось сохранить картинку", "Нет связи с LifeCommit — проверьте интернет.", "Попробовать ещё раз")
    } else {
      (back, reload, about, hide, hideOthers, showAll, quit) = ("Back", "Reload", "About LifeCommit", "Hide LifeCommit", "Hide Others", "Show All", "Quit LifeCommit")
      (edit, undo, redo, cut, copy, paste, selectAll) = ("Edit", "Undo", "Redo", "Cut", "Copy", "Paste", "Select All")
      (view, fullScreen, window, minimize, zoom, close, bringAllToFront) = ("View", "Enter Full Screen", "Window", "Minimize", "Zoom", "Close Window", "Bring All to Front")
      (saveFailed, offline, retry) = ("Couldn’t save the picture", "Can’t reach LifeCommit — check your connection.", "Try Again")
    }
  }
}
