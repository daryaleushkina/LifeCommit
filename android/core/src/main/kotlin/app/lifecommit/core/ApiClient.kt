// Клиент сервера LifeCommit (Cloudflare Worker, /api). Ошибка сервера всегда {"error":"<код>"} со статусом — здесь
// она становится ApiError с этим кодом: экран решает, что показать, а не гадает по тексту.
package app.lifecommit.core

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.logging.Logger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal val log: Logger = Logger.getLogger("app.lifecommit")

/** Чем подписан запрос. */
sealed interface Credential {
    val header: String

    /** Ключ сессии устройства (`Authorization: Bearer`), его выдаёт вход через Telegram. */
    data class Session(val token: String) : Credential {
        override val header get() = "Bearer $token"
        override fun toString() = "Session(***)"
    }

    /** Подпись Telegram (initData) — в приложении только подменённая, для локального стенда и тестов. */
    data class TelegramInitData(val raw: String) : Credential {
        override val header get() = "tma $raw"
    }
}

class ApiError(val kind: Kind) : Exception() {
    sealed interface Kind {
        /** Сервер ответил ошибкой: статус и код из {"error":"…"}. */
        data class Http(val status: Int, val code: String) : Kind

        /** Нет связи, таймаут, обрыв. */
        data object Network : Kind

        /** Ответ пришёл, но не тот: не JSON, обрезан, другие поля. */
        data object BadResponse : Kind
    }

    val status: Int? get() = (kind as? Kind.Http)?.status
    val code: String? get() = (kind as? Kind.Http)?.code

    /**
     * Ключ больше не пускает — забыть его и показать вход. Другой 401 (например, `apple_auth` у календаря) — это
     * ошибка дела, а не выход.
     */
    val isSignedOut: Boolean
        get() = kind is Kind.Http && kind.status == 401 && kind.code in setOf("bad_session", "session_expired", "no_session")

    override val message: String
        get() = when (kind) {
            is Kind.Http -> "HTTP ${kind.status} ${kind.code}"
            Kind.Network -> "network"
            Kind.BadResponse -> "bad response"
        }

    override fun equals(other: Any?) = other is ApiError && other.kind == kind
    override fun hashCode() = kind.hashCode()
}

class ApiClient(
    /** Адрес API, например https://lifecommit.app/api. */
    base: String,
    private val http: OkHttpClient = defaultHttp,
) {
    val base: HttpUrl = base.trimEnd('/').toHttpUrl()
    private val credentialRef = AtomicReference<Credential?>(null)

    var credential: Credential?
        get() = credentialRef.get()
        set(value) = credentialRef.set(value)

    companion object {
        val defaultHttp: OkHttpClient = OkHttpClient.Builder()
            .callTimeout(30, TimeUnit.SECONDS)
            .build()

        val json = Json {
            namingStrategy = JsonNamingStrategy.SnakeCase
            ignoreUnknownKeys = true
            // null в ответе у поля со значением по умолчанию — берём значение по умолчанию, а не падаем.
            coerceInputValues = true
            explicitNulls = true
            encodeDefaults = true
        }

        private val JSON_TYPE = "application/json".toMediaType()
    }

    fun url(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val b = base.newBuilder().addPathSegments(path)
        for ((k, v) in query) b.addQueryParameter(k, v)
        return b.build()
    }

    /** Запрос с телом-JSON (или без тела); ответ — T. Ошибка — ApiError (отмену пробрасывает как есть). */
    suspend fun <T> send(method: String, path: String, body: JsonElement?, out: KSerializer<T>, query: Map<String, String> = emptyMap()): T {
        return decode(build(method, url(path, query), jsonBody(body)), out)
    }

    suspend inline fun <reified B, reified T> send(method: String, path: String, body: B): T =
        send(method, path, json.encodeToJsonElement(serializer<B>(), body), serializer<T>())

    suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T =
        send("GET", path, null, serializer<T>(), query)

    /** Вызов без нужного результата: `{ok:true}`, 204. */
    suspend fun call(method: String, path: String, body: JsonElement? = null) {
        perform(build(method, url(path), jsonBody(body)))
    }

    /** Запрос с сырым телом (аудио, картинка). */
    suspend fun <T> upload(method: String, path: String, data: ByteArray, contentType: String, out: KSerializer<T>): T =
        decode(build(method, url(path), data.toRequestBody(contentType.toMediaType())), out)

    private fun jsonBody(body: JsonElement?): RequestBody? =
        body?.let { json.encodeToString(JsonElement.serializer(), it).toRequestBody(JSON_TYPE) }

    private fun build(method: String, url: HttpUrl, body: RequestBody?): Request {
        val b = Request.Builder().url(url)
        // DELETE и POST без тела — пустое тело: OkHttp требует его у POST.
        b.method(method, body ?: if (method == "POST" || method == "PUT" || method == "PATCH") ByteArray(0).toRequestBody(null) else null)
        credential?.let { b.header("Authorization", it.header) }
        return b.build()
    }

    /** Отправить и вернуть тело успешного ответа; иначе — ApiError. */
    private suspend fun perform(request: Request): String {
        val (status, text) = try {
            http.newCall(request).await().let { it.code to it.body }
        } catch (e: IOException) {
            log.warning("${request.method} ${request.url.encodedPath} failed: $e")
            throw ApiError(ApiError.Kind.Network)
        }
        if (status !in 200..299) {
            val code = errorCode(text) ?: "http_$status"
            log.info("${request.method} ${request.url.encodedPath} → $status $code")
            throw ApiError(ApiError.Kind.Http(status, code))
        }
        return text
    }

    private suspend fun <T> decode(request: Request, out: KSerializer<T>): T {
        val text = perform(request)
        return try {
            json.decodeFromString(out, text)
        } catch (e: SerializationException) {
            // 200 с оборванным или чужим телом — не успех (как в мини-аппе, src/api.ts). Причина — в лог: так видно,
            // что поменялась модель на сервере, а не пропала связь.
            log.severe("decode ${out.descriptor.serialName} from ${request.url.encodedPath}: $e")
            throw ApiError(ApiError.Kind.BadResponse)
        } catch (e: IllegalArgumentException) {
            log.severe("decode ${out.descriptor.serialName} from ${request.url.encodedPath}: $e")
            throw ApiError(ApiError.Kind.BadResponse)
        }
    }

    private fun errorCode(text: String): String? = try {
        (json.parseToJsonElement(text) as? JsonObject)?.get("error")?.jsonPrimitive?.content
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}

/** Ответ целиком: статус и тело. */
internal data class Reply(val code: Int, val body: String)

/**
 * OkHttp-вызов как suspend: отмена корутины отменяет запрос. Тело читается здесь же, в потоке OkHttp, — не там, где
 * продолжится корутина (на Android это главный поток: чтение сокета там — NetworkOnMainThreadException; /code-review 05.10).
 */
internal suspend fun Call.await(): Reply = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            val reply = try {
                response.use { Reply(it.code, it.body.string()) }
            } catch (e: IOException) {
                if (!cont.isCancelled) cont.resumeWithException(e)
                return
            }
            cont.resume(reply) { _, _, _ -> }
        }

        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
}
