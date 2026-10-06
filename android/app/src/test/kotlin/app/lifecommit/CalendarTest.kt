// «Календарь» через интерфейс, как человек: дни, дела дня, шторка дела, подключение Apple и Google, возврат после Google.
package app.lifecommit

import androidx.compose.ui.test.assertCountEquals
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

    private val code = "a".repeat(43)

    /** Нажали «Подключить» у Google — приложение ждёт возврата 15 минут. */
    private fun startGoogle() {
        compose.waitText(t.calendar).performClick()
        compose.waitText(t.cal.connect).performClick()
        compose.onNodeWithTag("connectGoogle").performClick()
        compose.waitFor { opened.isNotEmpty() }
    }

    @Test fun `возврат из Google - код своим ключом в finish, новый - выбор календарей и Готово`() {
        seed()
        launch()
        startGoogle()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=$code") }
        compose.waitFor { server.calls("POST", "/api/calendars/google/finish").size == 1 }
        val call = server.calls("POST", "/api/calendars/google/finish").single()
        assertEquals("\"$code\"", call.json["pending"].toString())
        assertEquals("Bearer session-key", call.auth)
        compose.waitText(t.cal.googleChoose)
        compose.onNodeWithTag("googleDone").performClick()
        compose.waitFor { server.calls("POST", "/api/calendars/7/confirm").size == 1 }
    }

    @Test fun `возврат из Google - сервер не ответил - тот же код можно отправить ещё раз`() {
        seed()
        server.failures["POST /api/calendars/google/finish"] = 500 to "server_error"
        launch()
        startGoogle()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=$code") }
        compose.waitText(t.retry)
        server.failures.remove("POST /api/calendars/google/finish")
        compose.onNodeWithTag("googleRetry").performClick()
        compose.waitText(t.cal.googleChoose)
        val calls = server.calls("POST", "/api/calendars/google/finish")
        assertEquals(2, calls.size)
        assertTrue(calls.all { it.json["pending"].toString() == "\"$code\"" })
    }

    @Test fun `ссылка возврата без начатого входа - не принимается`() {
        seed()
        launch()
        compose.waitText("Позвонить в банк")
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=$code") }
        compose.waitText("Позвонить в банк")
        assertTrue(server.calls("POST", "/api/calendars/google/finish").isEmpty())
        assertTrue(!model.calendar.sheetOpen)
    }

    @Test fun `возврат из Google - ссылка устарела или чужая - объяснение, без кода - не получилось`() {
        seed()
        launch()
        startGoogle()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=old" + "a".repeat(40)) }
        compose.waitText(t.cal.googleLinkExpired, substring = true)
        startGoogleAgain()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok") }
        compose.waitText(t.cal.googleReturn.getValue("failed").first, substring = true)
        startGoogleAgain()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=denied") }
        compose.waitText(t.cal.googleReturn.getValue("denied").first, substring = true)
        assertEquals(1, server.calls("POST", "/api/calendars/google/finish").size)
    }

    private fun startGoogleAgain() {
        compose.onNodeWithTag("connectGoogle").performClick()
    }

    @Test fun `возврат, который запустил выгруженное приложение, - после загрузки и со своим ключом`() {
        seed()
        prefs.setString("lc-gcal-wait", (System.currentTimeMillis() + 60_000).toString())
        server.sessionDelayMs = 1000
        launch()
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=$code") }
        compose.waitText(t.cal.googleChoose, timeout = 8_000)
        assertTrue(server.calls("POST", "/api/calendars/google/finish").all { it.auth == "Bearer session-key" })
        assertEquals("session-key", kotlinx.coroutines.runBlocking { tokens.load() })
    }

    // Сбои и края «Календаря» (/lc-review и /code-review 06.10)

    @Test fun `отметка дела не дошла - снова пустой кружок и ошибка`() {
        seed()
        server.failures["PATCH /api/todos/11"] = 500 to "server_error"
        launch()
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitLabel(t.todo.check("Записаться к врачу")).performClick()
        compose.waitText(t.error)
        compose.waitLabel(t.todo.check("Записаться к врачу"))
    }

    @Test fun `новое дело не сохранилось - строки нет и ошибка`() {
        seed()
        server.failures["POST /api/todos"] = 500 to "server_error"
        launch()
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText(t.calAdd).performClick()
        compose.onNodeWithTag("todoInput").performTextInput("Купить подарок")
        compose.onNodeWithTag("todoInput").performImeAction()
        compose.waitText(t.error)
        compose.waitFor { model.calendar.ofDay("2026-10-06").none { it.title == "Купить подарок" } }
    }

    @Test fun `своё дело свайпом - удаляется, а не скрывается`() {
        seed()
        launch(undoMillis = 300)
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText("Записаться к врачу").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitFor { server.calls("DELETE", "/api/todos/11").size == 1 }
        assertTrue(server.calls("PATCH", "/api/todos/11").isEmpty())
    }

    @Test fun `добавили дело и сразу ушли на далёкий день - его дела приходят, а дело получает свой номер`() {
        seed()
        launch()
        openCalendar()
        compose.waitFor { model.calendar.inFlight == 0 }
        // Дело сохраняется быстро, а дела далёкого дня идут дольше: сохранение приходит, пока они ещё в пути.
        server.slow["POST /api/todos"] = 300
        server.calendarDelayMs = 1200
        compose.runOnUiThread {
            model.calendarTodos.add("Купить подарок", "2026-10-05")
            model.calendar.select("2026-11-20")
        }
        compose.waitFor { server.calls("POST", "/api/todos").size == 1 }
        compose.waitFor(8_000) { model.calendar.inFlight == 0 }
        assertTrue(model.calendar.todos != null)
        server.calendarDelayMs = 0
        compose.runOnUiThread { model.calendar.select("2026-10-05") }
        compose.waitFor { model.calendar.ofDay("2026-10-05").any { it.title == "Купить подарок" && it.id > 0 } }
    }

    @Test fun `Google сломался - в шторке «Переподключить» со свежей ссылкой`() {
        seed()
        server.accounts = listOf(CalendarAccount(9, TodoSource.Google, "d@gmail.com", "auth_failed", collections = listOf(CalendarCollection("work", "Работа", null, true, true))))
        launch()
        openCalendarConnected()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        // «Подключить заново» есть и над днями (ведёт в шторку), и в самой шторке — нажимаем в шторке.
        compose.waitFor { compose.onAllNodes(hasText(t.cal.reconnect).and(androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog()))).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasText(t.cal.reconnect).and(androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog()))).performClick()
        compose.waitFor { opened.any { it.first.startsWith("https://accounts.google.com/") } }
    }

    @Test fun `«Наши дела — в» - выбор уходит на сервер, не вышло - как было и ошибка`() {
        seed()
        val cols = listOf(CalendarCollection("home", "Дом", null, true, true), CalendarCollection("work", "Работа", null, true, true))
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", "2026-10-05T10:00:00Z", "home", cols))
        launch()
        openCalendarConnected()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitText(t.cal.writeTo).performClick()
        compose.onAllNodes(hasText("Работа")).let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitFor { server.calls("PATCH", "/api/calendars/8/default").size == 1 }
        assertEquals("\"work\"", server.calls("PATCH", "/api/calendars/8/default").single().json["url"].toString())
        server.failures["PATCH /api/calendars/8/default"] = 500 to "server_error"
        compose.waitFor { model.calendar.accounts?.single()?.defaultUrl == "work" }
        compose.waitText(t.cal.writeTo).performClick()
        compose.onAllNodes(hasText("Дом")).let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitText(t.error)
        compose.waitFor { model.calendar.accounts?.single()?.defaultUrl == "work" }
    }

    @Test fun `событие со ссылкой не http - строк «Подключиться» и «Открыть в Google» нет`() {
        seed()
        server.calendarTodos = listOf(Todo(12, "Созвон с командой", "2026-10-06", time = "10:00", source = TodoSource.Google, details = TodoDetails(link = "lifecommit://join/abcd1234", openUrl = "intent://evil#Intent;end")))
        launch()
        openCalendar()
        compose.waitLabel(t.nextDay).performClick()
        compose.waitText("Созвон с командой").performClick()
        compose.waitText(t.todo.event)
        compose.waitForIdle()
        compose.onAllNodes(hasText(t.todo.join)).assertCountEquals(0)
        compose.onAllNodes(hasText(t.todo.openLink)).assertCountEquals(0)
        compose.onAllNodes(hasText(t.todo.openGoogle, substring = true)).assertCountEquals(0)
    }

    @Test fun `шторка дела - «Без времени» стирает время`() {
        seed()
        launch()
        compose.waitText("Позвонить в банк").performClick()
        compose.waitText(t.todo.time).performClick()
        compose.waitFor { (org.robolectric.shadows.ShadowDialog.getLatestDialog() as? android.app.TimePickerDialog)?.isShowing == true }
        (org.robolectric.shadows.ShadowDialog.getLatestDialog() as android.app.TimePickerDialog).getButton(android.content.DialogInterface.BUTTON_NEUTRAL).performClick()
        compose.waitText(t.todo.allDay)
        compose.onNodeWithTag("todoDone").performClick()
        compose.waitFor { server.calls("PATCH", "/api/todos/10").size == 1 }
        assertEquals("null", server.calls("PATCH", "/api/todos/10").single().json["time"].toString())
    }

    // Выход из аккаунта: ответы, начатые при прошлом человеке, новому не достаются.

    @Test fun `вышли, пока шёл запрос календарей, - чужие календари не записываются`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", collections = listOf(CalendarCollection("home", "Дом", null, true, true))))
        server.slow["GET /api/calendars"] = 600
        launch()
        // Запрос календарей ушёл и ждёт ответа — тут выходим.
        compose.waitText(t.calendar).performClick()
        compose.waitFor { "GET /api/calendars" in server.arrived }
        compose.runOnUiThread { model.signOutLocally() }
        compose.waitText(t.signIn)
        // Ответ дошёл и разобран.
        compose.waitFor { model.calendar.inFlight == 0 }
        assertEquals(1, server.calls("GET", "/api/calendars").size)
        assertEquals(null, model.calendar.accounts)
    }

    @Test fun `выход забывает начатый вход Google - ссылка возврата новому входу не подходит`() {
        seed()
        launch()
        startGoogle()
        compose.runOnUiThread { model.signOutLocally() }
        compose.waitText(t.signIn)
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.size >= 2 }
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=c0de") }
        compose.waitText(t.today)
        compose.runOnUiThread { model.handleLink("lifecommit://calendars?status=ok&pending=$code") }
        compose.waitForIdle()
        assertTrue(server.calls("POST", "/api/calendars/google/finish").isEmpty())
        assertTrue(!model.calendar.sheetOpen)
    }

    @Test fun `вышли, пока шли дела дня, - чужие дела не записываются`() {
        seed()
        server.slow["GET /api/calendar"] = 600
        launch()
        compose.waitText(t.calendar).performClick()
        compose.waitFor { "GET /api/calendar" in server.arrived }
        compose.runOnUiThread { model.signOutLocally() }
        compose.waitText(t.signIn)
        compose.waitFor(8_000) { model.calendar.inFlight == 0 }
        assertTrue(server.calls("GET", "/api/calendar").isNotEmpty())
        // Ни один промежуток прошлого человека не лёг (иначе предзагрузка месяца у нового его бы не перезапросила).
        assertEquals(0, model.calendar.loadedRanges)
    }

    @Test fun `ссылка входа Google - свежая не перезапрашивается, старше 12 минут - заново, «не настроен» - не спрашиваем`() {
        seed()
        launch()
        openCalendar()
        compose.waitFor { model.calendar.googleUrl != null }
        compose.waitFor { model.calendar.inFlight == 0 }
        val n = server.calls("GET", "/api/calendars/google/url").size
        // Запрос ушёл бы сразу (счётчик растёт до запуска) — проверяем его, не дожидаясь сервера.
        compose.runOnUiThread {
            model.calendar.ensureGoogleUrl(System.currentTimeMillis() + 5 * 60_000)
            assertEquals(0, model.calendar.inFlight)
        }
        compose.runOnUiThread { model.calendar.ensureGoogleUrl(System.currentTimeMillis() + 13 * 60_000) }
        compose.waitFor { server.calls("GET", "/api/calendars/google/url").size == n + 1 }
        // Google на сервере не настроен (503): ответ «скоро» не перезапрашиваем.
        server.googleUrl = null
        compose.runOnUiThread { model.calendar.loadGoogleUrl() }
        compose.waitFor { model.calendar.googleUrl == "" && model.calendar.inFlight == 0 }
        compose.runOnUiThread {
            model.calendar.ensureGoogleUrl(System.currentTimeMillis() + 13 * 60_000)
            assertEquals(0, model.calendar.inFlight)
        }
    }

    @Test fun `шторка календарей открыта - при возврате в приложение свежие календари и ссылка, закрыта - ничего`() {
        seed()
        launch()
        openCalendar()
        compose.waitFor { model.calendar.googleUrl != null && model.calendar.inFlight == 0 }
        // Шторка закрыта: ничего не запрашиваем (счётчик растёт сразу, до запуска запроса).
        compose.runOnUiThread {
            model.calendar.resumed()
            assertEquals(0, model.calendar.inFlight)
        }
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitText(t.cal.sheetHint)
        compose.waitFor { model.calendar.inFlight == 0 }
        val accounts1 = server.calls("GET", "/api/calendars").size
        val url1 = server.calls("GET", "/api/calendars/google/url").size
        compose.runOnUiThread { model.calendar.resumed() }
        compose.waitFor { server.calls("GET", "/api/calendars").size == accounts1 + 1 && server.calls("GET", "/api/calendars/google/url").size == url1 + 1 }
    }

    @Test fun `вернулись в приложение, ссылка Google не обновилась - живая ссылка остаётся, «Подключить» нажимается`() {
        seed()
        launch()
        openCalendar()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitFor { !model.calendar.googleUrl.isNullOrEmpty() }
        server.failures["GET /api/calendars/google/url"] = 500 to "server_error"
        val n = server.calls("GET", "/api/calendars/google/url").size
        compose.runOnUiThread { model.calendar.resumed() }
        compose.waitFor { server.calls("GET", "/api/calendars/google/url").size == n + 1 }
        compose.waitFor { model.calendar.inFlight == 0 }
        compose.waitForIdle()
        assertTrue(!model.calendar.googleUrl.isNullOrEmpty())
        compose.onNodeWithTag("connectGoogle").performClick()
        compose.waitFor { opened.any { it.first.startsWith("https://accounts.google.com/") } }
    }

    @Test fun `вышли во время синхронизации - у нового входа «Обновить» работает`() {
        seed()
        server.accounts = listOf(CalendarAccount(8, TodoSource.Apple, "d@icloud.com", "ok", collections = listOf(CalendarCollection("home", "Дом", null, true, true))))
        server.slow["POST /api/calendars/sync"] = 800
        launch()
        openCalendarConnected()
        compose.waitLabel(t.cal.refresh).performClick()
        compose.waitFor { "POST /api/calendars/sync" in server.arrived }
        compose.runOnUiThread { model.signOutLocally() }
        compose.waitText(t.signIn)
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.isNotEmpty() }
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=c0de") }
        compose.waitText(t.today)
        compose.waitFor { server.calls("POST", "/api/calendars/sync").size == 1 }
        server.slow.remove("POST /api/calendars/sync")
        openCalendarConnected()
        compose.waitLabel(t.cal.refresh).performClick()
        compose.waitFor { server.calls("POST", "/api/calendars/sync").size == 2 }
    }
}
