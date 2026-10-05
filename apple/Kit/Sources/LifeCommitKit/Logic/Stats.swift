// Статистика экрана привычки — как shared/stats.ts и подсчёты в src/screens/TaskDetail.tsx: цель на день, периоды
// «без этого», последние дни, сетка месяца, числа и цвет каждого дня календаря.
import Foundation

public enum Stats {
    /// Цель, действовавшая в этот день: прошлые дни по новой цели не пересчитываются.
    public static func targetOn(_ goals: [HistoryGoal], day: String) -> Double {
        var target = goals.first?.target ?? 1
        var from = ""
        for g in goals where g.effectiveFrom <= day && g.effectiveFrom >= from {
            from = g.effectiveFrom
            target = g.target
        }
        return target
    }

    /// «Бросить»: самый долгий период без этого и текущий. Дни до появления привычки (после «последнего раза»)
    /// продолжают первый период; сегодня без ответа период не рвёт.
    public static func cleanRuns(_ logs: [HistoryLog], start: String, lastSlipOn: String?, today: String) -> (longest: Int, current: Int) {
        let clean = Set(logs.filter { $0.status == .clean }.map(\.day))
        let answered = Set(logs.map(\.day))
        var run = 0, longest = 0
        var day = lastSlipOn.map { Days.add($0, 1) } ?? start
        while day < start {
            run = answered.contains(day) && !clean.contains(day) ? 0 : run + 1
            longest = max(longest, run)
            day = Days.add(day, 1)
        }
        day = start
        while day <= today {
            if clean.contains(day) {
                run += 1
            } else if day == today && !answered.contains(day) {
                break
            } else {
                run = 0
            }
            longest = max(longest, run)
            day = Days.add(day, 1)
        }
        return (longest, run)
    }

    /// Значения за последние n дней по порядку, без отметки — ноль.
    public static func lastDays(_ logs: [HistoryLog], today: String, count: Int) -> [(day: String, value: Double)] {
        let byDay = Dictionary(logs.map { ($0.day, $0.value) }, uniquingKeysWith: { _, b in b })
        return (0..<count).map { i in
            let day = Days.add(today, i - count + 1)
            return (day, byDay[day] ?? 0)
        }
    }
}

public enum Months {
    /// «2026-09» из «2026-09-30».
    public static func of(_ day: String) -> String { String(day.prefix(7)) }

    /// Месяц со сдвигом: shift("2026-01", -1) → "2025-12".
    public static func shift(_ month: String, _ n: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        let total = parts[0] * 12 + (parts[1] - 1) + n
        return String(format: "%04d-%02d", total / 12, total % 12 + 1)
    }

    /// Дни месяца и сколько пустых клеток перед первым числом (понедельник слева).
    public static func cells(_ month: String) -> (lead: Int, days: [String]) {
        let first = "\(month)-01"
        let count = Days.between(first, "\(shift(month, 1))-01")
        return (Days.weekdayIndex(first), (0..<count).map { Days.add(first, $0) })
    }
}

/// Что показывает экран привычки за выбранный месяц.
public struct HabitDetail: Sendable, Equatable {
    /// Цвет дня в календаре месяца (классы .hcal мини-аппа).
    public enum Cell: String, Sendable { case off, plan, some, half, full, clean, slip }

    /// Под названием: «Каждый день» / «Цель — 8 стаканов в день» / «С 21 сентября».
    public let subtitle: String
    /// Ключевые числа: значение и подпись.
    public let stats: [Stat]
    /// День → цвет клетки (дни месяца, у которых нет записи, — .off).
    public let cells: [String: Cell]
    /// Отметки задним числом: у «делать» и «бросить» — да; у «считать» нужно число, его отмечают только сегодня.
    public let markable: Bool
    /// Раньше этого месяца листать некуда.
    public let oldestMonth: String

    public struct Stat: Sendable, Equatable {
        public let value: String
        public let label: String
    }

    /// Сегодняшняя отметка уже на экране — подставляем её в историю, не дожидаясь сервера.
    public static func logs(task: TodayTask, history: TaskHistory?, today: String) -> [HistoryLog] {
        let past = (history?.logs ?? []).filter { $0.day != today }
        guard task.logged else { return past }
        let value = task.kind == .abstain ? (task.status == .clean ? 1 : 0) : task.value
        return past + [HistoryLog(day: today, value: value, status: task.status)]
    }

