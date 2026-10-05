// Редактор привычки — как TaskEditor.tsx: метка вида, название (единственное обязательное), у «считать» — «Цель на
// день», у «бросить» — «Последний раз», «Повторять» (шторка), «Кто видит»; у существующей — «Отложить» и «Удалить»
// (с подтверждением: стирает историю). Вид у существующей привычки не меняется.
import LifeCommitKit
import SwiftUI

struct TaskEditorView: View {
    let taskId: Int?
    let kind: TaskKind

    /// Форма заполняется сразу из привычки (из «Сегодня», без загрузки) — без мигания пустой формы при открытии.
    init(task: TodayTask?, kind: TaskKind) {
        taskId = task?.id
        self.kind = task?.kind ?? kind
        _form = State(initialValue: task.map {
            Form(title: $0.title, target: $0.target, unit: $0.unit ?? "", schedule: $0.schedule, weekdays: $0.weekdays,
                 perWeek: $0.perWeek ?? 3, visibility: $0.visibility, lastSlipOn: $0.lastSlipOn)
        } ?? Form())
    }
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var form: Form
    @State private var busy = false
    @State private var message: String?
    @State private var repeatOpen = false
    @State private var visibilityOpen = false
    @State private var lastSlipOpen = false
    @State private var confirmDelete = false
    @State private var goalTomorrow = false

    struct Form: Equatable {
        var title = ""
        var target: Double = 10
        var unit = ""
        var schedule: Schedule = .daily
        var weekdays = 31
        var perWeek = 3
        var visibility: HabitVisibility = .private
        var lastSlipOn: String?
    }

