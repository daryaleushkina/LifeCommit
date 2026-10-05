// Те же случаи, что shared/stats.test.ts и LogicTests.swift (экран привычки).
package app.lifecommit.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private fun clean(day: String) = HistoryLog(day, 1.0, AbstainStatus.Clean)
private fun slip(day: String) = HistoryLog(day, 0.0, AbstainStatus.Slip)

class StatsTest {
    @Test fun `цель, действовавшая в этот день`() {
        val goals = listOf(HistoryGoal("2026-09-10", 30.0), HistoryGoal("2026-09-01", 20.0))
        assertEquals(20.0, Stats.targetOn(goals, "2026-09-05"), 0.0)
        assertEquals(30.0, Stats.targetOn(goals, "2026-09-10"), 0.0)
        assertEquals(30.0, Stats.targetOn(goals, "2026-09-30"), 0.0)
    }

    @Test fun `периоды без этого - срыв начинает заново, сегодня без ответа не рвёт, пропуск в прошлом рвёт`() {
        val logs = listOf(clean("2026-09-01"), clean("2026-09-02"), clean("2026-09-03"), slip("2026-09-04"), clean("2026-09-05"), clean("2026-09-06"))
        assertEquals(Stats.Runs(3, 2), Stats.cleanRuns(logs, "2026-09-01", null, "2026-09-06"))
        assertEquals(Stats.Runs(2, 2), Stats.cleanRuns(listOf(clean("2026-09-01"), clean("2026-09-02")), "2026-09-01", null, "2026-09-03"))
        assertEquals(Stats.Runs(1, 1), Stats.cleanRuns(listOf(clean("2026-09-01"), clean("2026-09-03")), "2026-09-01", null, "2026-09-03"))
    }

    @Test fun `дни до появления привычки продолжают первый период, срыв в первый день обнуляет`() {
        assertEquals(Stats.Runs(8, 8), Stats.cleanRuns(listOf(clean("2026-09-01"), clean("2026-09-02")), "2026-09-01", "2026-08-25", "2026-09-02"))
        assertEquals(Stats.Runs(6, 0), Stats.cleanRuns(listOf(slip("2026-09-01")), "2026-09-01", "2026-08-25", "2026-09-01"))
    }

    @Test fun `последние n дней по порядку, без отметки - ноль`() {
        val days = Stats.lastDays(listOf(HistoryLog("2026-09-29", 12.0)), "2026-09-30", 3)
        assertEquals(listOf("2026-09-28" to 0.0, "2026-09-29" to 12.0, "2026-09-30" to 0.0), days)
    }

    @Test fun `месяцы - сдвиг через год, сетка с понедельника`() {
        assertEquals("2025-12", Months.shift("2026-01", -1))
        assertEquals("2027-01", Months.shift("2026-12", 1))
        assertEquals("2025-11", Months.shift("2026-10", -11))
        val oct = Months.cells("2026-10")
        assertEquals(3, oct.lead)
        assertEquals(31, oct.days.size)
        assertEquals(29, Months.cells("2028-02").days.size)
    }

    @Test fun `экран делать - план по дням недели, цвет дней`() {
        // 1 октября 2026 — четверг. Пн, ср, пт до 9-го: 2, 5, 7, 9 — четыре дня; сделаны 2 и 5.
        val task = TodayTask(id = 1, title = "Спортзал", kind = TaskKind.Check, schedule = Schedule.Weekdays, weekdays = 0b0010101)
        val history = TaskHistory("2026-10-01", listOf(HistoryGoal("2026-10-01", 1.0)), listOf(HistoryLog("2026-10-02", 1.0), HistoryLog("2026-10-05", 1.0)))
        val d = HabitDetail.make(task, history, "2026-10-09", "2026-10", Strings.ru)
        assertEquals("Пн, ср, пт", d.subtitle)
        assertEquals(listOf(HabitDetail.Stat("2 из 4", "по плану за октябрь"), HabitDetail.Stat("2", "раз за всё время")), d.stats)
        assertEquals(HabitDetail.Cell.Full, d.cells["2026-10-02"])
        assertEquals(HabitDetail.Cell.Off, d.cells["2026-10-03"])
        assertEquals(HabitDetail.Cell.Plan, d.cells["2026-10-07"])
        assertEquals(HabitDetail.Cell.Plan, d.cells["2026-10-09"])
        assertTrue(d.markable)
    }

