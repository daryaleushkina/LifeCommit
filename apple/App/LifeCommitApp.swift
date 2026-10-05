// LifeCommit для iPhone и Mac — одно приложение на SwiftUI (docs/mobile.md). Вид — копия мини-аппа, поведение — родное.
import LifeCommitKit
import SwiftUI

@main
struct LifeCommitApp: App {
    @State private var model = AppModel(api: APIClient(base: Config.apiBase), tokens: KeychainTokenStore())

    init() {
        Typography.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        #if os(macOS)
        // Окно шириной с телефон, как у мини-аппа (широкой раскладки пока нет).
        .defaultSize(width: 420, height: 860)
        .windowResizability(.contentMinSize)
        #endif
    }
}
