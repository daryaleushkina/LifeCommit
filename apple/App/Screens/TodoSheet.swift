// Шторка дела — как TodoSheet.tsx: название, день («Сегодня» / «Завтра» в одно касание, остальное — календарём),
// время (барабаны часов и минут, как TimeRow), место. У события из календаря сверху — его подробности: где, ссылка на
// созвон, кто будет, описание. Ссылки открываются системой: место — в Картах, созвон — в браузере или приложении.
import LifeCommitKit
import SwiftUI

struct TodoSheet: View {
    let todo: Todo
    let today: String
    let onSave: (TodoEdit) -> Void
    /// Нет — удалять здесь нечего (например, в «Потом» удаляют свайпом).
    var onDelete: (() -> Void)?
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var day: String
    @State private var time: String?
    @State private var place: String
    @State private var dayOpen = false
    @State private var timeOpen = false

    init(todo: Todo, today: String, onSave: @escaping (TodoEdit) -> Void, onDelete: (() -> Void)? = nil) {
        self.todo = todo
        self.today = today
        self.onSave = onSave
        self.onDelete = onDelete
        _title = State(initialValue: todo.title)
        _day = State(initialValue: TodoEdit.initialDay(of: todo, today: today))
        _time = State(initialValue: todo.time)
        _place = State(initialValue: todo.details?.location ?? "")
    }

    private var s: TodoSheetStrings { t.todoSheet }
    private var tomorrow: String { Days.add(today, 1) }
    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        SheetBody(title: todo.source != nil ? s.event : s.edit) {
            TextField(s.edit, text: $title)
                .textFieldStyle(.plain)
                .font(.onest(17, .medium))
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .onChange(of: title) { _, v in if v.count > 120 { title = String(v.prefix(120)) } }
                .accessibilityIdentifier("todoTitle")

            if todo.source != nil, let details = todo.details { EventDetailsView(details: details).padding(.top, 10) }

            // Повторяющееся: день задан повтором — не выбирают.
            if !todo.recurring {
                Segmented(options: [(today, s.today), (tomorrow, s.tomorrow)], selected: day, label: s.when) { day = $0 }
                    .padding(.top, 10)
            }

            VStack(spacing: 0) {
                if !todo.recurring {
                    SheetRow(label: s.otherDay, value: day > tomorrow ? t.dayMonth(day) : s.pick) { dayOpen = true }
                    Divider().overlay(palette.line)
                }
                SheetRow(label: s.time, value: time ?? s.allDay) { timeOpen = true }
                    .accessibilityIdentifier("todoTime")
                // Своё дело: место можно вписать или поправить, оно уйдёт в календарь телефона.
                if todo.source == nil {
                    Divider().overlay(palette.line)
                    HStack(spacing: 8) {
                        Text(s.place).font(.onest(16, .medium))
                        TextField(s.placePh, text: $place)
                            .textFieldStyle(.plain)
                            .font(.onest(15))
                            .multilineTextAlignment(.trailing)
                            .onChange(of: place) { _, v in if v.count > 200 { place = String(v.prefix(200)) } }
                            .accessibilityLabel(s.place)
                        if let map = MapLink.url(place) {
                            Link(destination: map) {
                                StrokeGlyph(d: Glyph.pin).frame(width: 18, height: 18).foregroundStyle(palette.muted).frame(width: 36, height: 36)
                            }
                            .accessibilityLabel(s.onMap)
                        }
                    }
                    .padding(.leading, 18)
                    .padding(.trailing, 10)
                    .frame(minHeight: 56)
                }
            }
            .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.top, 10)

