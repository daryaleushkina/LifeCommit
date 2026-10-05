// Экран привычки — как TaskDetail.tsx: отметка за сегодня, ключевые числа, календарь месяца (прошедший день можно
// отметить задним числом), у «бросить» — крупный счёт, у «считать» — столбики за две недели с линией цели.
// «Поделиться» придёт вместе с разделом «Поделиться» (docs/parity.md).
import LifeCommitKit
import SwiftUI

struct TaskDetailView: View {
    let taskId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var month: String?
    @State private var marking: String?

    var body: some View {
        // Привычку отложили или удалили, пока экран открыт, — уходим на «Сегодня».
        if let task = model.today.tasks.first(where: { $0.id == taskId }) {
            content(task)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    private func content(_ task: TodayTask) -> some View {
        let today = model.today.day
        let shown = month ?? Months.of(today)
        let history = model.histories[task.id]
        let detail = HabitDetail.make(task: task, history: history, today: today, month: shown, strings: t)
        let logs = HabitDetail.logs(task: task, history: history, today: today)
        let start = history?.start ?? today

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                BackBar().padding(.top, 8)
                HStack(spacing: 12) {
                    KindTile(kind: task.kind, title: task.title, size: .lg)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.title).font(.onest(26, .bold, relativeTo: .title)).tracking(-0.52).accessibilityAddTraits(.isHeader)
                        Text(detail.subtitle).font(.onest(14)).foregroundStyle(palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        model.path.append(.editTask(task.id))
                    } label: {
                        StrokeGlyph(d: Glyph.pencil).frame(width: 20, height: 20)
                            .foregroundStyle(palette.muted)
                            .frame(width: 44, height: 44)
                            .glassCard(radius: 14)
                    }
                    .buttonStyle(PressScale())
                    .accessibilityLabel(t.editTask)
                    .accessibilityIdentifier("edit")
                }
                .padding(.top, 16)

                if let banner = model.banner {
                    ErrorNote(text: banner).onTapGesture { model.banner = nil }
                }

                TodayBlock(task: task)

                if task.kind == .abstain {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(t.num(task.cleanDays)).font(.onest(44, .bold)).tracking(-0.88).foregroundStyle(palette.accent)
                        Text(t.cleanDaysWord(task.cleanDays)).font(.onest(16)).foregroundStyle(palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .glassCard()
                }

                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(detail.stats.enumerated()), id: \.offset) { i, stat in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(stat.value).font(.onest(22, .bold))
                                .foregroundStyle(i == 0 && task.kind != .abstain ? palette.kind(task.kind).ink : palette.text)
                            Text(stat.label).font(.onest(13)).foregroundStyle(palette.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(18)
                .glassCard()

                monthCard(task: task, detail: detail, month: shown, today: today)

                if task.kind == .count {
                    TwoWeeks(days: Stats.lastDays(logs, today: today, count: 14), goal: task.target)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task(id: task.id) { await model.loadHistory(task.id) }
        .sheet(item: Binding(get: { marking.map(Marking.init) }, set: { marking = $0?.day })) { mark in
            MarkSheet(task: task, day: mark.day, marked: logs.contains { $0.day == mark.day } && !(task.kind == .abstain && mark.day < start)) { yes in
                marking = nil
                Task { await model.markDay(task, day: mark.day, yes: yes) }
            }
        }
    }

    private struct Marking: Identifiable {
        let day: String
        var id: String { day }
    }

    private func monthCard(task: TodayTask, detail: HabitDetail, month: String, today: String) -> some View {
        let grid = Months.cells(month)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 5), count: 7)
        return VStack(spacing: 8) {
            HStack {
                navButton("‹", label: t.prevMonth, disabled: month <= detail.oldestMonth) { self.month = Months.shift(month, -1) }
                Text(t.monthYear(month)).font(.onest(15, .semibold)).frame(maxWidth: .infinity)
                navButton("›", label: t.nextMonth, disabled: month >= Months.of(today)) { self.month = Months.shift(month, 1) }
            }
            .frame(minHeight: 44)
            LazyVGrid(columns: columns, spacing: 5) {
                ForEach(t.weekdaysShort, id: \.self) { d in
                    Text(d).font(.onest(12)).foregroundStyle(palette.muted).frame(height: 18).accessibilityHidden(true)
                }
                ForEach(0..<grid.lead, id: \.self) { i in Color.clear.frame(height: 34).id("lead\(i)") }
                ForEach(Array(grid.days.enumerated()), id: \.element) { i, day in
                    let cell = detail.cells[day] ?? .off
                    let isToday = day == today
                    let label = Text("\(i + 1)").font(.onest(13, .medium))
                    Group {
                        if detail.markable && day <= today {
                            Button { marking = day } label: { dayCell(label, cell: cell, today: isToday) }
                                .buttonStyle(.plain)
                                .accessibilityLabel(t.dayMonth(day))
                                .accessibilityIdentifier("day-\(day)")
                        } else {
                            dayCell(label, cell: cell, today: isToday).accessibilityHidden(true)
                        }
                    }
                }
            }
        }
        .padding(18)
        .glassCard()
    }

    private func dayCell(_ label: Text, cell: HabitDetail.Cell, today: Bool) -> some View {
        let (bg, fg): (Color, Color) = switch cell {
        case .off: (.clear, palette.muted)
        case .plan: (.clear, palette.text)
        case .some: (palette.heat[1], palette.text)
        case .half, .clean: (palette.heat[2], palette.text)
        case .full: (palette.heat[3], palette.accentText)
        case .slip: (palette.warnSoft, palette.warn)
        }
        return label
            .foregroundStyle(fg)
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                if cell == .plan { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(palette.line, lineWidth: 1.5) }
            }
            .padding(2)
            .overlay {
                if today { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.text, lineWidth: 2) }
            }
            .contentShape(Rectangle())
    }

