// Приложение после входа: вкладки с нижней панелью и переходы на экраны без неё (редактор, «Чего я хочу?»,
// «Отложенные») — как маршруты App.tsx. Переходы — системный стек: свайп от края работает как в iOS.
import LifeCommitKit
import os
import SwiftUI

struct MainView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @State private var voiceOpen = false

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            Group {
                if model.onboarding {
                    OnboardingView(onSkip: { model.skipOnboarding() })
                } else {
                    tabs
                }
            }
            // Стек навигации рисует свой сплошной фон — под каждым экраном ставим наш (пятна стоят на месте).
            .background { GlowBackground() }
            .navigationDestination(for: AppModel.Route.self) { route in
                Group {
                    switch route {
                    case .pick:
                        OnboardingView(onSkip: nil)
                    case .newTask(let kind):
                        TaskEditorView(task: nil, kind: kind)
                    case .editTask(let id):
                        TaskEditorView(task: model.today.tasks.first { $0.id == id }, kind: .check)
                    case .detail(let id):
                        TaskDetailView(taskId: id)
                    case .archive:
                        ArchiveView()
                    case .group(let id):
                        GroupView(groupId: id)
                    case .join(let code):
                        JoinView(code: code)
                    case .requests:
                        RequestsView()
                    case .friend(let id):
                        FriendView(friendId: id)
                    case .friendLink(let code):
                        FriendLinkView(code: code)
                    }
                }
                .background(GlowBackground())
            }
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        .overlay(alignment: .bottom) { UndoToast().padding(.bottom, model.onboarding || !model.path.isEmpty ? 24 : 104) }
    }

    private var tabs: some View {
        @Bindable var model = model
        return ZStack {
            switch model.tab {
            case .today: TodayView()
            case .calendar: CalendarView()
            case .groups: TogetherView()
            case .me: ProfilePendingView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            TabBar(tab: $model.tab) { voiceOpen = true }
        }
        .sheet(isPresented: $voiceOpen) { VoiceSoonSheet() }
    }
}

/// Шапка экрана: крупный заголовок и подпись под ним (.page-head).
struct PageHead: View {
    let title: String
    var subtitle: String?
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.onest(30, .bold, relativeTo: .largeTitle))
                .tracking(-0.6)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle).font(.onest(15, relativeTo: .subheadline)).foregroundStyle(palette.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 24)
        .padding(.horizontal, 4)
    }
}

/// «Назад» для экранов без нижней панели: свой вид (как кнопка Telegram над мини-аппом), жест от края — системный.
struct BackBar: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @Environment(\.strings) private var t

    var body: some View {
        Button {
            dismiss()
        } label: {
            HStack(spacing: 4) {
                StrokeGlyph(d: "M15 6l-6 6 6 6", lineWidth: 2.2).frame(width: 18, height: 18)
                Text(t.back).font(.onest(15, .medium))
            }
            .foregroundStyle(palette.accent)
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .glassCard(radius: 18)
        }
        .buttonStyle(PressScale())
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("nav.back")
    }
}

/// Раздел ещё не перенесён (docs/parity.md — «ждёт»): пока он в мини-аппе, с теми же данными.
struct PendingTabView: View {
    let title: String
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHead(title: title)
                VStack(alignment: .leading, spacing: 14) {
                    Text(t.pendingSection).foregroundStyle(palette.muted)
                    PrimaryButton(title: t.openInTelegram, wide: true) {
                        openURL(URL(string: "https://t.me/LifeCommit_bot?startapp")!)
                    }
                }
                .padding(18)
                .glassCard()
            }
            .padding(.horizontal, 20)
        }
        .scrollContentBackground(.hidden)
    }
}

/// «Я» до переноса раздела: то же, что у временных вкладок, и «Выйти на этом устройстве».
struct ProfilePendingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var confirm = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PendingTabView(title: model.user?.firstName ?? t.me)
                    .scrollDisabled(true)
                    .frame(minHeight: 260)
                Button(t.logoutDevice) { confirm = true }
                    .font(.onest(15))
                    .foregroundStyle(palette.warn)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .accessibilityIdentifier("me.logout")
            }
        }
        .confirmationDialog(t.logoutDeviceConfirm, isPresented: $confirm, titleVisibility: .visible) {
            Button(t.logoutOk, role: .destructive) {
                Task {
                    // Сервер забывает ключ; не вышло (нет связи) — всё равно выходим здесь, ключ истечёт сам.
                    do {
                        try await model.api.signOutHere()
                    } catch {
                        Logger(subsystem: "app.lifecommit", category: "model").notice("sign out on server failed: \(String(describing: error), privacy: .public)")
                    }
                    model.signOutLocally()
                }
            }
            Button(t.cancel, role: .cancel) {}
        }
    }
}

/// Микрофон до переноса голоса: сказать то же самое боту.
struct VoiceSoonSheet: View {
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(t.voiceMic).font(.onest(22, .bold))
            Text(t.voiceSoon).foregroundStyle(palette.muted)
            PrimaryButton(title: t.openBot, wide: true) {
                openURL(URL(string: "https://t.me/LifeCommit_bot")!)
                dismiss()
            }
        }
        .padding(20)
        .presentationDetents([.height(260)])
        .presentationBackground(palette.surface)
        .presentationCornerRadius(24)
    }
}

/// «Удалено · Вернуть» — 5 секунд внизу поверх любого экрана; сервер не удалил — «Что-то пошло не так».
struct UndoToast: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if let removal = model.removal {
                toast(removal.text) {
                    Button {
                        model.undoRemoval()
                    } label: {
                        HStack(spacing: 6) {
                            StrokeGlyph(d: Glyph.undo, lineWidth: 2.2).frame(width: 16, height: 16)
                            Text(t.swipe.undo).font(.onest(15, .semibold))
                        }
                        .padding(.horizontal, 14)
                        .frame(height: 40)
                        .background(palette.bg.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("undo")
                }
            } else if model.removalFailed {
                toast(model.removalFailedText ?? t.error) { EmptyView() }
                    .onTapGesture { model.dismissRemovalError() }
            }
        }
        .animation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.2), value: model.removal)
        .animation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.2), value: model.removalFailed)
    }

    private func toast<Trailing: View>(_ text: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 10) {
            Text(text).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .font(.onest(15))
        .foregroundStyle(palette.bg)
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .background(palette.text.opacity(0.92), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.2), radius: 15, y: 10)
        .padding(.horizontal, 16)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .contain)
    }
}