            if let source = todo.source {
                if let open = todo.details?.openUrl.flatMap(ExternalLink.url) {
                    Link(destination: open) {
                        Text("\(s.openGoogle) ↗").font(.onest(15, .medium)).foregroundStyle(palette.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .padding(.top, 6)
                } else {
                    Text(source == .apple ? s.fromApple : s.fromGoogle)
                        .font(.onest(14)).foregroundStyle(palette.muted)
                        .padding(.horizontal, 4).padding(.top, 10)
                }
            }

            PrimaryButton(title: t.done, wide: true) {
                onSave(TodoEdit(title: title.trimmingCharacters(in: .whitespacesAndNewlines), day: day, time: time,
                                location: todo.source == nil ? place.trimmingCharacters(in: .whitespacesAndNewlines) : nil))
                dismiss()
            }
            .disabled(!valid)
            .opacity(valid ? 1 : 0.4)
            .padding(.top, 16)
            .accessibilityIdentifier("todoDone")

            if let onDelete {
                Button(todo.source != nil ? s.deleteEvent : s.delete, role: .destructive) {
                    onDelete()
                    dismiss()
                }
                .buttonStyle(.plain)
                .font(.onest(15, .medium))
                .foregroundStyle(palette.danger)
                .frame(maxWidth: .infinity, minHeight: 48)
                .accessibilityIdentifier("todoDelete")
            }
        }
        .sheet(isPresented: $dayOpen) {
            DayPickerSheet(title: s.otherDay, value: day > tomorrow ? day : nil, from: Days.add(today, 2)) { day = $0 }
        }
        .sheet(isPresented: $timeOpen) {
            TimeSheet(title: s.time, value: time, initial: "12:00", offAction: s.noTime) { time = $0 }
        }
    }
}

/// Подробности события: только то, что есть, каждая — строкой; описание сворачивается (EventDetails в TodoSheet.tsx).
struct EventDetailsView: View {
    let details: TodoDetails
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var notesOpen = false

    private static let callHosts = /meet|zoom|teams|telemost|webex|whereby|jit\.si|jazz|ktalk|t\.me\/call|facetime/.ignoresCase()

