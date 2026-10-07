// Друзья — как Friends.tsx: список во «Вместе» (поиск и «Позвать друга» одной строкой, «Заявки · N», «ждём ответа»),
// «Позвать друга» (ссылка в Telegram, поиск по @username), заявки, экран друга (карта «Месяц · Год», открытые
// привычки), чужая ссылка, «Что показать друзьям?» на весь экран. С другом — только смотреть: реакций нет.
import LifeCommitKit
import os
import SwiftUI

private let friendsLog = Logger(subsystem: "app.lifecommit", category: "friends")

// MARK: Список во «Вместе»

struct FriendsPanel: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var query = ""
    @State private var inviting = false
    @State private var visible = false

    private var tg: TogetherModel { model.together }

    var body: some View {
        @Bindable var tg = model.together
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 10) {
                    StrokeGlyph(d: "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0zM16 16l4.5 4.5").frame(width: 18, height: 18).foregroundStyle(palette.muted)
                    TextField(t.fr.search, text: $query)
                        .textFieldStyle(.plain)
                        .font(.onest(16))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .accessibilityIdentifier("friendSearch")
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .glassCard(radius: 16)
                Button { inviting = true } label: {
                    StrokeGlyph(d: Glyph.plus, lineWidth: 2.4).frame(width: 22, height: 22).foregroundStyle(palette.accent)
                        .frame(width: 48, height: 48)
                        .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(PressScale())
                .accessibilityLabel(t.fr.invite)
                .accessibilityIdentifier("inviteFriend")
            }
            .padding(.top, 14)

            if let data = tg.friends {
                list(data)
            } else if tg.friendsFailed {
                ErrorNote(text: t.error).padding(.top, 16).onTapGesture { Task { await tg.reloadFriends() } }
            }
        }
        // «Что показать друзьям?» — только когда список друзей на экране (как в мини-аппе: спрашивает он, а не заявки).
        .onAppear {
            visible = true
            tg.promptIfNeeded()
        }
        .onDisappear { visible = false }
        .task { await tg.reloadFriends() }
        .onChange(of: tg.friends?.prompt) { _, _ in if visible { tg.promptIfNeeded() } }
        .sheet(isPresented: $inviting) { AddFriendSheet() }
        #if os(iOS)
        .fullScreenCover(isPresented: $tg.showOpen) { ShowSheet() }
        #else
        .sheet(isPresented: $tg.showOpen) { ShowSheet().frame(minWidth: 420, minHeight: 560) }
        #endif
    }

    @ViewBuilder private func list(_ data: FriendsResponse) -> some View {
        let incoming = tg.incoming
        let q = query.trimmingCharacters(in: .whitespaces)
        let shown = FriendsLogic.search(data.friends, query)
        if !incoming.isEmpty {
            Button { model.path.append(.requests) } label: {
                HStack(spacing: 12) {
                    AvatarStack(members: incoming.prefix(3).map(\.person.member), size: 28)
                    Text(t.fr.requests(incoming.count)).font(.onest(16, .bold)).foregroundStyle(palette.text).frame(maxWidth: .infinity, alignment: .leading)
                    StrokeGlyph(d: Glyph.chevron, lineWidth: 2.2).frame(width: 18, height: 18).foregroundStyle(palette.muted)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 60)
                .glassCard()
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScale())
            .padding(.top, 12)
            .accessibilityIdentifier("requestsRow")
        }
        if tg.cancelFailed {
            ErrorNote(text: t.error).padding(.top, 12).onTapGesture { tg.cancelFailed = false }
        }
        if data.friends.isEmpty && data.outgoing.isEmpty {
            Text(t.fr.empty).font(.onest(15)).foregroundStyle(palette.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, 24)
        }
        if !q.isEmpty && shown.isEmpty {
            Text(t.fr.nothingFound).font(.onest(15)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 24)
        }
        VStack(spacing: 10) {
            ForEach(shown) { f in
                FriendRow(friend: f) { model.path.append(.friend(f.id)) }
            }
            if q.isEmpty {
                ForEach(data.outgoing) { p in
                    HStack(spacing: 12) {
                        AvatarView(member: p.member, size: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(p.firstName).font(.onest(16, .bold)).lineLimit(1)
                            Text(t.fr.waiting).font(.onest(13)).foregroundStyle(palette.muted)
                        }
                        Spacer(minLength: 0)
                        Button(t.fr.cancel) { tg.cancelRequest(p.id) }
                            .buttonStyle(.plain).font(.onest(15, .medium)).foregroundStyle(palette.muted)
                            .padding(.horizontal, 8).frame(minHeight: 44)
                            .accessibilityIdentifier("cancel-\(p.firstName)")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .glassCard()
                }
            }
        }
        .padding(.top, 12)
    }
}

