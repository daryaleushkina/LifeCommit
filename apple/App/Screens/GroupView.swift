// Экран группы — как Group.tsx (дизайн 16E/16F): дела на сегодня с отметками, цели с «+ Положить», «Скоро», люди,
// «Позвать в группу» (ссылка в Telegram, как в мини-аппе), настройки (название, «только админы», чат Telegram, выйти,
// удалить). Подсказка после действия — поверх, над низом экрана.
import LifeCommitKit
import os
import SwiftUI

private let groupLog = Logger(subsystem: "app.lifecommit", category: "group")

extension Glyph {
    static let telegram = "M21 4L3 11l6 2.5M21 4l-3 16-9-6.5M21 4L9 13.5V19l3-3.5"
}

struct GroupView: View {
    let groupId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "items"
    @State private var settingsOpen = false
    @State private var editing: GroupItemSheet.Target?
    @State private var putting: GroupDayItem?
    @State private var chatChecked = false

    /// tab — какая вкладка открыта сразу (снимки экранов показывают и «Люди»).
    init(groupId: Int, tab: String = "items") {
        self.groupId = groupId
        _tab = State(initialValue: tab)
    }

    private var tg: TogetherModel { model.together }

    var body: some View {
        let group = tg.details[groupId]
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    BackBar().padding(.top, 8)
                    if tg.missing.contains(groupId) {
                        Text(t.gr.join.notFound).font(.onest(15)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 48)
                    } else if let group {
                        content(group)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 120)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await tg.loadGroup(groupId) }

