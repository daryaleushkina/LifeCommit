import AppKit
import ShellCore
import WebKit

private extension NSToolbarItem.Identifier {
  static let back = NSToolbarItem.Identifier("back")
}

/// Окно приложения: мини-апп в WKWebView. Страница сама играет роль Telegram (src/desktop/host.ts), а сюда
/// присылает то, что лучше сделать по-настоящему: «назад» в заголовке окна, цвет окна, ссылки наружу, «Загрузки».
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, WKNavigationDelegate, WKUIDelegate {
  private let appURL: URL
  private let strings: Strings
  private let webView: WKWebView
  private var backVisible = false
  /** Когда падал процесс страницы — чтобы не перезагружать по кругу. */
  private var crashes: [Date] = []
  private weak var backItem: NSToolbarItem?

  init(url: URL, strings: Strings) {
    appURL = url
    self.strings = strings

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default() // ключ входа и настройки остаются между запусками
    config.applicationNameForUserAgent = "LifeCommitMac/1.0"
    config.mediaTypesRequiringUserActionForPlayback = []
    webView = WKWebView(frame: .zero, configuration: config)
    webView.allowsBackForwardNavigationGestures = false
    webView.allowsMagnification = false
    // Отладка через Safari → «Разработка» — только у стенда разработки, не у боевого адреса.
    if #available(macOS 13.3, *) { webView.isInspectable = url != AppConfig.production }

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "LifeCommit"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.toolbarStyle = .unifiedCompact
    // Мини-апп нарисован под телефон: окно шириной с телефон, тянется в высоту.
    window.contentMinSize = NSSize(width: 360, height: 560)
    window.contentMaxSize = NSSize(width: 640, height: CGFloat.greatestFiniteMagnitude)
    window.backgroundColor = Self.paper
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("LifeCommitMain")
    window.isReleasedWhenClosed = false
    super.init(window: window)

    window.delegate = self
    let toolbar = NSToolbar(identifier: "main")
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
    window.toolbar = toolbar

    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Сообщения от страницы — через посредника: WKUserContentController держит обработчик сильной ссылкой.
    config.userContentController.add(MessageRelay(owner: self), name: "lifecommit")
    webView.load(URLRequest(url: url))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

  /// Фон окна до того, как страница сказала свой цвет: «тёплая бумага» или тёмный фон приложения (DESIGN.md).
  private static let paper = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      ? NSColor(srgbRed: 0x0F / 255, green: 0x15 / 255, blue: 0x11 / 255, alpha: 1)
      : NSColor(srgbRed: 0xF6 / 255, green: 0xF4 / 255, blue: 0xEE / 255, alpha: 1)
  }

  // MARK: Сообщения от страницы

  fileprivate func receive(_ message: WKScriptMessage) {
    // Слушаем только своё приложение: чужая страница (если бы сюда попала) ничего не может попросить.
    let origin = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame,
      Links.sameOrigin(scheme: origin.protocol, host: origin.host, port: origin.port, app: appURL),
      let parsed = ShellMessage(body: message.body)
    else { return }
    switch parsed {
    case .ready:
      break
    case .back(let visible):
      backVisible = visible
      updateBack()
    case .colors(let rgb):
      window?.backgroundColor = NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    case .open(let url, let fallback):
      // tg:// без Telegram на Маке открыть нечем — тогда та же ссылка t.me в браузере (там предложат Telegram Web).
      if NSWorkspace.shared.open(url) { return }
      NSLog("LifeCommit: nothing opens \(url.scheme ?? "")")
      if let fallback { NSWorkspace.shared.open(fallback) }
    case .download(let url, let name):
      guard Links.isApp(url, app: appURL) else {
        NSLog("LifeCommit: download refused, not our address: \(url.host ?? "")")
        failed(strings.saveFailed, detail: nil)
        return
      }
      Task { await save(url, name: name) }
    }
  }

  private func updateBack() {
    guard let item = backItem else { return }
    if #available(macOS 15, *) { item.isHidden = !backVisible }
    item.isEnabled = backVisible
  }

  @objc func goBack(_ sender: Any?) {
    guard backVisible else { return }
    webView.evaluateJavaScript("window.lifecommitHost && window.lifecommitHost.back()")
  }

  @objc func reload(_ sender: Any?) {
    webView.load(URLRequest(url: appURL))
  }

  /// Картинка «Сохранить» — в «Загрузки», и Finder показывает её.
  private func save(_ url: URL, name: String) async {
    do {
      let (temp, response) = try await URLSession.shared.download(from: url)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
      let downloads = try FileManager.default.url(for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let target = Files.unique(name, in: downloads) { FileManager.default.fileExists(atPath: $0.path) }
      try FileManager.default.moveItem(at: temp, to: target)
      NSWorkspace.shared.activateFileViewerSelecting([target])
    } catch {
      NSLog("LifeCommit: download failed: \(error)")
      failed(strings.saveFailed, detail: error.localizedDescription)
    }
  }

  /// Сказать, что не вышло, окном поверх приложения.
  private func failed(_ message: String, detail: String?) {
    guard let window, window.attachedSheet == nil else { return }
    let alert = NSAlert()
    alert.messageText = message
    if let detail { alert.informativeText = detail }
    alert.beginSheetModal(for: window) { _ in }
  }

  // MARK: Ссылки и разрешения

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = action.request.url else { return .cancel }
    if Links.isApp(url, app: appURL) { return .allow }
    // Всё чужое — в браузере (или в Telegram для tg://), а не в окне приложения.
    if Links.canOpenOutside(url) { NSWorkspace.shared.open(url) }
    return .cancel
  }

  // window.open(…) — тоже наружу.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, Links.canOpenOutside(url) { NSWorkspace.shared.open(url) }
    return nil
  }

  // Микрофон (голос) — только своей странице; системный запрос macOS покажет сам.
  func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
    Links.sameOrigin(scheme: origin.protocol, host: origin.host, port: origin.port, app: appURL) && type == .microphone ? .grant : .deny
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    offline(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    offline(error)
  }

  // Процесс страницы упал (например, не хватило памяти) — не оставлять белое окно, а загрузить заново. Падает на каждой
  // загрузке — не мигать бесконечно: после двух падений за минуту сказать и предложить «Попробовать ещё раз».
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let now = Date()
    crashes = crashes.filter { now.timeIntervalSince($0) < 60 } + [now]
    NSLog("LifeCommit: web content process terminated (\(crashes.count) in 60 s)")
    if crashes.count <= 2 { reload(nil) } else { offline(URLError(.cannotLoadFromNetwork)) }
  }

  /// Не загрузилось (нет интернета) — сказать и предложить ещё раз, а не оставлять пустое окно.
  private func offline(_ error: Error) {
    if (error as NSError).code == NSURLErrorCancelled { return }
    guard let window, window.attachedSheet == nil else { return }
    let alert = NSAlert()
    alert.messageText = strings.offline
    alert.informativeText = error.localizedDescription
    alert.addButton(withTitle: strings.retry)
    alert.beginSheetModal(for: window) { [weak self] _ in self?.reload(nil) }
  }

  // MARK: Заголовок окна: «назад»

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.back] }
  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.back] }

  func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
    guard id == .back else { return nil }
    let item = NSToolbarItem(itemIdentifier: id)
    item.label = strings.back
    item.toolTip = strings.back
    item.image = NSImage(systemSymbolName: "chevron.backward", accessibilityDescription: strings.back)
    item.isBordered = true
    item.isNavigational = true
    item.autovalidates = false
    item.target = self
    item.action = #selector(goBack(_:))
    backItem = item
    updateBack()
    return item
  }
}

/// Посредник для WKScriptMessageHandler: держит окно слабой ссылкой, чтобы окно и страница не держали друг друга.
@MainActor
private final class MessageRelay: NSObject, WKScriptMessageHandler {
  weak var owner: MainWindowController?
  init(owner: MainWindowController) { self.owner = owner }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    owner?.receive(message)
  }
}
