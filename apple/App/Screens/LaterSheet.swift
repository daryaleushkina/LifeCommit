// «Потом» — дела на следующие дни, по дням (LaterSheet в TodoList.tsx). Открывают редко — грузится, когда открыли.
// Нажали дело — шторка дела; смахнули — «Удалить» с «Вернуть».
import LifeCommitKit
import SwiftUI

struct LaterSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var editing: Todo?

    var body: some View {
        let list = (model.later ?? []).filter { !model.isRemoved("todo:\($0.id)") }
        let days = list.reduce(into: [String]()) { if !$0.contains($1.day) { $0.append($1.day) } }
        SheetBody(title: t.todoSheet.laterTitle) {
            ForEach(days, id: \.self) { day in
                let title = Todos.when(day, today: model.today.day, strings: t) ?? t.dayMonth(day)
                Text(title.prefix(1).uppercased(with: t.locale) + title.dropFirst())
                    .font(.onest(14, .semibold))
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 4)
                    .padding(.top, 14)
                    .padding(.bottom, 6)
                VStack(spacing: 0) {
                    ForEach(Array(list.filter { $0.day == day }.enumerated()), id: \.element.id) { i, todo in
                        if i > 0 { Divider().overlay(palette.line) }
                        SwipeRow(actions: [SwipeAction(label: t.swipe.remove) { model.removeTodo(todo) }]) {
                            Button { editing = todo } label: {
                                HStack(spacing: 10) {
                                    if let time = todo.time { Text(time).font(.onest(14, .semibold)).foregroundStyle(palette.accent).frame(minWidth: 40, alignment: .leading) }
                                    Text(todo.title).font(.onest(16)).frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 52)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .task { await model.loadLater() }
        .sheet(item: $editing) { todo in
            TodoSheet(todo: todo, today: model.today.day, carried: false, onSave: { edit in Task { await model.updateTodo(todo, edit) } }, onDelete: { model.removeTodo(todo) })
        }
    }
}
