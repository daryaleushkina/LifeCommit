// swift-tools-version: 6.0
// Приложение LifeCommit для Mac (05.10.2026): нативное окно с тем же мини-аппом, что в Telegram (WKWebView), вход через
// Telegram. Сборка — `pnpm mac:build` (macos/build.sh), тесты — `pnpm mac:test`.
import PackageDescription

let package = Package(
  name: "LifeCommit",
  platforms: [.macOS(.v13)],
  targets: [
    // Логика без AppKit: разбор сообщений от страницы, какие адреса свои, куда сохранить файл. Покрыта тестами.
    .target(name: "ShellCore"),
    .executableTarget(name: "LifeCommit", dependencies: ["ShellCore"]),
    .testTarget(name: "ShellCoreTests", dependencies: ["ShellCore"]),
  ]
)
