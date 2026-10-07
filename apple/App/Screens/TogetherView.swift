// Вкладка «Вместе» — как Groups.tsx: «Группы · Друзья» (последний выбор помним на устройстве, lc-together), группы —
// с прогрессом дня, «Тебе: …» и «Новая группа»; друзья — FriendsPanel.
import LifeCommitKit
import os
import SwiftUI

struct TogetherView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    /// Последний выбор «Группы · Друзья» — на устройстве.
    @AppStorage("lc-together") private var saved = "groups"
    /// Раздел, открытый сразу, мимо запомненного (снимки экранов).
    @State private var opened: String?
    @State private var creating = false

    init(section: String? = nil) {
        _opened = State(initialValue: section)
    }

    private var section: String { opened ?? saved }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                PageHead(title: t.groups)
                Segmented(options: [("groups", t.fr.tabGroups), ("friends", t.fr.tabFriends)], selected: section == "friends" ? "friends" : "groups", label: t.groups, ids: ["together.groups", "together.friends"]) {
                    opened = nil
                    saved = $0
                }
                    .padding(.top, 16)
                if section == "friends" {
                    FriendsPanel()
                } else {
                    groups
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        .refreshable {
            if section == "friends" { await model.together.reloadFriends() } else { await model.together.loadList() }
        }
        .task { await model.together.loadList() }
        .sheet(isPresented: $creating) {
            NewGroupSheet { id in model.path.append(.group(id)) }
        }
    }

    @ViewBuilder private var groups: some View {
        // Список обновляется вместе с «Сегодня»: первым кадром — группы оттуда, свежие — с сервера.
        let list = model.together.list ?? model.today.groups
        let me = model.user?.id ?? 0
        if model.together.list != nil && list.isEmpty {
            Text(t.gr.empty).font(.onest(15)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.top, 24)
        }
        VStack(spacing: 12) {
            ForEach(list) { group in
                GroupCard(group: group, me: me) { model.path.append(.group(group.id)) }
            }
            Button { creating = true } label: {
                HStack(spacing: 8) {
                    StrokeGlyph(d: Glyph.plus, lineWidth: 2.4).frame(width: 18, height: 18)
                    Text(t.gr.newGroup).font(.onest(16, .semibold))
                }
                .foregroundStyle(palette.accent)
                .frame(maxWidth: .infinity, minHeight: 52)
                .glassCard(radius: 16)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(palette.accent.opacity(0.4), lineWidth: 1.5))
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScale())
            .accessibilityIdentifier("group.new")
        }
        .padding(.top, 20)
    }
}

/// Карточка группы в списке: значок, название, сколько людей, аватарки; прогресс дня, цель, «Тебе: …».
struct GroupCard: View {
    let group: GroupToday
    let me: Int
    let action: () -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        let mine = GroupLogic.forYou(group, me: me)
        let goal = group.items.first { $0.mode == .goal }
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    GroupBadge(id: group.id, title: group.title)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.title).font(.onest(17, .bold)).foregroundStyle(palette.text).lineLimit(2)
                        Text(t.gr.people(group.members.count)).font(.onest(13)).foregroundStyle(palette.muted)
                    }
                    Spacer(minLength: 0)
                    AvatarStack(members: group.members)
                }
                if group.planned > 0 {
                    HStack(spacing: 10) {
                        GoalBar(value: Double(group.done) / Double(group.planned))
                        Text(t.gr.progress(group.done, group.planned)).font(.onest(14, .bold)).foregroundStyle(palette.text)
                    }
                }
                if let goal, let target = goal.target {
                    Text(t.gr.goalOf("\(goal.title): \(t.num(goal.total ?? 0))", t.num(target))).font(.onest(13)).foregroundStyle(palette.muted)
                }
                if let mine { Text(t.gr.forYou(mine.title)).font(.onest(13)).foregroundStyle(palette.muted) }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityIdentifier("group.card")
    }
}

/// Новая группа: только название — тип не нужен, значок и цвет берутся из самой группы.
struct NewGroupSheet: View {
    let onCreated: (Int) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var busy = false
    @State private var failed = false
    @FocusState private var focused: Bool

    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        SheetBody(title: t.gr.newGroup) {
            TextField(t.gr.namePh, text: $title)
                .textFieldStyle(.plain)
                .font(.onest(17, .medium))
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .focused($focused)
                .submitLabel(.done)
                .onSubmit { if valid && !busy { create() } }
                .onChange(of: title) { _, v in if v.count > 60 { title = String(v.prefix(60)) } }
                .accessibilityIdentifier("groupNew.title")
            if failed { ErrorNote(text: t.error).padding(.top, 10) }
            PrimaryButton(title: t.gr.create, wide: true, busy: busy) { create() }
                .disabled(!valid)
                .opacity(valid ? 1 : 0.4)
                .padding(.top, 16)
                .accessibilityIdentifier("groupNew.create")
        }
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private func create() {
        busy = true
        failed = false
        Task {
            do {
                let id = try await model.together.create(title: title)
                dismiss()
                onCreated(id)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                Logger(subsystem: "app.lifecommit", category: "group").notice("create group failed: \(String(describing: error), privacy: .public)")
                failed = true
                busy = false
            }
        }
    }
}
