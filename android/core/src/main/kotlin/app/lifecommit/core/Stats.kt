// Статистика экрана привычки — как shared/stats.ts и подсчёты в src/screens/TaskDetail.tsx (и Stats.swift на iPhone):
// цель на день, периоды «без этого», последние дни, сетка месяца, числа и цвет каждого дня календаря.
package app.lifecommit.core

import kotlin.math.roundToLong

object Stats {
    /** Цель, действовавшая в этот день: прошлые дни по новой цели не пересчитываются. */
    fun targetOn(goals: List<HistoryGoal>, day: String): Double {
        var target = goals.firstOrNull()?.target ?: 1.0
        var from = ""
        for (g in goals) if (g.effectiveFrom <= day && g.effectiveFrom >= from) {
            from = g.effectiveFrom
            target = g.target
        }
        return target
    }

    data class Runs(val longest: Int, val current: Int)

    /**
     * «Бросить»: самый долгий период без этого и текущий. Дни до появления привычки (после «последнего раза»)
     * продолжают первый период; сегодня без ответа период не рвёт.
     */
    fun cleanRuns(logs: List<HistoryLog>, start: String, lastSlipOn: String?, today: String): Runs {
        val clean = logs.filter { it.status == AbstainStatus.Clean }.map { it.day }.toSet()
        val answered = logs.map { it.day }.toSet()
        var run = 0
        var longest = 0
        var day = lastSlipOn?.let { Days.add(it, 1) } ?: start
        while (day < start) {
            run = if (day in answered && day !in clean) 0 else run + 1
            longest = maxOf(longest, run)
            day = Days.add(day, 1)
        }
        day = start
        while (day <= today) {
            if (day in clean) run++ else if (day == today && day !in answered) break else run = 0
            longest = maxOf(longest, run)
            day = Days.add(day, 1)
        }
        return Runs(longest, run)
    }

    /** Значения за последние n дней по порядку, без отметки — ноль. */
    fun lastDays(logs: List<HistoryLog>, today: String, count: Int): List<Pair<String, Double>> {
        val byDay = logs.associate { it.day to it.value }
        return (0 until count).map { i -> Days.add(today, i - count + 1).let { it to (byDay[it] ?: 0.0) } }
    }
}

object Months {
    /** «2026-09» из «2026-09-30». */
    fun of(day: String): String = day.take(7)

    /** Месяц со сдвигом: shift("2026-01", -1) → "2025-12". */
    fun shift(month: String, n: Int): String {
        val parts = month.split("-").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return month
        val total = parts[0] * 12 + (parts[1] - 1) + n
        return "%04d-%02d".format(Math.floorDiv(total, 12), Math.floorMod(total, 12) + 1)
    }

    data class Grid(val lead: Int, val days: List<String>)

    /** Дни месяца и сколько пустых клеток перед первым числом (понедельник слева). */
    fun cells(month: String): Grid {
        val first = "$month-01"
        val count = Days.between(first, "${shift(month, 1)}-01")
        return Grid(Days.weekdayIndex(first), (0 until count).map { Days.add(first, it) })
    }
}

