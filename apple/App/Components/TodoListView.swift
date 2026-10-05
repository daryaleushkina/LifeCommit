// Список дел — как TodoList.tsx: свои дела с кружком-галочкой (сделанное зачёркивается и опускается), события из
// календаря — синей полоской без галочки, строка «+ Дело…» превращается в поле (Enter добавляет и оставляет поле
// открытым), «Все · Осталось» в шапке (только на «Сегодня»), «Потом · N». Нажали дело — шторка дела (TodoSheet).
// Один и тот же список — на «Сегодня» и во вкладке «Календарь» (выбранный день).
import LifeCommitKit
import SwiftUI

struct TodoListView: View {
    let todos: [Todo]
    /// Сколько дел на потом; 0 — строки «Потом» нет (во вкладке «Календарь»).
    var later = 0
    /// Заголовок блока; во вкладке «Календарь» в режиме «Месяц» — выбранный день.
    var heading: String?
    /// Подпись строки добавления.
    var addLabel: String?
    /// Подписи «со вчера» — только на «Сегодня»: в календаре дело и так стоит в свой день.
    var showCarry = true
    /// В прошедший день календаря добавлять нельзя.
    var canAdd = true
    /// Переключатель «Все · Осталось» — только на «Сегодня».
    var filterable = false
    let onAdd: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    /// «Только несделанные» — запоминается на устройстве (как localStorage lc-todos-left).
    @AppStorage("lc-todos-left") private var onlyLeft = false
    @State private var adding = false
    @State private var draft = ""
    @State private var editing: Todo?
    @State private var laterOpen = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        let listed = todos.filter { !model.isRemoved("todo:\($0.id)") }
        let canFilter = filterable && listed.contains { $0.source == nil || $0.time != nil }
        let now = Date()
        let shown = canFilter && onlyLeft ? listed.filter { !$0.done && !Todos.eventOver($0, now: now) } : listed

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                SectionLabel(text: heading ?? blockTitle(listed))
                Spacer(minLength: 0)
                if canFilter { filter }
            }
            .frame(minHeight: 36)
            .padding(.horizontal, 4)
            .padding(.top, 16)
            .padding(.bottom, 6)

            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.listKey) { index, todo in
                    if index > 0 { Divider().overlay(palette.line) }
                    SwipeRow(actions: todo.id < 0 ? [] : swipeActions(todo)) {
                        row(todo)
                    }
                }
                if !canAdd && shown.isEmpty {
                    Text(t.cal.empty).font(.onest(14)).foregroundStyle(palette.muted).frame(maxWidth: .infinity, minHeight: 52)
                }
                if canAdd {
                    if !shown.isEmpty { Divider().overlay(palette.line) }
                    addRow
                }
            }
            .glassCard()

            if later > 0 {
                Button(t.todo.later(later)) { laterOpen = true }
                    .font(.onest(15, .medium))
                    .foregroundStyle(palette.muted)
                    .frame(minHeight: 48)
                    .padding(.horizontal, 8)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("laterLink")
            }
        }
        .sheet(item: $editing) { todo in
            TodoSheet(todo: todo, today: model.today.day, carried: showCarry, onSave: { edit in Task { await model.updateTodo(todo, edit) } }, onDelete: { model.removeTodo(todo) })
        }
        .sheet(isPresented: $laterOpen) { LaterSheet() }
    }

    /// «Удалить»; у события календаря крайняя — «Скрыть» (Todos.swipe).
    private func swipeActions(_ todo: Todo) -> [SwipeAction] {
        Todos.swipe(todo).map { action in
            switch action {
            case .remove: SwipeAction(label: t.swipe.remove) { model.removeTodo(todo) }
            case .hide: SwipeAction(label: t.swipe.hide, tone: .muted, icon: Glyph.hide, id: "swipe-hide") { model.hideTodo(todo) }
            }
        }
    }

    private func blockTitle(_ listed: [Todo]) -> String {
        if !listed.isEmpty && listed.allSatisfy({ $0.source != nil }) { return t.todo.blockEvents }
        if listed.contains(where: { $0.source != nil }) { return t.todo.blockMixed }
        return t.todo.block
    }

    private var filter: some View {
        HStack(spacing: 0) {
            ForEach([false, true], id: \.self) { left in
                Button {
                    onlyLeft = left
                } label: {
                    Text(left ? t.todo.showLeft : t.todo.showAll)
                        .font(.onest(13, .semibold))
                        .foregroundStyle(onlyLeft == left ? palette.text : palette.muted)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 30)
                        .background(onlyLeft == left ? palette.surface : .clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .shadow(color: onlyLeft == left && !palette.isDark ? Color.black.opacity(0.06) : .clear, radius: 1, y: 1)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(onlyLeft == left ? .isSelected : [])
            }
        }
        .padding(3)
        .background(palette.heat[0], in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t.todo.showWhich)
        .animation(.easeOut(duration: 0.2), value: onlyLeft)
    }

    private func row(_ todo: Todo) -> some View {
        let when = !showCarry || todo.recurring ? nil : Todos.when(todo.day, today: model.today.day, strings: t)
        let end = todo.time.flatMap { time in todo.durationMin.flatMap { Todos.endTime(time, minutes: $0) } }
        let note = [when, end.map(t.todo.until)].compactMap { $0 }.joined(separator: " · ")

        return HStack(spacing: 0) {
            if todo.source != nil {
                RoundedRectangle(cornerRadius: 2).fill(palette.outside).frame(width: 4, height: 22).frame(width: 48, height: 48)
            } else {
                Button {
                    Task { await model.toggle(todo) }
                } label: {
                    ZStack {
                        Circle().strokeBorder(palette.muted, lineWidth: todo.done ? 0 : 2)
                            .background(Circle().fill(todo.done ? palette.accent : .clear))
                            .frame(width: 24, height: 24)
                        StrokeGlyph(d: Glyph.check, lineWidth: 3)
                            .frame(width: 16, height: 16)
                            .foregroundStyle(todo.done ? palette.accentText : .clear)
                    }
                    .frame(width: 48, height: 48)
                    .contentShape(Rectangle())
                    .animation(.easeOut(duration: 0.2), value: todo.done)
                }
                .buttonStyle(PressScale())
                .disabled(todo.id < 0)
                .accessibilityLabel(todo.done ? t.todo.uncheck(todo.title) : t.todo.check(todo.title))
                .accessibilityAddTraits(todo.done ? .isSelected : [])
            }
            Button { if todo.id > 0 { editing = todo } } label: { rowText(todo, note: note) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("todo-\(todo.title)")
        }
        .padding(.leading, 8)
        .contentShape(Rectangle())
    }

    private func rowText(_ todo: Todo, note: String) -> some View {
            HStack(spacing: 10) {
                if let time = todo.time {
                    Text(time).font(.onest(14, .semibold)).foregroundStyle(todo.done ? palette.muted : palette.accent).frame(minWidth: 40, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(todo.title)
                        .font(.onest(16))
                        .foregroundStyle(todo.done ? palette.muted : palette.text)
                        .strikethrough(todo.done, color: palette.muted.opacity(0.6))
                    if !note.isEmpty && !todo.done {
                        Text(note).font(.onest(13)).foregroundStyle(palette.muted)
                    }
                }
                Spacer(minLength: 0)
                if let source = todo.source {
                    Text(source == .apple ? "A" : "G")
                        .font(.onest(11, .bold))
                        .foregroundStyle(source == .apple ? palette.text : palette.outside)
                        .frame(width: 20, height: 20)
                        .background(source == .apple ? palette.heat[0] : palette.outside.opacity(0.16), in: RoundedRectangle(cornerRadius: 6))
                        .accessibilityLabel(source == .apple ? "Apple" : "Google")
                }
            }
            .padding(.vertical, 8)
            .padding(.leading, 4)
            .padding(.trailing, 14)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
    }

    @ViewBuilder private var addRow: some View {
        if adding {
            TextField(t.todo.addPh, text: $draft)
                .textFieldStyle(.plain)
                .font(.onest(16))
                .focused($fieldFocused)
                .submitLabel(.done)
                .onSubmit {
                    // Поле остаётся открытым: следующее дело можно вписать сразу.
                    submit()
                    fieldFocused = true
                }
                .onChange(of: fieldFocused) { _, focused in
                    if !focused {
                        submit()
                        adding = false
                    }
                }
                .frame(minHeight: 52)
                .padding(.horizontal, 20)
                .accessibilityLabel(addLabel ?? t.todo.add)
                .accessibilityIdentifier("todoField")
        } else {
            Button {
                adding = true
                fieldFocused = true
            } label: {
                HStack(spacing: 10) {
                    StrokeGlyph(d: Glyph.plus, lineWidth: 2.2).frame(width: 18, height: 18)
                    Text(addLabel ?? t.todo.add).font(.onest(15, .medium))
                }
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .padding(.horizontal, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func submit() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !title.isEmpty else { return }
        onAdd(String(title.prefix(120)))
    }
}

extension Todo {
    /// Ключ строки: у повторяющегося один id на все дни.
    var listKey: String { "\(id):\(day)" }
}

/// Подпись раздела: 13, полужирная, прописными, разрядка 0.04em (.section-label).
struct SectionLabel: View {
    let text: String
    @Environment(\.palette) private var palette
    @Environment(\.strings) private var t

    var body: some View {
        Text(text.uppercased(with: t.locale))
            .font(.onest(13, .semibold, relativeTo: .footnote))
            .tracking(0.52)
            .foregroundStyle(palette.muted)
            .accessibilityAddTraits(.isHeader)
    }
}
