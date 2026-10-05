// Шторка «Календари» — как CalendarsSheet.tsx: Google и Apple. Google подключается входом Google в системном окне входа
// (ASWebAuthenticationSession): сервер возвращает его ссылкой lifecommit://calendars?status=… (docs/mobile.md), после
// чего человек выбирает, какие календари забирать. Apple — паролем приложения: объясняем по шагам, основной пароль не
// просим. Подключённый показывает, когда обновлялся, что забирать, куда писать наши дела, и даёт отключить; перестал
// пускать — просит подключить заново.
import AuthenticationServices
import LifeCommitKit
import SwiftUI

struct CalendarsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var appleOpen = false
    @State private var googleBusy = false

    var body: some View {
        let c = t.cal
        let accounts = model.accounts
        let apple = accounts?.first { $0.provider == .apple }
        let google = accounts?.first { $0.provider == .google }
        // Новые дела пишутся в подключённый последним (список приходит по порядку подключения).
        let destination = accounts?.last { $0.status == .ok && $0.defaultUrl != nil }

        SheetBody(title: c.sheetTitle) {
            Text(c.sheetHint).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4)
            if let notice = model.calendarNotice {
                ErrorNote(text: notice).padding(.top, 10).onTapGesture { model.calendarNotice = nil }
            }

            ProviderRow(mark: "G", provider: .google, title: c.google, subtitle: google.map { status($0) } ?? (accounts == nil ? nil : model.googleUnavailable ? nil : c.googleNeeds)) {
                if accounts != nil && google == nil {
                    if model.googleUnavailable {
                        Text(c.googleSoon).font(.onest(13)).foregroundStyle(palette.muted)
                    } else {
                        ProviderButton(title: c.connect, busy: googleBusy) { Task { await signInGoogle() } }
                            .accessibilityIdentifier("connectGoogle")
                    }
                }
            }
            .opacity(google == nil && model.googleUnavailable ? 0.6 : 1)
            if accounts != nil && google == nil && !model.googleUnavailable {
                Text(c.googleUnverified).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4).padding(.top, 10)
            }
            if let google, google.status == .authFailed || google.status == .error {
                Warn(text: c.googleExpired, link: c.reconnect) { Task { await signInGoogle() } }
            }
            if let google, google.status == .setup {
                GoogleSetupView(account: google)
            } else if let google {
                AccountSettingsView(account: google, name: c.google, isDestination: destination?.id == google.id)
            }

            ProviderRow(mark: "A", provider: .apple, title: c.apple, subtitle: accounts == nil ? nil : apple.map { $0.status == .ok ? status($0) : $0.login } ?? c.appleNeeds) {
                if accounts != nil && apple == nil {
                    ProviderButton(title: c.connect, busy: false) { appleOpen = true }
                        .accessibilityIdentifier("connectApple")
                }
            }
            if let apple, apple.status != .ok {
                Warn(text: c.authFailed, link: c.newPassword) { appleOpen = true }
            }
            if let apple {
                AccountSettingsView(account: apple, name: c.apple, isDestination: destination?.id == apple.id)
            }
        }
        .sheet(isPresented: $appleOpen) { AppleForm(login: apple?.login ?? "") }
        .task { await model.loadAccounts() }
    }

    private func status(_ a: CalendarAccount) -> String {
        switch a.status {
        case .ok: "\(t.cal.connected) · \(CalendarDays.synced(a.lastSyncAt, now: Date(), strings: t.cal))"
        case .setup: t.cal.googleSetup
        case .authFailed, .error: a.login
        }
    }

    /// Вход Google в системном окне: открываем только адрес accounts.google.com (проверяет APIClient), назад — по ссылке
    /// lifecommit://calendars?status=…. Закрыли окно — просто остаёмся в шторке.
    private func signInGoogle() async {
        googleBusy = true
        defer { googleBusy = false }
        model.calendarNotice = nil
        do {
            let url = try await model.api.googleSignInURL()
            let callback = try await webAuth.authenticate(using: url, callbackURLScheme: "lifecommit", preferredBrowserSession: .shared)
            guard let result = GoogleReturn(url: callback) else {
                model.calendarNotice = t.cal.googleFailed
                return
            }
            await model.googleReturned(result)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch let error as APIError where error.code == "calendar_unavailable" {
            model.googleUnavailable = true
        } catch {
            model.fail(error, notice: t.cal.errGoogle)
        }
    }
}

/// Строка провайдера: знак, название, состояние, справа — кнопка (.provider).
private struct ProviderRow<Trailing: View>: View {
    let mark: String
    let provider: CalendarProvider
    let title: String
    let subtitle: String?
    @ViewBuilder let trailing: () -> Trailing
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            Text(mark)
                .font(.onest(17, .bold))
                .foregroundStyle(provider == .google ? palette.outside : palette.text)
                .frame(width: 40, height: 40)
                .background(provider == .google ? palette.outside.opacity(0.16) : palette.heat[0], in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.onest(16, .semibold))
                if let subtitle, !subtitle.isEmpty { Text(subtitle).font(.onest(13)).foregroundStyle(palette.muted) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.top, 10)
    }
}

private struct ProviderButton: View {
    let title: String
    let busy: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().tint(palette.accentText) } else { Text(title).font(.onest(14, .semibold)) }
            }
            .foregroundStyle(palette.accentText)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(palette.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressScale())
        .disabled(busy)
    }
}

/// Предупреждение «перестал пускать» со ссылкой-действием (.cal-warn).
private struct Warn: View {
    let text: String
    let link: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(text)
            Button(link, action: action).underline().buttonStyle(.plain)
        }
        .font(.onest(14))
        .foregroundStyle(palette.warn)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(palette.warnSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.top, 10)
    }
}

