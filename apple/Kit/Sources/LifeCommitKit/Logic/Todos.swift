// Дела на день: порядок, подписи «со вчера», конец события — как shared/types.ts (sortTodos), src/todoDates.ts и
// src/components/TodoList.tsx мини-аппа.
import Foundation

/// Что под строкой дела при свайпе влево (слева направо; крайнее справа срабатывает свайпом до конца).
public enum TodoSwipe: Sendable, Equatable {
    case remove
    case hide
}

public enum Todos {
    /// Кнопки под строкой — как useTodoSwipe в TodoList.tsx: у события календаря крайняя — «Скрыть» (у нас пропадает,
    /// в календаре остаётся), «Удалить» — отдельно: удаляет и из календаря.
    public static func swipe(_ d: Todo) -> [TodoSwipe] {
        d.source == nil ? [.remove] : [.remove, .hide]
    }

    /// Несделанные со временем — по часам, потом без времени, сделанные — вниз; внутри — как пришли.
    public static func sorted(_ list: [Todo]) -> [Todo] {
        func rank(_ d: Todo) -> Int { d.done ? 2 : d.time != nil ? 0 : 1 }
        return list.enumerated().sorted { a, b in
            let ra = rank(a.element), rb = rank(b.element)
            if ra != rb { return ra < rb }
            if ra == 0, let ta = a.element.time, let tb = b.element.time, ta != tb { return ta < tb }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Подпись рядом с названием: сегодняшнее — без подписи; переехавшее — тихое «со вчера» / «с 26 сентября»
    /// (без красного и «просрочено»); запланированное — «завтра» или «пт, 3 октября».
    public static func when(_ day: String, today: String, strings: Strings) -> String? {
        if day == today { return nil }
        if day < today {
            return day == Days.add(today, -1) ? strings.todo.sinceYesterday : strings.todo.since(strings.dayMonth(day))
        }
        if day == Days.add(today, 1) { return strings.todo.tomorrow.lowercased(with: strings.locale) }
        return strings.weekdayDayMonth(day)
    }

    /// Конец события: «10:00» + 60 минут → «11:00» (в пределах суток, иначе nil).
    public static func endTime(_ start: String, minutes: Int) -> String? {
        let parts = start.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        let total = parts[0] * 60 + parts[1] + minutes
        guard total < 24 * 60 else { return nil }
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    /// Событие без длительности считаем часовым (решение владелицы 05.10.2026).
    static let eventDefaultMinutes = 60

    /// Событие из календаря уже прошло. Своё дело не «проходит»; событие на весь день — тоже.
    public static func eventOver(_ d: Todo, now: Date, calendar: Calendar = .current) -> Bool {
        guard d.source != nil, let time = d.time else { return false }
        let ymd = d.day.split(separator: "-").compactMap { Int($0) }
        let hm = time.split(separator: ":").compactMap { Int($0) }
        guard ymd.count == 3, hm.count >= 2,
              let start = calendar.date(from: DateComponents(year: ymd[0], month: ymd[1], day: ymd[2], hour: hm[0], minute: hm[1]))
        else { return false }
        return now >= start.addingTimeInterval(Double((d.durationMin ?? eventDefaultMinutes) * 60))
    }
}
