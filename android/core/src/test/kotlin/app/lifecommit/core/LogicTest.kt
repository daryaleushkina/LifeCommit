// Логика из shared/ и src/ мини-аппа — те же случаи, что в shared/*.test.ts и apple/Kit LogicTests.swift.
package app.lifecommit.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

private fun task(kind: TaskKind, target: Double = 1.0, value: Double = 0.0, status: AbstainStatus? = null, due: Boolean = true, cleanBefore: Int = 0, id: Long = 1) =
    TodayTask(id = id, title = "", kind = kind, target = target, value = value, status = status, due = due, cleanBefore = cleanBefore)

class HeatAndTaskTest {
    @Test fun `уровни по абсолютной сумме выполненного`() {
        assertEquals(listOf(0, 1, 2, 2, 3, 3, 4, 4), listOf(0.0, 0.5, 1.0, 2.9, 3.0, 4.9, 5.0, 12.0).map(Heat::level))
        assertEquals(0, Heat.level(-1.0))
    }

    @Test fun `сделано - считать до цели, делать - отметка, бросить - любой ответ`() {
        assertTrue(task(TaskKind.Count, target = 8.0, value = 8.0).isDone)
        assertFalse(task(TaskKind.Count, target = 8.0, value = 7.0).isDone)
        assertTrue(task(TaskKind.Check, value = 1.0).isDone)
        assertFalse(task(TaskKind.Check).isDone)
        assertTrue(task(TaskKind.Abstain, status = AbstainStatus.Slip).isDone)
        assertFalse(task(TaskKind.Abstain).isDone)
    }

    @Test fun `вклад в день - частичное засчитывается, срыв - ноль`() {
        assertEquals(0.5, task(TaskKind.Count, target = 8.0, value = 4.0).score, 0.0)
        assertEquals(1.0, task(TaskKind.Count, target = 8.0, value = 20.0).score, 0.0)
        assertEquals(0.0, task(TaskKind.Count, target = 0.0, value = 3.0).score, 0.0)
        assertEquals(1.0, task(TaskKind.Check, value = 1.0).score, 0.0)
        assertEquals(1.0, task(TaskKind.Abstain, status = AbstainStatus.Clean).score, 0.0)
        assertEquals(0.0, task(TaskKind.Abstain, status = AbstainStatus.Slip).score, 0.0)
    }

    @Test fun `N дней без этого - срыв не обнуляет, сегодня прибавляется, только если получилось`() {
        assertEquals(7, task(TaskKind.Abstain, status = AbstainStatus.Clean, cleanBefore = 6).cleanDays)
        assertEquals(6, task(TaskKind.Abstain, status = AbstainStatus.Slip, cleanBefore = 6).cleanDays)
        assertEquals(6, task(TaskKind.Abstain, cleanBefore = 6).cleanDays)
    }

    @Test fun `сегодняшняя клетка карты считается из отметок на экране, события календаря - нет`() {
        val today = TodayResponse(
            day = "2026-10-05",
            tasks = listOf(task(TaskKind.Count, target = 4.0, value = 2.0), task(TaskKind.Check, value = 1.0, id = 2)),
            todos = listOf(
                Todo(1, "", "2026-10-05", done = true),
                Todo(2, "", "2026-10-05", done = true, source = TodoSource.Google),
                Todo(3, "", "2026-10-05"),
            ),
        )
        val heat = Heat.withToday(listOf(HeatDay("2026-10-04", 3.0), HeatDay("2026-10-05", 9.0)), today)
        assertEquals(listOf(HeatDay("2026-10-04", 3.0), HeatDay("2026-10-05", 2.5)), heat)
    }

    @Test fun `порядок на Сегодня - несделанные сверху, сделанные вниз, не на сегодня отдельно`() {
        val r = TodayResponse("2026-10-05", tasks = listOf(task(TaskKind.Check, value = 1.0, id = 1), task(TaskKind.Check, id = 2), task(TaskKind.Check, due = false, id = 3)))
        assertEquals(listOf(2L, 1L), r.dueOrdered.map { it.id })
        assertEquals(listOf(3L), r.notDue.map { it.id })
        assertFalse(r.isEmpty)
        assertTrue(TodayResponse("2026-10-05").isEmpty)
        assertFalse(TodayResponse("2026-10-05", todosLater = 1).isEmpty)
        // Есть группа — уже не пусто: на «Сегодня» её блок, а не «Чего я хочу?» (App.tsx).
        assertFalse(TodayResponse("2026-10-05", groups = listOf(GroupToday(1, "Семья"))).isEmpty)
        assertFalse(TodayResponse("2026-10-05", limits = TaskLimits(5, 5)).canAddTask)
        assertTrue(TodayResponse("2026-10-05").canAddTask)
    }
}