    private var isNew: Bool { taskId == nil }
    private var valid: Bool {
        !form.title.trimmingCharacters(in: .whitespaces).isEmpty && (kind != .count || form.target > 0) && (form.schedule != .weekdays || form.weekdays > 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackBar().padding(.top, 8)
                PageHead(title: isNew ? t.newTask : t.editTask)
                if let message { ErrorNote(text: message).padding(.top, 12) }

                HStack(spacing: 10) {
                    KindTile(kind: kind, title: form.title, size: .sm)
                    Text(t.intents[kind]?.title ?? "").font(.onest(15, .semibold))
                }
                .padding(.vertical, 6)
                .padding(.leading, 6)
                .padding(.trailing, 14)
                .glassCard(radius: 16)
                .padding(.top, 16)

                TextField(t.titlePh[kind] ?? "", text: $form.title)
                    .textFieldStyle(.plain)
                    .font(.onest(17, .medium))
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .glassCard(radius: 16)
                    .padding(.top, 14)
                    .onChange(of: form.title) { _, v in if v.count > 80 { form.title = String(v.prefix(80)) } }
                    .accessibilityIdentifier("title")

                VStack(spacing: 0) {
                    if kind == .abstain {
                        row(t.lastSlip, value: form.lastSlipOn.map(t.dayMonth) ?? t.notSet) { lastSlipOpen = true }
                    }
                    if kind == .count {
                        HStack {
                            Text(t.goal).font(.onest(16, .medium))
                            Spacer()
                            // Шаг как в мини-аппе: до 20 — по одному, дальше — по пять.
                            MiniStepper(label: t.goal, value: Int(form.target), range: 1...100_000, down: Int(form.target) > 20 ? 5 : 1, up: Int(form.target) >= 20 ? 5 : 1) {
                                form.target = Double($0)
                            }
                            .accessibilityIdentifier("goal")
                        }
                        .padding(.leading, 18)
                        .padding(.trailing, 14)
                        .frame(minHeight: 56)
                    }
                    if kind != .abstain {
                        if kind == .count { Divider().overlay(palette.line) }
                        row(t.repeatLabel, value: Repeat.label(t, schedule: form.schedule, weekdays: form.weekdays, perWeek: form.perWeek)) { repeatOpen = true }
                    }
                    Divider().overlay(palette.line)
                    row(t.who, value: t.visibility[form.visibility] ?? "") { visibilityOpen = true }
                }
                .glassCard()
                .padding(.top, 16)

                PrimaryButton(title: isNew ? t.add : t.save, wide: true, busy: busy) { Task { await save() } }
                    .disabled(!valid)
                    .opacity(valid ? 1 : 0.4)
                    .padding(.top, 20)
                    .accessibilityIdentifier("save")

                if !isNew {
                    HStack(spacing: 12) {
                        Button(t.postpone) { Task { await postpone() } }
                            .foregroundStyle(palette.muted)
                            .accessibilityIdentifier("postpone")
                        Button(t.deleteTask) { confirmDelete = true }
                            .foregroundStyle(palette.danger)
                            .accessibilityIdentifier("delete")
                    }
                    .font(.onest(15))
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .sheet(isPresented: $repeatOpen) { RepeatSheet(form: $form) }
        .sheet(isPresented: $visibilityOpen) {
            OptionsSheet(title: t.who, options: HabitVisibility.allCases.map { ($0, t.visibility[$0] ?? "") }, selected: form.visibility) { form.visibility = $0 }
        }
        .sheet(isPresented: $lastSlipOpen) { DateSheet(title: t.lastSlip, value: $form.lastSlipOn) }
        .confirmationDialog(t.deleteForeverConfirm, isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(t.deleteForever, role: .destructive) { Task { await remove() } }
            Button(t.cancel, role: .cancel) {}
        }
        .alert(t.goalTomorrow, isPresented: $goalTomorrow) {
            Button("OK") { dismiss() }
        }
    }

    private func row(_ label: String, value: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label).font(.onest(16, .medium)).lineLimit(1)
                Spacer(minLength: 8)
                Text(value).font(.onest(15)).foregroundStyle(palette.muted).multilineTextAlignment(.trailing)
                StrokeGlyph(d: "M9.5 6l6 6-6 6").frame(width: 20, height: 20).foregroundStyle(palette.muted)
            }
            .padding(.leading, 18)
            .padding(.trailing, 14)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func save() async {
        guard valid else { return }
        busy = true
        defer { busy = false }
        let input = TaskInput(
            title: form.title.trimmingCharacters(in: .whitespaces),
            kind: kind,
            unit: kind == .count ? (form.unit.trimmingCharacters(in: .whitespaces).isEmpty ? nil : form.unit) : nil,
            schedule: kind == .abstain ? .daily : form.schedule,
            weekdays: form.weekdays,
            perWeek: kind != .abstain && form.schedule == .perWeek ? form.perWeek : nil,
            visibility: form.visibility,
            target: kind == .count ? form.target : 1,
            lastSlipOn: kind == .abstain ? form.lastSlipOn : nil
        )
        do {
            let easier = try await model.saveTask(id: taskId, input: input)
            if easier { goalTomorrow = true } else { close() }
        } catch {
            message = model.message(for: error)
        }
    }

    private func postpone() async {
        guard let id = taskId else { return }
        do {
            try await model.postponeTask(id: id)
            close()
        } catch {
            message = model.message(for: error)
        }
    }

    private func remove() async {
        guard let id = taskId else { return }
        do {
            try await model.deleteTaskNow(id: id)
            close()
        } catch {
            message = model.message(for: error)
        }
    }

    /// После сохранения — на «Сегодня» (новая привычка открывалась через «Чего я хочу?» — убираем и его).
    private func close() {
        model.path = []
    }
}

/// Шторка «Повторять»: каждый день / по дням недели / несколько раз в неделю.
struct RepeatSheet: View {
    @Binding var form: TaskEditorView.Form
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetBody(title: t.repeatLabel) {
            VStack(spacing: 0) {
                ForEach(Array(Schedule.allCases.enumerated()), id: \.element) { i, schedule in
                    if i > 0 { Divider().overlay(palette.line) }
                    OptionRow(label: t.schedules[schedule] ?? "", on: form.schedule == schedule) { form.schedule = schedule }
                }
            }
            if form.schedule == .weekdays {
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { i in
                        let on = form.weekdays & (1 << i) != 0
                        Button {
                            form.weekdays ^= 1 << i
                        } label: {
                            Text(t.weekdaysShort[i])
                                .font(.onest(13, .semibold))
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .foregroundStyle(on ? palette.accentText : palette.text)
                                .background(on ? palette.accent : palette.heat[0], in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.top, 12)
            }
            if form.schedule == .perWeek {
                HStack(spacing: 12) {
                    MiniStepper(label: t.schedules[.perWeek] ?? "", value: form.perWeek, range: 1...6, down: 1, up: 1) { form.perWeek = $0 }
                    Text(t.perWeekHint(form.perWeek)).font(.onest(15)).foregroundStyle(palette.muted)
                }
                .padding(.top, 12)
            }
            // Ни одного дня — закрыть нельзя: такую привычку некогда было бы делать.
            PrimaryButton(title: t.done, wide: true) { dismiss() }
                .disabled(form.schedule == .weekdays && form.weekdays == 0)
                .opacity(form.schedule == .weekdays && form.weekdays == 0 ? 0.4 : 1)
                .padding(.top, 14)
        }
    }
}

/// Шторка снизу в стиле приложения (Sheet в Picker.tsx): заголовок 18 bold, фон --surface, радиус 24.
struct SheetBody<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.onest(18, .bold)).padding(.horizontal, 4).padding(.bottom, 10)
                content()
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 20)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(palette.surface)
        .presentationCornerRadius(24)
    }
}

