// Вкладка «Календарь» и шторка дела — как src/screens/Calendar.tsx, CalendarsSheet.tsx (syncedLabel), TodoSheet.tsx и
// update в src/useTodos.ts: какие дни на экране, точки под днём, «обновлено N мин назад», что уходит на сервер при
// правке дела.
import Foundation

public enum CalendarMode: String, Sendable, CaseIterable {
    case day, month
}

public enum CalendarDays {
    /// Дни на экране: один день или месяц целыми неделями (понедельник слева, до 6 строк).
    public static func range(_ mode: CalendarMode, anchor: String) -> [String] {
        if mode == .day { return [anchor] }
        let month = Months.of(anchor)
        let first = "\(month)-01"
        let last = Days.add("\(Months.shift(month, 1))-01", -1)
        var day = Days.add(first, -Days.weekdayIndex(first))
        var days: [String] = []
        while day <= last || Days.weekdayIndex(day) != 0 {
            days.append(day)
            day = Days.add(day, 1)
        }
        return days
    }

    /// Первый и последний день на экране — промежуток для GET /calendar.
    public static func bounds(_ mode: CalendarMode, anchor: String) -> (from: String, to: String) {
        let days = range(mode, anchor: anchor)
        return (days.first ?? anchor, days.last ?? anchor)
    }

    /// Стрелки: день — на день, месяц — на месяц (выбирается первое число).
    public static func shift(_ mode: CalendarMode, _ selected: String, by n: Int) -> String {
        mode == .day ? Days.add(selected, n) : "\(Months.shift(Months.of(selected), n))-01"
    }

    /// Точки под днём месяца: до трёх несделанных дел; true — событие из календаря (синяя точка).
    public static func dots(_ todos: [Todo], day: String) -> [Bool] {
        todos.filter { $0.day == day && !$0.done }.prefix(3).map { $0.source != nil }
    }

    /// «обновлено 3 мин назад»; ещё не обновлялся — пусто.
    public static func synced(_ lastSyncAt: String?, now: Date, strings: CalendarStrings) -> String {
        guard let lastSyncAt, let at = parseISO(lastSyncAt) else { return "" }
        let minutes = Int(now.timeIntervalSince(at) / 60)
        return strings.synced(minutes < 1 ? strings.justNow : strings.minutesAgo(minutes))
    }

    /// Время сервера (Postgres пишет доли секунды до микросекунд: 09:05:00.123456+00:00). Форматтеры — общие: подпись
    /// «обновлено N мин» считается на каждую перерисовку вкладки, а создавать их дорого. ISO8601DateFormatter
    /// потокобезопасен.
    nonisolated(unsafe) private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let iso = ISO8601DateFormatter()

    static func parseISO(_ s: String) -> Date? {
        isoFraction.date(from: s) ?? iso.date(from: s)
    }
}

/// Правка дела из шторки.
public struct TodoEdit: Sendable, Equatable {
    public var title: String
    public var day: String
    /// «HH:MM» или nil — весь день.
    public var time: String?
    /// Место — только у своих дел; "" — убрать; nil — не трогаем (событие из календаря).
    public var location: String?

    public init(title: String, day: String, time: String?, location: String? = nil) {
        self.title = title
        self.day = day
        self.time = time
        self.location = location
    }

    /// Что уходит в PATCH /todos/:id — только изменённое. День у повторяющегося не меняется (его задаёт повтор).
    public func patch(for todo: Todo) -> [String: JSONValue] {
        var patch: [String: JSONValue] = [:]
        if title != todo.title { patch["title"] = .string(title) }
        if day != todo.day && !todo.recurring { patch["day"] = .string(day) }
        if time != todo.time { patch["time"] = .optional(time) }
        if let location, location != (todo.details?.location ?? "") { patch["location"] = .string(location) }
        return patch
    }

    /// Шторка открывается с этим днём. carried — открыли с «Сегодня»: там дело со вчера переехало, и открывается
    /// сегодняшним (прошлым днём его уже не поставить). Во вкладке «Календарь» прошлый день остаётся своим — иначе любая
    /// правка (опечатка в названии) тихо переносила бы старое дело на сегодня.
    public static func initialDay(of todo: Todo, today: String, carried: Bool) -> String {
        carried && !todo.recurring && todo.day < today ? today : todo.day
    }
}
