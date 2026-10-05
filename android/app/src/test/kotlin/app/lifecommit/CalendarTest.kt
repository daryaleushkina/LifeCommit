// «Календарь» через интерфейс, как человек: дни, дела дня, шторка дела, подключение Apple и Google, возврат после Google.
package app.lifecommit

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import app.lifecommit.core.CalendarAccount
import app.lifecommit.core.CalendarCollection
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodoDetails
import app.lifecommit.core.TodoSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CalendarTest : AppTest() {
    private fun seed() {
        server.today = TodayResponse("2026-10-05", todos = listOf(Todo(10, "Позвонить в банк", "2026-10-05", time = "15:00")))
        server.calendarTodos = listOf(
            Todo(11, "Записаться к врачу", "2026-10-06"),
            Todo(12, "Созвон с командой", "2026-10-06", time = "10:00", durationMin = 30, source = TodoSource.Google, details = TodoDetails(link = "https://meet.google.com/abc", peopleCount = 4, people = listOf("Маша", "Петя"))),
            Todo(13, "Отчёт", "2026-10-02", done = true),
        )
    }

    private fun openCalendar() {
        compose.waitText(t.calendar).performClick()
        // Календарей нет — сверху предложение подключить.
        compose.waitText(t.cal.connectTitle)
    }

    @Test fun `день - дела дня, стрелки, К сегодня`() {
        seed()
        launch()
        openCalendar()
        compose.waitText("Позвонить в банк")
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText("Вторник, 6 октября")
        compose.waitText("Записаться к врачу")
        compose.waitText("Созвон с командой")
        compose.waitText(t.backToToday).performClick()
        compose.waitText("Понедельник, 5 октября")
    }

    @Test fun `дело на будущий день - с этим днём`() {
        seed()
        launch()
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText(t.calAdd).performClick()
        compose.onNodeWithTag("todoInput").performTextInput("Купить подарок")
        compose.onNodeWithTag("todoInput").performImeAction()
        compose.waitFor { server.calls("POST", "/api/todos").isNotEmpty() }
        assertEquals("\"2026-10-06\"", server.calls("POST", "/api/todos").single().json["day"].toString())
        compose.waitText("Купить подарок")
    }

    @Test fun `прошедший день - добавить нельзя, пусто - В этот день ничего`() {
        seed()
        launch()
        openCalendar()
        compose.waitLabel(t.prevDay).performClick()
        compose.waitText(t.calEmpty)
        assertTrue(compose.onAllNodes(hasText(t.calAdd)).fetchSemanticsNodes().isEmpty())
    }

    @Test fun `месяц - сетка, выбор дня показывает его дела`() {
        seed()
        launch()
        openCalendar()
        compose.waitText(t.month).performClick()
        compose.waitText("Октябрь 2026")
        compose.waitLabel("2 октября").performClick()
        compose.waitText("Отчёт")
    }

    @Test fun `шторка дела - название и завтра`() {
        seed()
        launch()
        openCalendar()
        compose.waitText("Позвонить в банк").performClick()
        compose.waitText(t.todo.edit)
        compose.onNodeWithTag("todoTitle").performTextClearance()
        compose.onNodeWithTag("todoTitle").performTextInput("Позвонить в налоговую")
        compose.waitText(t.todo.tomorrow).performClick()
        compose.onNodeWithTag("todoDone").performClick()
        compose.waitFor { server.calls("PATCH", "/api/todos/10").isNotEmpty() }
        val body = server.calls("PATCH", "/api/todos/10").single().json
        assertEquals("\"Позвонить в налоговую\"", body["title"].toString())
        assertEquals("\"2026-10-06\"", body["day"].toString())
        assertTrue(!body.containsKey("time"))
    }

    @Test fun `событие - подробности, ссылка на созвон, Скрыть свайпом`() {
        seed()
        launch(undoMillis = 300)
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText("Созвон с командой").performClick()
        compose.waitText(t.todo.event)
        compose.waitText(t.todo.join).performClick()
        assertEquals("https://meet.google.com/abc" to true, opened.last())
        compose.waitText(t.todo.people(4))
        compose.waitText(t.todo.fromGoogle)
        compose.waitText(t.todo.deleteEvent)
        // Закрыть шторку системным «назад», как человек.
        androidx.test.espresso.Espresso.pressBack()
        compose.waitFor { compose.onAllNodes(hasText(t.todo.event)).fetchSemanticsNodes().isEmpty() }
        compose.waitText("Созвон с командой").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.hidden("Созвон с командой"))
        compose.waitFor { server.calls("PATCH", "/api/todos/12").any { it.json["hidden"].toString() == "true" } }
    }

    @Test fun `на Сегодня - тап по делу открывает шторку, Без времени - time null`() {
        seed()
        launch()
        compose.waitText("Позвонить в банк").performClick()
        compose.waitText(t.todo.edit)
        compose.waitText(t.todo.time)
        // Время — системный выбор; здесь проверяем только, что «Готово» без правок ничего не шлёт.
        compose.onNodeWithTag("todoDone").performClick()
        assertTrue(server.calls("PATCH", "/api/todos/10").isEmpty())
    }

    @Test fun `подключить Apple - пароль приложения, неверный - ошибка, верный - подключено`() {
        seed()
        launch()
        openCalendar()
        compose.waitText(t.cal.connect).performClick()
        compose.waitText(t.cal.sheetTitle)
        compose.onNodeWithTag("connectApple").performClick()
        compose.waitText(t.cal.appleTitle)
        compose.onNodeWithTag("appleLogin").performTextInput("dasha@icloud.com")
        compose.onNodeWithTag("applePassword").performTextInput("wrong-pass-word-xx")
        compose.onNodeWithTag("appleSubmit").performClick()
        compose.waitText(t.cal.errAuth)
        compose.onNodeWithTag("applePassword").performTextClearance()
        compose.onNodeWithTag("applePassword").performTextInput("abcd-efgh-ijkl-mnop")
        compose.onNodeWithTag("appleSubmit").performClick()
        compose.waitText(t.cal.connected, timeout = 8_000, substring = true)
        compose.waitFor { server.calls("POST", "/api/calendars/sync").isNotEmpty() }
    }

    @Test fun `подключить Google - адрес входа с client=app открывается снаружи`() {
        seed()
        launch()
        openCalendar()
        compose.waitText(t.cal.connect).performClick()
        compose.onNodeWithTag("connectGoogle").performClick()
        assertEquals(server.googleUrl!! to true, opened.last())
        assertTrue(server.calls("GET", "/api/calendars/google/url").isNotEmpty())
    }

    @Test fun `возврат из Google - ok, выбор календарей и Готово`() {
        seed()
        server.accounts = listOf(CalendarAccount(7, TodoSource.Google, "dasha@gmail.com", "setup", collections = listOf(CalendarCollection("work", "Работа", "#4470CC", true, true), CalendarCollection("hol", "Праздники", null, false, false))))
        launch()
        compose.waitText("Позвонить в банк")
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok") }
        compose.waitText(t.cal.googleChoose)
        compose.onNodeWithTag("googleDone").performClick()
        compose.waitFor { server.calls("POST", "/api/calendars/7/confirm").size == 1 }
    }

    @Test fun `возврат из Google - отказ - объяснение в шторке`() {
        seed()
        launch()
        compose.waitText("Позвонить в банк")
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=denied") }
        compose.waitText(t.cal.googleReturn.getValue("denied").first, substring = true)
    }

    @Test fun `выключить календарь не вышло - переключатель назад и ошибка`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", "2026-10-05T10:00:00Z", "home", listOf(CalendarCollection("home", "Дом", null, true, true))))
        server.failures["PATCH /api/calendars/8/collections"] = 500 to "internal"
        launch()
        openCalendarConnected()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitText(t.cal.whatToTake.uppercase())
        compose.onNode(androidx.compose.ui.test.isToggleable()).performClick()
        compose.waitText(t.error)
        assertTrue(model.calendar.accounts!!.single().collections.single().enabled)
    }

    @Test fun `отключить календарь - с подтверждением`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", "2026-10-05T10:00:00Z", "home", listOf(CalendarCollection("home", "Дом", null, true, true))))
        launch()
        openCalendarConnected()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitText(t.cal.disconnectOf(t.cal.apple)).performClick()
        compose.waitText(t.cal.disconnectConfirm)
        compose.onNode(hasText(t.cal.disconnect).and(androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog()))).performClick()
        compose.waitFor { server.calls("DELETE", "/api/calendars/apple").size == 1 }
    }

    private fun openCalendarConnected() {
        compose.waitText(t.calendar).performClick()
        compose.waitLabel(t.cal.refresh)
    }

    @Test fun `возврат из Google, пока приложение ещё загружается, - ключ не теряется, шторка после загрузки`() {
        seed()
        server.sessionDelayMs = 1000
        launch()
        // Приложение выгрузили, пока был открыт вход Google: возврат приходит сразу после запуска.
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=again") }
        compose.waitText(t.cal.sheetTitle, timeout = 8_000)
        assertTrue(server.calls("GET", "/api/calendars").none { it.auth == null })
        assertEquals("session-key", kotlinx.coroutines.runBlocking { tokens.load() })
    }

    @Test fun `после выхода календарь чистый - чужие дела и календари не видны`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", collections = emptyList()))
        launch()
        compose.waitText(t.calendar).performClick()
        compose.waitText("Позвонить в банк")
        compose.waitFor { model.calendar.accounts != null }
        compose.runOnUiThread { model.signOutLocally() }
        compose.waitText(t.signIn)
        assertEquals(null, model.calendar.accounts)
        assertEquals(null, model.calendar.todos)
    }

    @Test fun `ответ календаря, начатый до отметки, отметку не затирает`() {
        seed()
        launch()
        openCalendar()
        compose.waitText("Позвонить в банк")
        server.calendarDelayMs = 1500
        compose.runOnUiThread {
            model.calendar.load()
            model.calendarTodos.toggle(model.calendar.ofDay("2026-10-05").first { it.id == 10L })
        }
        compose.waitFor { server.calls("PATCH", "/api/todos/10").isNotEmpty() }
        // Медленный ответ, начатый до отметки, дошёл — и отметка на месте.
        compose.waitFor(8_000) { model.calendar.inFlight == 0 }
        assertTrue(model.calendar.ofDay("2026-10-05").first { it.id == 10L }.done)
        compose.waitLabel(t.todo.uncheck("Позвонить в банк"))
    }

    @Test fun `обновить во время синхронизации - вторая синхронизация не теряется`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", collections = listOf(CalendarCollection("home", "Дом", null, false, true))))
        server.syncDelayMs = 800
        launch()
        compose.waitText(t.calendar).performClick()
        compose.waitLabel(t.cal.refresh)
        compose.runOnUiThread {
            model.calendar.syncNow()
            model.calendar.syncNow()
        }
        compose.waitFor(8_000) { server.calls("POST", "/api/calendars/sync").size == 2 }
    }
}
