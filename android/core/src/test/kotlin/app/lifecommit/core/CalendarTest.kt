package app.lifecommit.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CalendarTest {
    @Test fun `день - один день, месяц - целыми неделями с понедельника`() {
        assertEquals(listOf("2026-10-05"), CalendarDays.range(CalMode.Day, "2026-10-05"))
        val oct = CalendarDays.range(CalMode.Month, "2026-10-17")
        // 1 октября 2026 — четверг: сетка с понедельника 28 сентября до воскресенья 1 ноября.
        assertEquals("2026-09-28", oct.first())
        assertEquals("2026-11-01", oct.last())
        assertEquals(35, oct.size)
        assertEquals(0, oct.size % 7)
    }

    @Test fun `стрелки - день на день, месяц на месяц с первого числа`() {
        assertEquals("2026-10-06", CalendarDays.shift(CalMode.Day, "2026-10-05", 1))
        assertEquals("2026-09-01", CalendarDays.shift(CalMode.Month, "2026-10-17", -1))
        assertEquals("2027-01-01", CalendarDays.shift(CalMode.Month, "2026-12-31", 1))
    }

    private val todo = Todo(1, "Купить хлеб", "2026-10-05", time = "10:00", details = TodoDetails(location = "Магазин"))

    @Test fun `правка дела - только изменённые поля, весь день - это time null`() {
        assertEquals(buildJsonObject {}, TodoEdits.patch(todo, TodoEdit("Купить хлеб", "2026-10-05", "10:00", "Магазин")))
        assertEquals(
            buildJsonObject {
                put("title", JsonPrimitive("Купить батон"))
                put("day", JsonPrimitive("2026-10-06"))
                put("time", JsonNull)
                put("location", JsonPrimitive(""))
            },
            TodoEdits.patch(todo, TodoEdit("Купить батон", "2026-10-06", null, "")),
        )
    }

    @Test fun `у повторяющегося день не меняется, у события место не трогаем`() {
        val recurring = todo.copy(recurring = true, source = TodoSource.Google)
        assertEquals(buildJsonObject {}, TodoEdits.patch(recurring, TodoEdit("Купить хлеб", "2026-10-07", "10:00", null)))
    }

    @Test fun `дело на экране после правки - место пустое убирается из подробностей`() {
        val next = TodoEdits.applied(todo, TodoEdit("Хлеб", "2026-10-05", null, ""))
        assertEquals("Хлеб", next.title)
        assertNull(next.time)
        assertNull(next.details)
        assertEquals("Дом", TodoEdits.applied(todo, TodoEdit("Хлеб", "2026-10-05", null, "Дом")).details?.location)
    }

    @Test fun `переехавшее со вчера - в шторке сегодняшнее, повторяющееся - своего дня`() {
        assertEquals("2026-10-05", TodoEdits.initialDay(todo.copy(day = "2026-10-03"), "2026-10-05"))
        assertEquals("2026-10-03", TodoEdits.initialDay(todo.copy(day = "2026-10-03", recurring = true), "2026-10-05"))
    }

    @Test fun `обновлено N мин назад`() {
        val now = Instant.parse("2026-10-05T10:00:00Z")
        assertEquals("обновлено только что", CalendarAccounts.syncedLabel(Strings.ru, "2026-10-05T09:59:30Z", now))
        assertEquals("обновлено 3 мин назад", CalendarAccounts.syncedLabel(Strings.ru, "2026-10-05T09:57:00Z", now))
        assertEquals("", CalendarAccounts.syncedLabel(Strings.ru, null, now))
        assertEquals("", CalendarAccounts.syncedLabel(Strings.ru, "не дата", now))
    }

    @Test fun `наши дела пишутся в подключённый последним из рабочих`() {
        val a = CalendarAccount(1, TodoSource.Apple, status = "ok", defaultUrl = "a")
        val g = CalendarAccount(2, TodoSource.Google, status = "setup", defaultUrl = "g")
        assertEquals(1L, CalendarAccounts.destination(listOf(a, g))?.id)
        assertEquals(2L, CalendarAccounts.destination(listOf(a, g.copy(status = "ok")))?.id)
        assertNull(CalendarAccounts.destination(emptyList()))
    }

    @Test fun `форма Apple - почта и пароль приложения`() {
        assertTrue(CalendarAccounts.appleFormValid("a@b.c", "abcd-efgh-ijkl-mnop"))
        assertFalse(CalendarAccounts.appleFormValid("abc", "abcd-efgh-ijkl-mnop"))
        assertFalse(CalendarAccounts.appleFormValid("a@b.c", "abcd-efg"))
    }

    @Test fun `ссылка на созвон или просто ссылка`() {
        assertTrue(isCallLink("https://meet.google.com/abc"))
        assertTrue(isCallLink("https://us02web.zoom.us/j/1"))
        assertFalse(isCallLink("https://example.com/doc"))
    }

    @Test fun `ответ календаря и аккаунтов читается`() {
        val range = ApiClient.json.decodeFromString(CalendarRange.serializer(), """{"today":"2026-10-05","todos":[{"id":1,"title":"x","day":"2026-10-05","done":false,"time":"10:00","duration_min":30,"recurring":true,"source":"google","details":{"location":"Офис","people_count":3}}],"groups":[]}""")
        assertEquals(30, range.todos[0].durationMin)
        assertEquals(3, range.todos[0].details?.peopleCount)
        val acc = ApiClient.json.decodeFromString(CalendarAccount.serializer(), """{"id":7,"provider":"google","login":"a@gmail.com","status":"setup","last_sync_at":null,"default_url":null,"collections":[{"url":"u","name":"Работа","color":"#f00","enabled":true,"writable":true}]}""")
        assertEquals(TodoSource.Google, acc.provider)
        assertTrue(acc.collections[0].writable)
    }
}
