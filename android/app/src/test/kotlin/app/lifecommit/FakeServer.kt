// Подменённый сервер LifeCommit для сценариев: хранит «Сегодня» одного человека и отвечает так же, как Worker
// (пути и коды — docs/mobile.md). Внешнее (Telegram) — тоже здесь: /token и /crossapp. Каждый запрос записывается.
package app.lifecommit

import app.lifecommit.core.ApiClient
import app.lifecommit.core.ArchivedTask
import app.lifecommit.core.HeatmapResponse
import app.lifecommit.core.SessionResponse
import app.lifecommit.core.TaskInput
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import app.lifecommit.core.UserSettings
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import java.util.concurrent.CopyOnWriteArrayList

class FakeServer {
    data class Call(val method: String, val path: String, val body: String, val auth: String?) {
        val json: JsonObject get() = ApiClient.json.parseToJsonElement(body).jsonObject
    }

    val server = MockWebServer()
    val calls = CopyOnWriteArrayList<Call>()

    @Volatile var today = TodayResponse(day = "2026-10-05")
    @Volatile var user = UserSettings(id = 9_000_000_000_001, firstName = "Даша")

    /** Ответить ошибкой на «МЕТОД /путь»: статус и код. */
    val failures = mutableMapOf<String, Pair<Int, String>>()

    /** Дела «на потом» — GET /todos/later. */
    @Volatile var later: List<Todo> = emptyList()

    /** История привычек для экрана привычки: id → история. */
    val histories = mutableMapOf<Long, app.lifecommit.core.TaskHistory>()

    /** PATCH /tasks/:id отвечает этим днём, с которого действует новая цель. */
    @Volatile var goalEffectiveFrom: String? = null
    private var nextId = 1000L

    val api: String get() = server.url("/api").toString()
    val oauth: String get() = server.url("/oauth").toString().trimEnd('/')

    fun start(): FakeServer {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = synchronized(this@FakeServer) { handle(request) }
        }
        server.start()
        return this
    }

    fun close() = server.close()

    fun calls(method: String, path: String) = calls.filter { it.method == method && it.path == path }

    private fun ok(body: String = """{"ok":true}""", code: Int = 200) =
        MockResponse.Builder().code(code).body(body).addHeader("Content-Type", "application/json").build()

    private fun error(code: Int, err: String) = ok("""{"error":"$err"}""", code)

    private inline fun <reified T> enc(v: T) = ApiClient.json.encodeToString(kotlinx.serialization.serializer<T>(), v)

    private fun handle(r: RecordedRequest): MockResponse {
        val path = r.url.encodedPath
        val call = Call(r.method, path, r.body?.utf8() ?: "", r.headers["Authorization"])
        calls += call
        failures["${call.method} $path"]?.let { (status, code) -> return error(status, code) }
        val api = path.removePrefix("/api/")
        return when {
            path == "/oauth/crossapp" -> ok("{}")
            path == "/oauth/token" -> ok("""{"id_token":"h.p.s"}""")
            call.method == "GET" && api == "auth/telegram/config" -> ok("""{"client_id":"7000000001"}""")
            call.method == "POST" && api == "auth/telegram" -> ok("""{"token":"session-key","is_new":false}""")
            call.method == "POST" && api == "session" -> ok(enc(SessionResponse(user = user, isNew = false)))
            call.method == "GET" && api == "today" -> ok(enc(today))
            call.method == "GET" && api == "heatmap" -> ok(enc(HeatmapResponse(today.day, emptyList())))
            call.method == "GET" && api == "todos/later" -> ok(enc(later))
            call.method == "GET" && api.matches(Regex("tasks/\\d+/history")) -> {
                val id = api.split('/')[1].toLong()
                histories[id]?.let { ok(enc(it)) } ?: error(404, "not_found")
            }
            call.method == "PUT" && api == "logs" -> {
                val b = call.json
                val id = b.getValue("task_id").jsonPrimitive.long
                today = today.copy(tasks = today.tasks.map {
                    if (it.id != id) it else it.copy(
                        value = b["value"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                        status = b["status"]?.jsonPrimitive?.contentOrNull?.let { s -> app.lifecommit.core.AbstainStatus.entries.first { e -> e.wire == s } },
                    )
                })
                ok()
            }
            call.method == "POST" && api == "todos" -> {
                val id = nextId++
                val b = call.json
                today = today.copy(todos = today.todos + Todo(id, b.getValue("title").jsonPrimitive.content, today.day))
                ok("""{"id":$id}""", 201)
            }
            call.method == "PATCH" && api.startsWith("todos/") -> {
                val id = api.removePrefix("todos/").toLong()
                val done = call.json["done"]?.jsonPrimitive?.booleanOrNull
                today = today.copy(todos = today.todos.map { if (it.id == id && done != null) it.copy(done = done) else it })
                ok()
            }
            call.method == "DELETE" && api.startsWith("todos/") -> {
                val id = api.removePrefix("todos/").toLong()
                today = today.copy(todos = today.todos.filter { it.id != id })
                later = later.filter { it.id != id }
                ok()
            }
            call.method == "POST" && api == "tasks" -> {
                val input = ApiClient.json.decodeFromString(TaskInput.serializer(), call.body)
                val id = nextId++
                today = today.copy(tasks = today.tasks + TodayTask(id = id, title = input.title, kind = input.kind, target = input.target, unit = input.unit, schedule = input.schedule, weekdays = input.weekdays, perWeek = input.perWeek))
                ok("""{"id":$id}""", 201)
            }
            call.method == "PATCH" && api.startsWith("tasks/") -> {
                val id = api.removePrefix("tasks/").toLong()
                val b = call.json
                today = today.copy(tasks = today.tasks.map {
                    if (it.id != id) it else it.copy(
                        title = b["title"]?.jsonPrimitive?.content ?: it.title,
                        target = b["target"]?.jsonPrimitive?.doubleOrNull ?: it.target,
                    )
                })
                ok(goalEffectiveFrom?.let { """{"ok":true,"goal_effective_from":"$it"}""" } ?: """{"ok":true,"goal_effective_from":null}""")
            }
            call.method == "POST" && api.matches(Regex("tasks/\\d+/archive")) -> {
                val id = api.split('/')[1].toLong()
                val t = today.tasks.first { it.id == id }
                today = today.copy(tasks = today.tasks - t, archived = today.archived + ArchivedTask(t.id, t.title))
                ok()
            }
            call.method == "POST" && api.matches(Regex("tasks/\\d+/restore")) -> {
                val id = api.split('/')[1].toLong()
                val a = today.archived.first { it.id == id }
                today = today.copy(archived = today.archived - a, tasks = today.tasks + TodayTask(id = a.id, title = a.title, kind = app.lifecommit.core.TaskKind.Check))
                ok()
            }
            call.method == "DELETE" && api.startsWith("tasks/") -> {
                val id = api.removePrefix("tasks/").toLong()
                today = today.copy(tasks = today.tasks.filter { it.id != id }, archived = today.archived.filter { it.id != id })
                ok()
            }
            call.method == "DELETE" && api == "desktop/session" -> ok()
            else -> error(404, "not_found")
        }
    }
}
