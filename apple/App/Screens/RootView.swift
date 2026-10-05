// Что на экране: заставка, вход, ошибка загрузки или приложение — как App.tsx (boot.state).
import LifeCommitKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(ThemeChoice.key) private var themeRaw: String = ""

    private var scheme: ColorScheme { ThemeChoice(rawValue: themeRaw)?.scheme ?? systemScheme }

    var body: some View {
        ZStack {
            GlowBackground()
            switch model.phase {
            case .loading:
                SplashView()
            case .signedOut:
                SignInView()
            case .failed:
                LoadErrorView()
            case .ready:
                MainView()
            }
        }
        .environment(\.palette, Palette.of(scheme))
        .environment(\.strings, model.strings)
        .preferredColorScheme(ThemeChoice(rawValue: themeRaw)?.scheme)
        .tint(Palette.of(scheme).accent)
        .font(.onest(16))
        .foregroundStyle(Palette.of(scheme).text)
        .task {
            // Под модульными тестами приложение — только хост: ни входа, ни запросов к серверу.
            if !Config.isUnitTestHost { await model.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Свернули приложение — отложенное удаление уходит на сервер сейчас, а не теряется.
            if phase != .active { model.flushRemoval() }
            if phase == .active { Task { await model.refreshIfStale() } }
        }
    }
}

private struct StringsKey: EnvironmentKey {
    static let defaultValue = Strings.ru
}

extension EnvironmentValues {
    var strings: Strings {
        get { self[StringsKey.self] }
        set { self[StringsKey.self] = newValue }
    }
}

/// Не загрузилось — «Проверьте интернет» и «Ещё раз».
struct LoadErrorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 20) {
            Text(t.loadError)
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
            PrimaryButton(title: t.retry) { Task { await model.load() } }
        }
        .padding(.horizontal, 20)
    }
}

/// Главная кнопка — зелёная, как .act.primary.
struct PrimaryButton: View {
    let title: String
    var wide = false
    var busy = false
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Group {
                if busy {
                    ProgressView().tint(palette.accentText)
                } else {
                    Text(title).font(.onest(17, .bold))
                }
            }
            .frame(minWidth: 64, maxWidth: wide ? .infinity : nil, minHeight: 48)
            .padding(.horizontal, 14)
            .foregroundStyle(palette.accentText)
            .background(palette.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressScale())
        .disabled(busy)
    }
}

/// Нажатие слегка уменьшает кнопку (transform: scale(0.96) в мини-аппе).
struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
