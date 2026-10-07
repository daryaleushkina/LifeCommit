// Вступление по приглашению — как Join.tsx (дизайн 16R): кто зовёт, кто уже в группе, что будет, что группа НЕ видит.
// Открывается ссылкой lifecommit://join/<код> со страницы приглашения (и lifecommit.app/j/<код>, когда настроят
// universal links).
import LifeCommitKit
import os
import SwiftUI

struct JoinView: View {
    let code: String
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var inv: Invitation?
    @State private var problem: String?
    @State private var busy = false

    /// invitation — уже известное приглашение (снимки экранов); в приложении экран читает его сам.
    init(code: String, invitation: Invitation? = nil) {
        self.code = code
        _inv = State(initialValue: invitation)
    }

    private var j: GroupStrings.Join { t.gr.join }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                BackBar().padding(.top, 8)
                if let problem {
                    Text(problem).font(.onest(15)).foregroundStyle(palette.muted).multilineTextAlignment(.center).padding(.top, 64)
                        .accessibilityIdentifier("join.problem")
                    PrimaryButton(title: j.later) { dismiss() }.padding(.top, 20)
                } else if let inv {
                    content(inv)
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
            guard inv == nil else { return }
            do {
                inv = try await model.together.invitation(code: code)
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                Logger(subsystem: "app.lifecommit", category: "group").notice("invitation failed: \(String(describing: error), privacy: .public)")
                problem = (error as? APIError)?.code == "invite_expired" ? j.expired : j.notFound
            }
        }
    }

    @ViewBuilder private func content(_ inv: Invitation) -> some View {
        VStack(spacing: 0) {
            GroupBadge(id: inv.group.id, title: inv.group.title, size: 96)
            Text(inv.inviter.map(j.invites) ?? j.invitesAnon).font(.onest(15)).foregroundStyle(palette.muted).padding(.top, 16)
            Text(inv.group.title).font(.onest(26, .bold, relativeTo: .title)).tracking(-0.5).multilineTextAlignment(.center).padding(.top, 4)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                AvatarStack(members: inv.members.prefix(4).map { GroupMember(id: $0.id, name: $0.name) }, size: 28)
                Text(inv.members.map(\.name).joined(separator: ", ")).font(.onest(15)).foregroundStyle(palette.muted).lineLimit(2)
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)

        SectionLabel(text: j.what).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4).padding(.top, 28).padding(.bottom, 8)
        VStack(spacing: 0) {
            point(Glyph.check, j.p1, j.p1s)
            Divider().overlay(palette.line)
            point("M21 4L3 11l6 2.5L19 7l-7.5 8L18 20l3-16z", j.p2, j.p2s)
            Divider().overlay(palette.line)
            point("M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v10h-13z", j.p3, j.p3s)
        }
        .glassCard()

        if inv.member {
            PrimaryButton(title: j.open, wide: true) { model.path = [.group(inv.group.id)] }.padding(.top, 24)
        } else {
            PrimaryButton(title: j.btn, wide: true, busy: busy) { join() }.padding(.top, 24).accessibilityIdentifier("join.join")
        }
        Button(inv.member ? j.already : j.later) { dismiss() }
            .buttonStyle(.plain).font(.onest(15)).foregroundStyle(palette.muted).frame(minHeight: 48).padding(.top, 12)
    }

    private func point(_ icon: String, _ title: String, _ sub: String) -> some View {
        HStack(spacing: 12) {
            StrokeGlyph(d: icon, lineWidth: 2.2).frame(width: 22, height: 22).foregroundStyle(palette.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.onest(16))
                Text(sub).font(.onest(13)).foregroundStyle(palette.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    /// Вступить: экран группы — сразу целиком, вместо экрана приглашения.
    private func join() {
        busy = true
        Task {
            do {
                let id = try await model.together.join(code: code)
                model.path = [.group(id)]
            } catch {
                if (error as? APIError)?.isSignedOut == true { return model.signOutLocally() }
                Logger(subsystem: "app.lifecommit", category: "group").notice("join failed: \(String(describing: error), privacy: .public)")
                problem = (error as? APIError)?.code == "invite_expired" ? j.expired : j.notFound
            }
            busy = false
        }
    }
}