/// Друг в списке: имя, общая карта за две недели без названий, «2 из 3» за сегодня.
struct FriendRow: View {
    let friend: FriendCard
    let action: () -> Void
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                AvatarView(member: friend.person.member, size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(friend.firstName).font(.onest(16, .bold)).foregroundStyle(palette.text).lineLimit(1)
                    HStack(spacing: 2) {
                        ForEach(Array(friend.days.enumerated()), id: \.offset) { _, score in
                            RoundedRectangle(cornerRadius: 2.5).fill(palette.heat[HeatMap.level(score)]).frame(width: 9, height: 9)
                        }
                    }
                    .accessibilityHidden(true)
                }
                Spacer(minLength: 0)
                if friend.due > 0 {
                    Text(t.fr.progress(friend.done, friend.due)).font(.onest(14, .semibold)).foregroundStyle(friend.done > 0 ? palette.accent : palette.muted)
                }
                StrokeGlyph(d: Glyph.chevron, lineWidth: 2.2).frame(width: 18, height: 18).foregroundStyle(palette.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .glassCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityIdentifier("friend-\(friend.firstName)")
    }
}

// MARK: «Позвать друга»

struct AddFriendSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @State private var name = ""
    @State private var found: FoundPerson?
    @State private var problem: String?
    @State private var busy = false

    private var tg: TogetherModel { model.together }

    var body: some View {
        SheetBody(title: t.fr.invite) {
            let link = tg.friends?.link ?? ""
            PrimaryButton(title: t.fr.sendLink, wide: true) {
                if let url = Links.telegramShare(link: link, text: t.fr.shareText) { openURL(url) }
            }
            .disabled(link.isEmpty)
            .opacity(link.isEmpty ? 0.4 : 1)
            .accessibilityIdentifier("sendLink")
            TextField(t.fr.usernamePh, text: $name)
                .textFieldStyle(.plain)
                .font(.onest(17, .medium))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .submitLabel(.search)
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 10)
                .accessibilityIdentifier("findUsername")
            if let problem { Text(problem).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4).padding(.top, 12) }
            if let found {
                HStack(spacing: 12) {
                    AvatarView(member: found.person.member, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(found.person.firstName).font(.onest(16, .bold))
                        if let u = found.person.username { Text("@\(u)").font(.onest(13)).foregroundStyle(palette.muted) }
                    }
                    Spacer(minLength: 0)
                    if found.status == .none || found.status == .incoming {
                        PrimaryButton(title: t.fr.call, busy: busy) { call(found.person) }
                            .accessibilityIdentifier("callFriend")
                    } else {
                        Text(t.fr.status[found.status] ?? "").font(.onest(14)).foregroundStyle(palette.muted)
                    }
                }
                .padding(4)
                .padding(.top, 12)
            }
        }
        .task { if tg.friends == nil { await tg.reloadFriends() } }
        // Ищем, когда перестали печатать (400 мс).
        .task(id: name) {
            found = nil
            problem = nil
            let clean = name.trimmingCharacters(in: .whitespaces)
            guard FriendsLogic.searchable(clean) else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            do {
                let result = try await tg.findPerson(clean)
                if !Task.isCancelled { found = result }
            } catch is CancellationError {
                // Печатают дальше — этот поиск уже не нужен.
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                guard !Task.isCancelled else { return }
                // «Такого нет» — только когда сервер так и сказал (404); сеть или сбой — «что-то пошло не так».
                let api = error as? APIError
                if api?.code != "bad_username" && api?.status != 404 {
                    friendsLog.notice("find person failed: \(String(describing: error), privacy: .public)")
                }
                problem = api?.code == "bad_username" ? t.fr.badUsername : api?.status == 404 ? t.fr.notFound : t.error
            }
        }
    }

    private func call(_ person: Person) {
        busy = true
        Task {
            do {
                let status = try await tg.request(username: person.username ?? name)
                found = FoundPerson(person: person, status: status)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                friendsLog.notice("friend request failed: \(String(describing: error), privacy: .public)")
                problem = t.error
            }
            busy = false
        }
    }
}

