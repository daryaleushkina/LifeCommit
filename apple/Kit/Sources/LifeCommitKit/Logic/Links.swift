// Ссылки и цвета, пришедшие снаружи (события Google и Apple, календари): что можно открыть и как показать. Ссылка из
// чужого события — чужой ввод (сервер берёт её из календаря как есть, worker/eventDetails.ts): открываем только http(s)
// с хостом — не javascript:, не tg:, не file:.
import Foundation

public enum Links {
    /// Ссылка события (созвон, «Открыть в Google Календаре»), если её можно открыть.
    public static func external(_ raw: String) -> URL? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespaces)), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host() != nil else { return nil }
        return url
    }

    /// «meet.google.com/abc-defg» — хост без www. и путь, не длиннее 40 знаков (hostOf в TodoSheet.tsx).
    public static func short(_ url: URL) -> String {
        let host = (url.host() ?? "").replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression)
        let path = url.path().count > 1 ? url.path() : ""
        return String((host + path).prefix(40))
    }

    /// Место — в Картах (на iPhone и Mac открывается приложение «Карты»); пустое — без ссылки.
    public static func map(_ place: String) -> URL? {
        let q = place.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return nil }
        var c = URLComponents(string: "https://maps.apple.com/")!
        c.queryItems = [URLQueryItem(name: "q", value: q)]
        return c.url
    }

    /// Цвет календаря «#0b8043» → 0x0B8043; другое — nil (тогда цвет по умолчанию).
    public static func cssColor(_ css: String) -> UInt32? {
        guard css.hasPrefix("#"), css.count == 7 else { return nil }
        return UInt32(css.dropFirst(), radix: 16)
    }

    /// «Поделиться» в Telegram (t.me/share/url), как encodeURIComponent в мини-аппе: «+», «&» и «=» кодируются —
    /// иначе Telegram прочёл бы «+» как пробел.
    public static func telegramShare(link: String, text: String) -> URL? {
        var unreserved = CharacterSet.alphanumerics
        unreserved.insert(charactersIn: "-._~")
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "" }
        return URL(string: "https://t.me/share/url?url=\(enc(link))&text=\(enc(text))")
    }
}
