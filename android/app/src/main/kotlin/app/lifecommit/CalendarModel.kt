// Состояние вкладки «Календарь» — как src/screens/Calendar.tsx, src/useTodos.ts и CalendarsSheet.tsx: дни на экране
// (уже виденные открываются сразу), дела с мгновенным откликом, подключённые календари Apple и Google.
package app.lifecommit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.lifecommit.core.ApiClient
import app.lifecommit.core.ApiError
import app.lifecommit.core.CalMode
import app.lifecommit.core.CalendarAccount
import app.lifecommit.core.CalendarDays
import app.lifecommit.core.Todo
import app.lifecommit.core.TodoEdit
import app.lifecommit.core.TodoEdits
import app.lifecommit.core.Todos
import app.lifecommit.core.calendar
import app.lifecommit.core.calendars
import app.lifecommit.core.confirmGoogle
import app.lifecommit.core.connectApple
import app.lifecommit.core.createTodo
import app.lifecommit.core.deleteTodo
import app.lifecommit.core.disconnectCalendar
import app.lifecommit.core.googleCalendarUrl
import app.lifecommit.core.setDefaultCalendar
import app.lifecommit.core.syncCalendars
import app.lifecommit.core.toggleCollection
import app.lifecommit.core.updateTodo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.net.URI
import java.util.logging.Logger

private val log = Logger.getLogger("app.lifecommit.calendar")

/** Действия с делами — одни и те же на «Сегодня» и в «Календаре» (useTodoActions). */
interface TodoActions {
    fun toggle(todo: Todo)
    fun add(title: String, day: String)
    fun update(todo: Todo, edit: TodoEdit)
    fun remove(todo: Todo)

    /** Скрыть событие из календаря у нас (в самом календаре оно остаётся). */
    fun hide(todo: Todo)
}