class TodosTest {
    @Test fun `несделанные со временем - по часам, потом без времени, сделанные вниз`() {
        val list = listOf(
            Todo(1, "без времени", "d"),
            Todo(2, "сделано", "d", done = true, time = "08:00"),
            Todo(3, "в 15", "d", time = "15:00"),
            Todo(4, "в 9", "d", time = "09:00"),
            Todo(5, "ещё без времени", "d"),
        )
        assertEquals(listOf(4L, 3L, 1L, 5L, 2L), Todos.sorted(list).map { it.id })
    }

    @Test fun `подписи дней`() {
        val ru = Strings.ru
        assertNull(Todos.whenLabel("2026-10-05", "2026-10-05", ru))
        assertEquals("со вчера", Todos.whenLabel("2026-10-04", "2026-10-05", ru))
        assertEquals("с 26 сентября", Todos.whenLabel("2026-09-26", "2026-10-05", ru))
        assertEquals("завтра", Todos.whenLabel("2026-10-06", "2026-10-05", ru))
        assertEquals("пт, 9 октября", Todos.whenLabel("2026-10-09", "2026-10-05", ru))
        val en = Strings.en
        assertEquals("since yesterday", Todos.whenLabel("2026-10-04", "2026-10-05", en))
        assertEquals("since September 26", Todos.whenLabel("2026-09-26", "2026-10-05", en))
        assertEquals("tomorrow", Todos.whenLabel("2026-10-06", "2026-10-05", en))
        assertEquals("Fri, October 9", Todos.whenLabel("2026-10-09", "2026-10-05", en))
    }

    @Test fun `конец события - в пределах суток, иначе нет`() {
        assertEquals("11:00", Todos.endTime("10:00", 60))
        assertNull(Todos.endTime("23:30", 45))
        assertEquals("09:35", Todos.endTime("09:05", 30))
        assertNull(Todos.endTime("плохо", 30))
    }

    @Test fun `событие прошло - своё дело и событие на весь день никогда, без длительности час`() {
        val zone = ZoneId.of("Asia/Ho_Chi_Minh")
        fun at(h: Int, m: Int) = ZonedDateTime.of(2026, 10, 5, h, m, 0, 0, zone)
        val event = Todo(1, "", "2026-10-05", time = "10:00", source = TodoSource.Apple)
        assertFalse(Todos.eventOver(event, at(10, 59)))
        assertTrue(Todos.eventOver(event, at(11, 0)))
        assertFalse(Todos.eventOver(event.copy(durationMin = 120), at(11, 30)))
        assertFalse(Todos.eventOver(Todo(2, "", "2026-10-05", time = "10:00"), at(23, 0)))
        assertFalse(Todos.eventOver(Todo(3, "", "2026-10-05", source = TodoSource.Google), at(23, 0)))
    }

    @Test fun `тот же раз дела - у повторяющегося различает день`() {
        val a = Todo(1, "", "2026-10-05", recurring = true)
        assertTrue(a.isSame(a))
        assertFalse(a.isSame(Todo(1, "", "2026-10-06", recurring = true)))
        assertTrue(Todo(2, "", "a").isSame(Todo(2, "", "b")))
    }
}

class HabitIconTest {
    @Test fun `узнаёт привычку по названию`() {
        assertEquals(HabitIcon.Gym, HabitIcon.of("Сходить в спортзал"))
        assertEquals(HabitIcon.Read, HabitIcon.of("Читать"))
        assertEquals(HabitIcon.Water, HabitIcon.of("Выпить воды"))
        assertEquals(HabitIcon.Smoke, HabitIcon.of("Не курить"))
        assertEquals(HabitIcon.Sweets, HabitIcon.of("Без сладкого"))
        assertEquals(HabitIcon.Exercise, HabitIcon.of("Зарядка"))
        assertEquals(HabitIcon.Sleep, HabitIcon.of("Лечь до полуночи"))
        assertEquals(HabitIcon.Study, HabitIcon.of("Учить английский"))
        assertEquals(HabitIcon.Run, HabitIcon.of("Morning run"))
    }