struct OptionRow: View {
    let label: String
    let on: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label).font(.onest(16, on ? .semibold : .medium)).foregroundStyle(on ? palette.accent : palette.text)
                Spacer()
                if on { StrokeGlyph(d: Glyph.check, lineWidth: 2.4).frame(width: 20, height: 20).foregroundStyle(palette.accent) }
            }
            .padding(.horizontal, 4)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Шторка с вариантами (SelectRow): тап выбирает и закрывает.
struct OptionsSheet<Value: Hashable>: View {
    let title: String
    let options: [(Value, String)]
    let selected: Value
    let onPick: (Value) -> Void
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetBody(title: title) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, option in
                if i > 0 { Divider().overlay(palette.line) }
                OptionRow(label: option.1, on: option.0 == selected) {
                    onPick(option.0)
                    dismiss()
                }
            }
        }
    }
}

/// «Последний раз»: календарь в шторке, позже сегодня — нельзя, дату можно сбросить.
struct DateSheet: View {
    let title: String
    @Binding var value: String?
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        SheetBody(title: title) {
            DatePicker(title, selection: $date, in: ...Date(), displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .environment(\.locale, t.locale)
            PrimaryButton(title: t.done, wide: true) {
                value = Self.day(date)
                dismiss()
            }
            .padding(.top, 8)
            if value != nil {
                Button(t.clearDate) {
                    value = nil
                    dismiss()
                }
                .font(.onest(15))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, minHeight: 48)
            }
        }
        .onAppear {
            if let value, let d = Days.localNoon(value) { date = d }
        }
    }

    static func day(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// Счётчик «− 10 +» мини-аппа (.stepper): кнопки 40×40, число посередине. Для VoiceOver — одно регулируемое значение.
struct MiniStepper: View {
    let label: String
    let value: Int
    let range: ClosedRange<Int>
    let down: Int
    let up: Int
    let onChange: (Int) -> Void
    @Environment(\.palette) private var palette
    @Environment(\.strings) private var t

    var body: some View {
        HStack(spacing: 2) {
            button("−") { onChange(max(range.lowerBound, value - down)) }
            Text(t.num(value)).font(.onest(18, .bold)).frame(width: 48)
            button("+") { onChange(min(range.upperBound, value + up)) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(t.num(value))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onChange(min(range.upperBound, value + up))
            case .decrement: onChange(max(range.lowerBound, value - down))
            @unknown default: break
            }
        }
    }

    private func button(_ sign: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(sign)
                .font(.onest(20, .medium))
                .frame(width: 40, height: 40)
                .background(palette.heat[0], in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressScale())
    }
}
