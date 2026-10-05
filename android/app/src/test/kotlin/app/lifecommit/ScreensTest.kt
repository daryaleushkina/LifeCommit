// Эталонные снимки экранов (Roborazzi на JVM): светлая и тёмная тема. Переснимать — только при намеренной правке вида
// (./gradlew :app:recordRoborazziDebug), сверка — :app:verifyRoborazziDebug (CLAUDE.md, «Тесты»).
package app.lifecommit

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.performClick
import app.lifecommit.core.ArchivedTask
import app.lifecommit.core.TaskKind
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner

@RunWith(ParameterizedRobolectricTestRunner::class)
class ScreensTest(private val theme: String) : AppTest() {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun themes() = listOf(arrayOf("light"), arrayOf("dark"))
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("src/test/screenshots/$theme/$name.png")
    }

    private fun seed() {
        server.today = TodayResponse(
            day = "2026-10-05",
            tasks = listOf(
                TodayTask(id = 1, title = "Сходить в спортзал", kind = TaskKind.Check, value = 1.0),
                TodayTask(id = 2, title = "Пить воду", kind = TaskKind.Count, target = 8.0, value = 3.0, unit = "стаканов"),
                TodayTask(id = 3, title = "Не курить", kind = TaskKind.Abstain, cleanBefore = 6),
                TodayTask(id = 4, title = "Читать", kind = TaskKind.Count, target = 20.0, due = false, schedule = app.lifecommit.core.Schedule.PerWeek, perWeek = 3),
            ),
            archived = listOf(ArchivedTask(7, "Бег")),
            todos = listOf(
                Todo(10, "Позвонить в банк", "2026-10-05", time = "15:00"),
                Todo(11, "Купить корм коту", "2026-10-04"),
                Todo(12, "Отправить отчёт", "2026-10-05", done = true),
            ),
            todosLater = 2,
        )
    }

    private fun start() {
        dark = theme == "dark"
        launch()
    }

    @Test fun signIn() {
        runBlocking { tokens.clear() }
        start()
        compose.waitText(t.signIn)
        shot("sign-in")
    }

    @Test fun today() {
        seed()
        start()
        compose.waitText("Позвонить в банк")
        shot("today")
    }

    @Test fun onboarding() {
        start()
        compose.waitText(t.onboardingTitle)
        shot("onboarding")
    }

    @Test fun editors() {
        seed()
        start()
        openEditor("Пить воду")
        shot("editor-count")
        compose.runOnUiThread { model.backToMain() }
        openEditor("Не курить")
        compose.waitText(t.lastSlip)
        shot("editor-abstain")
    }

    @Test fun details() {
        seed()
        server.histories[2] = app.lifecommit.core.TaskHistory("2026-09-28", listOf(app.lifecommit.core.HistoryGoal("2026-09-28", 8.0)), (28..30).map { app.lifecommit.core.HistoryLog("2026-09-$it", (it - 22).toDouble()) } + (1..4).map { app.lifecommit.core.HistoryLog("2026-10-0$it", (it * 2).toDouble()) })
        server.histories[3] = app.lifecommit.core.TaskHistory("2026-10-01", emptyList(), listOf(app.lifecommit.core.HistoryLog("2026-10-03", 0.0, app.lifecommit.core.AbstainStatus.Slip)))
        start()
        compose.waitText("Пить воду").performClick()
        // Снимать, когда пришла история: подписи «лучший день» и т. п. есть и без неё — кадр бывал раньше ответа.
        compose.waitFor { model.histories.containsKey(2L) }
        compose.waitText(t.statBest)
        shot("detail-count")
        compose.runOnUiThread { model.backToMain() }
        compose.waitText("Не курить").performClick()
        compose.waitFor { model.histories.containsKey(3L) }
        compose.waitText(t.statRunNow)
        shot("detail-abstain")
    }

    @Test fun later() {
        seed()
        server.later = listOf(Todo(20, "Купить подарок", "2026-10-06"), Todo(21, "Записаться к врачу", "2026-10-09", time = "09:30"))
        start()
        compose.waitText(t.todo.later(2)).performClick()
        compose.waitText("Записаться к врачу")
        shot("later")
    }

    private fun seedCalendar() {
        seed()
        server.calendarTodos = listOf(
            Todo(30, "Записаться к врачу", "2026-10-07"),
            Todo(31, "Созвон с командой", "2026-10-05", time = "10:00", durationMin = 30, source = app.lifecommit.core.TodoSource.Google,
                details = app.lifecommit.core.TodoDetails(link = "https://meet.google.com/abc", peopleCount = 4, people = listOf("Маша", "Петя"), notes = "Обсудить планы на квартал")),
        )
    }

    /** Открыть «Календарь» и дождаться календарей: баннер «Подключите» появляется после ответа и сдвигает экран. */
    private fun openCalendar() {
        compose.waitText(t.calendar).performClick()
        compose.waitFor { model.calendar.accounts != null && model.calendar.todos != null }
    }

    @Test fun calendar() {
        seedCalendar()
        start()
        openCalendar()
        compose.waitText("Созвон с командой")
        shot("calendar-day")
        compose.waitText(t.month).performClick()
        compose.waitText("Октябрь 2026")
        shot("calendar-month")
    }

    @Test fun todoSheets() {
        seedCalendar()
        start()
        openCalendar()
        compose.waitText("Созвон с командой").performClick()
        compose.waitText(t.todo.join)
        shot("sheet-event")
        androidx.test.espresso.Espresso.pressBack()
        compose.waitText("Позвонить в банк").performClick()
        compose.waitText(t.todo.place)
        shot("sheet-todo")
    }

    @Test fun calendarsSheets() {
        seed()
        // «обновлено 3 мин назад» считается от сейчас — время синхронизации тоже от сейчас, иначе снимок меняется сам.
        val synced = java.time.Instant.now().minusSeconds(190).toString()
        server.accounts = listOf(app.lifecommit.core.CalendarAccount(8, app.lifecommit.core.TodoSource.Apple, "d@icloud.com", "ok", synced, "home",
            listOf(app.lifecommit.core.CalendarCollection("home", "Дом", "#3FA968", true, true), app.lifecommit.core.CalendarCollection("work", "Работа", "#4470CC", false, true))))
        start()
        openCalendar()
        compose.waitLabel(t.cal.sheetTitle).performClick()
        compose.waitText(t.cal.whatToTake.uppercase())
        shot("sheet-calendars")
    }

    @Test fun appleForm() {
        seed()
        start()
        openCalendar()
        compose.waitText(t.cal.connect).performClick()
        compose.onNodeWithTag("connectApple").performClick()
        compose.waitText(t.cal.appleTitle)
        shot("sheet-apple")
    }

    @Test fun archive() {
        seed()
        start()
        compose.waitText("Позвонить в банк")
        // Долистать до конца, как человек: последняя строка встаёт над нижней панелью.
        repeat(3) { compose.onNodeWithTag("today").performTouchInput { swipeUp() } }
        compose.waitText(t.archivedLink(1)).performClick()
        compose.waitText(t.restore)
        shot("archive")
    }

    @Test fun pendingAndMe() {
        seed()
        start()
        compose.waitText(t.groups).performClick()
        compose.waitText(t.pendingSection)
        shot("groups-pending")
        compose.waitText(t.me).performClick()
        compose.waitText(t.logoutDevice)
        shot("me")
    }
}
