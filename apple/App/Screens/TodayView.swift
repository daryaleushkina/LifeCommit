// «Сегодня» — как Today.tsx: дата, дела на день (над привычками), привычки (несделанные сверху), не на сегодня —
// отдельно, «Добавить привычку», «Отложенные · N». Привычку и дело можно смахнуть: 5 секунд «Вернуть».
import LifeCommitKit
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        let data = model.today
        let due = data.dueOrdered.filter { !model.isRemoved("task:\($0.id)") }
        let notDue = data.notDue.filter { !model.isRemoved("task:\($0.id)") }

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                PageHead(title: t.today, subtitle: data.day.isEmpty ? nil : t.longDate(data.day))

                if let banner = model.banner {
                    ErrorNote(text: banner)
                        .padding(.top, 12)
                        .onTapGesture { model.banner = nil }
                        .accessibilityIdentifier("banner")
                }

                TodoListView()

                SectionLabel(text: t.habits)
                    .padding(.horizontal, 4)
                    .padding(.top, 24)
                    .padding(.bottom, 8)

                if due.isEmpty {
                    Text(t.nothingDue)
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else {
                    VStack(spacing: 10) {
                        ForEach(due) { task in
                            SwipeRow(action: SwipeAction(label: t.swipe.remove) { model.removeTask(task) }, card: true) {
                                TaskCard(task: task, onLog: { value, status in
                                    Task { await model.log(task, value: value, status: status) }
                                }, onOpen: { model.path.append(.detail(task.id)) })
                            }
                            // Карточка — один контейнер: подпись у неё, а не у каждой кнопки внутри.
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("task-\(task.title)")
                        }
                    }
                }

                if !notDue.isEmpty {
                    VStack(spacing: 10) {
                        ForEach(notDue) { task in
                            SwipeRow(action: SwipeAction(label: t.swipe.remove) { model.removeTask(task) }, card: true) {
                                NotDueCard(task: task) { model.path.append(.editTask(task.id)) }
                            }
                        }
                    }
                    .padding(.top, 10)
                }

                if data.canAddTask {
                    LinkButton(title: t.addTask, icon: Glyph.plus) { model.path.append(.pick) }
                        .padding(.top, 4)
                        .accessibilityIdentifier("addTask")
                } else {
                    Text(t.limitReached(data.limits.maxTasks ?? 0)).font(.onest(14)).foregroundStyle(palette.muted).padding(.top, 12)
                }

                if !data.archived.isEmpty {
                    LinkButton(title: t.archivedLink(data.archived.count), icon: nil) { model.path.append(.archive) }
                        .accessibilityIdentifier("archiveLink")
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        .refreshable { await model.refresh() }
        .task { await model.refreshIfStale() }
    }
}

/// Тихая ссылка-кнопка (.link-btn): серая, 15, с необязательным значком слева.
struct LinkButton: View {
    let title: String
    let icon: String?
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { StrokeGlyph(d: icon, lineWidth: 2.2).frame(width: 18, height: 18) }
                Text(title).font(.onest(15, .medium))
            }
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 8)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
