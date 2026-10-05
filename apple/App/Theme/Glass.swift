// Матовое стекло мини-аппа (--glass, --glass-edge, --glass-blur) и мягкие цветные пятна фона (--glow).
import SwiftUI

/// Фон всех экранов: цвет --bg и четыре размытых пятна (radial-gradient из app.css). Пятна стоят на месте, экран
/// листается поверх — как body в мини-аппе.
struct GlowBackground: View {
    @Environment(\.palette) private var palette
    @Environment(\.glowEnabled) private var glowEnabled

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(palette.bg))
            for glow in glowEnabled ? palette.glow : [] {
                // radial-gradient(RX% RY% at X% Y%, цвет, transparent 70%): эллипс — круг, растянутый по высоте.
                let rx = glow.rx * size.width, ry = glow.ry * size.height
                let center = CGPoint(x: glow.center.x * size.width, y: glow.center.y * size.height)
                var layer = context
                layer.translateBy(x: center.x, y: center.y)
                layer.scaleBy(x: 1, y: ry / rx)
                let rect = CGRect(x: -rx, y: -rx, width: 2 * rx, height: 2 * rx)
                layer.fill(
                    Path(ellipseIn: rect),
                    with: .radialGradient(Gradient(stops: [.init(color: glow.color, location: 0), .init(color: glow.color.opacity(0), location: 0.7)]), center: .zero, startRadius: 0, endRadius: rx)
                )
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// Карточка из стекла: полупрозрачная заливка поверх размытого фона, светлая кромка и мягкая тень.
struct GlassCard: ViewModifier {
    @Environment(\.palette) private var palette
    @Environment(\.glowEnabled) private var glowEnabled
    var radius: CGFloat = 20

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                // Без пятен под стеклом размывать нечего: ровная заливка того же цвета (так и в снимках экранов).
                shape.fill(glowEnabled ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(palette.bg))
                    .overlay(shape.fill(palette.glassTint))
                    .overlay(shape.fill(palette.glass))
                    .overlay(shape.strokeBorder(palette.glassEdge, lineWidth: 1))
                    .overlay(alignment: .top) {
                        // Тёмная тема: светлый блик сверху (inset 0 1px 0 rgba(255,255,255,.2)).
                        if palette.isDark { shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.2), .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.08)), lineWidth: 1) }
                    }
                    .shadow(color: palette.glassShadow, radius: palette.glassShadowRadius, y: palette.glassShadowY)
            }
    }
}

extension View {
    func glassCard(radius: CGFloat = 20) -> some View { modifier(GlassCard(radius: radius)) }
}

private struct GlowEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// Пятна фона. Снимки экранов выключают их везде, кроме «Сегодня»: плавные градиенты почти не сжимаются в PNG.
    var glowEnabled: Bool {
        get { self[GlowEnabledKey.self] }
        set { self[GlowEnabledKey.self] = newValue }
    }
}
