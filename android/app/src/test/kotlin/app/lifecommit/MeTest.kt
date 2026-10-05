// «Я» через интерфейс, как человек: имя и карта, напоминание, конец дня, тема, язык, заблокированные, устройства
// («Выйти везде»), «Удалить аккаунт» подтверждением, «Разрешить боту напоминать».
package app.lifecommit

import android.app.TimePickerDialog
import android.content.DialogInterface
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performClick
import app.lifecommit.core.DeviceSession
import app.lifecommit.core.HeatDay
import app.lifecommit.core.Person
import app.lifecommit.core.TodayResponse
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
class MeTest : AppTest() {
    private fun openMe() {
        compose.waitText(t.me).performClick()
        compose.waitText(t.reminders)
    }

    private fun seed() {
        server.today = TodayResponse("2026-10-05")
        server.user = server.user.copy(username = "dasha", remindEvening = "21:00", dayStartHour = 4, botChatOk = true)
        server.heat = listOf(HeatDay("2026-10-04", 2.0))
    }

    @Test fun `имя, ник и карта, напоминание - другое время и выключить`() {
        seed()
        launch()
        openMe()
        compose.waitText("@dasha")
        compose.waitText(t.year)
        compose.waitText("21:00").performClick()
        val dialog = compose.waitDialog()
        dialog.updateTime(20, 30)
        dialog.getButton(DialogInterface.BUTTON_POSITIVE).performClick()
        compose.waitFor { server.calls("PATCH", "/api/settings").size == 1 }
        assertEquals("\"20:30\"", server.calls("PATCH", "/api/settings").single().json["remind_evening"].toString())
        compose.waitText("20:30").performClick()
        val again = compose.waitDialog()
        again.getButton(DialogInterface.BUTTON_NEUTRAL).performClick()
        compose.waitFor { server.calls("PATCH", "/api/settings").size == 2 }
        assertEquals("null", server.calls("PATCH", "/api/settings").last().json["remind_evening"].toString())
        compose.waitText(t.off)
    }

    @Test fun `конец дня - час из шторки, язык - экран сразу по-английски`() {
        seed()
        launch()
        openMe()
        compose.waitText("04:00").performClick()
        compose.waitText("06:00").performClick()
        compose.waitFor { server.calls("PATCH", "/api/settings").size == 1 }
        assertEquals("6", server.calls("PATCH", "/api/settings").single().json["day_start_hour"].toString())
        compose.waitText("06:00")
        compose.scrollToText("me", "Русский").performClick()
        compose.waitText("English").performClick()
        compose.waitText("Day ends at")
        assertEquals("\"en\"", server.calls("PATCH", "/api/settings").last().json["language_code"].toString())
    }

    @Test fun `настройка не сохранилась - как было и ошибка`() {
        seed()
        server.failures["PATCH /api/settings"] = 500 to "server_error"
        launch()
        openMe()
        compose.waitText("04:00").performClick()
        compose.waitText("06:00").performClick()
        compose.waitText(t.error)
        compose.waitText("04:00")
    }

    @Test fun `тема - тёмная запоминается на устройстве`() {
        seed()
        launch()
        openMe()
        compose.waitLabel(t.themeDark).performClick()
        compose.waitFor { model.theme == "dark" }
        assertEquals("dark", prefs.string(AppModel.THEME_KEY))
    }

    @Test fun `заблокированные - разблокировать, не вышло - на месте и ошибка`() {
        seed()
        server.blocked = listOf(Person(3, "Петя", "petya"), Person(4, "Вася"))
        server.failures["DELETE /api/blocks/4"] = 500 to "server_error"
        launch()
        openMe()
        compose.scrollToText("me", t.fr.blocked).performClick()
        compose.waitText("@petya")
        compose.onAllNodes(hasText(t.fr.unblock))[0].performClick()
        compose.waitFor { server.calls("DELETE", "/api/blocks/3").size == 1 }
        compose.onAllNodes(hasText("Петя")).assertCountEquals(0)
        compose.waitText(t.fr.unblock).performClick()
        compose.waitText(t.error)
        compose.waitText("Вася")
    }

    @Test fun `устройства - Выйти везде, и здесь тоже`() {
        seed()
        server.devices = listOf(DeviceSession(1, "android", "2026-10-05T10:00:00Z", "2026-10-05T10:00:00Z", true), DeviceSession(2, "mac", "2026-10-01T10:00:00Z", "2026-10-04T10:00:00Z", false))
        launch()
        openMe()
        compose.scrollToText("me", t.devices).performClick()
        compose.waitText(t.logoutAllConfirm)
        compose.waitText(t.logoutAll).performClick()
        compose.waitText(t.signIn)
        assertEquals(1, server.calls("DELETE", "/api/desktop/sessions").size)
        assertNull(runBlocking { tokens.load() })
    }

    @Test fun `удалить аккаунт - одним подтверждением, потом вход`() {
        seed()
        launch()
        openMe()
        compose.scrollToText("me", t.deleteAccount).performClick()
        compose.waitText(t.deleteConfirm)
        compose.waitText(t.deleteForever).performClick()
        compose.waitText(t.signIn)
        assertEquals(1, server.calls("DELETE", "/api/account").size)
        assertNull(runBlocking { tokens.load() })
    }

    @Test fun `удалить аккаунт не вышло - остаёмся и ошибка`() {
        seed()
        server.failures["DELETE /api/account"] = 403 to "linked_account"
        launch()
        openMe()
        compose.scrollToText("me", t.deleteAccount).performClick()
        compose.waitText(t.deleteForever).performClick()
        compose.waitText(t.error)
        assertEquals("session-key", runBlocking { tokens.load() })
    }

    @Test fun `разрешить боту напоминать - чат с ботом, вернулись - строка пропала`() {
        seed()
        server.user = server.user.copy(botChatOk = false)
        launch()
        openMe()
        compose.waitText(t.allowBot).performClick()
        assertEquals("https://t.me/LifeCommit_bot" to false, opened.last())
        // В чате нажали «Старт» — бот записал разрешение; приложение снова на экране.
        server.user = server.user.copy(botChatOk = true)
        compose.runOnUiThread { model.checkBot() }
        compose.waitFor { model.user?.botChatOk == true }
        compose.waitForIdle()
        compose.onAllNodes(hasText(t.allowBot)).assertCountEquals(0)
    }

    /** Системный выбор времени, который открыла строка. */
    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.waitDialog(): TimePickerDialog {
        waitFor { (ShadowDialog.getLatestDialog() as? TimePickerDialog)?.isShowing == true }
        return ShadowDialog.getLatestDialog() as TimePickerDialog
    }
}
