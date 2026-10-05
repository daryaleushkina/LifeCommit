// Вкладка «Календарь» — как Calendar.tsx: день или месяц (точки — несделанные дела дня, синие — события календаря),
// стрелки, «К сегодня», ниже — дела выбранного дня (повторяющиеся события стоят в каждом своём дне со своей отметкой).
// Сверху — плашка «Подключите календарь» (пока ничего не подключено), метки подключённых календарей, «Обновить» и
// шторка «Календари». Синхронизация — при запуске и по «Обновить», не при открытии вкладки: она открывается сразу.
// Групповые дела в календаре придут вместе с разделом «Вместе» (docs/parity.md).
import LifeCommitKit
import SwiftUI

struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var mode: CalendarMode = .day
    @State private var picked: String?
    @AppStorage("lc-cal-banner-hidden") private var bannerHidden = false

    init(mode: CalendarMode = .day) {
        _mode = State(initialValue: mode)
    }

    var body: some View {
        @Bindable var model = model
        let today = model.today.day
        let selected = picked ?? today
        let bounds = CalendarDays.bounds(mode, anchor: selected)
        let todos = model.calendarTodos(from: bounds.from, to: bounds.to)
        let dayTodos = Todos.sorted((todos ?? []).filter { $0.day == selected })

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if let accounts = model.accounts {
                    if accounts.isEmpty && !bannerHidden { banner }
                    if !accounts.isEmpty { chips(accounts) }
                }

                Segmented(options: CalendarMode.allCases.map { ($0, $0 == .day ? t.cal.day : t.cal.month) }, selected: mode, label: t.calendar) { mode = $0 }
                    .padding(.top, 16)

                monthNav(selected: selected)

                // Место под «К сегодня» есть всегда: появилась ссылка — список не съезжает.
                if mode == .day {
                    Button(t.cal.backToToday) { picked = today }
                        .font(.onest(14, .medium))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .buttonStyle(.plain)
                        .opacity(selected == today ? 0 : 1)
                        .disabled(selected == today)
                        .accessibilityHidden(selected == today)
                }
                if mode == .month { grid(selected: selected, today: today, todos: todos ?? []) }

                if let banner = model.banner {
                    ErrorNote(text: banner).padding(.top, 12).onTapGesture { model.banner = nil }
                }

                if todos != nil {
                    TodoListView(
                        todos: dayTodos,
                        heading: mode == .day ? nil : t.weekdayLong(selected),
                        addLabel: t.cal.add,
                        showCarry: false,
                        canAdd: selected >= today
                    ) { title in Task { await model.addTodo(title, day: selected) } }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        .task(id: "\(mode.rawValue):\(bounds.from):\(bounds.to)") {
            await model.showRange(from: bounds.from, to: bounds.to)
            // Соседние дни (или месяцы) и месяц — заранее: листать стрелками без пустых кадров.
            for n in [1, -1] {
                let next = CalendarDays.bounds(mode, anchor: CalendarDays.shift(mode, selected, by: n))
                await model.prefetchRange(from: next.from, to: next.to)
            }
            if mode == .day {
                let month = CalendarDays.bounds(.month, anchor: selected)
                await model.prefetchRange(from: month.from, to: month.to)
            }
        }
        .task { await model.loadAccounts() }
        .onDisappear { model.hideRange() }
        .sheet(isPresented: $model.calendarsSheetOpen) { CalendarsSheet() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(t.calendar)
                .font(.onest(30, .bold, relativeTo: .largeTitle))
                .tracking(-0.6)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            // «Обновить» — просто обновляет и крутится, пока идёт; настройки календарей — отдельная кнопка.
            if !(model.accounts ?? []).isEmpty {
                IconButton(glyph: Glyph.refresh, label: t.cal.refresh, spinning: model.calendarSyncing) { Task { await model.syncCalendars() } }
                    .disabled(model.calendarSyncing)
                    .accessibilityIdentifier("calRefresh")
            }
            IconButton(glyph: Glyph.gear, label: t.cal.sheetTitle, spinning: false) { model.calendarsSheetOpen = true }
                .accessibilityIdentifier("calSettings")
        }
        .padding(.top, 24)
    }

    private var banner: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.cal.connectTitle).font(.onest(15, .semibold))
                Text(t.cal.connectHint).font(.onest(13)).foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(t.cal.connect) { model.calendarsSheetOpen = true }
                .font(.onest(14, .semibold))
                .foregroundStyle(palette.accentText)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .buttonStyle(PressScale())
        }
        .padding(.leading, 16)
        .padding(.trailing, 40)
        .padding(.vertical, 14)
        .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(alignment: .topTrailing) {
            Button { bannerHidden = true } label: {
                Text("×").font(.onest(20)).foregroundStyle(palette.muted).frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(t.cancel)
        }
        .padding(.top, 14)
    }

    private func chips(_ accounts: [CalendarAccount]) -> some View {
        FlowRow(spacing: 8) {
            ForEach(accounts) { a in
                let bad = a.status == .authFailed || a.status == .error
                Button {
                    if a.status == .ok { Task { await model.syncCalendars() } } else { model.calendarsSheetOpen = true }
                } label: {
                    HStack(spacing: 6) {
                        SourceMark(source: a.provider == .apple ? .apple : .google)
                        Text(chipText(a)).font(.onest(13))
                    }
                    .foregroundStyle(bad ? palette.warn : palette.muted)
                    .padding(.leading, 6)
                    .padding(.trailing, 10)
                    .frame(minHeight: 32)
                    .glassCard(radius: 12)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
    }

    private func chipText(_ a: CalendarAccount) -> String {
        switch a.status {
        case .ok: CalendarDays.synced(a.lastSyncAt, now: Date(), strings: t.cal)
        case .setup: t.cal.googleSetup
        case .authFailed, .error: a.provider == .apple ? t.cal.newPassword : t.cal.reconnect
        }
    }

    private func monthNav(selected: String) -> some View {
        let title = mode == .day ? t.weekdayLong(selected) : t.monthYear(Months.of(selected))
        return HStack {
            navButton("‹", label: mode == .day ? t.cal.prevDay : t.prevMonth) { picked = CalendarDays.shift(mode, selected, by: -1) }
            Text(title.prefix(1).uppercased(with: t.locale) + title.dropFirst())
                .font(.onest(15, .semibold))
                .frame(maxWidth: .infinity)
            navButton("›", label: mode == .day ? t.cal.nextDay : t.nextMonth) { picked = CalendarDays.shift(mode, selected, by: 1) }
        }
        .frame(minHeight: 44)
        .padding(.top, 10)
    }

    private func navButton(_ sign: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(sign).font(.onest(22)).foregroundStyle(palette.muted).frame(width: 40, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func grid(selected: String, today: String, todos: [Todo]) -> some View {
        let days = CalendarDays.range(.month, anchor: selected)
        let month = Months.of(selected)
        let columns = Array(repeating: GridItem(.flexible(minimum: 0), spacing: 4), count: 7)
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(t.weekdaysShort, id: \.self) { w in
                Text(w).font(.onest(11, .semibold)).foregroundStyle(palette.muted).accessibilityHidden(true)
            }
            ForEach(days, id: \.self) { day in
                let on = day == selected
                let out = Months.of(day) != month
                Button { picked = day } label: {
                    VStack(spacing: 3) {
                        Text("\(Int(day.suffix(2)) ?? 0)")
                            .font(.onest(14, day == today && !on ? .bold : .medium))
                            .foregroundStyle(on ? palette.accentText : day == today ? palette.accent : palette.text)
                        HStack(spacing: 3) {
                            ForEach(Array(CalendarDays.dots(todos, day: day).enumerated()), id: \.offset) { _, ext in
                                Circle().fill(on ? palette.accentText : ext ? palette.outside : palette.heat[3]).frame(width: 5, height: 5)
                            }
                        }
                        .frame(height: 5)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.top, 5)
                    .padding(.bottom, 4)
                    .background {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(on ? palette.accent : palette.surface.opacity(out ? 0.3 : 0.72))
                            .overlay {
                                if !on && !out {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(palette.text.opacity(0.09), lineWidth: 1)
                                }
                            }
                    }
                    .opacity(out ? 0.4 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t.weekdayLong(day))
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("cal-\(day)")
            }
        }
        .padding(.top, 4)
    }
}

/// Кнопка-значок в шапке (.icon-btn): 44×44, стекло, радиус 14.
struct IconButton: View {
    let glyph: String
    let label: String
    let spinning: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            StrokeGlyph(d: glyph)
                .frame(width: 20, height: 20)
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(spinning ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: spinning)
                .foregroundStyle(palette.muted)
                .frame(width: 44, height: 44)
                .glassCard(radius: 14)
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(label)
    }
}

/// Метка «откуда пришло»: A — Apple, G — Google (.src-mark).
struct SourceMark: View {
    let source: TodoSource
    @Environment(\.palette) private var palette

    var body: some View {
        Text(source == .apple ? "A" : "G")
            .font(.onest(11, .bold))
            .foregroundStyle(source == .apple ? palette.text : palette.outside)
            .frame(width: 20, height: 20)
            .background(source == .apple ? palette.heat[0] : palette.outside.opacity(0.16), in: RoundedRectangle(cornerRadius: 6))
            .accessibilityLabel(source == .apple ? "Apple" : "Google")
    }
}

/// Ряд, который переносится на следующую строку (метки календарей, .cal-chips — flex-wrap).
struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width + 0.5 {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            // Допуск на дробные точки: ряд ровно по ширине меток иначе переносил последнюю.
            if x > bounds.minX && x + size.width > bounds.maxX + 0.5 {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
