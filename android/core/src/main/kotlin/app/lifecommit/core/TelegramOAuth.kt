// Официальный вход Telegram (OpenID Connect) — как SDK TelegramMessenger/telegram-login-android (MIT), но своим кодом:
// без глобального состояния, с тестами и так же, как на iPhone (apple/Kit/.../TelegramOAuth.swift).
//   1. PKCE: случайный verifier, challenge = base64url(SHA-256(verifier)).
//   2. Есть приложение Telegram — /crossapp даёт ссылку, Telegram сам вернёт в приложение redirect_uri?code=…;
//      нет — страница oauth.telegram.org/auth в Custom Tab.
//   3. Код + verifier → POST oauth.telegram.org/token → id_token (без секрета: так Telegram пускает приложения).
//   4. id_token → наш сервер (ApiClient.signInWithTelegram) → ключ сессии.
package app.lifecommit.core

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object TelegramOAuth {
    /** Адрес Telegram; в тестах — MockWebServer. */
    const val BASE = "https://oauth.telegram.org"

    /**
     * Куда Telegram возвращает код. Пока приложение раздаётся только владелице — своя схема; её же нужно внести в
     * @BotFather → Login Widget → Allowed URLs. Перед Google Play — только проверенный App Link (docs/mobile.md, «Вход»).
     */
    const val REDIRECT_URI = "lifecommit://tglogin"
    const val CALLBACK_SCHEME = "lifecommit"
    const val CALLBACK_HOST = "tglogin"

    /** openid — кто вошёл; profile — имя, @username, фото (для нового пользователя). Телефон не просим. */
    val scopes = listOf("openid", "profile")

    data class Pkce(val verifier: String) {
        val challenge: String = base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

        override fun toString() = "Pkce(***)"

        companion object {
            private val random = SecureRandom()

            /** 32 случайных байта → 43 знака base64url. */
            fun random(): Pkce = Pkce(base64url(ByteArray(32).also(random::nextBytes)))
        }
    }

    internal fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun withQuery(url: HttpUrl, clientId: String, pkce: Pkce, redirectUri: String): HttpUrl = url.newBuilder()
        .addQueryParameter("client_id", clientId)
        .addQueryParameter("response_type", "code")
        .addQueryParameter("redirect_uri", redirectUri)
        .addQueryParameter("scope", scopes.joinToString(" "))
        .addQueryParameter("code_challenge", pkce.challenge)
        .addQueryParameter("code_challenge_method", "S256")
        .build()

    /** Страница входа Telegram (Custom Tab): QR или номер телефона. */
    fun authUrl(clientId: String, pkce: Pkce, base: String = BASE, redirectUri: String = REDIRECT_URI): HttpUrl =
        withQuery("$base/auth".toHttpUrl(), clientId, pkce, redirectUri)

    /** Запрос ссылки в приложение Telegram (когда оно установлено). */
    fun crossAppUrl(clientId: String, pkce: Pkce, base: String = BASE, redirectUri: String = REDIRECT_URI): HttpUrl =
        withQuery("$base/crossapp".toHttpUrl(), clientId, pkce, redirectUri)

    sealed class Failure(message: String) : Exception(message) {
        /** Человек закрыл вход. */
        data object Cancelled : Failure("cancelled")

        /** Telegram вернул ошибку (например, access_denied) или ответ без кода. */
        data class Denied(val reason: String) : Failure("denied: $reason")

        /** Связи с Telegram нет. */
        data object Network : Failure("network")

        /** Telegram ответил не так, как ждали. */
        data object BadResponse : Failure("bad response")
    }

    /** Наш ли это адрес возврата: lifecommit://tglogin (другие ссылки в приложение — не вход). */
    fun isCallback(uri: String): Boolean = try {
        val u = URI(uri)
        u.scheme == CALLBACK_SCHEME && u.host == CALLBACK_HOST
    } catch (_: java.net.URISyntaxException) {
        false
    }

    /** Код из адреса возврата `lifecommit://tglogin?code=…`; отказ — Failure.Denied. */
    fun code(callback: String): String {
        val query = try {
            URI(callback).rawQuery
        } catch (_: java.net.URISyntaxException) {
            null
        }
        val items = query.orEmpty().split('&').filter { it.isNotEmpty() }.associate {
            val i = it.indexOf('=')
            val k = if (i < 0) it else it.substring(0, i)
            val v = if (i < 0) "" else it.substring(i + 1)
            URLDecoder.decode(k, Charsets.UTF_8) to URLDecoder.decode(v, Charsets.UTF_8)
        }
        items["error"]?.let { throw Failure.Denied(it) }
        val code = items["code"]
        if (code.isNullOrEmpty()) throw Failure.Denied("no_code")
        return code
    }

    @Serializable
    private data class CrossApp(val url: String? = null)

    @Serializable
    private data class TokenResponse(val id_token: String? = null, val error: String? = null)

    private val json = Json { ignoreUnknownKeys = true }

    /** Ссылка в Telegram из ответа /crossapp; нет её — входим через Custom Tab. */
    suspend fun crossAppLink(http: OkHttpClient, clientId: String, pkce: Pkce, base: String = BASE): String? {
        // Запасной путь задуман: не вышло — входим через страницу Telegram, а почему — в лог.
        val request = Request.Builder().url(crossAppUrl(clientId, pkce, base)).build()
        return try {
            http.newCall(request).await().let { response ->
                val body = response.body
                val link = if (response.code == 200) json.decodeFromString(CrossApp.serializer(), body).url else null
                if (link.isNullOrEmpty()) {
                    log.info("telegram crossapp fallback: status ${response.code}")
                    null
                } else {
                    link
                }
            }
        } catch (e: IOException) {
            log.info("telegram crossapp fallback: $e")
            null
        } catch (e: SerializationException) {
            log.info("telegram crossapp fallback: $e")
            null
        }
    }

    /** Обмен кода на id_token (PKCE, без секрета). */
    suspend fun exchange(http: OkHttpClient, code: String, clientId: String, pkce: Pkce, base: String = BASE, redirectUri: String = REDIRECT_URI): String {
        val form = FormBody.Builder()
            .add("client_id", clientId)
            .add("code", code)
            .add("grant_type", "authorization_code")
            .add("redirect_uri", redirectUri)
            .add("code_verifier", pkce.verifier)
            .build()
        val request = Request.Builder().url("$base/token").post(form).build()
        val (status, body) = try {
            http.newCall(request).await().let { it.code to it.body }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            if (e.message == "Canceled") throw Failure.Cancelled
            log.warning("telegram token exchange failed: $e")
            throw Failure.Network
        }
        val parsed = try {
            json.decodeFromString(TokenResponse.serializer(), body)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
        val token = parsed?.id_token
        if (status == 200 && !token.isNullOrEmpty()) return token
        parsed?.error?.let { throw Failure.Denied(it) }
        log.warning("telegram token exchange: unexpected answer, status $status")
        throw Failure.BadResponse
    }
}

/**
 * Подменённый Telegram для локального стенда и тестов — как mockEnv мини-аппа и worker/test/harness.ts: сервер с
 * DEV_AUTH_BYPASS=1 принимает эту «подпись». На проде она не проходит (hash ненастоящий) — и в сборке для людей
 * приложение её не шлёт (только BuildConfig.DEBUG).
 */
object DevTelegram {
    const val MOCK_HASH = "mock-hash-not-valid-for-backend"

    /** Строка initData для `Authorization: tma …` от имени пользователя Telegram с этим id. */
    fun initData(userId: Long, firstName: String = "Тест", languageCode: String = "ru", nowSeconds: Long = System.currentTimeMillis() / 1000): String {
        val user = buildString {
            append("{\"id\":").append(userId)
            append(",\"first_name\":").append(Json.encodeToString(String.serializer(), firstName))
            append(",\"language_code\":").append(Json.encodeToString(String.serializer(), languageCode))
            append(",\"username\":\"u").append(userId).append("\"}")
        }
        // URLSearchParams на сервере читает «+» как пробел — кодируем всё, пробел — как %20.
        fun enc(s: String) = java.net.URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")
        return listOf("auth_date" to nowSeconds.toString(), "hash" to MOCK_HASH, "signature" to "mock-signature", "user" to user)
            .joinToString("&") { (k, v) -> "$k=${enc(v)}" }
    }
}
