// Плитка вида привычки с рисунком (src/components/KindIcon.tsx): цвет — по виду, рисунок — по названию
// (HabitIcon), не узнали — рисунок вида. Сами рисунки — KindIcons.generated.swift (apple/scripts/icons.mjs).
import LifeCommitKit
import SwiftUI

enum IconInk { case ink, mid }

struct IconRotation {
    let degrees: CGFloat
    let cx: CGFloat
    let cy: CGFloat
}

enum IconShape {
    case rect(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, radius: CGFloat)
    case circle(cx: CGFloat, cy: CGFloat, r: CGFloat)
    case path(String)

    var cgPath: CGPath {
        switch self {
        case let .rect(x, y, w, h, r):
            CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil)
        case let .circle(cx, cy, r):
            CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r), transform: nil)
        case let .path(d):
            // Строки рисунков — из мини-аппа и проверены тестом (KindIconsTests): ошибка разбора здесь — ошибка генератора.
            (try? SVGPath.cgPath(d)) ?? CGMutablePath()
        }
    }
}

struct IconPart {
    let shape: IconShape
    let fill: IconInk?
    let stroke: IconInk?
    let lineWidth: CGFloat
    let rotate: IconRotation?

    init(_ shape: IconShape, fill: IconInk?, stroke: IconInk?, lineWidth: CGFloat, rotate: IconRotation?) {
        self.shape = shape
        self.fill = fill
        self.stroke = stroke
        self.lineWidth = lineWidth
        self.rotate = rotate
    }
}

enum KindIcons {
    static func parts(kind: TaskKind, title: String?) -> [IconPart] {
        if let title, let icon = HabitIcon.of(title), let parts = habit[icon] { return parts }
        return Self.kind[kind] ?? []
    }
}

/// Рисунок 48×48 в любом размере: заливка средним цветом плитки, линии — тёмным, концы круглые.
struct KindGlyph: View {
    let parts: [IconPart]
    let ink: Color
    let mid: Color

    var body: some View {
        Canvas { context, size in
            let scale = size.width / 48
            context.scaleBy(x: scale, y: scale)
            for part in parts {
                var path = Path(part.shape.cgPath)
                if let r = part.rotate {
                    let t = CGAffineTransform(translationX: r.cx, y: r.cy).rotated(by: r.degrees * .pi / 180).translatedBy(x: -r.cx, y: -r.cy)
                    path = path.applying(t)
                }
                if let fill = part.fill { context.fill(path, with: .color(fill == .ink ? ink : mid)) }
                if let stroke = part.stroke {
                    context.stroke(path, with: .color(stroke == .ink ? ink : mid), style: StrokeStyle(lineWidth: part.lineWidth, lineCap: .round, lineJoin: .round))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Плитка: 44 (по умолчанию), 56 (крупная), 36 (мелкая) — как .kind-tile, .lg, .sm.
struct KindTile: View {
    enum Size {
        case sm, md, lg
        var side: CGFloat { switch self { case .sm: 36; case .md: 44; case .lg: 56 } }
        var radius: CGFloat { switch self { case .sm: 12; case .md: 14; case .lg: 18 } }
        var icon: CGFloat { switch self { case .sm: 22; case .md: 26; case .lg: 30 } }
    }

    let kind: TaskKind
    var title: String?
    var size: Size = .md
    @Environment(\.palette) private var palette

    var body: some View {
        let colors = palette.kind(kind)
        RoundedRectangle(cornerRadius: size.radius, style: .continuous)
            .fill(colors.bg)
            .frame(width: size.side, height: size.side)
            .overlay {
                KindGlyph(parts: KindIcons.parts(kind: kind, title: title), ink: colors.ink, mid: colors.mid)
                    .frame(width: size.icon, height: size.icon)
            }
            .accessibilityHidden(true)
    }
}
