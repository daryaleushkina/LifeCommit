// Шрифт Onest (OFL, App/Resources/Fonts) — как в мини-аппе. Размеры — те же пиксели, что в app.css, но растут вместе
// с системным размером текста (Dynamic Type): «вид — мини-апп, поведение — iOS».
import CoreText
import SwiftUI

enum Typography {
    static let family = "Onest"

    /// Подключить файл шрифта из приложения — один раз при запуске, одинаково на iPhone и Mac.
    static func register() {
        guard let url = Bundle.main.url(forResource: "Onest", withExtension: "ttf") else {
            assertionFailure("Onest.ttf нет в приложении")
            return
        }
        var error: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
            // Уже подключён (повторный запуск в тестах) — не ошибка; иначе — видно в логе, текст будет системным.
            let code = error.map { CFErrorGetCode($0.takeRetainedValue()) }
            if code != CTFontManagerError.alreadyRegistered.rawValue {
                print("Onest не подключился: \(String(describing: code))")
            }
        }
    }
}

extension Font {
    /// Onest этого размера и начертания; растёт вместе с системным размером текста относительно `style`.
    static func onest(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(Typography.family, size: size, relativeTo: style).weight(weight)
    }
}
