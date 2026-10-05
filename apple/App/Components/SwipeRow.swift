// Строка, которую можно смахнуть влево (как SwipeRow.tsx и «Почта» iPhone): короткий свайп открывает кнопки,
// протянул до конца — срабатывает крайняя (обычно «Удалить»). Ловит только явно горизонтальное движение: прокрутка
// работает как обычно. На Mac свайпа пальцем нет — те же действия в меню по правому щелчку.
import SwiftUI

struct SwipeAction {
    enum Tone { case danger, muted }

    let label: String
    var tone: Tone = .danger
    var icon: String = Glyph.trash
    /// Для UI-тестов.
    var id = "swipe-delete"
    let run: () -> Void
}

/// Ход свайпа — отдельно от вида, чтобы его проверяли тесты: где строка сейчас и где ляжет, когда отпустили.
struct SwipeTrack: Equatable {
    /// Ширина одной кнопки под строкой.
    static let button: CGFloat = 84
    /// Дальше этой доли ширины — «до конца»: срабатывает крайнее действие.
    static let full: CGFloat = 0.55

    enum Rest: Equatable { case closed, opened, fired }

    /// Сколько кнопок под строкой.
    var count = 1
    private(set) var offset: CGFloat = 0
    /// Где строка лежала, когда её взяли (открытая — на ширине кнопок): ведём от этого места.
    private var base: CGFloat?

    init(count: Int = 1) { self.count = count }

    var open: CGFloat { CGFloat(count) * Self.button }
    var dragging: Bool { base != nil }

    /// Палец сдвинулся на dx от места касания. Не правее закрытой и не левее ширины строки.
    mutating func move(by dx: CGFloat, width: CGFloat) {
        if base == nil { base = offset }
        let next = (base ?? 0) + dx
        offset = min(0, width > 0 ? max(-width, next) : next)
    }

    /// Протянули дальше доли full — отпустят, и сработает крайнее действие.
    func isFull(width: CGFloat) -> Bool { width > 0 && -offset > width * Self.full }

    /// Отпустили: дальше доли full — срабатывает крайнее, дальше половины кнопок — открыта, иначе закрывается.
    mutating func end(width: CGFloat) -> Rest {
        defer { base = nil }
        if isFull(width: width) {
            offset = 0
            return .fired
        }
        if -offset > open / 2 {
            offset = -open
            return .opened
        }
        offset = 0
        return .closed
    }

    mutating func close() { offset = 0 }
}

struct SwipeRow<Content: View>: View {
    /// Кнопки слева направо; последняя — крайняя, она же срабатывает свайпом до конца. Пусто — строка не смахивается
    /// (например, дело ещё сохраняется).
    let actions: [SwipeAction]
    /// Карточка привычки — кнопка во всю высоту с радиусом карточки; строка списка — с отступом 4.
    var card = false
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette
    @State private var track: SwipeTrack
    @State private var width: CGFloat = 0

    init(actions: [SwipeAction], card: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.actions = actions
        self.card = card
        self.content = content
        _track = State(initialValue: SwipeTrack(count: max(1, actions.count)))
    }

    var body: some View {
        #if os(macOS)
        content()
            .contextMenu {
                ForEach(actions.indices, id: \.self) { i in
                    Button(actions[i].label, role: actions[i].tone == .danger ? .destructive : nil, action: actions[i].run)
                }
            }
        #else
        ZStack(alignment: .trailing) {
            if track.offset < 0 { buttons }
            content()
                .offset(x: track.offset)
                .gesture(drag, isEnabled: !actions.isEmpty)
        }
        .background { GeometryReader { geo in Color.clear.onAppear { width = geo.size.width }.onChange(of: geo.size.width) { _, w in width = w } } }
        // Обрезаем, только пока строку смахивают: иначе срезается тень карточки.
        .clipShape(Rectangle().inset(by: track.offset < 0 ? 0 : -40))
        .accessibilityActions {
            ForEach(actions.indices, id: \.self) { i in Button(actions[i].label, action: actions[i].run) }
        }
        #endif
    }

    #if os(iOS)
    /// Кнопки занимают ровно открытую часть строки; при длинном свайпе крайняя растягивается на всё.
    private var buttons: some View {
        let shown = -track.offset
        let full = track.isFull(width: width)
        return HStack(spacing: 0) {
            ForEach(actions.indices, id: \.self) { i in
                let last = i == actions.count - 1
                let w = full ? (last ? shown : 0) : shown / CGFloat(actions.count)
                if w >= 1 { pill(actions[i], width: w, last: last) }
            }
        }
        .frame(width: shown, alignment: .trailing)
    }

    private func pill(_ action: SwipeAction, width w: CGFloat, last: Bool) -> some View {
        Button {
            close()
            action.run()
        } label: {
            VStack(spacing: 3) {
                StrokeGlyph(d: action.icon, lineWidth: 2).frame(width: 20, height: 20)
                if w > 70 { Text(action.label).font(.onest(12, .semibold)) }
            }
            .foregroundStyle(action.tone == .danger ? palette.dangerText : palette.neutralPillText)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(action.tone == .danger ? palette.danger : palette.neutralPill, in: RoundedRectangle(cornerRadius: card ? 20 : 16, style: .continuous))
            .padding(card ? EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 0) : EdgeInsets(top: 4, leading: 6, bottom: 4, trailing: last ? 4 : 0))
        }
        .buttonStyle(PressScale())
        .frame(width: w)
        .accessibilityIdentifier(action.id)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .local)
            .onChanged { value in
                // Только явно горизонтальное движение; вертикальное отдаём прокрутке.
                guard track.dragging || abs(value.translation.width) > abs(value.translation.height) * 1.4 else { return }
                let wasFull = track.isFull(width: width)
                track.move(by: value.translation.width, width: width)
                // Перешли границу «до конца» — щелчок, как в мини-аппе.
                if track.isFull(width: width) != wasFull { Haptics.impact() }
            }
            .onEnded { _ in
                guard track.dragging else { return }
                var next = track
                switch next.end(width: width) {
                case .fired:
                    track = next
                    actions.last?.run()
                case .opened, .closed:
                    withAnimation(Self.curve) { track = next }
                }
            }
    }
    #endif

    private static var curve: Animation { .timingCurve(0.23, 1, 0.32, 1, duration: 0.24) }

    private func close() {
        withAnimation(Self.curve) { track.close() }
    }
}