/** Что показывает экран привычки за выбранный месяц. */
data class HabitDetail(
    /** Под названием: «Каждый день» / «Цель — 8 стаканов в день» / «С 21 сентября». */
    val subtitle: String,
    /** Ключевые числа: значение и подпись. */
    val stats: List<Stat>,
    /** День → цвет клетки. */
    val cells: Map<String, Cell>,
    /** Отметки задним числом: у «делать» и «бросить» — да; у «считать» нужно число, его отмечают только сегодня. */
    val markable: Boolean,
    /** Раньше этого месяца листать некуда. */
    val oldestMonth: String,
) {
    /** Цвет дня в календаре месяца (классы .hcal мини-аппа). */
    enum class Cell { Off, Plan, Some, Half, Full, Clean, Slip }

    data class Stat(val value: String, val label: String)

    companion object {
        /** Сегодняшняя отметка уже на экране — подставляем её в историю, не дожидаясь сервера. */
        fun logs(task: TodayTask, history: TaskHistory?, today: String): List<HistoryLog> {
            val past = history?.logs.orEmpty().filter { it.day != today }
            if (!task.logged) return past
            val value = if (task.kind == TaskKind.Abstain) (if (task.status == AbstainStatus.Clean) 1.0 else 0.0) else task.value
            return past + HistoryLog(today, value, task.status)
        }

        fun make(task: TodayTask, history: TaskHistory?, today: String, month: String, t: Strings): HabitDetail {
            val logs = logs(task, history, today)
            val goals = history?.goals?.takeIf { it.isNotEmpty() } ?: listOf(HistoryGoal(today, task.target))
            val start = history?.start ?: today
            val byDay = logs.associateBy { it.day }
            val inMonth = logs.filter { it.day.startsWith(month) }
            val monthName = t.monthName(month)
            val grid = Months.cells(month)
            // Дни месяца, когда привычка уже была и которые уже наступили.
            val lived = grid.days.filter { it >= start && it <= today }
            val oldest = buildList {
                add(Months.of(start))
                add(Months.shift(Months.of(today), -11))
                if (task.kind == TaskKind.Abstain) task.lastSlipOn?.let { add(Months.of(it)) }
            }.min()
            val cells = mutableMapOf<String, Cell>()
            val subtitle: String
            val stats: List<Stat>
            when (task.kind) {
                TaskKind.Check -> {
                    subtitle = Repeat.label(t, task.schedule, task.weekdays, task.perWeek)
                    val done = inMonth.count { it.value >= 1 }
                    val planned = lived.filter { task.weekdays and (1 shl Days.weekdayIndex(it)) != 0 }
                    val total = logs.count { it.value >= 1 }
                    // «N раз в неделю» не привязано к дням — плана по дням нет, просто счёт.
                    stats = listOf(
                        if (task.schedule == Schedule.PerWeek) Stat(t.num(done), t.statTimesIn(monthName)) else Stat(t.statOf(done, planned.size), t.statPlanIn(monthName)),
                        Stat(t.num(total), t.statTimesAll),
                    )
                    val plan = if (task.schedule == Schedule.PerWeek) emptySet() else planned.toSet()
                    for (day in grid.days) cells[day] = if ((byDay[day]?.value ?: 0.0) >= 1) Cell.Full else if (day in plan) Cell.Plan else Cell.Off
                }
                TaskKind.Count -> {
                    subtitle = t.goalLine(task.target, task.unit)
                    val sum = inMonth.sumOf { it.value }
                    stats = listOf(
                        Stat(t.num((sum / maxOf(1, lived.size)).roundToLong().toDouble()), t.statAvg(task.unit)),
                        Stat(t.num(inMonth.maxOfOrNull { it.value } ?: 0.0), t.statBest),
                        Stat(t.num(sum), t.statSumIn(monthName)),
                    )
                    for (day in grid.days) {
                        val v = byDay[day]?.value ?: 0.0
                        cells[day] = if (v <= 0) Cell.Off else (v / Stats.targetOn(goals, day)).let { if (it >= 1) Cell.Full else if (it >= 0.5) Cell.Half else Cell.Some }
                    }
                }
                TaskKind.Abstain -> {
                    val slip = task.lastSlipOn
                    // Считаем с дня после «последнего раза», а если его не указывали — с первого дня привычки.
                    subtitle = t.sinceDate(t.dayMonth(slip?.let { Days.add(it, 1) } ?: start))
                    val runs = Stats.cleanRuns(logs, start, slip, today)
                    val slipsInMonth = inMonth.count { it.status == AbstainStatus.Slip } + if (slip != null && slip.startsWith(month) && slip !in byDay) 1 else 0
                    stats = listOf(
                        Stat(t.num(runs.current), t.statRunNow),
                        Stat(t.num(runs.longest), t.statRunBest),
                        Stat(t.num(slipsInMonth), t.statSlipsIn(monthName)),
                    )
                    // Дни до приложения тоже настоящие: после «последнего раза» и до первого дня — чистые, сам
                    // «последний раз» — красный (решение владелицы 02.10.2026).
                    for (day in grid.days) {
                        val status = byDay[day]?.status
                        cells[day] = when {
                            status != null -> if (status == AbstainStatus.Clean) Cell.Clean else Cell.Slip
                            day == slip -> Cell.Slip
                            slip != null && day > slip && day < start -> Cell.Clean
                            else -> Cell.Off
                        }
                    }
                }
            }
            return HabitDetail(subtitle, stats, cells, task.kind != TaskKind.Count, oldest)
        }
    }
}
