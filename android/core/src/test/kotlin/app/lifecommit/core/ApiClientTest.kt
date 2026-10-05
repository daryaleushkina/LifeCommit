package app.lifecommit.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import okhttp3.OkHttpClient
import okio.buffer
import kotlinx.coroutines.asCoroutineDispatcher

fun fixture(name: String): String = requireNotNull(object {}.javaClass.getResource("/$name.json")).readText()

fun json(status: Int, body: String) = MockResponse.Builder().code(status).body(body).addHeader("Content-Type", "application/json").build()

val RecordedRequest.text: String get() = body?.utf8() ?: ""

suspend fun expectApiError(expected: ApiError.Kind, block: suspend () -> Unit) {
    try {
        block()
        fail("ждали ошибку $expected")
    } catch (e: ApiError) {
        assertEquals(expected, e.kind)
    }
}

class ApiClientTest {
    private val server = MockWebServer()
    private lateinit var api: ApiClient

    @Before fun start() {
        server.start()
        api = ApiClient(server.url("/api").toString())
    }

    @After fun stop() = server.close()

    @Test fun `настоящий ответ today читается целиком`() {
        val today = ApiClient.json.decodeFromString(TodayResponse.serializer(), fixture("today"))
        assertEquals(listOf(TaskKind.Check, TaskKind.Count, TaskKind.Abstain), today.tasks.map { it.kind })
        val water = today.tasks.first { it.kind == TaskKind.Count }
        assertEquals("стаканов", water.unit)
        assertEquals(3.0, water.value, 0.0)
        assertEquals(8.0, water.target, 0.0)
        val quit = today.tasks.first { it.kind == TaskKind.Abstain }
        assertEquals(AbstainStatus.Clean, quit.status)
        assertEquals("2026-09-20", quit.lastSlipOn)
        assertEquals(listOf("Купить корм Тесле", "Позвонить в банк"), today.todos.map { it.title }.sorted())
        assertEquals("15:00", today.todos.first { it.time != null }.time)
        assertNull(today.limits.maxTasks)
    }

    @Test fun `настоящий ответ session и heatmap`() {
        val s = ApiClient.json.decodeFromString(SessionResponse.serializer(), fixture("session"))
        assertEquals("Даша", s.user.firstName)
        assertEquals("Asia/Ho_Chi_Minh", s.user.timezone)
        assertTrue(s.isNew)
        val heat = ApiClient.json.decodeFromString(HeatmapResponse.serializer(), fixture("heatmap"))
        assertTrue(heat.today.isNotEmpty())
    }

    @Test fun `ключ сессии уходит заголовком Bearer, подменённый Telegram - tma, тело - JSON в snake_case`() = runTest {
        server.enqueue(json(201, """{"id":42}"""))
        server.enqueue(json(201, """{"id":43}"""))
        api.credential = Credential.Session("key-123")
        assertEquals(42L, api.createTask(TaskInput(title = "Читать", kind = TaskKind.Count, target = 20.0, schedule = Schedule.PerWeek, perWeek = 3)))
        val call = server.takeRequest()
        assertEquals("POST", call.method)
        assertEquals("/api/tasks", call.url.encodedPath)
        assertEquals("Bearer key-123", call.headers["Authorization"])
        val body = ApiClient.json.parseToJsonElement(call.text).jsonObject
        assertEquals(JsonPrimitive("Читать"), body["title"])
        assertEquals(JsonPrimitive("count"), body["kind"])
        assertEquals(20.0, body["target"].toString().toDouble(), 0.0)
        assertEquals(JsonPrimitive("per_week"), body["schedule"])
        assertEquals(JsonPrimitive(3), body["per_week"])
        api.credential = Credential.TelegramInitData("user=1")
        api.createTask(TaskInput(title = "x", kind = TaskKind.Check))
        assertEquals("tma user=1", server.takeRequest().headers["Authorization"])
    }

    @Test fun `отметка - value null снимает, status строкой, день задним числом, целые без точки`() = runTest {
        server.enqueue(json(200, """{"ok":true}"""))
        server.enqueue(json(200, """{"ok":true}"""))
        api.log(7, null, AbstainStatus.Slip, "2026-10-01")
        val body = ApiClient.json.parseToJsonElement(server.takeRequest().text).jsonObject
        assertEquals(JsonPrimitive(7), body["task_id"])
        assertEquals(JsonNull, body["value"])
        assertEquals(JsonPrimitive("slip"), body["status"])
        assertEquals(JsonPrimitive("2026-10-01"), body["day"])
        api.log(7, 5.0, null)
        val second = server.takeRequest().text
        assertTrue(second, second.contains("\"value\":5,") || second.contains("\"value\":5}"))
        assertTrue(second.contains("\"status\":null"))
        assertFalse(second.contains("day"))
    }

