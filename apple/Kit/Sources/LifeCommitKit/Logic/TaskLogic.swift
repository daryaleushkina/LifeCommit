// Привычка на «Сегодня»: сделана ли, сколько даёт карте, «N дней без этого» — как src/components/TaskCard.tsx и
// shared/types.ts мини-аппа.
import Foundation

public extension TodayTask {
    var isDone: Bool {
        switch kind {
        case .count: value >= target
        case .check: value >= 1
        case .abstain: status != nil
        }
    }

    /// Вклад в «зелёность» дня, 0…1 — та же формула, что log_score в базе.
    var score: Double {
        switch kind {
        case .count: target > 0 ? min(1, value / target) : 0
        case .check: value >= 1 ? 1 : 0
        case .abstain: status == .clean ? 1 : 0
        }
    }

    /// «Бросить»: срыв счёт не обнуляет, сегодня прибавляется, только если получилось.
    var cleanDays: Int { cleanBefore + (status == .clean ? 1 : 0) }
}

public enum Heat {
    /// Уровень клетки карты по абсолютной сумме выполненного за день (решение владелицы: не «% от плана»).
    public static func level(_ score: Double) -> Int {
        if score <= 0 { return 0 }
        if score < 1 { return 1 }
        if score < 3 { return 2 }
        if score < 5 { return 3 }
        return 4
    }

    /// Карта с сегодняшним днём, посчитанным из отметок на экране, — без ожидания сервера. Сделанное дело на день
    /// зеленит клетку так же, как привычка; события из календаря — нет.
    public static func withToday(_ heat: [HeatDay], today: TodayResponse) -> [HeatDay] {
        let score = today.tasks.reduce(0) { $0 + $1.score } + Double(today.todos.filter { $0.done && $0.source == nil }.count)
        return heat.filter { $0.day != today.day } + [HeatDay(day: today.day, score: score)]
    }
}

public extension TodayResponse {
    /// Нужные сегодня: несделанные сверху, сделанные — тихо вниз. Не на сегодня — отдельно.
    var dueOrdered: [TodayTask] {
        let due = tasks.filter(\.due)
        return due.filter { !$0.isDone } + due.filter(\.isDone)
    }

    var notDue: [TodayTask] { tasks.filter { !$0.due } }

    /// Пусто совсем — первый экран «Чего я хочу?». Группы считаются (App.tsx): у человека только в группах — «Сегодня».
    var isEmpty: Bool { tasks.isEmpty && archived.isEmpty && todos.isEmpty && todosLater == 0 && groups.isEmpty }

    var canAddTask: Bool { limits.maxTasks.map { limits.active < $0 } ?? true }
}
