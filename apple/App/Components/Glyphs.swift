// Значки интерфейса — те же пути SVG, что в мини-аппе (viewBox 24×24, линии цветом текста).
import LifeCommitKit
import SwiftUI

enum Glyph {
    /// Галочка отметки (RoundBtn ok, Check дела).
    static let check = "M5 12.5l4.5 4.5L19 7.5"
    /// Крестик «было» у «бросить».
    static let cross = "M7 7l10 10M17 7L7 17"
    /// Карандаш «ввести число».
    static let pencil = "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3"
    static let plus = "M12 5v14M5 12h14"
    static let chevron = "M9 6l6 6-6 6"
    /// Перечёркнутый глаз — «Скрыть» (SwipeRow.tsx).
    static let hide = "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4.2-1M9.9 10a3 3 0 0 0 4.1 4.1"
    static let trash = "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
    static let undo = "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"
    static let calendarTab = "M3.5 8.5a3.5 3.5 0 0 1 3.5-3.5h10a3.5 3.5 0 0 1 3.5 3.5v8.5a3.5 3.5 0 0 1-3.5 3.5h-10a3.5 3.5 0 0 1-3.5-3.5zM3.5 10h17M8 3v4M16 3v4"
    static let groupsTab = "M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0zM2.5 19.5c.6-3 3.2-4.8 6.5-4.8s5.9 1.8 6.5 4.8M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.3.5 3.8 2.1 4.2 4.6"
    static let meTab = "M16 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0zM4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"
}

/// Путь SVG 24×24 линией: толщина и концы как в мини-аппе (stroke-linecap/linejoin round).
struct StrokeGlyph: View {
    let d: String
    var lineWidth: CGFloat = 2
    var viewBox: CGFloat = 24

    var body: some View {
        Canvas { context, size in
            guard let cg = try? SVGPath.cgPath(d) else { return }
            context.scaleBy(x: size.width / viewBox, y: size.height / viewBox)
            context.stroke(Path(cg), with: .foreground, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
        .accessibilityHidden(true)
    }
}

/// Значок «Сегодня» — сетка 3×3 залитых квадратиков (как TABS[0] в App.tsx).
struct GridGlyph: View {
    var body: some View {
        Canvas { context, size in
            let s = size.width / 24
            for y in [3.0, 10, 17] {
                for x in [3.0, 10, 17] {
                    context.fill(Path(roundedRect: CGRect(x: x * s, y: y * s, width: 5 * s, height: 5 * s), cornerRadius: 1.4 * s), with: .foreground)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
