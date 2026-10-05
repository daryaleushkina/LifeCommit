// swift-tools-version: 6.2
// LifeCommitKit — всё, что у приложения для iPhone и Mac не про экран: модели API (как shared/types.ts), клиент
// сервера, вход через Telegram, ключ в Keychain, логика из shared/ и тексты ru/en. Тесты — `swift test` без симулятора.
import PackageDescription

let package = Package(
    name: "LifeCommitKit",
    defaultLocalization: "ru",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "LifeCommitKit", targets: ["LifeCommitKit"]),
    ],
    targets: [
        .target(name: "LifeCommitKit"),
        .testTarget(name: "LifeCommitKitTests", dependencies: ["LifeCommitKit"], resources: [.copy("Fixtures")]),
    ],
    swiftLanguageModes: [.v6]
)