            if group != nil, tab == "items", !tg.missing.contains(groupId) {
                fab.frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 20).padding(.bottom, 24)
            }
            if let note = tg.note, note.groupId == groupId {
                NoteToast(text: note.text) { tg.note = nil }.padding(.bottom, 96)
            }
        }
        .animation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.2), value: tg.note)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task { await tg.loadGroup(groupId) }
        // Чат ещё жив? Проверяем в фоне раз за открытие: удалённый в Telegram чат пропадает из настроек сразу.
        .task(id: group?.settings?.tgChatTitle != nil) {
            guard !chatChecked, group?.settings?.tgChatTitle != nil else { return }
            chatChecked = true
            await tg.checkChat(groupId: groupId)
        }
        .sheet(item: $editing) { target in
            if let group { GroupItemSheet(group: group, target: target, me: model.user?.id ?? 0, today: model.today.day) }
        }
        .sheet(isPresented: $settingsOpen) {
            if let group { GroupSettingsSheet(group: group, onLeft: { dismiss() }) }
        }
        .sheet(item: $putting) { item in
            PutSheet(item: item) { amount in
                Task { await tg.put(groupId: groupId, itemId: item.id, amount: amount) }
            }
        }
    }

    @ViewBuilder private func content(_ group: GroupToday) -> some View {
        HStack(alignment: .center, spacing: 14) {
            GroupBadge(id: group.id, title: group.title, size: 60)
            VStack(alignment: .leading, spacing: 4) {
                Text(group.title).font(.onest(26, .bold, relativeTo: .title)).tracking(-0.5).accessibilityAddTraits(.isHeader)
                HStack(spacing: 6) {
                    AvatarStack(members: group.members, size: 20)
                    Text(t.gr.people(group.members.count) + (group.planned > 0 ? " · \(t.gr.progress(group.done, group.planned))" : ""))
                        .font(.onest(14)).foregroundStyle(palette.muted)
                }
            }
            Spacer(minLength: 0)
            IconButton(glyph: Glyph.gear, label: t.gr.settings, spinning: false) { settingsOpen = true }
                .accessibilityIdentifier("group.settings")
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 20)
        .padding(.bottom, 16)

        Segmented(options: [("items", t.gr.tabItems), ("people", t.gr.tabPeople)], selected: tab, label: group.title, ids: ["group.tab.items", "group.tab.people"]) { tab = $0 }

        if tab == "items" { items(group) } else { people(group) }
    }

    @ViewBuilder private func items(_ group: GroupToday) -> some View {
        let today = model.today.day
        let goals = GroupLogic.goals(group.items).filter { !removed($0, today) }
        let list = GroupLogic.screenOrder(group.items).filter { !removed($0, today) }
        let soon = GroupLogic.soon(group.upcoming ?? [])
        if !goals.isEmpty {
            card(goals) { it in
                GroupItemRow(item: it, members: group.members, onOpen: { editing = .edit(it) }, onPut: { putting = it }, swipe: (group.id, today))
            }
            .padding(.top, 16)
        }
        SectionLabel(text: t.gr.todayLabel).padding(.horizontal, 4).padding(.top, 20).padding(.bottom, 8)
        if list.isEmpty {
            Text(t.gr.nothingToday).font(.onest(15)).foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, minHeight: 52).glassCard()
        } else {
            card(list) { it in
                GroupItemRow(item: it, members: group.members, onToggle: { Task { await tg.mark(groupId: group.id, it) } }, onOpen: { editing = .edit(it) }, swipe: (group.id, today))
            }
        }
        let soonShown = soon.map { b in (b, b.items.filter { !removed($0, b.day) }) }.filter { !$0.1.isEmpty }
        if !soonShown.isEmpty {
            SectionLabel(text: t.gr.soon).padding(.horizontal, 4).padding(.top, 24).padding(.bottom, 4)
            ForEach(soonShown, id: \.0.day) { block, items in
                Text(t.weekdayLong(block.day)).font(.onest(15, .semibold)).foregroundStyle(palette.muted)
                    .padding(.horizontal, 4).padding(.top, 12).padding(.bottom, 6)
                card(items) { it in
                    GroupItemRow(item: GroupBlockView.readOnly(it), members: group.members, onOpen: { editing = .edit(it) }, swipe: (group.id, block.day))
                }
            }
        }
    }

    private func removed(_ it: GroupDayItem, _ day: String) -> Bool { TogetherModel.isRemoved(model, groupId, it.id, day: day) }

    private func card(_ items: [GroupDayItem], @ViewBuilder row: @escaping (GroupDayItem) -> some View) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, it in
                if index > 0 { Divider().overlay(palette.line) }
                row(it)
            }
        }
        .glassCard()
    }

    @ViewBuilder private func people(_ group: GroupToday) -> some View {
        let me = model.user?.id ?? 0
        VStack(spacing: 0) {
            ForEach(Array(group.members.enumerated()), id: \.element.id) { index, m in
                if index > 0 { Divider().overlay(palette.line) }
                let done = GroupLogic.doneToday(group, by: m.id)
                HStack(spacing: 12) {
                    AvatarView(member: m, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.id == me ? "\(m.name) (\(t.gr.me))" : m.name).font(.onest(16))
                        if !done.isEmpty { Text(t.gr.doneBy(done.joined(separator: ", "))).font(.onest(13)).foregroundStyle(palette.muted) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
            }
        }
        .glassCard()
        .padding(.top, 16)
        PrimaryButton(title: t.gr.invite, wide: true) { invite(group) }
            .padding(.top, 16)
            .accessibilityIdentifier("group.invite")
        Text(t.gr.inviteHint).font(.onest(14)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 8)
    }

    private var fab: some View {
        Button { editing = .new } label: {
            HStack(spacing: 8) {
                StrokeGlyph(d: Glyph.plus, lineWidth: 2.4).frame(width: 20, height: 20)
                Text(t.gr.addItem).font(.onest(16, .semibold))
            }
            .foregroundStyle(palette.accentText)
            .padding(.horizontal, 22)
            .frame(height: 56)
            .background(palette.accent, in: Capsule())
            .shadow(color: palette.accent.opacity(0.35), radius: 12, y: 10)
        }
        .buttonStyle(PressScale())
        .accessibilityIdentifier("group.addItem")
    }

    /// «Позвать в группу»: свежая ссылка (7 дней) — в Telegram, человек выбирает чат сам.
    private func invite(_ group: GroupToday) {
        Task {
            do {
                let link = try await tg.inviteLink(groupId: group.id)
                if let url = Links.telegramShare(link: link, text: "\(group.title) · LifeCommit") { openURL(url) }
                tg.note = TogetherModel.Note(groupId: group.id, text: t.gr.inviteSent)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                groupLog.notice("invite failed: \(String(describing: error), privacy: .public)")
                tg.note = TogetherModel.Note(groupId: group.id, text: t.error)
            }
        }
    }
}

/// Вклад в общую цель: одно число; под полем — «сколько станет из цели».
struct PutSheet: View {
    let item: GroupDayItem
    let onPut: (Double) -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        let n = GroupLogic.number(value)
        SheetBody(title: t.gr.putTitle(item.title)) {
            TextField(t.gr.putPh, text: $value)
                .textFieldStyle(.plain)
                .font(.onest(28, .bold))
                .multilineTextAlignment(.center)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .frame(height: 64)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .focused($focused)
                .onChange(of: value) { _, v in
                    let clean = GroupLogic.numberInput(v)
                    if clean != v { value = clean }
                }
                .accessibilityLabel(t.gr.putPh)
                .accessibilityIdentifier("put.value")
            if n > 0, let target = item.target {
                Text(t.gr.goalOf(t.num((item.total ?? 0) + n), t.num(target)))
                    .font(.onest(14)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 10)
            }
            PrimaryButton(title: t.gr.put, wide: true) {
                onPut(n)
                dismiss()
            }
            .disabled(!(n > 0))
            .opacity(n > 0 ? 1 : 0.4)
            .padding(.top, 16)
            .accessibilityIdentifier("put.done")
        }
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }
}

