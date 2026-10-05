// Вход — как экран входа на компьютере (src/desktop/Login.tsx): знак, название, «Войти через Telegram».
// Сам вход — официальный вход Telegram (TelegramOAuth в LifeCommitKit): есть приложение Telegram на iPhone — через него,
// нет (или Mac) — страница Telegram в системном листе входа.
import AuthenticationServices
import LifeCommitKit
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.webAuthenticationSession) private var webAuth
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 20) {
            Logo(cell: 24, gap: 8, padding: 14, radius: 26, cellRadius: 7)
            Text("Life\(Text("Commit").foregroundStyle(palette.accent))")
                .font(.onest(26, .bold))
                .tracking(-0.52)
            Text(t.signInSub)
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            if let error = model.signInError {
                ErrorNote(text: error)
                    .frame(maxWidth: 360)
            }
            Button {
                Task { await signIn() }
            } label: {
                HStack(spacing: 8) {
                    if model.signingIn {
                        ProgressView().tint(palette.accentText)
                    } else {
                        StrokeGlyph(d: "M21 4L3 11l6 2.5L19 7l-7.5 8L18 20l3-16z", lineWidth: 2.2).frame(width: 20, height: 20)
                        Text(t.signIn).font(.onest(17, .bold))
                    }
                }
                .frame(maxWidth: 360, minHeight: 48)
                .foregroundStyle(palette.accentText)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(PressScale())
            .disabled(model.signingIn)
            .accessibilityIdentifier("signIn")
        }
        .padding(.horizontal, 20)
        .onOpenURL { url in
            // Вернулись из приложения Telegram: lifecommit://tglogin?code=…
            guard url.scheme == TelegramOAuth.callbackScheme, let pending = model.takeTelegramPending() else { return }
            Task { await finish(callback: url, pkce: pending.pkce, clientId: pending.clientId) }
        }
    }

    private func signIn() async {
        model.beginSignIn()
        let clientId: String
        do {
            clientId = try await model.api.telegramLoginConfig().clientId
        } catch {
            model.signInFailed(t.signInFailed)
            return
        }
        let pkce = TelegramOAuth.PKCE.random()
        #if os(iOS)
        if let tg = URL(string: "tg://resolve"), UIApplication.shared.canOpenURL(tg),
           let link = await TelegramOAuth.crossAppLink(session: .shared, clientId: clientId, pkce: pkce) {
            model.handOffToTelegram(.init(pkce: pkce, clientId: clientId))
            openURL(link)
            return
        }
        #endif
        do {
            let callback = try await webAuth.authenticate(
                using: TelegramOAuth.authURL(clientId: clientId, pkce: pkce),
                callbackURLScheme: TelegramOAuth.callbackScheme,
                preferredBrowserSession: .shared
            )
            await finish(callback: callback, pkce: pkce, clientId: clientId)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // Закрыли лист входа — просто вернулись к кнопке.
            model.signInFailed(nil)
        } catch {
            model.signInFailed(t.signInFailed)
        }
    }

    private func finish(callback: URL, pkce: TelegramOAuth.PKCE, clientId: String) async {
        do {
            let code = try TelegramOAuth.code(from: callback)
            let idToken = try await TelegramOAuth.exchange(session: .shared, code: code, clientId: clientId, pkce: pkce)
            await model.finishSignIn(idToken: idToken)
        } catch TelegramOAuth.Failure.cancelled {
            model.signInFailed(nil)
        } catch {
            model.signInFailed(t.signInFailed)
        }
    }
}

/// Плашка ошибки — терракотовая, как .error в мини-аппе.
struct ErrorNote: View {
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        Text(text)
            .font(.onest(14))
            .foregroundStyle(palette.warn)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(palette.warnSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