/// Какие календари забирать: цвет, название, переключатель.
private struct CollectionToggles: View {
    let account: CalendarAccount
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(account.collections.enumerated()), id: \.element.url) { i, col in
                if i > 0 { Divider().overlay(palette.line) }
                Toggle(isOn: Binding(get: { col.enabled }, set: { on in Task { await model.toggleCollection(account, url: col.url, enabled: on) } })) {
                    HStack(spacing: 10) {
                        Circle().fill(col.color.flatMap(Color.init(css:)) ?? palette.heat[2]).frame(width: 10, height: 10)
                        Text(col.name).font(.onest(16))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                // На Mac по умолчанию — галочка посередине; у нас, как в мини-аппе, переключатель справа.
                .toggleStyle(.switch)
                .tint(palette.accent)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 52)
            }
        }
        .frame(maxWidth: .infinity)
        .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.top, 8)
    }
}

/// Подключённый календарь: куда пишем наши дела (только у того, куда пишем сейчас), что забирать, отключить.
private struct AccountSettingsView: View {
    let account: CalendarAccount
    let name: String
    let isDestination: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var writeToOpen = false
    @State private var confirmOff = false

    var body: some View {
        let writable = account.collections.filter(\.writable)
        if isDestination && !writable.isEmpty {
            SheetRow(label: t.cal.writeTo, value: writable.first { $0.url == account.defaultUrl }?.name ?? "") { writeToOpen = true }
                .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 10)
                .sheet(isPresented: $writeToOpen) {
                    OptionsSheet(title: t.cal.writeTo, options: writable.map { ($0.url, $0.name) }, selected: account.defaultUrl ?? "") { url in
                        Task { await model.setDestination(account, url: url) }
                    }
                }
        }
        if !account.collections.isEmpty {
            SectionLabel(text: t.cal.whatToTake).padding(.horizontal, 4).padding(.top, 16)
            CollectionToggles(account: account)
        }
        Button(t.cal.disconnectOf(name)) { confirmOff = true }
            .buttonStyle(.plain)
            .font(.onest(15, .medium))
            .foregroundStyle(palette.warn)
            .frame(maxWidth: .infinity, minHeight: 48)
            .confirmationDialog(t.cal.disconnectConfirm, isPresented: $confirmOff, titleVisibility: .visible) {
                Button(t.cal.disconnect, role: .destructive) { Task { await model.disconnectCalendar(account.provider) } }
                Button(t.cancel, role: .cancel) {}
            }
            .accessibilityIdentifier("disconnect-\(account.provider.rawValue)")
    }
}

/// Google только что подключили: какие календари забирать. События приходят после «Готово».
private struct GoogleSetupView: View {
    let account: CalendarAccount
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var busy = false
    @State private var failed = false

    var body: some View {
        Text(t.cal.googleChoose).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4).padding(.top, 10)
        CollectionToggles(account: account)
        if failed { ErrorNote(text: t.cal.errGoogle).padding(.top, 10) }
        let any = account.collections.contains(where: \.enabled)
        PrimaryButton(title: busy ? t.cal.connecting : t.done, wide: true, busy: busy) {
            Task {
                busy = true
                failed = false
                failed = !(await model.confirmGoogle(account))
                busy = false
            }
        }
        .disabled(busy || !any)
        .opacity(any ? 1 : 0.4)
        .padding(.top, 14)
        .accessibilityIdentifier("googleDone")
    }
}

/// Подключение Apple: три шага, ссылка на сайт Apple ID, почта и пароль приложения.
struct AppleForm: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var login: String
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    init(login: String) {
        _login = State(initialValue: login)
    }

    private static let appleID = URL(string: "https://account.apple.com/account/manage")!

    private var valid: Bool { login.contains("@") && password.filter { $0 != " " && $0 != "-" }.count >= 12 }

    var body: some View {
        let c = t.cal
        SheetBody(title: c.appleTitle) {
            Text(c.appleHint).font(.onest(14)).foregroundStyle(palette.muted).padding(.horizontal, 4)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(c.appleSteps.enumerated()), id: \.offset) { i, step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(i + 1)").font(.onest(12, .bold)).foregroundStyle(palette.accent)
                            .frame(width: 22, height: 22).background(palette.accentSoft, in: Circle())
                        Text(step).font(.onest(15))
                    }
                }
            }
            .padding(.top, 12)
            Link(destination: Self.appleID) {
                Text("\(c.openAppleId) ↗").font(.onest(15, .medium)).foregroundStyle(palette.accent).frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(.top, 4)
            field(c.appleLogin, text: $login, email: true).accessibilityIdentifier("appleLogin")
            field(c.applePassword, text: $password, email: false).padding(.top, 8).accessibilityIdentifier("applePassword")
            if let error { ErrorNote(text: error).padding(.top, 10) }
            PrimaryButton(title: busy ? c.connecting : c.connect, wide: true, busy: busy) { Task { await submit() } }
                .disabled(busy || !valid)
                .opacity(valid ? 1 : 0.4)
                .padding(.top, 14)
                .accessibilityIdentifier("appleConnect")
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, email: Bool) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(.onest(17, .medium))
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(email ? .emailAddress : .asciiCapable)
            .textContentType(email ? .username : nil)
            #endif
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityLabel(placeholder)
    }

    private func submit() async {
        busy = true
        error = nil
        error = await model.connectApple(login: login.trimmingCharacters(in: .whitespaces), password: password)
        busy = false
        if error == nil { dismiss() }
    }
}

extension Color {
    /// Цвет календаря из CSS «#0b8043» (Links.cssColor); другое — nil.
    init?(css: String) {
        guard let v = Links.cssColor(css) else { return nil }
        self.init(hex: v)
    }
}
