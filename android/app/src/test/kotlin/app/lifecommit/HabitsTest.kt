package app.lifecommit

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import app.lifecommit.core.ArchivedTask
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HabitsTest : AppTest() {
    private val reading = TodayTask(id = 5, title = "Читать", kind = TaskKind.Count, target = 20.0)

    @Test fun `первый экран - Чего я хочу, Пропустить запоминается`() {
        launch()
        compose.waitText(t.onboardingTitle)
        compose.waitText(t.onboardingSkip).performClick()
        compose.waitText(t.nothingDue)
    }

    @Test fun `первая привычка - вид, название, цель, Добавить - на сервер и на Сегодня`() {
        launch()
        compose.waitText(t.intents.getValue(TaskKind.Count).title).performClick()
        compose.waitText(t.newTask)
        // Без названия «Добавить» неактивна.
        compose.onNodeWithTag("save").assertIsNotEnabled()
        compose.onNodeWithTag("title").performTextInput("Читать")
        compose.waitLabel("+").performClick()
        compose.waitText(t.add).performClick()
        compose.waitText("0 из 11")
        val body = server.calls("POST", "/api/tasks").single().json
        assertEquals("\"Читать\"", body["title"].toString())
        assertEquals("\"count\"", body["kind"].toString())
        assertEquals(11.0, body["target"].toString().toDouble(), 0.0)
        assertEquals("\"daily\"", body["schedule"].toString())
    }

    @Test fun `Добавить привычку с Сегодня - Назад возвращает к выбору вида`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        launch()
        compose.waitText(t.addTask).performClick()
        compose.waitText(t.intents.getValue(TaskKind.Abstain).title).performClick()
        compose.waitText(t.titlePh.getValue(TaskKind.Abstain))
        compose.waitText(t.back).performClick()
        compose.waitText(t.onboardingTitle)
    }

    @Test fun `правка - Сохранить шлёт только поля формы, без вида, и возвращает на Сегодня`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        launch()
        openEditor("Читать")
        compose.onNodeWithTag("title").performTextClearance()
        compose.onNodeWithTag("title").performTextInput("Читать книгу")
        compose.waitText(t.save).performClick()
        compose.waitText("Читать книгу")
        compose.waitText(t.today)
        val patch = server.calls("PATCH", "/api/tasks/5").single().json
        assertEquals("\"Читать книгу\"", patch["title"].toString())
        assertTrue(!patch.containsKey("kind"))
    }

    @Test fun `цель стала легче - сначала сказать, что применится с завтра`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        server.goalEffectiveFrom = "2026-10-06"
        launch()
        openEditor("Читать")
        compose.waitLabel("−").performClick()
        compose.waitText(t.save).performClick()
        compose.waitText(t.goalTomorrow)
        compose.waitText("OK").performClick()
        compose.waitText(t.today)
    }

    @Test fun `сервер не сохранил - сообщение под формой, форма остаётся`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        server.failures["PATCH /api/tasks/5"] = 500 to "internal"
        launch()
        openEditor("Читать")
        compose.waitText(t.save).performClick()
        compose.waitText(t.error)
        compose.waitText(t.editTask)
    }

    @Test fun `удалить из редактора - с подтверждением, вместе с историей`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        launch()
        openEditor("Читать")
        compose.waitText(t.deleteTask).performClick()
        compose.waitText(t.deleteForeverConfirm)
        compose.waitText(t.cancel).performClick()
        assertTrue(server.calls("DELETE", "/api/tasks/5").isEmpty())
        compose.waitText(t.deleteTask).performClick()
        compose.onNode(androidx.compose.ui.test.hasText(t.deleteForever).and(androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog()))).performClick()
        compose.waitFor { server.calls("DELETE", "/api/tasks/5").size == 1 }
        // Как в мини-аппе (App.tsx): «Чего я хочу?» — только при запуске; удалили последнюю — пустое «Сегодня».
        compose.waitText(t.nothingDue)
    }

    @Test fun `Отложить - привычка уходит в Отложенные, Вернуть - обратно`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading, TodayTask(id = 6, title = "Зарядка", kind = TaskKind.Check)))
        launch()
        openEditor("Читать")
        compose.waitText(t.postpone).performClick()
        compose.waitText(t.archivedLink(1)).performClick()
        compose.waitText(t.archive)
        compose.waitText(t.restore).performClick()
        compose.waitFor { server.calls("POST", "/api/tasks/5/restore").size == 1 }
        // Пусто — экран закрывается сам.
        compose.waitText(t.today)
    }

    @Test fun `Отложенные - лимит привычек при возврате - сообщение`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading), archived = listOf(ArchivedTask(7, "Бег")))
        server.failures["POST /api/tasks/7/restore"] = 402 to "task_limit"
        launch()
        compose.waitText(t.archivedLink(1)).performClick()
        compose.waitText(t.restore).performClick()
        compose.waitText(t.limitReached(5))
    }

    @Test fun `разделов, которых ещё нет, - ссылка в мини-апп, микрофон - чат с ботом`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(reading))
        launch()
        // «Календарь» и «Вместе» уже есть в приложении — раздел, которого ещё нет, это «Я».
        compose.waitText(t.me).performClick()
        compose.waitText(t.pendingSection)
        compose.waitText(t.openInTelegram).performClick()
        assertEquals("https://t.me/LifeCommit_bot?startapp" to false, opened.last())
        compose.waitLabel(t.voiceMic).performClick()
        compose.waitText(t.openBot).performClick()
        assertEquals("https://t.me/LifeCommit_bot" to false, opened.last())
    }
}
