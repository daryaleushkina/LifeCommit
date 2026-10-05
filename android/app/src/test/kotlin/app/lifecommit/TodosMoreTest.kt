// Дела на «Сегодня» сверх основного: «Потом · N», «Все · Осталось», откаты и устаревшие ответы (ревью 05.10.2026).
package app.lifecommit

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import app.lifecommit.core.TaskKind
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import app.lifecommit.core.TodoSource
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TodosMoreTest : AppTest() {
    private fun seedLater() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(TodayTask(id = 1, title = "Зарядка", kind = TaskKind.Check)), todosLater = 2)
        server.later = listOf(Todo(20, "Купить подарок", "2026-10-06"), Todo(21, "Записаться к врачу", "2026-10-09"))
    }

    @Test fun `Потом - шторка с делами по дням`() {
        seedLater()
        launch()
        compose.waitText(t.todo.later(2)).performClick()
        compose.waitText(t.todo.laterTitle)
        compose.waitText("завтра")
        compose.waitText("пт, 9 октября")
        compose.waitText("Купить подарок")
        compose.waitText("Записаться к врачу")
    }

    @Test fun `Потом - смахнули и Вернуть - дело снова в шторке, на сервер ничего`() {
        seedLater()
        launch()
        compose.waitText(t.todo.later(2)).performClick()
        compose.waitText("Купить подарок").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.undo).performClick()
        compose.waitText("Купить подарок")
        assertTrue(server.calls("DELETE", "/api/todos/20").isEmpty())
    }

    @Test fun `Потом - смахнули - удаление уходит на сервер`() {
        seedLater()
        launch(undoMillis = 300)
        compose.waitText(t.todo.later(2)).performClick()
        compose.waitText("Купить подарок").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitFor { server.calls("DELETE", "/api/todos/20").size == 1 }
    }

    @Test fun `Потом - список не загрузился - ошибка в шторке`() {
        seedLater()
        server.failures["GET /api/todos/later"] = 500 to "internal"
        launch()
        compose.waitText(t.todo.later(2)).performClick()
        compose.waitText(t.error)
    }

    private fun seedLeft() {
        server.today = TodayResponse(
            "2026-10-05",
            todos = listOf(Todo(10, "Позвонить в банк", "2026-10-05"), Todo(11, "Отправить отчёт", "2026-10-05", done = true)),
        )
    }

    @Test fun `Осталось прячет сделанное и запоминается, Все - показывает`() {
        seedLeft()
        launch()
        compose.waitText("Отправить отчёт")
        compose.waitText(t.todo.showLeft).performClick()
        compose.waitFor { compose.onAllNodes(hasText("Отправить отчёт")).fetchSemanticsNodes().isEmpty() }
        compose.waitText("Позвонить в банк")
        assertTrue(prefs.bool("lc-todos-left"))
        compose.waitText(t.todo.showAll).performClick()
        compose.waitText("Отправить отчёт")
        assertFalse(prefs.bool("lc-todos-left"))
    }

    @Test fun `Осталось - выбор с прошлого запуска`() {
        seedLeft()
        prefs.setBool("lc-todos-left", true)
        launch()
        compose.waitText("Позвонить в банк")
        assertTrue(compose.onAllNodes(hasText("Отправить отчёт")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun `одни события на весь день - переключателя нет`() {
        server.today = TodayResponse("2026-10-05", todos = listOf(Todo(30, "День рождения Маши", "2026-10-05", source = TodoSource.Google)))
        launch()
        compose.waitText("День рождения Маши")
        assertTrue(compose.onAllNodes(hasText(t.todo.showLeft)).fetchSemanticsNodes().isEmpty())
        // Подпись раздела — прописными (.section-label).
        compose.waitText(t.todo.blockEvents.uppercase())
    }

    @Test fun `сервер не создал дело - строка уходит, ошибка`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(TodayTask(id = 1, title = "Зарядка", kind = TaskKind.Check)))
        server.failures["POST /api/todos"] = 500 to "internal"
        launch()
        compose.waitText(t.todo.add).performClick()
        compose.onNodeWithTag("todoInput").performTextInput("Купить хлеб")
        compose.onNodeWithTag("todoInput").performImeAction()
        compose.waitText(t.error)
        compose.waitFor { compose.onAllNodes(hasText("Купить хлеб")).fetchSemanticsNodes().isEmpty() }
    }

    @Test fun `сервер не отметил дело - кружок снова пустой, ошибка`() {
        seedLeft()
        server.failures["PATCH /api/todos/10"] = 500 to "internal"
        launch()
        compose.waitLabel(t.todo.check("Позвонить в банк")).performClick()
        compose.waitText(t.error)
        compose.waitLabel(t.todo.check("Позвонить в банк"))
    }

    @Test fun `фоновое обновление, начатое до отметки, отметку не затирает`() {
        server.today = TodayResponse("2026-10-05", tasks = listOf(TodayTask(id = 1, title = "Зарядка", kind = TaskKind.Check)))
        launch()
        compose.waitText("Зарядка")
        // Сервер «отстал»: следующий /today ещё без отметки. Обновление стартует, потом человек отмечает.
        compose.runOnUiThread {
            model.forceStale()
            model.refreshIfStale()
            model.log(model.today.tasks.single(), 1.0, null)
        }
        compose.waitFor { server.calls("GET", "/api/today").size >= 2 && server.calls("PUT", "/api/logs").isNotEmpty() }
        compose.waitLabel("Зарядка — ${t.markDone.lowercase()}")
        compose.waitFor { model.today.tasks.single().value == 1.0 }
    }

    @Test fun `перечитывание после удаления, начатое до отметки, отметку не затирает`() {
        server.today = TodayResponse(
            "2026-10-05",
            tasks = listOf(TodayTask(id = 1, title = "Зарядка", kind = TaskKind.Check)),
            todos = listOf(Todo(10, "Позвонить в банк", "2026-10-05")),
        )
        launch(undoMillis = 200)
        compose.waitText("Позвонить в банк").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        // Удаление ушло, «Сегодня» перечитывается — сервер отвечает медленно и состоянием до отметки.
        server.todayDelayMs = 1500
        compose.waitFor { server.calls("DELETE", "/api/todos/10").size == 1 && server.calls("GET", "/api/today").size >= 2 }
        compose.waitLabel("Зарядка — ${t.markDone.lowercase()}").performClick()
        compose.waitFor(8_000) { server.calls("PUT", "/api/logs").isNotEmpty() }
        server.todayDelayMs = 0
        // Ждём, пока медленный ответ дойдёт, и проверяем: отметка на месте.
        compose.waitFor(8_000) { compose.onAllNodes(hasText("Позвонить в банк")).fetchSemanticsNodes().isEmpty() }
        compose.waitFor(8_000) { model.today.todos.isEmpty() }
        assertTrue(model.today.tasks.single().value == 1.0)
    }

    @Test fun `приоткрытое Удалить остаётся у своего дела, когда список переставился`() {
        server.today = TodayResponse(
            "2026-10-05",
            todos = listOf(Todo(10, "Первое дело", "2026-10-05"), Todo(11, "Второе дело", "2026-10-05")),
        )
        launch()
        // Приоткрыть «Удалить» у второго дела (короткий свайп), потом отметить первое — оно уедет вниз.
        compose.waitText("Второе дело").performTouchInput { swipeLeft(startX = right, endX = right - 150f) }
        compose.waitLabel(t.todo.check("Первое дело")).performClick()
        compose.waitFor { server.calls("PATCH", "/api/todos/10").isNotEmpty() }
        compose.waitForIdle()
        // Сдвинута влево (открыта) строка «Второе дело», а не та, что встала на её место.
        val second = compose.onNode(hasText("Второе дело"), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        val first = compose.onNode(hasText("Первое дело"), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        assertTrue("второе ${'$'}second, первое ${'$'}first", second < first - 20)
    }

    @Test fun `перечитывание ждёт отметку, которая ещё идёт на сервер`() {
        server.today = TodayResponse(
            "2026-10-05",
            tasks = listOf(TodayTask(id = 1, title = "Зарядка", kind = TaskKind.Check)),
            todos = listOf(Todo(10, "Позвонить в банк", "2026-10-05")),
        )
        launch(undoMillis = 200)
        compose.waitText("Зарядка")
        // Отметка уходит медленно; тут же истекает «Вернуть» у удалённого дела — и «Сегодня» перечитывается.
        server.logDelayMs = 1500
        compose.waitLabel("Зарядка — ${t.markDone.lowercase()}").performClick()
        compose.waitText("Позвонить в банк").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitFor(8_000) { server.calls("DELETE", "/api/todos/10").size == 1 && model.today.todos.isEmpty() }
        // GET /today ушёл только после того, как сервер принял отметку, — и отметка на экране осталась.
        val calls = server.calls.toList()
        val put = calls.indexOfFirst { it.method == "PUT" && it.path == "/api/logs" }
        val get = calls.indexOfLast { it.method == "GET" && it.path == "/api/today" }
        // Записи — в порядке, в каком сервер их обработал: PUT записан после задержки, GET перечитывания — после него.
        assertTrue("PUT $put, GET $get", get > put)
        assertTrue(model.today.tasks.single().value == 1.0)
    }
}
