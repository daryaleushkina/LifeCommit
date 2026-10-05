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

    /** Задержать ответ GET /today (мс): ответ собран в момент запроса, приходит позже — «устаревший». */
    @Volatile var todayDelayMs = 0L

    /** Задержать PUT /logs (мс) до того, как сервер его применит: отметка «ещё идёт на сервер». */
    @Volatile var logDelayMs = 0L

    /** Ссылка из /oauth/crossapp (есть приложение Telegram); null — ссылки нет. */
    @Volatile var crossAppLink: String? = null

    /** Дела в календаре (кроме «Сегодня»): GET /calendar отдаёт их и дела «Сегодня» в промежутке from..to. */
    @Volatile var calendarTodos: List<Todo> = emptyList()

    /** Подключённые календари — GET /calendars. */
    @Volatile var accounts: List<app.lifecommit.core.CalendarAccount> = emptyList()

    /** Адрес входа Google; null — Google на сервере не настроен (503 calendar_unavailable). */
    @Volatile var googleUrl: String? = "https://accounts.google.com/o/oauth2/v2/auth?state=s"

    /** Задержать ответ GET /calendar (мс): ответ собран в момент запроса — «устаревший». */
    @Volatile var calendarDelayMs = 0L

    /** Задержать POST /calendars/sync (мс): синхронизация идёт. */
    @Volatile var syncDelayMs = 0L

    /** Задержать POST /session (мс): приложение ещё загружается. */
    @Volatile var sessionDelayMs = 0L

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
            override fun dispatch(request: RecordedRequest): MockResponse {
                // Медленная отметка: сервер применяет её не сразу (как настоящий, пока идёт запись в базу).
                if (request.method == "PUT" && request.url.encodedPath == "/api/logs" && logDelayMs > 0) Thread.sleep(logDelayMs)
                if (request.method == "POST" && request.url.encodedPath == "/api/calendars/sync" && syncDelayMs > 0) Thread.sleep(syncDelayMs)
                if (request.method == "POST" && request.url.encodedPath == "/api/session" && sessionDelayMs > 0) Thread.sleep(sessionDelayMs)
                return synchronized(this@FakeServer) { handle(request) }
            }
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
            path == "/oauth/crossapp" -> ok(crossAppLink?.let { """{"url":"$it"}""" } ?: "{}")
            path == "/oauth/token" -> ok("""{"id_token":"h.p.s"}""")
            call.method == "GET" && api == "auth/telegram/config" -> ok("""{"client_id":"7000000001"}""")
            call.method == "POST" && api == "auth/telegram" -> ok("""{"token":"session-key","is_new":false}""")
            call.method == "POST" && api == "session" -> ok(enc(SessionResponse(user = user, isNew = false)))
            call.method == "GET" && api == "today" -> ok(enc(today)).let { r ->
                if (todayDelayMs > 0) r.newBuilder().headersDelay(todayDelayMs, java.util.concurrent.TimeUnit.MILLISECONDS).build() else r
            }
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
                val day = b["day"]?.jsonPrimitive?.contentOrNull ?: today.day
                val todo = Todo(id, b.getValue("title").jsonPrimitive.content, day)
                if (day == today.day) today = today.copy(todos = today.todos + todo) else calendarTodos = calendarTodos + todo
                ok("""{"id":$id}""", 201)
            }
            call.method == "PATCH" && api.startsWith("todos/") -> {
                val id = api.removePrefix("todos/").toLong()
                val b = call.json
                fun edit(t: Todo): Todo {
                    if (t.id != id) return t
                    var n = t
                    b["done"]?.jsonPrimitive?.booleanOrNull?.let { n = n.copy(done = it) }
                    b["title"]?.jsonPrimitive?.contentOrNull?.let { n = n.copy(title = it) }
                    b["day"]?.jsonPrimitive?.contentOrNull?.let { n = n.copy(day = it) }
                    if (b.containsKey("time")) n = n.copy(time = b["time"]?.jsonPrimitive?.contentOrNull)
                    return n
                }
                val hidden = b["hidden"]?.jsonPrimitive?.booleanOrNull == true
                today = today.copy(todos = today.todos.map(::edit).filter { !(hidden && it.id == id) })
                calendarTodos = calendarTodos.map(::edit).filter { !(hidden && it.id == id) }
                ok()
            }
            call.method == "GET" && api == "calendar" -> {
                val from = r.url.queryParameter("from")!!
                val to = r.url.queryParameter("to")!!
                val all = (today.todos + calendarTodos).filter { it.day in from..to }
                ok(enc(app.lifecommit.core.CalendarRange(today.day, all))).let { resp ->
                    if (calendarDelayMs > 0) resp.newBuilder().headersDelay(calendarDelayMs, java.util.concurrent.TimeUnit.MILLISECONDS).build() else resp
                }
            }
            call.method == "GET" && api == "calendars" -> if (call.auth == null) error(401, "no_session") else ok(enc(accounts))
            call.method == "GET" && api == "calendars/google/url" -> {
                if (r.url.queryParameter("client") != "app") error(400, "bad_client")
                else googleUrl?.let { ok("""{"url":"$it"}""") } ?: error(503, "calendar_unavailable")
            }
            call.method == "POST" && api == "calendars/apple" -> {
                val b = call.json
                if (b["password"]?.jsonPrimitive?.content != "abcd-efgh-ijkl-mnop") error(401, "apple_auth") else {
                    accounts = accounts + app.lifecommit.core.CalendarAccount(nextId++, app.lifecommit.core.TodoSource.Apple, b["login"]!!.jsonPrimitive.content, "ok", "2026-10-05T10:00:00Z", "home", listOf(app.lifecommit.core.CalendarCollection("home", "Дом", "#3FA968", true, true)))
                    ok("{}", 201)
                }
            }
            call.method == "POST" && api.matches(Regex("calendars/\\d+/confirm")) -> {
                val id = api.split('/')[1].toLong()
                accounts = accounts.map { if (it.id == id) it.copy(status = "ok") else it }
                ok()
            }
            call.method == "PATCH" && api.matches(Regex("calendars/\\d+/collections")) -> {
                val id = api.split('/')[1].toLong()
                val b = call.json
                val url = b["url"]!!.jsonPrimitive.content
                val on = b["enabled"]!!.jsonPrimitive.booleanOrNull == true
                accounts = accounts.map { a -> if (a.id != id) a else a.copy(collections = a.collections.map { if (it.url == url) it.copy(enabled = on) else it }) }
                ok()
            }
            call.method == "PATCH" && api.matches(Regex("calendars/\\d+/default")) -> {
                val id = api.split('/')[1].toLong()
                accounts = accounts.map { if (it.id == id) it.copy(defaultUrl = call.json["url"]!!.jsonPrimitive.content) else it }
                ok()
            }
            call.method == "DELETE" && api.startsWith("calendars/") -> {
                val provider = api.removePrefix("calendars/")
                accounts = accounts.filter { it.provider.name.lowercase() != provider }
                ok()
            }
            call.method == "POST" && api == "calendars/sync" -> ok()
            call.method == "POST" && api == "calendars/google/finish" -> {
                val pending = call.json["pending"]?.jsonPrimitive?.contentOrNull
                when {
                    pending == null || !Regex("^[A-Za-z0-9_-]{43}$").matches(pending) -> error(400, "bad_pending")
                    pending.startsWith("old") -> error(410, "pending_expired")
                    pending.startsWith("bad") -> error(404, "pending_not_found")
                    else -> {
                        val fresh = accounts.none { it.provider == app.lifecommit.core.TodoSource.Google }
                        if (fresh) accounts = accounts + app.lifecommit.core.CalendarAccount(7, app.lifecommit.core.TodoSource.Google, "d@gmail.com", "setup", collections = listOf(app.lifecommit.core.CalendarCollection("work", "Работа", "#4470CC", true, true)))
                        ok("""{"account_id":7,"fresh":$fresh}""")
                    }
                }
            }
            call.method == "DELETE" && api.startsWith("todos/") -> {
                val id = api.removePrefix("todos/").toLong()
                today = today.copy(todos = today.todos.filter { it.id != id })
                calendarTodos = calendarTodos.filter { it.id != id }
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
