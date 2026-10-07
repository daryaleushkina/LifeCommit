// Новое (или правка) групповое дело — как GroupItemSheet.tsx (дизайн 16H, круг 18): четыре плитки «Кто делает»; у
// «Назначить» и «Мероприятия» — люди мультивыбором и «Все»; «По очереди» — когда людей двое и больше; повтор, день,
// время; у цели — число и «К какому дню». Что уходит на сервер — GroupItemForm (Kit).
import LifeCommitKit
import os
import SwiftUI

struct GroupItemSheet: View {
    enum Target: Identifiable {
        case new
        case edit(GroupDayItem)

        var id: String {
            switch self {
            case .new: "new"
            case .edit(let it): "edit-\(it.id)"
            }
        }
    }

    let group: GroupToday
    let target: Target
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var form: GroupItemForm
    @State private var busy = false
    @State private var failed = false
    @State private var dayOpen = false
    @State private var untilOpen = false
    @State private var timeOpen = false
    @State private var repeatOpen = false
    @FocusState private var titleFocused: Bool

    init(group: GroupToday, target: Target, me: Int, today: String) {
        self.group = group
        self.target = target
        switch target {
        case .new: _form = State(initialValue: GroupItemForm(me: me, today: today))
        case .edit(let it): _form = State(initialValue: GroupItemForm(item: it, me: me))
        }
    }

    private var item: GroupDayItem? {
        if case .edit(let it) = target { return it }
        return nil
    }

    private var today: String { model.today.day }
    private var g: GroupStrings { t.gr }
    private var me: Int { model.user?.id ?? 0 }

    var body: some View {
        let members = group.members
        SheetBody(title: item?.title ?? g.newItem(group.title)) {
            TextField(placeholder, text: $form.title)
                .textFieldStyle(.plain)
                .font(.onest(17, .medium))
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .focused($titleFocused)
                .onChange(of: form.title) { _, v in if v.count > 120 { form.title = String(v.prefix(120)) } }
                .accessibilityIdentifier("groupItem.title")

            Text(g.who).font(.onest(15, .semibold)).foregroundStyle(palette.muted).padding(.horizontal, 4).padding(.top, 18).padding(.bottom, 8)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(GroupMode.allCases, id: \.self) { mode in modeTile(mode) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(g.who)

            if form.choosesPeople { people(members).padding(.top, 12) }

            VStack(spacing: 0) {
                if form.mode == .goal { goalRows } else { whenRows(members) }
            }
            .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.top, 12)

            if failed { ErrorNote(text: t.error).padding(.top, 10) }
            PrimaryButton(title: item == nil ? g.add : g.save, wide: true, busy: busy) { save() }
                .disabled(!form.valid(members))
                .opacity(form.valid(members) ? 1 : 0.4)
                .padding(.top, 16)
                .accessibilityIdentifier("groupItem.save")
            if let item {
                Button(g.remove, role: .destructive) {
                    model.together.removeItem(groupId: group.id, item, skipDay: nil)
                    dismiss()
                }
                .buttonStyle(.plain)
                .font(.onest(15, .medium))
                .foregroundStyle(palette.danger)
                .frame(maxWidth: .infinity, minHeight: 48)
                .disabled(busy)
                .accessibilityIdentifier("groupItem.delete")
            }
        }
        .presentationDetents([.large])
        .onAppear { if item == nil { titleFocused = true } }
        .sheet(isPresented: $dayOpen) {
            DayPickerSheet(title: g.date, value: form.day, from: today) { form.day = $0 }
        }
        .sheet(isPresented: $untilOpen) {
            DayPickerSheet(title: g.until, value: form.until.isEmpty ? nil : form.until, from: today) { form.until = $0 }
        }
        .sheet(isPresented: $timeOpen) {
            TimeSheet(title: g.time, value: form.time, initial: "19:00", offAction: g.noTime) { form.time = $0 }
        }
        .sheet(isPresented: $repeatOpen) {
            SheetBody(title: g.repeatLabel) {
                VStack(spacing: 0) {
                    ForEach(GroupRepeat.allCases, id: \.self) { r in
                        OptionRow(label: g.repeats[r] ?? "", on: form.repeatRule == r) {
                            form.repeatRule = r
                            repeatOpen = false
                        }
                    }
                }
            }
        }
    }

    private var placeholder: String {
        switch form.mode {
        case .event: g.eventPh
        case .goal: g.goalPh
        default: g.itemPh
        }
    }