    @Test fun `смотрит на начало слова, а не на любую часть`() {
        assertNull(HabitIcon.of("Съездить на завод"))
        assertEquals(HabitIcon.Study, HabitIcon.of("Курсы вождения"))
        assertEquals(HabitIcon.Food, HabitIcon.of("Курица на ужин"))
    }

    @Test fun `буква ё и регистр не мешают, незнакомое - без значка`() {
        assertEquals(HabitIcon.Sleep, HabitIcon.of("ПОДЪЁМ в 7"))
        assertNull(HabitIcon.of("Что-то своё"))
        assertNull(HabitIcon.of(""))
    }
}

class DaysTest {
    @Test fun `арифметика дней не спотыкается о переходы месяцев и високосный год`() {
        assertEquals("2026-09-30", Days.add("2026-10-01", -1))
        assertEquals("2028-02-29", Days.add("2028-02-28", 1))
        assertEquals("2027-01-01", Days.add("2026-12-31", 1))
        assertEquals(4, Days.between("2026-10-01", "2026-10-05"))
        assertEquals("не дата", Days.add("не дата", 1))
    }

    @Test fun `день недели - понедельник 0`() {
        assertEquals(0, Days.weekdayIndex("2026-10-05"))
        assertEquals(6, Days.weekdayIndex("2026-10-11"))
    }
}

class StringsTest {
    @Test fun `склонения по-русски`() {
        val forms = listOf(1, 2, 5, 11, 12, 21, 22, 25, 111, 101).map { Plural.ru(it, "день", "дня", "дней") }
        assertEquals(listOf("день", "дня", "дней", "дней", "дней", "день", "дня", "дней", "дней", "день"), forms)
    }

    @Test fun `числа - разряды с тысяч, неразрывным пробелом`() {
        assertEquals("146", Strings.ru.num(146))
        assertEquals("1\u00a0146", Strings.ru.num(1146))
        assertEquals("25\u00a0546", Strings.ru.num(25546))
        assertEquals("2,5", Strings.ru.num(2.5))
        assertEquals("1,146", Strings.en.num(1146))
        assertEquals("2.25", Strings.en.num(2.25))
    }

    @Test fun `дни без этого и раз в неделю`() {
        assertEquals("1 день без этого", Strings.ru.cleanDays(1))
        assertEquals("22 дня без этого", Strings.ru.cleanDays(22))
        assertEquals("1 day without it", Strings.en.cleanDays(1))
        assertEquals("3 раза в неделю", Strings.ru.perWeek(3))
        assertEquals("Потом · 1\u00a0200", Strings.ru.todo.later(1200))
    }

    @Test fun `шапка Сегодня - день недели с заглавной`() {
        assertEquals("Понедельник, 5 октября", Strings.ru.longDate("2026-10-05"))
        assertEquals("Monday, October 5", Strings.en.longDate("2026-10-05"))
    }

    @Test fun `язык человека - en английский, всё остальное русский`() {
        assertEquals(Strings.Lang.En, Strings.of("en").lang)
        assertEquals(Strings.Lang.Ru, Strings.of("ru").lang)
        assertEquals(Strings.Lang.Ru, Strings.of(null).lang)
    }
}

class RepeatTest {
    @Test fun `каждый день, и по дням недели со всеми семью - тоже`() {
        assertEquals("Каждый день", Repeat.label(Strings.ru, Schedule.Daily, 127, null))
        assertEquals("Каждый день", Repeat.label(Strings.ru, Schedule.Weekdays, 127, null))
    }

    @Test fun `по дням недели - заглавная только первая`() {
        assertEquals("Пн, ср, пт", Repeat.label(Strings.ru, Schedule.Weekdays, 0b10101, null))
        assertEquals("Сб, вс", Repeat.label(Strings.ru, Schedule.Weekdays, 0b1100000, null))
        assertEquals("Tu", Repeat.label(Strings.en, Schedule.Weekdays, 0b10, null))
    }

    @Test fun `несколько раз в неделю, без числа - три`() {
        assertEquals("2 раза в неделю", Repeat.label(Strings.ru, Schedule.PerWeek, 127, 2))
        assertEquals("3 раза в неделю", Repeat.label(Strings.ru, Schedule.PerWeek, 127, null))
        assertEquals("1 time a week", Repeat.label(Strings.en, Schedule.PerWeek, 127, 1))
    }
}