// MARK: Заявки

struct RequestsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    private var tg: TogetherModel { model.together }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackBar().padding(.top, 8)
                PageHead(title: t.fr.requestsTitle)
                if tg.answerFailed {
                    ErrorNote(text: t.error).padding(.top, 12).onTapGesture { tg.answerFailed = false }
                }
                if tg.incoming.isEmpty {
                    Text(t.fr.nothingFound).font(.onest(15)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 24)
                }
                VStack(spacing: 10) {
                    ForEach(tg.incoming) { p in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 12) {
                                AvatarView(member: p.person.member, size: 44)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(p.firstName).font(.onest(16, .bold))
                                    let sub = p.via == .link ? t.fr.viaLink : p.username.map { "@\($0)" } ?? ""
                                    if !sub.isEmpty { Text(sub).font(.onest(13)).foregroundStyle(palette.muted) }
                                }
                            }
                            HStack(spacing: 8) {
                                PrimaryButton(title: t.fr.accept, wide: true) { tg.answer(p.id, accept: true) }
                                    .accessibilityIdentifier("accept-\(p.firstName)")
                                Button { tg.answer(p.id, accept: false) } label: {
                                    Text(t.fr.decline).font(.onest(17, .bold)).foregroundStyle(palette.text)
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .background(palette.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                }
                                .buttonStyle(PressScale())
                                .accessibilityIdentifier("decline-\(p.firstName)")
                            }
                        }
                        .padding(14)
                        .glassCard()
                    }
                }
                .padding(.top, 16)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task { await tg.reloadFriends() }
    }
}

// MARK: Экран друга

struct FriendView: View {
    let friendId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var view = "month"
    @State private var offset = 0
    @State private var confirm: Bool?
    @State private var leaveFailed = false

    private var tg: TogetherModel { model.together }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackBar().padding(.top, 8)
                if tg.missingFriends.contains(friendId) {
                    Text(t.fr.linkNotFound).font(.onest(15)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 48)
                } else if let f = tg.profiles[friendId] {
                    content(f)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task { await tg.loadFriend(friendId) }
        .confirmationDialog(confirmText, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if let block = confirm {
                Button(block ? t.fr.block : t.fr.remove, role: .destructive) { leave(block: block) }
            }
            Button(t.cancel, role: .cancel) {}
        }
    }

    private var confirmText: String {
        let name = tg.profiles[friendId]?.person.firstName ?? ""
        return confirm == true ? t.fr.blockConfirm(name) : t.fr.removeConfirm(name)
    }

