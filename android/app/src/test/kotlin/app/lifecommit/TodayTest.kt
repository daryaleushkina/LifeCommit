package app.lifecommit

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performCustomAccessibilityActionWithLabel
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import app.lifecommit.core.AbstainStatus
import app.lifecommit.core.TaskKind
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TodayTest : AppTest() {
    private fun seed() {
        server.today = TodayResponse(
            day = "2026-10-05",
            tasks = listOf(
                TodayTask(id = 1, title = "Сходить в спортзал", kind = TaskKind.Check),
                TodayTask(id = 2, title = "Пить воду", kind = TaskKind.Count, target = 8.0, value = 3.0, unit = "стаканов"),
                TodayTask(id = 3, title = "Не курить", kind = TaskKind.Abstain, cleanBefore = 6),
            ),
            todos = listOf(Todo(10, "Позвонить в банк", "2026-10-05", time = "15:00"), Todo(11, "Купить корм", "2026-10-04")),
        )
    }

    @Test fun `Сегодня - дела, привычки трёх видов, дата в шапке, переехавшее дело со вчера`() {
        seed()
        launch()
        compose.waitText("Понедельник, 5 октября")
        compose.waitText("Позвонить в банк")
        compose.waitText("со вчера")
        compose.waitText("Сходить в спортзал")
        compose.waitText(t.didItShort)
        compose.waitText("3 из 8 стаканов")
    }

    @Test fun `галочка отмечает и повторный тап снимает, на сервер - абсолютное значение`() {
        seed()
        launch()
        val label = "Сходить в спортзал — сделано"
        compose.waitLabel(label).performClick()
        compose.waitFor { server.calls("PUT", "/api/logs").size == 1 }
        assertEquals("1", server.calls("PUT", "/api/logs")[0].json["value"].toString())
        compose.waitLabel(label).assertIsSelected().performClick()
        compose.waitFor { server.calls("PUT", "/api/logs").size == 2 }
        assertEquals(JsonNull, server.calls("PUT", "/api/logs")[1].json["value"])
        compose.waitLabel(label).assertIsNotSelected()
    }

    @Test fun `сервер не сохранил отметку - откат и ошибка`() {
        seed()
        server.failures["PUT /api/logs"] = 500 to "internal"
        launch()
        compose.waitLabel("Сходить в спортзал — сделано").performClick()
        compose.waitText(t.error)
        compose.waitLabel("Сходить в спортзал — сделано").assertIsNotSelected()
    }

    @Test fun `бросить - получилось, N дней без этого, повторный тап снимает ответ`() {
        seed()
        launch()
        compose.waitLabel(t.answerYes).performClick()
        compose.waitText("7 дней без этого")
        compose.waitFor { server.calls("PUT", "/api/logs").isNotEmpty() }
        assertEquals("\"clean\"", server.calls("PUT", "/api/logs")[0].json["status"].toString())
        compose.waitLabel(t.answerYes).performClick()
        compose.waitText(t.didItShort)
        compose.waitFor { server.calls("PUT", "/api/logs").size == 2 }
        assertEquals(JsonNull, server.calls("PUT", "/api/logs")[1].json["status"])
        assertEquals(server.today.tasks.first { it.id == 3L }.status, null as AbstainStatus?)
    }

    @Test fun `считать - ввести число карандашом`() {
        seed()
        launch()
        compose.waitLabel("Пить воду: ${t.enterValue}").performClick()
        compose.onNodeWithTag("countInput").performTextInput("5")
        compose.onNodeWithTag("countInput").performImeAction()
        compose.waitText("5 из 8 стаканов")
        compose.waitFor { server.calls("PUT", "/api/logs").isNotEmpty() }
        assertEquals("5", server.calls("PUT", "/api/logs")[0].json["value"].toString())
    }

    @Test fun `новое дело строкой - появляется сразу, поле остаётся для следующего`() {
        seed()
        launch()
        compose.waitText(t.todo.add).performClick()
        compose.onNodeWithTag("todoInput").performTextInput("Купить хлеб")
        compose.onNodeWithTag("todoInput").performImeAction()
        compose.waitText("Купить хлеб")
        compose.waitFor { server.calls("POST", "/api/todos").size == 1 }
        assertEquals("\"Купить хлеб\"", server.calls("POST", "/api/todos")[0].json["title"].toString())
        assertEquals("\"2026-10-05\"", server.calls("POST", "/api/todos")[0].json["day"].toString())
        compose.onNodeWithTag("todoInput").performTextInput("Позвонить маме")
        compose.onNodeWithTag("todoInput").performImeAction()
        compose.waitText("Позвонить маме")
    }

    @Test fun `дело - отметить кружком, на сервер done`() {
        seed()
        launch()
        compose.waitLabel(t.todo.check("Позвонить в банк")).performClick()
        compose.waitLabel(t.todo.uncheck("Позвонить в банк"))
        compose.waitFor { server.calls("PATCH", "/api/todos/10").isNotEmpty() }
        assertEquals("true", server.calls("PATCH", "/api/todos/10")[0].json["done"].toString())
    }

    @Test fun `свайп Удалить - строка пропадает, Вернуть - возвращается и на сервер ничего не уходит`() {
        seed()
        launch()
        compose.waitText("Сходить в спортзал").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.removed("Сходить в спортзал"))
        compose.waitText(t.swipe.undo).performClick()
        compose.waitText("Сходить в спортзал")
        assertTrue(server.calls("DELETE", "/api/tasks/1").isEmpty())
    }

    @Test fun `свайп Удалить - после плашки удаление уходит на сервер`() {
        seed()
        launch(undoMillis = 300)
        compose.waitText("Позвонить в банк").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.removed("Позвонить в банк"))
        compose.waitFor { server.calls("DELETE", "/api/todos/10").size == 1 }
    }

    @Test fun `сервер не удалил - строка возвращается, поверх - Что-то пошло не так`() {
        seed()
        server.failures["DELETE /api/tasks/1"] = 500 to "internal"
        launch(undoMillis = 300)
        compose.waitText("Сходить в спортзал").performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.error)
        compose.waitText("Сходить в спортзал")
    }

    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test fun `удалить можно и из меню действий TalkBack`() {
        seed()
        launch(undoMillis = 300)
        compose.waitText("Сходить в спортзал")
        compose.onNode(hasCustomAction(t.swipe.remove).and(androidx.compose.ui.test.hasAnyDescendant(androidx.compose.ui.test.hasText("Сходить в спортзал")))).performCustomAccessibilityActionWithLabel(t.swipe.remove)
        compose.waitText(t.swipe.removed("Сходить в спортзал"))
        compose.waitFor { server.calls("DELETE", "/api/tasks/1").size == 1 }
    }
}

private fun hasCustomAction(label: String) = androidx.compose.ui.test.SemanticsMatcher("custom action $label") { node ->
    node.config.getOrElseNullable(androidx.compose.ui.semantics.SemanticsActions.CustomActions) { null }?.any { it.label == label } == true
}