    var body: some View {
        let s = t.todoSheet
        VStack(spacing: 0) {
            if let location = details.location, let map = MapLink.url(location) {
                Link(destination: map) { row(Glyph.pin, Text(location), chevron: true) }
                    .accessibilityLabel("\(s.onMap): \(location)")
            }
            if let raw = details.link, let link = ExternalLink.url(raw) {
                Link(destination: link) {
                    row(Glyph.video, VStack(alignment: .leading, spacing: 2) {
                        Text(raw.contains(Self.callHosts) ? s.join : s.openLink).font(.onest(15, .semibold))
                        Text(ExternalLink.short(link)).font(.onest(13)).foregroundStyle(palette.muted)
                    }, chevron: true)
                }
            }
            if let count = details.peopleCount, count > 0 {
                let shown = details.people ?? []
                let names = shown.prefix(3).joined(separator: ", ")
                let rest = count - 1 - min(3, shown.count)
                row(Glyph.people, VStack(alignment: .leading, spacing: 2) {
                    Text(s.people(count)).font(.onest(15, .semibold))
                    if !names.isEmpty {
                        Text(rest > 0 ? "\(names) \(s.andMore(rest))" : names).font(.onest(13)).foregroundStyle(palette.muted)
                    }
                }, chevron: false)
            }
            if let notes = details.notes, !notes.isEmpty {
                let long = notes.count > 140 || notes.split(separator: "\n", omittingEmptySubsequences: false).count > 3
                Button {
                    notesOpen.toggle()
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        StrokeGlyph(d: Glyph.notes).frame(width: 18, height: 18).foregroundStyle(palette.muted)
                        Text(notes).font(.onest(14)).foregroundStyle(palette.muted)
                            .lineLimit(notesOpen ? nil : 3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .multilineTextAlignment(.leading)
                        if long && !notesOpen {
                            Text(s.more).font(.onest(14, .semibold)).foregroundStyle(palette.accent).frame(maxHeight: .infinity, alignment: .bottom)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!long)
            }
        }
        .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func row(_ icon: String, _ content: some View, chevron: Bool) -> some View {
        HStack(spacing: 12) {
            StrokeGlyph(d: icon).frame(width: 18, height: 18).foregroundStyle(palette.muted)
            content.font(.onest(15)).foregroundStyle(palette.text).frame(maxWidth: .infinity, alignment: .leading).multilineTextAlignment(.leading)
            if chevron { StrokeGlyph(d: Glyph.chevron, lineWidth: 2.2).frame(width: 16, height: 16).foregroundStyle(palette.muted) }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

/// Ссылки из событий календаря — чужой ввод: открываем только http(s).
enum ExternalLink {
    static func url(_ raw: String) -> URL? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespaces)), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host() != nil else { return nil }
        return url
    }

    /// «meet.google.com/abc-defg» — хост и путь, не длиннее 40 знаков.
    static func short(_ url: URL) -> String {
        let host = (url.host() ?? "").replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression)
        let path = url.path().count > 1 ? url.path() : ""
        return String((host + path).prefix(40))
    }
}

/// Место — в Картах (на iPhone и Mac открывается приложение «Карты»).
enum MapLink {
    static func url(_ place: String) -> URL? {
        let q = place.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return nil }
        var c = URLComponents(string: "https://maps.apple.com/")!
        c.queryItems = [URLQueryItem(name: "q", value: q)]
        return c.url
    }
}

/// Переключатель на две-три кнопки (.segmented мини-аппа): фон --heat-0, выбранная — белая с тенью.
struct Segmented<Value: Hashable>: View {
    let options: [(Value, String)]
    let selected: Value?
    let label: String
    let onPick: (Value) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let on = option.0 == selected
                Button {
                    onPick(option.0)
                } label: {
                    Text(option.1)
                        .font(.onest(13, on ? .semibold : .medium))
                        .foregroundStyle(palette.text)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(on ? palette.surface : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .shadow(color: on && !palette.isDark ? Color.black.opacity(0.06) : .clear, radius: 2, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(palette.heat[0], in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// Строка шторки: подпись, значение справа, стрелка — тап открывает выбор.
struct SheetRow: View {
    let label: String
    let value: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label).font(.onest(16, .medium)).lineLimit(1)
                Spacer(minLength: 8)
                Text(value).font(.onest(15)).foregroundStyle(palette.muted)
                StrokeGlyph(d: Glyph.chevron).frame(width: 20, height: 20).foregroundStyle(palette.muted)
            }
            .padding(.leading, 18)
            .padding(.trailing, 14)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(value)
    }
}

/// Другой день: календарь в шторке, не раньше `from`.
struct DayPickerSheet: View {
    let title: String
    let value: String?
    let from: String
    let onPick: (String) -> Void
    @Environment(\.strings) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        SheetBody(title: title) {
            DatePicker(title, selection: $date, in: (Days.localNoon(from) ?? Date())..., displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .environment(\.locale, t.locale)
            PrimaryButton(title: t.done, wide: true) {
                onPick(DateSheet.day(date))
                dismiss()
            }
            .padding(.top, 8)
        }
        .onAppear { date = Days.localNoon(value ?? from) ?? Date() }
    }
}

/// Время: барабаны часов и минут (шаг 5), «Без времени» — снять (TimeRow в Picker.tsx). На Mac барабанов нет —
/// там те же значения в меню.
struct TimeSheet: View {
    let title: String
    let value: String?
    let initial: String
    let offAction: String
    let onPick: (String?) -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var hour = 12
    @State private var minute = 0

    var body: some View {
        SheetBody(title: title) {
            HStack(spacing: 4) {
                Picker(t.todoSheet.hours, selection: $hour) {
                    ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).font(.onest(20, .semibold)).tag($0) }
                }
                Text(":").font(.onest(20, .semibold))
                Picker(t.todoSheet.minutes, selection: $minute) {
                    ForEach(Array(stride(from: 0, to: 60, by: 5)), id: \.self) { Text(String(format: "%02d", $0)).font(.onest(20, .semibold)).tag($0) }
                }
            }
            #if os(iOS)
            .pickerStyle(.wheel)
            .frame(height: 180)
            #else
            .pickerStyle(.menu)
            #endif
            .labelsHidden()
            .accessibilityIdentifier("timeWheels")

            PrimaryButton(title: t.done, wide: true) {
                onPick(String(format: "%02d:%02d", hour, minute))
                dismiss()
            }
            .padding(.top, 12)
            .accessibilityIdentifier("timeDone")
            if value != nil {
                Button(offAction) {
                    onPick(nil)
                    dismiss()
                }
                .buttonStyle(.plain)
                .font(.onest(15))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, minHeight: 48)
            }
        }
        .onAppear {
            let parts = (value ?? initial).split(separator: ":").compactMap { Int($0) }
            hour = min(23, max(0, parts.first ?? 12))
            minute = min(55, max(0, ((parts.count > 1 ? parts[1] : 0) + 2) / 5 * 5))
        }
    }
}
