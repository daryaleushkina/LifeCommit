// Вызовы API по разделам — как src/api.ts мини-аппа. Пути и тела — docs/mobile.md.
package app.lifecommit.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Вход и сессия

/** client_id для oauth.telegram.org (id бота). Без входа. */
suspend fun ApiClient.telegramLoginConfig(): TelegramLoginConfig = get("auth/telegram/config")

/** id_token Telegram → ключ сессии этого устройства. Без входа. */
suspend fun ApiClient.signInWithTelegram(idToken: String, device: String, language: String): SignedIn =
    send("POST", "auth/telegram", mapOf("id_token" to idToken, "device" to device, "language" to language))

/** Первый запрос после входа и при каждом запуске: пояс телефона, пользователь. */
suspend fun ApiClient.session(timezone: String): SessionResponse = send("POST", "session", mapOf("timezone" to timezone))

suspend fun ApiClient.updateSettings(patch: JsonObject): UserSettings = send("PATCH", "settings", patch, UserSettings.serializer())

suspend fun ApiClient.deviceSessions(): List<DeviceSession> = get("desktop/sessions")

/** Выйти на этом устройстве: ключ перестаёт работать. */
suspend fun ApiClient.signOutHere() = call("DELETE", "desktop/session")

suspend fun ApiClient.signOutEverywhere() = call("DELETE", "desktop/sessions")

suspend fun ApiClient.deleteAccount() = call("DELETE", "account")

// Привычки

suspend fun ApiClient.today(): TodayResponse = get("today")

suspend fun ApiClient.heatmap(days: Int): HeatmapResponse = get("heatmap", mapOf("days" to days.toString()))

suspend fun ApiClient.createTask(input: TaskInput): Long = send<TaskInput, Created>("POST", "tasks", input).id

/** Правка привычки: только изменённые поля (snake_case, как на сервере). */
suspend fun ApiClient.updateTask(id: Long, patch: JsonObject): TaskUpdated = send("PATCH", "tasks/$id", patch, TaskUpdated.serializer())

suspend fun ApiClient.archiveTask(id: Long) = call("POST", "tasks/$id/archive")

suspend fun ApiClient.restoreTask(id: Long) = call("POST", "tasks/$id/restore")

suspend fun ApiClient.deleteTask(id: Long) = call("DELETE", "tasks/$id")

/** Отметка: value — абсолютное (не прибавка); null вместе со status null — снять отметку. day — задним числом. */
suspend fun ApiClient.log(taskId: Long, value: Double?, status: AbstainStatus?, day: String? = null) =
    call("PUT", "logs", buildJsonObject {
        put("task_id", taskId)
        put("value", value?.let(::number) ?: JsonNull)
        put("status", status?.wire)
        if (day != null) put("day", day)
    })

suspend fun ApiClient.history(taskId: Long): TaskHistory = get("tasks/$taskId/history")

// Дела

suspend fun ApiClient.createTodo(title: String, day: String?): Long =
    send("POST", "todos", buildJsonObject {
        put("title", title)
        put("day", day)
    }, Created.serializer()).id

/** Правка дела: title, day, time (null — весь день), done, on (день у повторяющегося), location, hidden. */
suspend fun ApiClient.updateTodo(id: Long, patch: JsonObject) = call("PATCH", "todos/$id", patch)

suspend fun ApiClient.deleteTodo(id: Long) = call("DELETE", "todos/$id")

suspend fun ApiClient.laterTodos(): List<Todo> = get("todos/later")

/** Целые — без «.0»: сервер ждёт 5, а не 5.0. */
fun number(n: Double): JsonPrimitive =
    if (n == Math.rint(n) && kotlin.math.abs(n) < 9_007_199_254_740_992.0) JsonPrimitive(n.toLong()) else JsonPrimitive(n)

// Календарь

suspend fun ApiClient.calendar(from: String, to: String): CalendarRange = get("calendar", mapOf("from" to from, "to" to to))

suspend fun ApiClient.calendars(): List<CalendarAccount> = get("calendars")

/** Адрес входа Google; client=app — после входа сервер вернёт в приложение (lifecommit://calendars?status=…). */
suspend fun ApiClient.googleCalendarUrl(): String = get<LinkUrl>("calendars/google/url", mapOf("client" to "app")).url

suspend fun ApiClient.connectApple(login: String, password: String) =
    call("POST", "calendars/apple", buildJsonObject {
        put("login", login)
        put("password", password)
    })

suspend fun ApiClient.confirmGoogle(accountId: Long) = call("POST", "calendars/$accountId/confirm")

suspend fun ApiClient.toggleCollection(accountId: Long, url: String, enabled: Boolean) =
    call("PATCH", "calendars/$accountId/collections", buildJsonObject {
        put("url", url)
        put("enabled", enabled)
    })

suspend fun ApiClient.setDefaultCalendar(accountId: Long, url: String) =
    call("PATCH", "calendars/$accountId/default", buildJsonObject { put("url", url) })

suspend fun ApiClient.disconnectCalendar(provider: TodoSource) =
    call("DELETE", "calendars/${if (provider == TodoSource.Apple) "apple" else "google"}")

suspend fun ApiClient.syncCalendars() = call("POST", "calendars/sync")
