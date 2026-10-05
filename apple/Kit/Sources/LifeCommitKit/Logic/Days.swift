// Дни — строки YYYY-MM-DD, как на сервере (логический день человека считает сервер). Арифметика — в UTC, чтобы
// переход на летнее время не сдвигал день.
import Foundation

public enum Days {
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = utc
        f.timeZone = utc.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Полдень этого дня в UTC; nil — не дата.
    public static func date(_ day: String) -> Date? {
        guard day.count == 10, let d = parser.date(from: day) else { return nil }
        return utc.date(byAdding: .hour, value: 12, to: d)
    }

    public static func string(_ date: Date) -> String { parser.string(from: date) }

    public static func add(_ day: String, _ n: Int) -> String {
        guard let d = date(day), let next = utc.date(byAdding: .day, value: n, to: d) else { return day }
        return string(next)
    }

    /// Сколько дней от a до b (b − a).
    public static func between(_ a: String, _ b: String) -> Int {
        guard let da = date(a), let db = date(b) else { return 0 }
        return utc.dateComponents([.day], from: da, to: db).day ?? 0
    }

    /// День недели: 0 — понедельник … 6 — воскресенье (как маска weekdays: пн = 1).
    public static func weekdayIndex(_ day: String) -> Int {
        guard let d = date(day) else { return 0 }
        return (utc.component(.weekday, from: d) + 5) % 7
    }

    /// Дата для подписи (полдень этого дня в часовом поясе телефона — чтобы формат не съехал на соседний день).
    public static func localNoon(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar(identifier: .gregorian).date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
}