    @ViewBuilder private func content(_ f: FriendProfile) -> some View {
        HStack(spacing: 14) {
            AvatarView(member: f.person.member, size: 64)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.person.firstName).font(.onest(26, .bold, relativeTo: .title)).tracking(-0.5).accessibilityAddTraits(.isHeader)
                if let u = f.person.username { Text("@\(u)").font(.onest(14)).foregroundStyle(palette.muted) }
            }
        }
        .padding(.top, 20)

        HeatCard(days: f.heat, today: f.today, view: $view, offset: $offset).padding(.top, 16)

        SectionLabel(text: t.fr.habits).padding(.horizontal, 4).padding(.top, 24).padding(.bottom, 8)
        if f.habits.isEmpty {
            Text(t.fr.noShown).font(.onest(15)).foregroundStyle(palette.muted).frame(maxWidth: .infinity).padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(f.habits.enumerated()), id: \.element.id) { index, h in
                    if index > 0 { Divider().overlay(palette.line) }
                    let note = FriendsLogic.habitNote(h, strings: t)
                    HStack(spacing: 12) {
                        KindTile(kind: h.kind, title: h.title, size: .sm)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(h.title).font(.onest(16, .bold))
                            if let text = note.text {
                                Text(text).font(.onest(13, note.done ? .semibold : .regular)).foregroundStyle(note.done ? palette.accent : palette.muted)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .frame(minHeight: 60)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.vertical, 4)
            .glassCard()
        }

        if leaveFailed { ErrorNote(text: t.error).padding(.top, 16).onTapGesture { leaveFailed = false } }
        HStack(spacing: 12) {
            Button(t.fr.remove) { confirm = false }.foregroundStyle(palette.muted).accessibilityIdentifier("removeFriend")
            Button(t.fr.block) { confirm = true }.foregroundStyle(palette.warn).accessibilityIdentifier("blockFriend")
        }
        .buttonStyle(.plain)
        .font(.onest(15))
        .frame(maxWidth: .infinity, minHeight: 48)
        .padding(.top, 20)
    }

    private func leave(block: Bool) {
        leaveFailed = false
        Task {
            if await tg.leaveFriend(friendId, block: block) {
                dismiss()
            } else {
                leaveFailed = true
            }
        }
    }
}

// MARK: Открыли чужую ссылку

struct FriendLinkView: View {
    let code: String
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var who: FoundPerson?
    @State private var missing = false
    @State private var busy = false

    /// who — уже известный хозяин ссылки (снимки экранов); в приложении экран читает его сам.
    init(code: String, who: FoundPerson? = nil) {
        self.code = code
        _who = State(initialValue: who)
    }

    private var tg: TogetherModel { model.together }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                BackBar().padding(.top, 8)
                if missing {
                    Text(t.fr.linkNotFound).font(.onest(15)).foregroundStyle(palette.muted).padding(.top, 64)
                    PrimaryButton(title: t.fr.later) { dismiss() }.padding(.top, 20)
                } else if let who {
                    content(who)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task {
            guard who == nil else { return }
            do {
                who = try await tg.friendLink(code: code)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                friendsLog.notice("friend link failed: \(String(describing: error), privacy: .public)")
                missing = true
            }
        }
    }

    @ViewBuilder private func content(_ who: FoundPerson) -> some View {
        let name = who.person.firstName
        let line: String = switch who.status {
        case .sent: t.fr.linkSent(name)
        case .friends: t.fr.linkFriends
        case .self: t.fr.linkSelf
        case .blocked: t.fr.linkBlocked
        case .none, .incoming: t.fr.linkSub
        }
        VStack(spacing: 0) {
            AvatarView(member: who.person.member, size: 88)
            Text(who.status == .self ? name : t.fr.linkTitle(name))
                .font(.onest(26, .bold, relativeTo: .title)).tracking(-0.5).multilineTextAlignment(.center).padding(.top, 16)
            Text(line).font(.onest(15)).foregroundStyle(palette.muted).multilineTextAlignment(.center).padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        if who.status == .none || who.status == .incoming {
            PrimaryButton(title: t.fr.linkBtn, wide: true, busy: busy) { ask(who) }.padding(.top, 24).accessibilityIdentifier("wantFriend")
        } else {
            PrimaryButton(title: t.fr.open, wide: true) {
                if who.status == .friends || who.status == .sent {
                    // К друзьям: вкладка «Вместе», раздел «Друзья».
                    UserDefaults.standard.set("friends", forKey: "lc-together")
                    model.tab = .groups
                    model.path = []
                } else {
                    dismiss()
                }
            }
            .padding(.top, 24)
        }
        Button(t.fr.later) { dismiss() }
            .buttonStyle(.plain).font(.onest(15)).foregroundStyle(palette.muted).frame(minHeight: 48).padding(.top, 12)
    }

    private func ask(_ who: FoundPerson) {
        busy = true
        Task {
            do {
                let status = try await tg.request(code: code)
                self.who = FoundPerson(person: who.person, status: status)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                friendsLog.notice("friend request by link failed: \(String(describing: error), privacy: .public)")
                missing = true
            }
            busy = false
        }
    }
}

// MARK: «Что показать друзьям?»

/// На весь экран: плитки привычек, тап выбирает; «Выбрать все» — обязательно (правило владелицы). «Назад» — ничего не
/// меняем (служебное «уже спросили»).
struct ShowSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var picked: Set<Int> = []

