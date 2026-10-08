import Foundation
import Testing

/// Дождаться состояния после фонового действия, проверяя условие, без паузы вслепую.
@MainActor
func until(_ what: Comment, _ check: () -> Bool) async {
    for _ in 0..<2000 {
        if check() { return }
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
    Issue.record(what)
}
