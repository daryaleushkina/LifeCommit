package app.lifecommit

import androidx.compose.ui.test.performClick
import app.lifecommit.core.HistoryGoal
import app.lifecommit.core.HistoryLog
import app.lifecommit.core.Schedule
import app.lifecommit.core.TaskHistory
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DetailTest : AppTest() {
    private val gym = TodayTask(id = 1, title = "Спортзал", kind = TaskKind.Check, schedule = Schedule.Weekdays, weekdays = 0b0010101)
    private val quit = TodayTask(id = 3, title = "Не курить", kind = TaskKind.Abstain, cleanBefore = 6, lastSlipOn = "2026-09-28")

    private fun seed() {
        server.today = TodayResponse("2026-10-09", tasks = listOf(gym, quit))
        server.histories[1] = TaskHistory("2026-10-01", listOf(HistoryGoal("2026-10-01", 1.0)), listOf(HistoryLog("2026-10-02", 1.0), HistoryLog("2026-10-05", 1.0)))
        server.histories[3] = TaskHistory("2026-10-03", emptyList(), emptyList())
    }

    @Test fun `тап по названию - экран привычки с числами за месяц`() {
        seed()
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitText("Пн, ср, пт")
        compose.waitText("2 из 4")
        compose.waitText("по плану за октябрь")
        compose.waitText("Октябрь 2026")
    }

    @Test fun `отметка задним числом - на экране сразу, на сервер с днём`() {
        seed()
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitText("2 из 4")
        compose.waitLabel("7 октября").performClick()
        compose.waitText(t.markDone).performClick()
        compose.waitText("3 из 4")
        compose.waitFor { server.calls("PUT", "/api/logs").isNotEmpty() }
        val body = server.calls("PUT", "/api/logs").single().json
        assertEquals("\"2026-10-07\"", body["day"].toString())
        assertEquals("1", body["value"].toString())
    }

    @Test fun `убрать отметку задним числом`() {
        seed()
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitText("2 из 4")
        compose.waitLabel("2 октября").performClick()
        compose.waitText(t.markClear).performClick()
        compose.waitText("1 из 4")
        compose.waitFor { server.calls("PUT", "/api/logs").isNotEmpty() }
        assertEquals("null", server.calls("PUT", "/api/logs").single().json["value"].toString())
    }

    @Test fun `сервер не сохранил отметку задним числом - откат и ошибка`() {
        seed()
        server.failures["PUT /api/logs"] = 500 to "internal"
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitText("2 из 4")
        compose.waitLabel("7 октября").performClick()
        compose.waitText(t.markDone).performClick()
        compose.waitText(t.error)
        compose.waitText("2 из 4")
    }

    @Test fun `бросить - счёт дней, с какого дня, было задним числом`() {
        seed()
        launch()
        compose.waitText("Не курить").performClick()
        compose.waitText("С 29 сентября")
        compose.waitText(t.cleanDaysWord(6))
        compose.waitLabel("4 октября").performClick()
        compose.waitText(t.markSlip).performClick()
        compose.waitFor { server.calls("PUT", "/api/logs").isNotEmpty() }
        val body = server.calls("PUT", "/api/logs").single().json
        assertEquals("\"slip\"", body["status"].toString())
        assertEquals("null", body["value"].toString())
        // После отметки задним числом перечитываются «Сегодня» и карта (в фоне).
        compose.waitFor { server.calls("GET", "/api/heatmap").size >= 2 }
    }

    @Test fun `месяц назад - и обратно, вперёд сегодняшнего нельзя`() {
        seed()
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitLabel(t.prevMonth).performClick()
        compose.waitText("Сентябрь 2026")
        compose.waitLabel(t.nextMonth).performClick()
        compose.waitText("Октябрь 2026")
    }

    @Test fun `карандаш - редактор этой привычки`() {
        seed()
        launch()
        compose.waitText("Спортзал").performClick()
        compose.waitLabel(t.editTask).performClick()
        compose.waitText(t.save)
    }
}
