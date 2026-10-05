// Карточка привычки на «Сегодня» — как TaskCard.tsx: плитка, название (тап — экран привычки), круглые кнопки отметки.
// «Делать» — галочка; «считать» — «3 из 8», карандаш (ввести число), галочка и полоса; «бросить» — крестик и галочка
// с вопросом «Получилось?», после ответа — «N дней без этого». Повторный тап по выбранной кнопке снимает отметку.
import LifeCommitKit
import SwiftUI

/// Круглая кнопка отметки 48×48: в своём цвете; выбранная заливается, вторая гаснет (.rb, .on, .dim).
struct RoundButton: View {
    enum Kind { case ok, no, edit }
    enum State { case normal, on, dim }

    let kind: Kind
    var state: State = .normal
    let label: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(background)
                .frame(width: 48, height: 48)
                .overlay {
                    StrokeGlyph(d: kind == .ok ? Glyph.check : kind == .no ? Glyph.cross : Glyph.pencil, lineWidth: kind == .edit ? 2 : 3)
                        .frame(width: kind == .edit ? 20 : 24, height: kind == .edit ? 20 : 24)
                        .foregroundStyle(foreground)
                }
                .opacity(state == .dim ? 0.6 : 1)
                .animation(.easeOut(duration: 0.2), value: state)
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(label)
        .accessibilityAddTraits(kind != .edit && state == .on ? .isSelected : [])
    }

    private var background: Color {
        if state == .dim || kind == .edit { return palette.heat[0] }
        switch kind {
        case .ok: return state == .on ? palette.accent : palette.accentSoft
        case .no: return state == .on ? palette.warn : palette.warnSoft
        case .edit: return palette.heat[0]
        }
    }

    private var foreground: Color {
        if state == .dim || kind == .edit { return palette.muted }
        switch kind {
        case .ok: return state == .on ? palette.accentText : palette.accent
        case .no: return state == .on ? palette.warnText : palette.warn
        case .edit: return palette.muted
        }
    }
}

struct TaskCard: View {
    let task: TodayTask
    let onLog: (_ value: Double?, _ status: AbstainStatus?) -> Void
    let onOpen: () -> Void
    /// Блок «сегодня» на экране привычки: без плитки, вместо названия — «Сегодня» / «Сегодня получилось?».
    var caption: String?
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var draft: String?
    @FocusState private var editing: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                if caption == nil { KindTile(kind: task.kind, title: task.title) }
                main
                buttons
            }
            if task.kind == .count { progress }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, task.kind == .count ? 14 : 12)
        .frame(minHeight: 72)
        .glassCard()
    }

    private var title: some View {
        Text(task.title)
            .font(.onest(16, .medium, relativeTo: .body))
            .foregroundStyle(task.isDone ? palette.muted : palette.text)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var main: some View {
        if let caption {
            VStack(alignment: .leading, spacing: 2) {
                Text(caption).font(.onest(17, .semibold)).frame(maxWidth: .infinity, alignment: .leading)
                if task.kind == .count { countValue }
            }
        } else {
            titled
        }
    }

    @ViewBuilder private var titled: some View {
        switch task.kind {
        case .check:
            Button(action: onOpen) { title }.buttonStyle(.plain)
        case .abstain:
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 2) {
                    title
                    Text(task.status == nil ? t.didItShort : t.cleanDays(task.cleanDays))
                        .font(.onest(14, relativeTo: .subheadline))
                        .foregroundStyle(palette.muted)
                }
            }
            .buttonStyle(.plain)
        case .count:
            VStack(alignment: .leading, spacing: 2) {
                Button(action: onOpen) { title }.buttonStyle(.plain)
                countValue
            }
        }
    }

    /// «3 из 8 стаканов»; тап — поле ввода, только цифры.
    @ViewBuilder private var countValue: some View {
        let rest = " \(t.of) \(t.num(task.target))\(task.unit.map { " \($0)" } ?? "")"
        if let current = draft {
            HStack(spacing: 6) {
                TextField(t.num(task.value), text: Binding(get: { current }, set: { draft = String($0.filter(\.isNumber).prefix(6)) }))
                    .textFieldStyle(.plain)
                    .font(.onest(16, .bold))
                    .frame(width: 72)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(palette.bg, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.accent, lineWidth: 1))
                    .focused($editing)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .onSubmit(commit)
                    .accessibilityLabel("\(task.title): \(t.enterValue)")
                Text(rest).font(.onest(14)).foregroundStyle(palette.muted)
            }
            .frame(minHeight: 28)
            .onChange(of: editing) { _, focused in if !focused { commit() } }
        } else {
            Button(action: startEditing) {
                Text("\(Text(t.num(task.value)).bold().foregroundStyle(palette.text))\(Text(rest).foregroundStyle(palette.muted))")
                    .font(.onest(14, relativeTo: .subheadline))
                    .frame(minHeight: 28, alignment: .leading)
                    .padding(.trailing, 12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(task.title): \(t.enterValue)")
            .accessibilityValue("\(t.num(task.value))\(rest)")
        }
    }

    @ViewBuilder private var buttons: some View {
        switch task.kind {
        case .check:
            doneButton
        case .count:
            HStack(spacing: 8) {
                RoundButton(kind: .edit, label: "\(task.title): \(t.enterValue)", action: startEditing)
                doneButton
            }
        case .abstain:
            HStack(spacing: 8) {
                RoundButton(kind: .no, state: state(.slip), label: t.answerNo) { pick(.slip) }
                RoundButton(kind: .ok, state: state(.clean), label: t.answerYes) { pick(.clean) }
            }
        }
    }

    /// Галочка «сделано целиком»: повторный тап снимает.
    private var doneButton: some View {
        let done = task.isDone
        return RoundButton(kind: .ok, state: done ? .on : .normal, label: "\(task.title) — \(t.markDone.lowercased(with: t.locale))") {
            onLog(done ? nil : (task.kind == .count ? task.target : 1), nil)
        }
    }

    private func state(_ s: AbstainStatus) -> RoundButton.State {
        task.status == s ? .on : task.status == nil ? .normal : .dim
    }

    private func pick(_ s: AbstainStatus) {
        onLog(nil, task.status == s ? nil : s)
    }

    private var progress: some View {
        GeometryReader { geo in
            let fraction = task.target > 0 ? min(1, task.value / task.target) : 0
            Capsule().fill(palette.heat[0])
                .overlay(alignment: .leading) {
                    Capsule().fill(palette.heat[3])
                        .frame(width: geo.size.width)
                        .offset(x: (fraction - 1) * geo.size.width)
                        .animation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.24), value: fraction)
                }
                .clipShape(Capsule())
        }
        .frame(height: 6)
        .padding(.trailing, 4)
        .accessibilityHidden(true)
    }

    private func startEditing() {
        draft = task.value > 0 ? String(Int(task.value)) : ""
        editing = true
    }

    private func commit() {
        guard let value = draft else { return }
        draft = nil
        guard let next = Double(value), next != task.value else { return }
        onLog(next > 0 ? next : nil, nil)
    }
}

/// Привычка не на сегодня — без кнопок, но открыть и поправить можно.
struct NotDueCard: View {
    let task: TodayTask
    let onOpen: () -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).font(.onest(16, .medium)).foregroundStyle(palette.muted)
                Text(task.schedule == .perWeek ? t.perWeek(task.perWeek ?? 0) : t.schedules[task.schedule] ?? "")
                    .font(.onest(14)).foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .glassCard()
        }
        .buttonStyle(.plain)
    }
}
