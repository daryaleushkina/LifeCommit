// Строка, которую можно смахнуть влево (как SwipeRow.tsx и «Почта» iPhone): короткий свайп открывает «Удалить»,
// протянул до конца — удаляется сразу. Ловит только явно горизонтальное движение: прокрутка работает как обычно.
// На Mac свайпа пальцем нет — то же действие в меню по правому щелчку.
import SwiftUI

struct SwipeAction {
    let label: String
    let run: () -> Void
}

struct SwipeRow<Content: View>: View {
    /// Пусто — строка не смахивается (например, дело ещё сохраняется).
    let action: SwipeAction?
    /// Карточка привычки — кнопка во всю высоту с радиусом карточки; строка списка — с отступом 4.
    var card = false
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette
    @State private var offset: CGFloat = 0
    @State private var dragging = false
    @State private var width: CGFloat = 0

    private let button: CGFloat = 84
    /// Дальше этой доли ширины — «до конца»: срабатывает действие.
    private let full: CGFloat = 0.55

    var body: some View {
        #if os(macOS)
        content()
            .contextMenu {
                if let action {
                    Button(action.label, role: .destructive, action: action.run)
                }
            }
        #else
        ZStack(alignment: .trailing) {
            if let action, offset < 0 {
                Button {
                    close()
                    action.run()
                } label: {
                    VStack(spacing: 3) {
                        StrokeGlyph(d: Glyph.trash, lineWidth: 2).frame(width: 20, height: 20)
                        Text(action.label).font(.onest(12, .semibold))
                    }
                    .foregroundStyle(palette.dangerText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(palette.danger, in: RoundedRectangle(cornerRadius: card ? 20 : 16, style: .continuous))
                    .padding(card ? EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 0) : EdgeInsets(top: 4, leading: 6, bottom: 4, trailing: 4))
                }
                .buttonStyle(PressScale())
                .frame(width: max(button, -offset))
                .accessibilityIdentifier("swipe-delete")
            }
            content()
                .offset(x: offset)
                .gesture(drag, isEnabled: action != nil)
        }
        .background { GeometryReader { geo in Color.clear.onAppear { width = geo.size.width }.onChange(of: geo.size.width) { _, w in width = w } } }
        // Обрезаем, только пока строку смахивают: иначе срезается тень карточки.
        .clipShape(Rectangle().inset(by: offset < 0 ? 0 : -40))
        .accessibilityActions {
            if let action { Button(action.label, action: action.run) }
        }
        #endif
    }

    #if os(iOS)
    private var drag: some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .local)
            .onChanged { value in
                // Только явно горизонтальное движение влево; вертикальное отдаём прокрутке.
                guard dragging || abs(value.translation.width) > abs(value.translation.height) * 1.4 else { return }
                dragging = true
                let base: CGFloat = offset <= -button && !dragging ? -button : 0
                offset = min(0, base + value.translation.width)
            }
            .onEnded { value in
                defer { dragging = false }
                guard dragging else { return }
                let distance = -value.translation.width
                if width > 0, distance > width * full, let action {
                    Haptics.impact()
                    withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.24)) { offset = -width }
                    action.run()
                    offset = 0
                } else if distance > button / 2 {
                    withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.24)) { offset = -button }
                } else {
                    close()
                }
            }
    }
    #endif

    private func close() {
        withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.24)) { offset = 0 }
    }
}
