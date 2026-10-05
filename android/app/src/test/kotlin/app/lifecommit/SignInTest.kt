package app.lifecommit

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SignInTest : AppTest() {
    @Test fun `без ключа - экран входа, вход через страницу Telegram, возврат с кодом - Сегодня`() {
        runBlocking { tokens.clear() }
        launch()
        compose.waitText(t.signIn)
        compose.onNodeWithTag("signIn").performClick()
        // Telegram не установлен — страница входа в Custom Tab, с нашим PKCE и адресом возврата.
        compose.waitFor { opened.isNotEmpty() }
        val (url, inBrowser) = opened.single()
        assertTrue(inBrowser)
        assertTrue(url, url.startsWith(server.oauth + "/auth?client_id=7000000001"))
        assertTrue(url.contains("redirect_uri=lifecommit%3A%2F%2Ftglogin"))

        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=c0de") }
        compose.waitText(t.today)
        val exchange = server.calls("POST", "/oauth/token").single()
        assertTrue(exchange.body.contains("code=c0de"))
        val signIn = server.calls("POST", "/api/auth/telegram").single().json
        assertEquals("\"h.p.s\"", signIn["id_token"].toString())
        assertEquals("\"android\"", signIn["device"].toString())
        assertEquals("session-key", runBlocking { tokens.load() })
        assertEquals("Bearer session-key", server.calls("GET", "/api/today").last().auth)
    }

    @Test fun `Telegram установлен - вход через приложение Telegram, без ссылки - через страницу`() {
        runBlocking { tokens.clear() }
        telegramInstalled = true
        launch()
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.isNotEmpty() }
        // /crossapp ссылку не дал — запасной путь: страница входа.
        assertEquals(1, server.calls("GET", "/oauth/crossapp").size)
        assertTrue(opened.single().second)
    }

    @Test fun `вернулись со страницы входа без кода - снова кнопка, поздний код всё равно примем`() {
        runBlocking { tokens.clear() }
        launch()
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.isNotEmpty() }
        compose.runOnUiThread { model.returnedWithoutCallback() }
        compose.waitFor { !model.signingIn }
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=late") }
        compose.waitText(t.today)
    }

    @Test fun `нечем открыть страницу входа - ошибка и снова кнопка, а не вечное ожидание`() {
        runBlocking { tokens.clear() }
        linksWork = false
        launch()
        compose.onNodeWithTag("signIn").performClick()
        compose.waitText(t.signInFailed)
        compose.waitFor { !model.signingIn }
    }

    @Test fun `чужой адрес возврата без начатого входа игнорируется`() {
        runBlocking { tokens.clear() }
        launch()
        compose.waitText(t.signIn)
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=stolen") }
        compose.waitText(t.signIn)
        assertTrue(server.calls("POST", "/oauth/token").isEmpty())
        assertTrue(server.calls("POST", "/api/auth/telegram").isEmpty())
    }

    @Test fun `Telegram отказал - снова кнопка и ошибка, ключа нет`() {
        runBlocking { tokens.clear() }
        launch()
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.isNotEmpty() }
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?error=access_denied") }
        compose.waitText(t.signInFailed)
        assertNull(runBlocking { tokens.load() })
    }

    @Test fun `сервер не дал войти (id_token уже использован) - ошибка, а не пустой экран`() {
        runBlocking { tokens.clear() }
        server.failures["POST /api/auth/telegram"] = 409 to "token_used"
        launch()
        compose.onNodeWithTag("signIn").performClick()
        compose.waitFor { opened.isNotEmpty() }
        compose.runOnUiThread { model.handleCallback("lifecommit://tglogin?code=c") }
        compose.waitText(t.signInFailed)
    }

    @Test fun `ключ больше не пускает - забыть его и показать вход`() {
        server.failures["POST /api/session"] = 401 to "session_expired"
        launch()
        compose.waitText(t.signIn)
        compose.waitFor { runBlocking { tokens.load() } == null }
    }

    @Test fun `не загрузилось - Проверьте интернет и Ещё раз`() {
        server.failures["GET /api/today"] = 500 to "internal"
        launch()
        compose.waitText(t.loadError)
        server.failures.clear()
        compose.waitText(t.retry).performClick()
        compose.waitText(t.today)
    }

    @Test fun `Выйти на этом устройстве - ключ гасится на сервере и забывается`() {
        launch()
        compose.waitText(t.today)
        compose.waitText(t.me).performClick()
        compose.waitText(t.logoutDevice).performClick()
        compose.waitText(t.logoutOk).performClick()
        compose.waitText(t.signIn)
        assertEquals(1, server.calls("DELETE", "/api/desktop/session").size)
        assertNull(runBlocking { tokens.load() })
    }

    @Test fun `выйти, даже если сервер недоступен - ключ всё равно забывается`() {
        server.failures["DELETE /api/desktop/session"] = 500 to "internal"
        launch()
        compose.waitText(t.me).performClick()
        compose.waitText(t.logoutDevice).performClick()
        compose.waitText(t.logoutOk).performClick()
        compose.waitText(t.signIn)
        assertNull(runBlocking { tokens.load() })
    }
}