    private static let icons: [GroupMode: String] = [
        .one: "M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.2-3L3.6 14a1.5 1.5 0 0 1 2.6-1.5L7 14",
        .assign: "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.7-3.4 3.5-5.3 7-5.3s6.3 1.9 7 5.3",
        .goal: "M7 4h10M8 4v3l-2 3v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9l-2-3V4M6 13h12",
        .event: "M4 6.5h16v13.5H4zM4 10.5h16M8.5 4v4M15.5 4v4",
    ]

    private func modeTile(_ mode: GroupMode) -> some View {
        let on = form.mode == mode
        return Button { form.mode = mode } label: {
            VStack(alignment: .leading, spacing: 6) {
                StrokeGlyph(d: Self.icons[mode] ?? "").frame(width: 22, height: 22).foregroundStyle(on ? palette.accent : palette.muted)
                Text(g.modes[mode] ?? "").font(.onest(15, .bold)).foregroundStyle(palette.text)
                Text(g.modeHints[mode] ?? "").font(.onest(13)).foregroundStyle(palette.muted).multilineTextAlignment(.leading)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(on ? palette.surface : palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? palette.accent : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("groupItem.mode.\(mode.rawValue)")
    }

    private func people(_ members: [GroupMember]) -> some View {
        FlowRow(spacing: 8) {
            chip(on: form.all, label: g.all, avatar: nil) { form.all.toggle() }
                .accessibilityIdentifier("groupItem.all")
            ForEach(members) { m in
                chip(on: form.all || form.people.contains(m.id), label: m.id == me ? g.me : m.name, avatar: m) {
                    form.toggle(m.id, members: members)
                }
            }
        }
    }

    private func chip(on: Bool, label: String, avatar: GroupMember?, action: @escaping () -> Void) -> some View {
        let all = avatar == nil
        return Button(action: action) {
            HStack(spacing: 8) {
                if let avatar { AvatarView(member: avatar, size: 30) }
                Text(label).font(.onest(15, all ? .semibold : .medium)).lineLimit(1)
            }
            .foregroundStyle(all && on ? palette.accentText : palette.text)
            .padding(.leading, all ? 16 : 6)
            .padding(.trailing, all ? 16 : 12)
            .frame(minHeight: 44)
            .background(all && on ? palette.accent : on ? palette.surface : palette.bg, in: Capsule())
            .overlay(Capsule().strokeBorder(on && !all ? palette.accent : .clear, lineWidth: 2))
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func whenRows(_ members: [GroupMember]) -> some View {
        if form.canRotate(members) {
            let names = form.chosen(members).map { id in id == me ? g.me : members.first { $0.id == id }?.name ?? "" }.joined(separator: " → ")
            Toggle(isOn: $form.rotate) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(g.rotate).font(.onest(16, .medium))
                    Text(form.rotate ? names : g.eachHint).font(.onest(13)).foregroundStyle(palette.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .toggleStyle(.switch)
            .tint(palette.accent)
            .padding(.horizontal, 18)
            .frame(minHeight: 60)
            .accessibilityIdentifier("groupItem.rotate")
            Divider().overlay(palette.line)
        }
        SheetRow(label: g.repeatLabel, value: g.repeats[form.repeatRule] ?? "") { repeatOpen = true }
            .accessibilityIdentifier("groupItem.repeat")
        if form.repeatRule.hasDay {
            Divider().overlay(palette.line)
            SheetRow(label: g.date, value: form.day == today ? t.today : t.dayMonth(form.day)) { dayOpen = true }
                .accessibilityIdentifier("groupItem.day")
        }
        Divider().overlay(palette.line)
        SheetRow(label: g.time, value: form.time ?? g.allDay) { timeOpen = true }
            .accessibilityIdentifier("groupItem.time")
    }

    @ViewBuilder private var goalRows: some View {
        HStack(spacing: 8) {
            Text(g.target).font(.onest(16, .medium))
            TextField(g.targetPh, text: $form.target)
                .textFieldStyle(.plain)
                .font(.onest(16))
                .multilineTextAlignment(.trailing)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .onChange(of: form.target) { _, v in
                    let clean = GroupLogic.numberInput(v)
                    if clean != v { form.target = clean }
                }
                .accessibilityLabel(g.target)
                .accessibilityIdentifier("groupItem.target")
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 56)
        Divider().overlay(palette.line)
        SheetRow(label: g.until, value: form.until.isEmpty ? "—" : t.dayMonth(form.until)) { untilOpen = true }
    }

    private func save() {
        busy = true
        failed = false
        let input = form.input(members: group.members, today: today)
        Task {
            do {
                try await model.together.saveItem(groupId: group.id, itemId: item?.id, input)
                dismiss()
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                Logger(subsystem: "app.lifecommit", category: "group").notice("save item failed: \(String(describing: error), privacy: .public)")
                failed = true
                busy = false
            }
        }
    }
}