    private func navButton(_ glyph: String, label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.onest(22)).foregroundStyle(palette.muted).frame(width: 40, height: 44)
        }
        .buttonStyle(.plain)
        .opacity(disabled ? 0 : 1)
        .disabled(disabled)
        .accessibilityLabel(label)
    }
}

/// Блок «сегодня»: отметить привычку прямо с её экрана — те же кнопки, что на карточке.
private struct TodayBlock: View {
    let task: TodayTask
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t

    var body: some View {
        // Карточка «Сегодня» без плитки и с подписью вместо названия — на ней те же кнопки.
        TaskCard(task: task, onLog: { value, status in
            Task { await model.log(task, value: value, status: status) }
        }, onOpen: {}, caption: task.kind == .abstain ? t.didIt : t.today)
    }
}

/// Отметить прошедший день: «Сделано / Не сделано» (у «бросить» — «Получилось / Не получилось»), «Убрать отметку».
private struct MarkSheet: View {
    let task: TodayTask
    let day: String
    let marked: Bool
    let onPick: (Bool?) -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        SheetBody(title: t.weekdayLong(day)) {
            Text(task.title).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4)
            HStack(spacing: 10) {
                PrimaryButton(title: task.kind == .abstain ? t.markClean : t.markDone, wide: true) { onPick(true) }
                Button { onPick(false) } label: {
                    Text(task.kind == .abstain ? t.markSlip : t.markNotDone)
                        .font(.onest(17, .bold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(palette.warn)
                        .background(palette.warnSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(PressScale())
            }
            .padding(.top, 14)
            if marked {
                Button(t.markClear) { onPick(nil) }
                    .font(.onest(15))
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.top, 12)
            }
        }
        .presentationDetents([.height(marked ? 250 : 200)])
    }
}

/// Столбики за две недели с линией цели: тёмные — цель достигнута.
private struct TwoWeeks: View {
    let days: [(day: String, value: Double)]
    let goal: Double
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        let top = max(goal, days.map(\.value).max() ?? 0) * 1.08
        let colors = palette.kind(.count)
        VStack(alignment: .leading, spacing: 6) {
            Text(t.twoWeeks).font(.onest(15, .semibold)).padding(.bottom, 4)
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    HStack(alignment: .bottom, spacing: 4) {
                        ForEach(days, id: \.day) { d in
                            UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 2, bottomTrailingRadius: 2, topTrailingRadius: 5, style: .continuous)
                                .fill(d.value >= goal ? colors.ink : colors.mid)
                                .frame(height: max(geo.size.height * 0.03, geo.size.height * d.value / top))
                        }
                    }
                    let y = geo.size.height * (1 - goal / top)
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: geo.size.width, y: y))
                    }
                    .stroke(palette.muted, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    Text("\(t.goalShort) \(t.num(goal))")
                        .font(.onest(11))
                        .foregroundStyle(palette.muted)
                        .padding(.leading, 4)
                        .position(x: geo.size.width - 24, y: y - 9)
                }
            }
            .frame(height: 96)
            HStack {
                Text(String(Int(days.first?.day.suffix(2) ?? "") ?? 0))
                Spacer()
                Text(String(Int(days.last?.day.suffix(2) ?? "") ?? 0))
            }
            .font(.onest(12))
            .foregroundStyle(palette.muted)
        }
        .padding(18)
        .glassCard()
        .accessibilityHidden(true)
    }
}
