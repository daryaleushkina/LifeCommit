// Заставка: крупный знак 3×3 (клетки загораются по очереди) и название — как Splash в src/components/Logo.tsx.
import SwiftUI

struct Logo: View {
    var cell: CGFloat = 8
    var gap: CGFloat = 3
    var padding: CGFloat = 5
    var radius: CGFloat = 9
    var cellRadius: CGFloat = 2
    var animated = false
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    /// Самые тёмные клетки складываются в галочку.
    static let levels = [0, 1, 4, 1, 4, 2, 4, 2, 0]

    var body: some View {
        Grid(horizontalSpacing: gap, verticalSpacing: gap) {
            ForEach(0..<3, id: \.self) { row in
                GridRow {
                    ForEach(0..<3, id: \.self) { col in
                        let i = row * 3 + col
                        RoundedRectangle(cornerRadius: cellRadius, style: .continuous)
                            .fill(palette.heat[Self.levels[i]])
                            .frame(width: cell, height: cell)
                            .opacity(!animated || shown || reduceMotion ? 1 : 0)
                            .scaleEffect(!animated || shown || reduceMotion ? 1 : 0.6)
                            .animation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.32).delay(Double(i) * 0.06), value: shown)
                    }
                }
            }
        }
        .padding(padding)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        .onAppear { shown = true }
        .accessibilityHidden(true)
    }
}

struct SplashView: View {
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 20) {
            Logo(cell: 24, gap: 8, padding: 14, radius: 26, cellRadius: 7, animated: true)
            Text("Life\(Text("Commit").foregroundStyle(palette.accent))")
                .font(.onest(26, .bold))
                .tracking(-0.52)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("LifeCommit")
    }
}