class CalendarModel(
    private val api: ApiClient,
    private val scope: CoroutineScope,
    /** Сегодняшний логический день (из «Сегодня»). */
    private val today: () -> String,
    /** Дела поменялись — «Сегодня» перечитывает себя в фоне. */
    private val onChanged: suspend () -> Unit,
    private val onSignedOut: () -> Unit,
    private val errorText: () -> String,
) : TodoActions {
    var mode by mutableStateOf(CalMode.Day)
        private set
    var selected by mutableStateOf("")
        private set

    /** Дела по промежуткам «from:to» — уже виденное открывается сразу. */
    private val ranges = mutableStateMapOf<String, List<Todo>>()

    /** Подключённые календари; null — ещё не знаем. */
    var accounts by mutableStateOf<List<CalendarAccount>?>(null)
        private set

    /** Адрес входа Google: null — ещё грузится, "" — Google на сервере не настроен. */
    var googleUrl by mutableStateOf<String?>(null)
        private set
    var syncing by mutableStateOf(false)
        private set

    /** Ошибка действия — тап убирает. */
    var error by mutableStateOf<String?>(null)

    /** Шторка «Календари» открыта (в том числе после возврата из входа Google). */
    var sheetOpen by mutableStateOf(false)

    /** Сервер не сохранил правку в шторке календарей — строка ошибки в шторке. */
    var sheetFailed by mutableStateOf(false)

    val days: List<String> get() = CalendarDays.range(mode, selected.ifEmpty { today() })
    private val key: String get() = days.let { "${it.first()}:${it.last()}" }

    /** Дела на экране; null — ещё не пришли. */
    val todos: List<Todo>? get() = ranges[key]

    fun ofDay(day: String): List<Todo> = Todos.sorted(todos.orEmpty().filter { it.day == day })

    fun select(day: String) {
        selected = day
        load()
    }

    fun switchMode(next: CalMode) {
        mode = next
        load()
    }

    fun shift(n: Int) = select(CalendarDays.shift(mode, selected.ifEmpty { today() }, n))

    /** Вкладку открыли: сегодняшний день, дела, календари (синхронизация — по кнопке, вкладка открывается сразу). */
    fun open() {
        if (selected.isEmpty()) selected = today()
        load()
        loadAccounts()
    }

    /** Дела промежутка на экране и соседних (листать стрелками без пустых кадров). */
    fun load() {
        if (selected.isEmpty()) selected = today()
        fetch(mode, selected)
        for (n in listOf(1, -1)) prefetch(mode, CalendarDays.shift(mode, selected, n))
        if (mode == CalMode.Day) prefetch(CalMode.Month, selected)
    }

    private fun prefetch(mode: CalMode, anchor: String) {
        val d = CalendarDays.range(mode, anchor)
        if ("${d.first()}:${d.last()}" !in ranges) fetch(mode, anchor)
    }

    private fun fetch(mode: CalMode, anchor: String) {
        val d = CalendarDays.range(mode, anchor)
        scope.launch {
            try {
                ranges["${d.first()}:${d.last()}"] = api.calendar(d.first(), d.last()).todos
            } catch (e: ApiError) {
                if (e.isSignedOut) onSignedOut() else log.info("calendar ${d.first()}..${d.last()} failed: $e")
            }
        }
    }

    /** После правки на сервере: все промежутки устарели, перечитываем то, что на экране. */
    private suspend fun reload() {
        ranges.keys.filter { it != key }.forEach { ranges.remove(it) }
        try {
            ranges[key] = api.calendar(days.first(), days.last()).todos
        } catch (e: ApiError) {
            if (e.isSignedOut) onSignedOut() else log.info("calendar reload failed: $e")
        }
        onChanged()
    }

    private fun patch(transform: (List<Todo>) -> List<Todo>) {
        val k = key
        ranges[k]?.let { ranges[k] = transform(it) }
    }

    private fun fail(e: ApiError) {
        if (e.isSignedOut) onSignedOut() else {
            log.severe("calendar action failed: $e")
            error = errorText()
        }
    }

    override fun toggle(todo: Todo) {
        val done = !todo.done
        patch { list -> list.map { if (it.isSame(todo)) it.copy(done = done) else it } }
        scope.launch {
            try {
                api.updateTodo(todo.id, buildJsonObject {
                    put("done", JsonPrimitive(done))
                    if (todo.recurring) put("on", JsonPrimitive(todo.day))
                })
                onChanged()
            } catch (e: ApiError) {
                patch { list -> list.map { if (it.isSame(todo)) todo else it } }
                fail(e)
            }
        }
    }

    private var tempId = -1_000_000L

    override fun add(title: String, day: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return
        val temp = Todo(id = --tempId, title = trimmed, day = day)
        patch { it + temp }
        scope.launch {
            try {
                val id = api.createTodo(trimmed, day)
                patch { list -> list.map { if (it.id == temp.id) it.copy(id = id) else it } }
                onChanged()
            } catch (e: ApiError) {
                patch { list -> list.filter { it.id != temp.id } }
                fail(e)
            }
        }
    }

    override fun update(todo: Todo, edit: TodoEdit) {
        val body = TodoEdits.patch(todo, edit)
        if (body.isEmpty()) return
        patch { list -> list.map { if (it.id == todo.id) TodoEdits.applied(it, edit) else it } }
        scope.launch {
            try {
                api.updateTodo(todo.id, body)
            } catch (e: ApiError) {
                fail(e)
            }
            reload()
        }
    }

    /** Удаление — с «Вернуть» (AppModel.removeWithUndo); сюда приходит уже сама отправка на сервер. */
    override fun remove(todo: Todo) {
        scope.launch { commitRemove(todo) }
    }

    suspend fun commitRemove(todo: Todo) {
        try {
            api.deleteTodo(todo.id)
        } finally {
            reload()
        }
    }

    override fun hide(todo: Todo) {
        scope.launch { commitHide(todo) }
    }

    suspend fun commitHide(todo: Todo) {
        try {
            api.updateTodo(todo.id, buildJsonObject { put("hidden", JsonPrimitive(true)) })
        } finally {
            reload()
        }
    }

    // Подключённые календари

    fun loadAccounts() {
        scope.launch {
            try {
                accounts = api.calendars()
            } catch (e: ApiError) {
                if (e.isSignedOut) onSignedOut() else {
                    log.info("calendars failed: $e")
                    if (accounts == null) accounts = emptyList()
                }
            }
            // Нет Google — заранее берём ссылку входа: шторка откроется уже с кнопкой.
            if (accounts?.none { it.provider == app.lifecommit.core.TodoSource.Google } == true) loadGoogleUrl()
        }
    }

    fun loadGoogleUrl() {
        scope.launch {
            googleUrl = try {
                api.googleCalendarUrl()
            } catch (e: ApiError) {
                // 503 calendar_unavailable — Google на сервере не настроен: «Скоро».
                if (e.code == "calendar_unavailable") "" else {
                    log.info("google url failed: $e")
                    null
                }
            }
        }
    }

    /** «Обновить»: синхронизация на сервере, свежие календари и дела. */
    fun syncNow() {
        if (syncing) return
        syncing = true
        scope.launch {
            try {
                api.syncCalendars()
            } catch (e: ApiError) {
                log.info("sync failed: $e")
            }
            try {
                accounts = api.calendars()
            } catch (e: ApiError) {
                log.info("calendars failed: $e")
            }
            reload()
            syncing = false
        }
    }

    /** Подключить Apple: null — получилось; иначе — текст ошибки для формы. */
    suspend fun connectApple(login: String, password: String, t: app.lifecommit.core.Strings): String? = try {
        api.connectApple(login.trim(), password.trim())
        changed()
        null
    } catch (e: ApiError) {
        if (e.isSignedOut) onSignedOut()
        when (e.code) {
            "apple_auth" -> t.cal.errAuth
            "apple_bad_input" -> t.cal.errInput
            else -> t.cal.errNet
        }
    }

    /** Google только что подключили, календари выбраны — «Готово». false — не достучались. */
    suspend fun confirmGoogle(account: CalendarAccount): Boolean = try {
        api.confirmGoogle(account.id)
        changed()
        true
    } catch (e: ApiError) {
        if (e.isSignedOut) onSignedOut()
        false
    }

    /** Включить или выключить календарь: на экране сразу, сервер догоняет; не сохранил — вернуть как было. */
    fun toggleCollection(account: CalendarAccount, url: String, enabled: Boolean, sync: Boolean) {
        fun set(on: Boolean) {
            accounts = accounts?.map { a -> if (a.id != account.id) a else a.copy(collections = a.collections.map { if (it.url == url) it.copy(enabled = on) else it }) }
        }
        set(enabled)
        sheetFailed = false
        scope.launch {
            try {
                api.toggleCollection(account.id, url, enabled)
                if (sync) changed()
            } catch (e: ApiError) {
                set(!enabled)
                if (e.isSignedOut) onSignedOut() else sheetFailed = true
            }
        }
    }

    fun setDestination(account: CalendarAccount, url: String) {
        val prev = account.defaultUrl
        fun set(v: String?) {
            accounts = accounts?.map { if (it.id == account.id) it.copy(defaultUrl = v) else it }
        }
        set(url)
        sheetFailed = false
        scope.launch {
            try {
                api.setDefaultCalendar(account.id, url)
                changed()
            } catch (e: ApiError) {
                set(prev)
                if (e.isSignedOut) onSignedOut() else sheetFailed = true
            }
        }
    }

    fun disconnect(account: CalendarAccount) {
        sheetFailed = false
        scope.launch {
            try {
                api.disconnectCalendar(account.provider)
                changed()
            } catch (e: ApiError) {
                if (e.isSignedOut) onSignedOut() else sheetFailed = true
            }
        }
    }

    /** Подключили, отключили или выключили календарь — синхронизировать и перечитать. */
    private suspend fun changed() {
        try {
            accounts = api.calendars()
        } catch (e: ApiError) {
            log.info("calendars failed: $e")
        }
        syncNow()
    }

    /** Итог возврата после входа Google, если не получилось: denied, expired, failed (тексты — Strings.cal.googleReturn). */
    var googleReturn by mutableStateOf<String?>(null)

    /**
     * Возврат после входа Google (docs/mobile.md «Возврат после входа Google»): lifecommit://calendars?status=ok|again|
     * denied|expired|failed. Открываем шторку «Календари» со свежим списком: ok — там выбор календарей; again — уже
     * подключён; остальное — заголовок и пояснение в шторке. Незнакомый статус — как failed.
     */
    fun handleGoogleReturn(uri: String): Boolean {
        val u = try {
            URI(uri)
        } catch (_: java.net.URISyntaxException) {
            return false
        }
        if (u.scheme != "lifecommit" || u.host != "calendars") return false
        val status = u.rawQuery.orEmpty().split('&').firstOrNull { it.startsWith("status=") }?.removePrefix("status=")
        googleReturn = when (status) {
            "ok", "again" -> null
            "denied", "expired" -> status
            else -> "failed"
        }
        sheetFailed = false
        sheetOpen = true
        loadAccounts()
        loadGoogleUrl()
        return true
    }
}