    @Test fun `экран делать несколько раз в неделю - просто счёт, плана по дням нет`() {
        val task = TodayTask(id = 1, title = "Бег", kind = TaskKind.Check, schedule = Schedule.PerWeek, perWeek = 3)
        val history = TaskHistory("2026-10-01", emptyList(), listOf(HistoryLog("2026-10-02", 1.0)))
        val d = HabitDetail.make(task, history, "2026-10-09", "2026-10", Strings.ru)
        assertEquals(HabitDetail.Stat("1", "раз за октябрь"), d.stats[0])
        assertEquals(HabitDetail.Cell.Off, d.cells["2026-10-05"])
    }

    @Test fun `экран считать - среднее, лучший день, сумма, доля цели - цвет`() {
        val task = TodayTask(id = 2, title = "Вода", kind = TaskKind.Count, unit = "стаканов", target = 8.0, value = 4.0, logged = true)
        val history = TaskHistory("2026-10-01", listOf(HistoryGoal("2026-10-01", 8.0)), listOf(HistoryLog("2026-10-01", 8.0), HistoryLog("2026-10-02", 2.0)))
        val d = HabitDetail.make(task, history, "2026-10-05", "2026-10", Strings.ru)
        assertEquals("Цель — 8 стаканов в день", d.subtitle)
        assertEquals(listOf("3", "8", "14"), d.stats.map { it.value })
        assertEquals(listOf("стаканов в день в среднем", "лучший день", "всего за октябрь"), d.stats.map { it.label })
        assertEquals(HabitDetail.Cell.Full, d.cells["2026-10-01"])
        assertEquals(HabitDetail.Cell.Some, d.cells["2026-10-02"])
        assertEquals(HabitDetail.Cell.Half, d.cells["2026-10-05"])
        assertFalse(d.markable)
    }

    @Test fun `экран бросить - с дня после последнего раза, дни до приложения чистые, последний раз красный`() {
        val task = TodayTask(id = 3, title = "Не курить", kind = TaskKind.Abstain, logged = true, status = AbstainStatus.Clean, lastSlipOn = "2026-09-28")
        val history = TaskHistory("2026-10-03", emptyList(), listOf(HistoryLog("2026-10-04", 0.0, AbstainStatus.Slip)))
        val d = HabitDetail.make(task, history, "2026-10-05", "2026-10", Strings.ru)
        assertEquals("С 29 сентября", d.subtitle)
        assertEquals(
            listOf(
                HabitDetail.Stat("1", "подряд сейчас"),
                // 29 сентября – 2 октября — чистые до приложения (4), 3-го ответа нет — период рвётся.
                HabitDetail.Stat("4", "самый долгий период"),
                HabitDetail.Stat("1", "раз было за октябрь"),
            ),
            d.stats,
        )
        assertEquals(HabitDetail.Cell.Clean, d.cells["2026-10-01"])
        assertEquals(HabitDetail.Cell.Slip, d.cells["2026-10-04"])
        assertEquals(HabitDetail.Cell.Clean, d.cells["2026-10-05"])
        assertEquals("2025-11", d.oldestMonth)
        val sep = HabitDetail.make(task, history, "2026-10-05", "2026-09", Strings.ru)
        assertEquals(HabitDetail.Cell.Slip, sep.cells["2026-09-28"])
        assertEquals(HabitDetail.Cell.Clean, sep.cells["2026-09-30"])
        assertEquals("1", sep.stats.last().value)
    }

    @Test fun `месяц по-русски и по-английски`() {
        assertEquals("Октябрь 2026", Strings.ru.monthYear("2026-10"))
        assertEquals("October 2026", Strings.en.monthYear("2026-10"))
        assertEquals("понедельник, 5 октября", Strings.ru.weekdayLong("2026-10-05"))
        assertEquals("Goal: 1,200 pages a day", Strings.en.goalLine(1200.0, "pages"))
    }
}