    public static func make(task: TodayTask, history: TaskHistory?, today: String, month: String, strings t: Strings) -> HabitDetail {
        let logs = logs(task: task, history: history, today: today)
        let goals = history?.goals ?? [HistoryGoal(effectiveFrom: today, target: task.target)]
        let start = history?.start ?? today
        let byDay = Dictionary(logs.map { ($0.day, $0) }, uniquingKeysWith: { _, b in b })
        let inMonth = logs.filter { $0.day.hasPrefix(month) }
        let monthName = t.monthName(month)
        let grid = Months.cells(month)
        // Дни месяца, когда привычка уже была и которые уже наступили.
        let lived = grid.days.filter { $0 >= start && $0 <= today }
        var oldest = [Months.of(start), Months.shift(Months.of(today), -11)]
        if task.kind == .abstain, let slip = task.lastSlipOn { oldest.append(Months.of(slip)) }

        var cells: [String: Cell] = [:]
        let subtitle: String
        let stats: [Stat]
        switch task.kind {
        case .check:
            subtitle = Repeat.label(t, schedule: task.schedule, weekdays: task.weekdays, perWeek: task.perWeek)
            let done = inMonth.filter { $0.value >= 1 }.count
            let planned = lived.filter { task.weekdays & (1 << Days.weekdayIndex($0)) != 0 }
            let total = logs.filter { $0.value >= 1 }.count
            // «N раз в неделю» не привязано к дням — плана по дням нет, просто счёт.
            stats = [
                task.schedule == .perWeek
                    ? Stat(value: t.num(done), label: t.statTimesIn(monthName))
                    : Stat(value: t.statOf(done, planned.count), label: t.statPlanIn(monthName)),
                Stat(value: t.num(total), label: t.statTimesAll),
            ]
            let plan = task.schedule == .perWeek ? Set<String>() : Set(planned)
            for day in grid.days {
                cells[day] = (byDay[day]?.value ?? 0) >= 1 ? .full : plan.contains(day) ? .plan : .off
            }
        case .count:
            subtitle = t.goalLine(task.target, task.unit)
            let sum = inMonth.reduce(0) { $0 + $1.value }
            stats = [
                Stat(value: t.num((sum / Double(max(1, lived.count))).rounded()), label: t.statAvg(task.unit)),
                Stat(value: t.num(inMonth.map(\.value).max() ?? 0), label: t.statBest),
                Stat(value: t.num(sum), label: t.statSumIn(monthName)),
            ]
            for day in grid.days {
                let v = byDay[day]?.value ?? 0
                if v <= 0 {
                    cells[day] = .off
                    continue
                }
                let share = v / Stats.targetOn(goals, day: day)
                cells[day] = share >= 1 ? .full : share >= 0.5 ? .half : .some
            }
        case .abstain:
            let slip = task.lastSlipOn
            // Считаем с дня после «последнего раза», а если его не указывали — с первого дня привычки.
            subtitle = t.since(t.dayMonth(slip.map { Days.add($0, 1) } ?? start))
            let runs = Stats.cleanRuns(logs, start: start, lastSlipOn: slip, today: today)
            let slipsInMonth = inMonth.filter { $0.status == .slip }.count + (slip.map { $0.hasPrefix(month) && byDay[$0] == nil } == true ? 1 : 0)
            stats = [
                Stat(value: t.num(runs.current), label: t.statRunNow),
                Stat(value: t.num(runs.longest), label: t.statRunBest),
                Stat(value: t.num(slipsInMonth), label: t.statSlipsIn(monthName)),
            ]
            // Дни до приложения тоже настоящие: после «последнего раза» и до первого дня — чистые, сам «последний
            // раз» — красный (решение владелицы 02.10.2026).
            for day in grid.days {
                if let status = byDay[day]?.status {
                    cells[day] = status == .clean ? .clean : .slip
                } else if day == slip {
                    cells[day] = .slip
                } else if let slip, day > slip, day < start {
                    cells[day] = .clean
                } else {
                    cells[day] = .off
                }
            }
        }
        return HabitDetail(subtitle: subtitle, stats: stats, cells: cells, markable: task.kind != .count, oldestMonth: oldest.min() ?? Months.of(today))
    }
}