/// Настройки группы: название (админам), «только админы заводят дела», чат Telegram, выйти, удалить (владельцу).
struct GroupSettingsSheet: View {
    let group: GroupToday
    let onLeft: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var confirm: Confirm?

    enum Confirm: Identifiable {
        case chatOff, leave, delete
        var id: Self { self }
    }

    init(group: GroupToday, onLeft: @escaping () -> Void) {
        self.group = group
        self.onLeft = onLeft
        _title = State(initialValue: group.title)
    }

    private var tg: TogetherModel { model.together }
    /// Свежее состояние группы (переключатели меняются сразу).
    private var live: GroupToday { tg.details[group.id] ?? group }
    private var canManage: Bool { group.role != .member }

    var body: some View {
        SheetBody(title: t.gr.settings) {
            if canManage {
                TextField(t.gr.namePh, text: $title)
                    .textFieldStyle(.plain)
                    .font(.onest(17, .medium))
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .submitLabel(.done)
                    .onSubmit { tg.rename(groupId: group.id, title: title) }
                    .onChange(of: title) { _, v in if v.count > 60 { title = String(v.prefix(60)) } }
                    .accessibilityLabel(t.gr.name)
                    .accessibilityIdentifier("groupSettings.name")
                Toggle(isOn: Binding(get: { live.settings?.adminsOnlyEdit ?? false }, set: { tg.setAdminsOnly(groupId: group.id, $0) })) {
                    Text(t.gr.adminsOnly).font(.onest(16, .medium)).frame(maxWidth: .infinity, alignment: .leading)
                }
                .toggleStyle(.switch)
                .tint(palette.accent)
                .padding(.horizontal, 18)
                .frame(minHeight: 56)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 10)
                .accessibilityIdentifier("groupSettings.adminsOnly")
            } else {
                Text(group.title).font(.onest(16)).foregroundStyle(palette.muted).padding(.horizontal, 4)
            }

            // Чат Telegram: подключённый — строкой с названием, админам — «Другой чат · Отключить»; без чата админам —
            // «Подключить», остальным — ничего (подключают только админы).
            if let chat = live.settings?.tgChatTitle {
                HStack(alignment: .top, spacing: 12) {
                    StrokeGlyph(d: Glyph.telegram).frame(width: 20, height: 20).foregroundStyle(palette.telegramInk)
                        .frame(width: 40, height: 40)
                        .background(Color(hex: 0x2AABEE).opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(t.gr.chatLabel).font(.onest(13)).foregroundStyle(palette.muted)
                        Text(chat).font(.onest(16, .semibold)).accessibilityIdentifier("groupSettings.chatTitle")
                        if canManage {
                            HStack(spacing: 2) {
                                Button(t.gr.chatOther) { connectChat() }.foregroundStyle(palette.accent)
                                Text("·").foregroundStyle(palette.muted).accessibilityHidden(true)
                                Button(t.gr.chatOff) { confirm = .chatOff }.foregroundStyle(palette.warn).accessibilityIdentifier("groupSettings.chatOff")
                            }
                            .buttonStyle(.plain)
                            .font(.onest(14, .semibold))
                            .frame(minHeight: 44)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, canManage ? 4 : 14)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 20)
            } else if canManage {
                Button { connectChat() } label: {
                    Text(t.gr.connectChat).font(.onest(16, .bold)).foregroundStyle(palette.accentSoftText)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(PressScale())
                .padding(.top, 20)
                .accessibilityIdentifier("groupSettings.connectChat")
                Text(t.gr.connectChatHint).font(.onest(14)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.top, 8)
            }

            if tg.settingsFailed == group.id {
                ErrorNote(text: t.error).padding(.top, 12).onTapGesture { tg.clearSettingsFailed() }
            }

            Button(t.gr.leave) { confirm = .leave }
                .buttonStyle(.plain).font(.onest(15)).foregroundStyle(palette.warn)
                .frame(maxWidth: .infinity, minHeight: 48).padding(.top, 20)
                .accessibilityIdentifier("groupSettings.leave")
            if group.role == .owner {
                Button(t.gr.removeGroup) { confirm = .delete }
                    .buttonStyle(.plain).font(.onest(15)).foregroundStyle(palette.danger)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .accessibilityIdentifier("groupSettings.delete")
            }
        }
        .onAppear { tg.clearSettingsFailed() }
        // Закрыли шторку — новое название сохраняется (как onBlur в мини-аппе); запрос идёт в модели, не в шторке.
        .onDisappear { if canManage { tg.rename(groupId: group.id, title: title) } }
        .confirmationDialog(confirmText, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            switch confirm {
            case .chatOff:
                Button(t.gr.chatOff, role: .destructive) { Task { await tg.disconnectChat(groupId: group.id) } }
            case .leave, .delete:
                let remove = confirm == .delete
                Button(remove ? t.gr.removeGroup : t.gr.leave, role: .destructive) { leave(remove: remove) }
            case nil:
                EmptyView()
            }
            Button(t.cancel, role: .cancel) {}
        }
    }

    private var confirmText: String {
        switch confirm {
        case .chatOff: t.gr.chatOffConfirm(live.settings?.tgChatTitle ?? "")
        case .leave: t.gr.leaveConfirm
        case .delete: t.gr.removeConfirm
        case nil: ""
        }
    }

    /// Добавить бота в чат Telegram: тот же код приглашения, но ссылка «в группу» (startgroup).
    private func connectChat() {
        Task {
            do {
                let link = try await tg.inviteLink(groupId: group.id)
                if let url = URL(string: link.replacingOccurrences(of: "?startapp=", with: "?startgroup=")) { openURL(url) }
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                groupLog.notice("chat link failed: \(String(describing: error), privacy: .public)")
                tg.note = TogetherModel.Note(groupId: group.id, text: t.error)
                dismiss()
            }
        }
    }

    /// Выйти или удалить: вышло — назад со экрана группы; сервер не выпустил — шторка закрывается, подсказка на экране.
    private func leave(remove: Bool) {
        Task {
            let ok = await tg.leave(groupId: group.id, remove: remove)
            dismiss()
            if ok { onLeft() }
        }
    }
}
