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
import app.lifecommit.core.finishGoogle
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
    /** Где помним, что ждём возврата из Google (переживает выгрузку приложения, пока открыт вход). */
    private val prefs: Prefs,
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

    /** Дела групп по промежуткам (касаются меня), по дням. */
    private val groupRanges = mutableStateMapOf<String, List<app.lifecommit.core.GroupDayBlock>>()

    /** Дела групп в этот день. */
    fun groupsOfDay(day: String): List<app.lifecommit.core.GroupDayBlock> = groupRanges[key].orEmpty().filter { it.day == day }

    /** Отметка группового дела на экране сразу. */
    fun patchGroupItem(groupId: Long, itemId: Long, day: String, f: (app.lifecommit.core.GroupDayItem) -> app.lifecommit.core.GroupDayItem) {
        // Ответ, начатый до отметки, её не затирает.
        version++
        val k = key
        groupRanges[k]?.let { list ->
            groupRanges[k] = list.map { b -> if (b.group.id != groupId || b.day != day) b else b.copy(items = b.items.map { if (it.id == itemId) f(it) else it }) }
        }
    }

    /** Перечитать то, что на экране (после правки в группе), без перечитывания «Сегодня». */
    suspend fun reloadQuiet() {
        if (selected.isEmpty()) return
        version++
        // Соседние промежутки (месяц, прошлый день) тоже устарели — перечитаются, когда до них дойдут.
        ranges.keys.filter { it != key }.forEach { ranges.remove(it) }
        groupRanges.keys.filter { it != key }.forEach { groupRanges.remove(it) }
        val seq = version
        val k = key
        try {
            val r = api.calendar(days.first(), days.last())
            if (seq == version) {
                ranges[k] = r.todos
                groupRanges[k] = r.groups
            }
        } catch (e: ApiError) {
            if (e.isSignedOut) onSignedOut() else log.info("calendar quiet reload failed: $e")
        }
    }

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

    /** Сколько запросов дел ещё в пути — тесты ждут их, а не паузу. */
    internal var inFlight by mutableStateOf(0)
        private set

    /** Номер правки дел на экране: ответ, начатый раньше правки, её не затирает (как change в AppModel). */
    private var version = 0

    /** Повторить синхронизацию, когда закончится текущая: её попросили, пока шла другая (правка календарей). */
    private var syncAgain = false

    /** Выход из аккаунта: всё прошлого человека забываем, ответы, что ещё в пути, выбрасываем. */
    fun reset() {
        version++
        ranges.clear()
        groupRanges.clear()
        accounts = null
        googleUrl = null
        selected = ""
        mode = CalMode.Day
        sheetOpen = false
        sheetFailed = false
        googleReturn = null
        error = null
        syncAgain = false
    }

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
        val seq = version
        inFlight++
        scope.launch {
            try {
                val r = api.calendar(d.first(), d.last())
                if (seq == version) {
                    ranges["${d.first()}:${d.last()}"] = r.todos
                    groupRanges["${d.first()}:${d.last()}"] = r.groups
                }
            } catch (e: ApiError) {
                if (e.isSignedOut) onSignedOut() else log.info("calendar ${d.first()}..${d.last()} failed: $e")
            } finally {
                inFlight--
            }
        }
    }

    /** После правки на сервере: все промежутки устарели, перечитываем то, что на экране. */
    private suspend fun reload() {
        version++
        ranges.keys.filter { it != key }.forEach { ranges.remove(it) }
        groupRanges.keys.filter { it != key }.forEach { groupRanges.remove(it) }
        val seq = version
        val k = key
        try {
            val r = api.calendar(days.first(), days.last())
            if (seq == version) {
                ranges[k] = r.todos
                groupRanges[k] = r.groups
            }
        } catch (e: ApiError) {
            if (e.isSignedOut) onSignedOut() else log.info("calendar reload failed: $e")
        }
        onChanged()
    }

    private fun patch(transform: (List<Todo>) -> List<Todo>) {
        version++
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
        if (syncing) {
            syncAgain = true
            return
        }
        syncing = true
        syncAgain = false
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
            if (syncAgain) syncNow()
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

    /** Итог возврата после входа Google, если не получилось: denied, expired, failed, link (тексты — Strings.cal). */
    var googleReturn by mutableStateOf<String?>(null)

    /** Нажали «Подключить» у Google: 15 минут ждём возврата (столько живёт код). */
    fun beginGoogle(now: Long = System.currentTimeMillis()) {
        prefs.setString(WAIT_KEY, (now + 15 * 60_000).toString())
    }

    private fun waiting(now: Long = System.currentTimeMillis()) = (prefs.string(WAIT_KEY)?.toLongOrNull() ?: 0) > now

    /**
     * Возврат после входа Google (docs/mobile.md «Возврат после входа Google»): lifecommit://calendars?status=ok&pending=<код>
     * или status=denied|expired|failed. Ссылке не доверяем: принимаем, только пока ждём вход, и только как сигнал отправить
     * код своим ключом (POST /calendars/google/finish) — чужая ссылка чужой календарь к нам не подключит.
     * true — ссылку приняли (открыть шторку «Календари»).
     */
    fun handleGoogleReturn(uri: String): Boolean {
        val u = try {
            URI(uri)
        } catch (_: java.net.URISyntaxException) {
            return false
        }
        if (u.scheme != "lifecommit" || u.host != "calendars") return false
        if (!waiting()) {
            log.warning("google return without a pending sign-in — ignored")
            return false
        }
        prefs.setString(WAIT_KEY, null)
        val q = u.rawQuery.orEmpty().split('&').associate { it.substringBefore('=') to it.substringAfter('=', "") }
        val status = q["status"]
        val pending = q["pending"]?.takeIf { PENDING.matches(it) }
        sheetFailed = false
        sheetOpen = true
        googleReturn = when {
            status == "ok" && pending != null -> null
            status == "denied" || status == "expired" -> status
            else -> "failed"
        }
        if (googleReturn == null && pending != null) finish(pending) else loadAccounts()
        loadGoogleUrl()
        return true
    }

    private suspend fun changedNow() = changed()

    /** Код возврата, который сервер не принял из-за сети или своей ошибки (код он вернул себе) — «Ещё раз». */
    private var retryPending: String? = null

    private fun finish(pending: String) {
        retryPending = null
        googleReturn = null
        scope.launch {
            try {
                val res = api.finishGoogle(pending)
                // Новый — выбор календарей в шторке (статус setup); подключён заново — перечитать календари и дела.
                if (res.fresh) loadAccounts() else changedNow()
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("google finish failed: $e")
                googleReturn = when {
                    e.code == "pending_not_found" || e.code == "pending_expired" -> "link"
                    // Нет связи или 5xx — код ещё действует (сервер вернул его себе): отправить его же ещё раз.
                    e.kind == ApiError.Kind.Network || (e.status ?: 0) >= 500 -> RETRY.also { retryPending = pending }
                    else -> "failed"
                }
            }
        }
    }

    /** «Ещё раз» после сбоя связи: тот же код. */
    fun retryGoogle() {
        retryPending?.let(::finish)
    }

    companion object {
        private const val WAIT_KEY = "lc-gcal-wait"

        /** googleReturn: сбой связи — показать «Ещё раз». */
        const val RETRY = "retry"

        /** Одноразовый код возврата Google: 43 знака base64url. */
        private val PENDING = Regex("^[A-Za-z0-9_-]{43}$")
    }
}