    @Test fun `ошибка сервера - код из error и статус, без тела - http_статус`() = runTest {
        server.enqueue(json(404, """{"error":"not_found"}"""))
        server.enqueue(MockResponse.Builder().code(502).body("<html>").build())
        expectApiError(ApiError.Kind.Http(404, "not_found")) { api.today() }
        expectApiError(ApiError.Kind.Http(502, "http_502")) { api.heatmap(7) }
    }

    @Test fun `ключ больше не пускает - выход, другой 401 - нет`() {
        assertTrue(ApiError(ApiError.Kind.Http(401, "bad_session")).isSignedOut)
        assertTrue(ApiError(ApiError.Kind.Http(401, "session_expired")).isSignedOut)
        assertTrue(ApiError(ApiError.Kind.Http(401, "no_session")).isSignedOut)
        assertFalse(ApiError(ApiError.Kind.Http(401, "apple_auth")).isSignedOut)
        assertFalse(ApiError(ApiError.Kind.Http(403, "bad_session")).isSignedOut)
        assertFalse(ApiError(ApiError.Kind.Network).isSignedOut)
    }

    @Test fun `200 с оборванным телом - не успех, а ошибка ответа`() = runTest {
        server.enqueue(json(200, """{"day":"""))
        server.enqueue(json(200, """{"tasks":[]}"""))
        expectApiError(ApiError.Kind.BadResponse) { api.today() }
        expectApiError(ApiError.Kind.BadResponse) { api.today() }
    }

    @Test fun `нет связи - ошибка сети`() = runTest {
        // Сервер недоступен (OkHttp сам повторяет оборванное соединение, поэтому обрыв на полпути — тот же случай).
        server.close()
        expectApiError(ApiError.Kind.Network) { api.today() }
    }

    @Test fun `ответ без тела - успех для вызовов без результата`() = runTest {
        server.enqueue(MockResponse.Builder().code(204).build())
        api.deleteTask(3)
        val call = server.takeRequest()
        assertEquals("DELETE", call.method)
        assertEquals("/api/tasks/3", call.url.encodedPath)
    }

    @Test fun `вход через Telegram - id_token, устройство и язык на сервер, без ключа`() = runTest {
        server.enqueue(json(200, """{"token":"k","is_new":true}"""))
        assertEquals(SignedIn("k", true), api.signInWithTelegram("a.b.c", "android", "ru-RU"))
        val call = server.takeRequest()
        assertEquals("/api/auth/telegram", call.url.encodedPath)
        assertNull(call.headers["Authorization"])
        assertEquals(
            buildJsonObject { put("id_token", "a.b.c"); put("device", "android"); put("language", "ru-RU") },
            ApiClient.json.parseToJsonElement(call.text),
        )
    }

    @Test fun `правка дела - весь день это time null, а не пропущенное поле`() = runTest {
        server.enqueue(json(200, """{"ok":true}"""))
        api.updateTodo(5, JsonObject(mapOf("time" to JsonNull, "done" to JsonPrimitive(true))))
        val body = ApiClient.json.parseToJsonElement(server.takeRequest().text).jsonObject
        assertEquals(JsonNull, body["time"])
        assertEquals(JsonPrimitive(true), body["done"])
    }

    @Test fun `тело ответа читается не в потоке, где продолжается корутина (на Android - главный)`() {
        server.enqueue(json(200, fixture("today")))
        val readOn = java.util.concurrent.atomic.AtomicReference<String>()
        // Тело оборачиваем: чтение запоминает поток.
        val http = OkHttpClient.Builder().addNetworkInterceptor { chain ->
            val r = chain.proceed(chain.request())
            val body = r.body
            val tracked = object : okhttp3.ResponseBody() {
                override fun contentType() = body.contentType()
                override fun contentLength() = body.contentLength()
                override fun source(): okio.BufferedSource = object : okio.ForwardingSource(body.source()) {
                    override fun read(sink: okio.Buffer, byteCount: Long): Long {
                        readOn.compareAndSet(null, Thread.currentThread().name)
                        return super.read(sink, byteCount)
                    }
                }.buffer()
            }
            r.newBuilder().body(tracked).build()
        }.build()
        val api = ApiClient(server.url("/api").toString(), http)
        val caller = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "caller") }.asCoroutineDispatcher()
        kotlinx.coroutines.runBlocking(caller) { api.today() }
        caller.close()
        // Имя потока в отладке корутин — «caller @coroutine#N».
        assertFalse(readOn.get(), readOn.get().startsWith("caller"))
    }

    @Test fun `ключ не попадает в строку для лога`() {
        assertFalse(Credential.Session("secret").toString().contains("secret"))
    }
}
