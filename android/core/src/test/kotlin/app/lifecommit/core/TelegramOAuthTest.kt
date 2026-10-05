package app.lifecommit.core

import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.net.URLDecoder

class TelegramOAuthTest {
    private val server = MockWebServer()
    private val http = OkHttpClient()
    private lateinit var base: String

    @Before fun start() {
        server.start()
        base = server.url("/").toString().trimEnd('/')
    }

    @After fun stop() = server.close()

    private suspend fun expectFailure(expected: TelegramOAuth.Failure, block: suspend () -> Unit) {
        try {
            block()
            fail("ждали $expected")
        } catch (e: TelegramOAuth.Failure) {
            assertEquals(expected, e)
        }
    }

    @Test fun `PKCE - challenge base64url SHA-256, пример из RFC 7636`() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", TelegramOAuth.Pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge)
    }

    @Test fun `случайный verifier - 43 знака base64url, каждый раз новый`() {
        val a = TelegramOAuth.Pkce.random()
        val b = TelegramOAuth.Pkce.random()
        assertEquals(43, a.verifier.length)
        assertTrue(a.verifier.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        assertNotEquals(a.verifier, b.verifier)
        assertFalse(a.toString().contains(a.verifier))
    }

    @Test fun `адрес входа - наш бот, наш адрес возврата, только openid и profile, S256`() {
        val p = TelegramOAuth.Pkce("v")
        val url = TelegramOAuth.authUrl("7000000001", p)
        assertEquals("oauth.telegram.org", url.host)
        assertEquals("/auth", url.encodedPath)
        assertEquals("7000000001", url.queryParameter("client_id"))
        assertEquals("lifecommit://tglogin", url.queryParameter("redirect_uri"))
        assertEquals("code", url.queryParameter("response_type"))
        assertEquals("openid profile", url.queryParameter("scope"))
        assertEquals(p.challenge, url.queryParameter("code_challenge"))
        assertEquals("S256", url.queryParameter("code_challenge_method"))
        assertEquals("/crossapp", TelegramOAuth.crossAppUrl("1", p).encodedPath)
    }

    @Test fun `адрес возврата - код, отказ Telegram или пустой код - ошибка, а не вход`() = runTest {
        assertEquals("abc", TelegramOAuth.code("lifecommit://tglogin?code=abc&state=x"))
        assertEquals("a b+c", TelegramOAuth.code("lifecommit://tglogin?code=a%20b%2Bc"))
        expectFailure(TelegramOAuth.Failure.Denied("access_denied")) { TelegramOAuth.code("lifecommit://tglogin?error=access_denied") }
        expectFailure(TelegramOAuth.Failure.Denied("no_code")) { TelegramOAuth.code("lifecommit://tglogin") }
        expectFailure(TelegramOAuth.Failure.Denied("no_code")) { TelegramOAuth.code("lifecommit://tglogin?code=") }
    }

    @Test fun `только наш адрес возврата считается входом`() {
        assertTrue(TelegramOAuth.isCallback("lifecommit://tglogin?code=1"))
        assertFalse(TelegramOAuth.isCallback("lifecommit://other?code=1"))
        assertFalse(TelegramOAuth.isCallback("https://tglogin/?code=1"))
        assertFalse(TelegramOAuth.isCallback("не адрес ::"))
    }

    @Test fun `обмен кода - форма с verifier и адресом возврата, ответ id_token`() = runTest {
        server.enqueue(json(200, """{"id_token":"h.p.s"}"""))
        val p = TelegramOAuth.Pkce("ver+/=")
        assertEquals("h.p.s", TelegramOAuth.exchange(http, "c0de", "7000000001", p, base))
        val call = server.takeRequest()
        assertEquals("/token", call.url.encodedPath)
        assertTrue(call.headers["Content-Type"]!!.startsWith("application/x-www-form-urlencoded"))
        val form = call.text.split('&').associate { val (k, v) = it.split('='); k to URLDecoder.decode(v, Charsets.UTF_8) }
        assertEquals("authorization_code", form["grant_type"])
        assertEquals("c0de", form["code"])
        assertEquals("ver+/=", form["code_verifier"])
        assertEquals("lifecommit://tglogin", form["redirect_uri"])
        assertEquals("7000000001", form["client_id"])
    }

    @Test fun `обмен кода - отказ Telegram, чужой ответ, нет связи - свои ошибки`() = runTest {
        val p = TelegramOAuth.Pkce("v")
        server.enqueue(json(400, """{"error":"invalid_grant"}"""))
        expectFailure(TelegramOAuth.Failure.Denied("invalid_grant")) { TelegramOAuth.exchange(http, "c", "1", p, base) }
        server.enqueue(MockResponse.Builder().code(200).body("<html>").build())
        expectFailure(TelegramOAuth.Failure.BadResponse) { TelegramOAuth.exchange(http, "c", "1", p, base) }
        server.close()
        expectFailure(TelegramOAuth.Failure.Network) { TelegramOAuth.exchange(http, "c", "1", p, base) }
    }

    @Test fun `ссылка в приложение Telegram - есть берём, нет или ошибка - входим через страницу`() = runTest {
        val p = TelegramOAuth.Pkce("v")
        server.enqueue(json(200, """{"url":"tg://oauth?token=1"}"""))
        assertEquals("tg://oauth?token=1", TelegramOAuth.crossAppLink(http, "1", p, base))
        assertEquals("/crossapp", server.takeRequest().url.encodedPath)
        server.enqueue(json(200, "{}"))
        assertNull(TelegramOAuth.crossAppLink(http, "1", p, base))
        server.enqueue(json(500, """{"error":"x"}"""))
        assertNull(TelegramOAuth.crossAppLink(http, "1", p, base))
        server.enqueue(json(200, "<html>"))
        assertNull(TelegramOAuth.crossAppLink(http, "1", p, base))
    }
}

class DevTelegramTest {
    @Test fun `initData как у mockEnv - id, имя, язык, ненастоящая подпись`() {
        val raw = DevTelegram.initData(123, "Даша + Аня", "en", nowSeconds = 1000)
        assertFalse(raw.contains("+"))
        val items = raw.split('&').associate { val (k, v) = it.split('='); k to URLDecoder.decode(v, Charsets.UTF_8) }
        assertEquals(DevTelegram.MOCK_HASH, items["hash"])
        assertEquals("1000", items["auth_date"])
        val user = ApiClient.json.parseToJsonElement(items.getValue("user")).toString()
        assertTrue(user.contains("\"id\":123"))
        assertTrue(user.contains("\"first_name\":\"Даша + Аня\""))
        assertTrue(user.contains("\"language_code\":\"en\""))
        "https://x/?$raw".toHttpUrl()
    }
}