    private var habits: [TodayTask] { model.today.tasks }

    var body: some View {
        let all = !habits.isEmpty && picked.count == habits.count
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button { model.together.saveShown(nil) } label: {
                    HStack(spacing: 4) {
                        StrokeGlyph(d: "M15 6l-6 6 6 6", lineWidth: 2.2).frame(width: 18, height: 18)
                        Text(t.back).font(.onest(15, .medium))
                    }
                    .foregroundStyle(palette.accent)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("showBack")
                Spacer()
            }
            HStack(alignment: .center, spacing: 12) {
                Text(t.fr.showTitle).font(.onest(26, .bold, relativeTo: .title)).tracking(-0.5).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if !habits.isEmpty {
                    Button(t.fr.selectAll) { picked = all ? [] : Set(habits.map(\.id)) }
                        .buttonStyle(.plain)
                        .font(.onest(15, .semibold))
                        .foregroundStyle(all ? palette.muted : palette.accent)
                        .frame(minHeight: 44)
                        .accessibilityAddTraits(all ? .isSelected : [])
                        .accessibilityIdentifier("selectAll")
                }
            }
            .padding(.top, 8)
            ScrollView {
                // Плитки одного ряда — одной высоты (сетка мини-аппа растягивает их по ряду).
                Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                    ForEach(Array(stride(from: 0, to: habits.count, by: 2)), id: \.self) { i in
                        GridRow {
                            tile(habits[i])
                            if i + 1 < habits.count { tile(habits[i + 1]) } else { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                        }
                    }
                }
                .padding(.horizontal, 2)
                .padding(.vertical, 4)
            }
            .scrollContentBackground(.hidden)
            .padding(.top, 16)
            if model.together.showFailed != nil { ErrorNote(text: t.error).padding(.top, 8) }
            PrimaryButton(title: t.done, wide: true) { model.together.saveShown(Array(picked)) }
                .padding(.top, 12)
                .accessibilityIdentifier("showDone")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 16)
        .background(palette.bg.ignoresSafeArea())
        .onAppear {
            picked = Set(model.together.showFailed ?? habits.filter { $0.visibility == .friends }.map(\.id))
        }
    }

    private func tile(_ h: TodayTask) -> some View {
        let on = picked.contains(h.id)
        return Button {
            if on { picked.remove(h.id) } else { picked.insert(h.id) }
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                KindTile(kind: h.kind, title: h.title)
                Text(h.title).font(.onest(16, .semibold)).foregroundStyle(palette.text).multilineTextAlignment(.leading)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 112, maxHeight: .infinity, alignment: .topLeading)
            .glassCard()
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(on ? palette.accent : .clear, lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                ZStack {
                    Circle().strokeBorder(on ? .clear : palette.text.opacity(0.25), lineWidth: 2).background(Circle().fill(on ? palette.accent : .clear))
                    StrokeGlyph(d: Glyph.check, lineWidth: 3).frame(width: 14, height: 14).foregroundStyle(on ? palette.accentText : .clear)
                }
                .frame(width: 24, height: 24)
                .padding(12)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("show-\(h.title)")
    }
}
