// Нижняя панель — как .tabbar мини-аппа: Сегодня · Календарь · микрофон · Вместе · Я, стекло, микрофон крупнее
// и чуть выступает над панелью.
import LifeCommitKit
import SwiftUI

struct TabBar: View {
    @Binding var tab: AppModel.Tab
    let onMic: () -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.glowEnabled) private var glowEnabled

    var body: some View {
        HStack(spacing: 0) {
            item(.today, t.today) { GridGlyph() }
            item(.calendar, t.calendar) { StrokeGlyph(d: Glyph.calendarTab) }
            Button(action: onMic) {
                Circle()
                    .fill(palette.accent)
                    .frame(width: 68, height: 68)
                    .overlay {
                        MicGlyph().foregroundStyle(palette.accentText).frame(width: 28, height: 28)
                    }
                    .background(Circle().fill(palette.bg).frame(width: 82, height: 82))
                    .shadow(color: palette.accent.opacity(0.28), radius: 11, y: 8)
            }
            .buttonStyle(PressScale())
            .frame(width: 80)
            .offset(y: -26)
            .accessibilityLabel(t.voiceMic)
            .accessibilityIdentifier("tab.mic")
            item(.groups, t.groups) { StrokeGlyph(d: Glyph.groupsTab) }
            item(.me, t.me) { StrokeGlyph(d: Glyph.meTab) }
        }
        .padding(.horizontal, 4)
        .padding(.top, 6)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background {
            Rectangle()
                .fill(glowEnabled ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(palette.bg))
                .overlay(Rectangle().fill(palette.glassTint))
                .overlay(Rectangle().fill(palette.glass))
                .overlay(alignment: .top) { Rectangle().fill(palette.glassEdge).frame(height: 1) }
                .shadow(color: palette.glassShadow, radius: palette.glassShadowRadius, y: -2)
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func item<Icon: View>(_ value: AppModel.Tab, _ title: String, @ViewBuilder icon: () -> Icon) -> some View {
        let active = tab == value
        return Button {
            tab = value
        } label: {
            VStack(spacing: 2) {
                icon()
                    .frame(width: 22, height: 22)
                    .frame(width: 48, height: 30)
                    .background(active ? palette.accentSoft : .clear, in: Capsule())
                Text(title).font(.onest(12, active ? .bold : .medium, relativeTo: .caption))
            }
            .foregroundStyle(active ? palette.accentLabel : palette.muted)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("tab.\(value == .groups ? "together" : "\(value)")")
    }
}

/// Микрофон мини-аппа: капсула и дуга со стойкой (MicIcon в VoiceSheet.tsx).
struct MicGlyph: View {
    var body: some View {
        ZStack {
            StrokeGlyph(d: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z")
            StrokeGlyph(d: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7")
        }
        .accessibilityHidden(true)
    }
}
