// Состояние приложения — как App.tsx и хуки мини-аппа (useTaskLog, useTodos, removal.tsx) и AppModel.swift на iPhone:
// вход, загрузка «Сегодня», отметки и дела с мгновенным откликом и откатом при ошибке, удаление с «Вернуть».
package app.lifecommit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.lifecommit.core.AbstainStatus
import app.lifecommit.core.ApiClient
import app.lifecommit.core.ApiError
import app.lifecommit.core.Credential
import app.lifecommit.core.DevTelegram
import app.lifecommit.core.Heat
import app.lifecommit.core.HeatDay
import app.lifecommit.core.HistoryLog
import app.lifecommit.core.TaskHistory
import app.lifecommit.core.Strings
import app.lifecommit.core.TaskInput
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TelegramOAuth
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayResponse
import app.lifecommit.core.TodayTask
import app.lifecommit.core.Todos
import app.lifecommit.core.UserSettings
import app.lifecommit.core.archiveTask
import app.lifecommit.core.createTask
import app.lifecommit.core.createTodo
import app.lifecommit.core.deleteTask
import app.lifecommit.core.deleteTodo
import app.lifecommit.core.heatmap
import app.lifecommit.core.isDone
import app.lifecommit.core.isEmpty
import app.lifecommit.core.history
import app.lifecommit.core.laterTodos
import app.lifecommit.core.log
import app.lifecommit.core.number
import app.lifecommit.core.restoreTask
import app.lifecommit.core.session
import app.lifecommit.core.signInWithTelegram
import app.lifecommit.core.signOutHere
import app.lifecommit.core.telegramLoginConfig
import app.lifecommit.core.today
import app.lifecommit.core.updateTask
import app.lifecommit.core.updateTodo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import java.util.TimeZone
import java.util.logging.Logger

private val log = Logger.getLogger("app.lifecommit.model")

/** Что запоминается на устройстве: «Пропустить» онбординга, тема, «Все · Осталось». Как localStorage мини-аппа. */
interface Prefs {
    fun bool(key: String): Boolean
    fun setBool(key: String, value: Boolean)
    fun string(key: String): String?
    fun setString(key: String, value: String?)
}

class MemoryPrefs : Prefs {
    private val map = mutableMapOf<String, Any>()
    override fun bool(key: String) = map[key] as? Boolean ?: false
    override fun setBool(key: String, value: Boolean) {
        map[key] = value
    }
    override fun string(key: String) = map[key] as? String
    override fun setString(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}

/** Экраны поверх вкладок (Navigation 3: стек — список этих ключей). */
sealed interface Route {
    data object Main : Route

    /** «Чего я хочу?» — выбор вида новой привычки. */
    data object Pick : Route

    /** Редактор: новая привычка этого вида. */
    data class NewTask(val kind: TaskKind) : Route

    /** Экран привычки: отметка за сегодня, числа, месяц. */
    data class Detail(val id: Long) : Route

    /** Редактор существующей привычки. */
    data class EditTask(val id: Long) : Route

    data object Archive : Route
}

enum class Tab { Today, Calendar, Groups, Me }

enum class Haptic { Success, Impact }

class AppModel(
    val api: ApiClient,
    private val tokens: TokenStore,
    val prefs: Prefs,
    private val config: Config,
    private val scope: CoroutineScope,
    /** Язык телефона до входа: «ru-RU», «en-US». */
    private val systemLanguage: () -> String,
    private val oauthHttp: OkHttpClient = ApiClient.defaultHttp,
    private val oauthBase: String = TelegramOAuth.BASE,
    /** Сколько живёт плашка «Вернуть» (removal.tsx: 5 секунд). */
    private val undoMillis: Long = 5_000,
) {
    enum class Phase { Loading, SignedOut, Failed, Ready }

    /** Убранная строка, пока можно «Вернуть». */
    data class Removal(val key: String, val text: String)

    var phase by mutableStateOf(Phase.Loading)
        private set
    var user by mutableStateOf<UserSettings?>(null)
        private set
    var today by mutableStateOf(TodayResponse(day = ""))
        private set
    var heat by mutableStateOf<List<HeatDay>>(emptyList())
        private set

    /** Ошибка действия на «Сегодня» — тап убирает (как .error в мини-аппе). */
    var banner by mutableStateOf<String?>(null)

    /** Первый экран «Чего я хочу?»: ничего нет и «Пропустить» ещё не нажимали. */
    var onboarding by mutableStateOf(false)
        private set
    var tab by mutableStateOf(Tab.Today)
    val backStack = mutableStateListOf<Route>(Route.Main)
    var removal by mutableStateOf<Removal?>(null)
        private set

    /** Сервер не выполнил удаление — плашка «Что-то пошло не так» поверх любого экрана. */
    var removalFailed by mutableStateOf(false)
        private set
    private val removed = mutableStateListOf<String>()
    var signInError by mutableStateOf<String?>(null)
        private set
    var signingIn by mutableStateOf(false)
        private set

    /** Хаптика — у Activity (системная, View.performHapticFeedback); в тестах — пусто. */
    var haptics: (Haptic) -> Unit = {}

    /** Номер последнего изменения привычек и дел: фоновое обновление, начатое раньше, свой ответ выбрасывает. */
    private var change = 0
    private var loadedAt = 0L
    private var pendingCommit: (suspend () -> Unit)? = null
    private var removalTimer: Job? = null

    /** Ждём возврата из Telegram с кодом: PKCE и id бота этого входа. */
    private var pendingLogin: Pair<TelegramOAuth.Pkce, String>? = null

    /** Язык: как у человека в настройках; до входа — язык телефона. */
    val strings: Strings
        get() = user?.languageCode?.let { Strings.of(it) } ?: if (systemLanguage().startsWith("ru")) Strings.ru else Strings.en

    // Вход и загрузка

    fun start() {
        scope.launch {
            config.devUserId?.let {
                api.credential = Credential.TelegramInitData(DevTelegram.initData(it))
                load()
                return@launch
            }
            // Стенд разработки без подменённого входа — экран входа, сохранённый ключ прода туда не отправляем.
            val token = if (!config.useStoredToken) null else try {
                tokens.load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Ключ не расшифровался (например, сбросили Keystore) — входим заново, причина — в лог.
                log.severe("token read failed: $e")
                null
            }
            if (token == null) {
                phase = Phase.SignedOut
                return@launch
            }
            api.credential = Credential.Session(token)
            load()
        }
    }

    /** Сессия, «Сегодня» и карта — пока видна заставка: после неё ждать уже нечего. */
    suspend fun load() {
        phase = Phase.Loading
        try {
            user = api.session(TimeZone.getDefault().id).user
            val seq = change
            val todayCall = scope.async { api.today() }
            val heatCall = scope.async { api.heatmap(371) }
            val fresh = todayCall.await()
            val heatmap = heatCall.await()
            if (seq == change) {
                today = fresh
                heat = heatmap.days
                loadedAt = System.currentTimeMillis()
            }
            onboarding = fresh.isEmpty && !onboardingSkipped
            phase = Phase.Ready
        } catch (e: ApiError) {
            if (e.isSignedOut) {
                signOutLocally()
            } else {
                log.severe("load failed: $e")
                phase = Phase.Failed
            }
        }
    }

    fun retry() {
        scope.launch { load() }
    }

    /**
     * «Войти через Telegram»: id бота с сервера, новый PKCE; есть приложение Telegram — ссылка в него (/crossapp),
     * нет — страница входа Telegram в Custom Tab. Код вернётся в handleCallback.
     */
    fun beginSignIn(telegramInstalled: Boolean, open: (url: String, inBrowser: Boolean) -> Boolean) {
        if (signingIn) return
        signingIn = true
        signInError = null
        scope.launch {
            val clientId = try {
                api.telegramLoginConfig().clientId
            } catch (e: ApiError) {
                log.warning("telegram config failed: $e")
                signingIn = false
                signInError = strings.signInFailed
                return@launch
            }
            val pkce = TelegramOAuth.Pkce.random()
            pendingLogin = pkce to clientId
            val link = if (telegramInstalled) TelegramOAuth.crossAppLink(oauthHttp, clientId, pkce, oauthBase) else null
            val opened = (link != null && open(link, false)) || open(TelegramOAuth.authUrl(clientId, pkce, oauthBase).toString(), true)
            // Открыть нечем (нет ни Telegram, ни браузера) — сказать, а не крутить кнопку вечно.
            if (!opened) {
                pendingLogin = null
                signingIn = false
                signInError = strings.signInFailed
            }
        }
    }

    /** Вернулись в приложение без кода (закрыли страницу входа) — снова кнопка; поздний код всё равно примем. */
    fun returnedWithoutCallback() {
        if (signingIn && pendingLogin != null) signingIn = false
    }

    /** lifecommit://tglogin?… — только пока ждём вход; иначе ссылку игнорируем (её мог прислать кто угодно). */
    fun handleCallback(uri: String) {
        if (!TelegramOAuth.isCallback(uri)) return
        val (pkce, clientId) = pendingLogin ?: run {
            log.warning("telegram callback without a pending sign-in — ignored")
            return
        }
        pendingLogin = null
        signingIn = true
        scope.launch {
            try {
                val code = TelegramOAuth.code(uri)
                val idToken = TelegramOAuth.exchange(oauthHttp, code, clientId, pkce, oauthBase)
                finishSignIn(idToken)
            } catch (_: TelegramOAuth.Failure.Cancelled) {
                signingIn = false
            } catch (e: TelegramOAuth.Failure) {
                log.warning("telegram sign-in failed: $e")
                signingIn = false
                signInError = strings.signInFailed
            }
        }
    }

    /** id_token Telegram → ключ сессии с сервера: сохранить и загрузиться. */
    private suspend fun finishSignIn(idToken: String) {
        try {
            val signed = api.signInWithTelegram(idToken, Config.DEVICE, systemLanguage())
            tokens.save(signed.token)
            api.credential = Credential.Session(signed.token)
            signInError = null
            signingIn = false
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.severe("sign-in failed: $e")
            signingIn = false
            signInError = strings.signInFailed
        }
    }

    /** Ключ больше не пускает (или вышли) — забыть его и показать вход. */
    fun signOutLocally() {
        scope.launch {
            try {
                tokens.clear()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.severe("token clear failed: $e")
            }
        }
        api.credential = null
        user = null
        today = TodayResponse(day = "")
        heat = emptyList()
        backStack.clear()
        backStack.add(Route.Main)
        tab = Tab.Today
        phase = Phase.SignedOut
    }

    /** «Выйти на этом устройстве»: ключ гасится на сервере; не вышло — всё равно забываем его здесь. */
    fun logout() {
        scope.launch {
            try {
                api.signOutHere()
            } catch (e: ApiError) {
                log.warning("sign out on server failed: $e")
            }
            signOutLocally()
        }
    }

    /** Перечитать «Сегодня» (после правки, удаления, возврата на экран); deleted — удаление стирает и прошлые дни карты. */
    suspend fun refresh(deleted: Boolean = false) {
        change++
        if (deleted) {
            scope.launch {
                try {
                    heat = api.heatmap(371).days
                } catch (e: ApiError) {
                    log.info("heatmap refresh failed: $e")
                }
            }
        }
        try {
            // Как trackEdit и load.range в src/caches.ts: сначала дождаться правок, которые ещё идут на сервер, —
            // иначе ответ придёт без них; за время ответа что-то отметили — ответ устарел, спрашиваем заново.
            repeat(3) {
                writes.first { it == 0 }
                val seq = change
                val fresh = api.today()
                if (seq == change && writes.value == 0) {
                    today = fresh
                    loadedAt = System.currentTimeMillis()
                    if (!fresh.isEmpty) onboarding = false
                    return
                }
            }
            log.info("today refresh: still changing, kept what is on screen")
        } catch (e: ApiError) {
            if (e.isSignedOut) signOutLocally() else log.info("today refresh failed: $e")
        }
    }

    /** Сколько правок «Сегодня» ещё идут на сервер (отметки, дела): перечитывание их ждёт. */
    private val writes = MutableStateFlow(0)

    /** Правка, которую ждёт перечитывание «Сегодня». */
    private suspend fun <T> write(block: suspend () -> T): T {
        writes.update { it + 1 }
        try {
            return block()
        } finally {
            writes.update { it - 1 }
        }
    }

    /**
     * Вернулись в приложение: данным больше минуты — тихо обновить в фоне. Пока шёл запрос, что-то отметили — ответ
     * устарел и выбрасывается.
     */
    fun refreshIfStale() {
        if (phase != Phase.Ready || System.currentTimeMillis() - loadedAt <= 60_000) return
        val seq = change
        scope.launch {
            try {
                val fresh = api.today()
                if (seq == change) {
                    today = fresh
                    loadedAt = System.currentTimeMillis()
                }
            } catch (e: ApiError) {
                log.info("background refresh failed: $e")
            }
        }
    }

    /** Тесты: данные «Сегодня» устарели (как через минуту) — следующий refreshIfStale пойдёт на сервер. */
    internal fun forceStale() {
        loadedAt = 0
    }

    // Навигация

    fun open(route: Route) {
        backStack.add(route)
    }

    fun back() {
        if (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
    }

    /** После сохранения — назад на «Сегодня», стек целиком. */
    fun backToMain() {
        while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
        tab = Tab.Today
    }

    // Онбординг

    private val onboardingSkipped: Boolean get() = !config.isTest && prefs.bool(SKIP_KEY)

    /** «Пропустить» — запоминаем на этом устройстве. */
    fun skipOnboarding() {
        if (!config.isTest) prefs.setBool(SKIP_KEY, true)
        onboarding = false
    }

    // Отметки привычек

    /** Отметка за сегодня: экран меняется сразу, сервер догоняет; не вышло — откат и ошибка. */
    fun log(task: TodayTask, value: Double?, status: AbstainStatus?) {
        val cleared = if (task.kind == TaskKind.Abstain) status == null else value == null
        val next = task.copy(value = value ?: if (status == AbstainStatus.Clean) 1.0 else 0.0, status = status, logged = !cleared)
        change++
        patchTask(next)
        if (!task.isDone && next.isDone) haptics(Haptic.Success)
        scope.launch {
            try {
                write { api.log(task.id, value, status) }
            } catch (e: ApiError) {
                patchTask(task)
                fail(e)
            }
        }
    }

    private fun patchTask(task: TodayTask) {
        today = today.copy(tasks = today.tasks.map { if (it.id == task.id) task else it })
    }

    /** Карта с сегодняшней клеткой из отметок на экране. */
    val heatWithToday: List<HeatDay> get() = if (today.day.isEmpty()) heat else Heat.withToday(heat, today)

    // Дела

    fun toggle(todo: Todo) {
        val done = !todo.done
        patchTodos { list -> list.map { if (it.isSame(todo)) it.copy(done = done) else it } }
        if (done) haptics(Haptic.Success)
        change++
        scope.launch {
            try {
                write {
                    api.updateTodo(todo.id, buildJsonObject {
                        put("done", done)
                        // У повторяющегося дела «сделано» — на этот его день.
                        if (todo.recurring) put("on", todo.day)
                    })
                }
            } catch (e: ApiError) {
                patchTodos { list -> list.map { if (it.isSame(todo)) todo else it } }
                fail(e)
            }
        }
    }

    private var tempId = 0L

    /** Новое дело появляется сразу (временный отрицательный id), настоящий id приходит с сервера. */
    fun addTodo(title: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return
        val temp = Todo(id = --tempId, title = trimmed, day = today.day)
        patchTodos { it + temp }
        change++
        scope.launch {
            try {
                val id = write { api.createTodo(trimmed, today.day) }
                change++
                patchTodos { list -> list.map { if (it.id == temp.id) it.copy(id = id) else it } }
            } catch (e: ApiError) {
                patchTodos { list -> list.filter { it.id != temp.id } }
                fail(e)
            }
        }
    }

    private fun patchTodos(transform: (List<Todo>) -> List<Todo>) {
        today = today.copy(todos = Todos.sorted(transform(today.todos)))
    }

    // Экран привычки

    /** История привычек, уже открытых на этом запуске: экран открывается сразу, свежая история догружается. */
    val histories = androidx.compose.runtime.mutableStateMapOf<Long, TaskHistory>()

    suspend fun loadHistory(id: Long) {
        try {
            histories[id] = api.history(id)
        } catch (e: ApiError) {
            if (e.isSignedOut) signOutLocally() else log.info("history $id failed: $e")
        }
    }

    /**
     * Отметка за прошлый день (TaskDetail.tsx markDay): на экране сразу, потом свежие «Сегодня» и карта. Сегодня —
     * обычная отметка. yes null — убрать отметку.
     */
    fun markDay(task: TodayTask, day: String, yes: Boolean?) {
        if (day == today.day) {
            if (task.kind == TaskKind.Abstain) log(task, null, yes?.let { if (it) AbstainStatus.Clean else AbstainStatus.Slip })
            else log(task, if (yes == true) task.target else null, null)
            return
        }
        val status = if (task.kind == TaskKind.Abstain && yes != null) (if (yes) AbstainStatus.Clean else AbstainStatus.Slip) else null
        val value = when {
            yes == null -> null
            task.kind == TaskKind.Abstain -> if (yes) 1.0 else 0.0
            yes -> task.target
            else -> null
        }
        val before = histories[task.id]
        val start = before?.start ?: today.day
        // До приложения после «последнего раза» день и так чистый — «получилось» там просто убирает отметку.
        val slip = task.lastSlipOn
        val implicit = task.kind == TaskKind.Abstain && slip != null && day > slip && day < start
        val keep = yes != null && !(implicit && yes) && (task.kind == TaskKind.Abstain || yes)
        val base = before ?: TaskHistory(start, emptyList(), emptyList())
        val rest = base.logs.filter { it.day != day }
        histories[task.id] = base.copy(logs = if (keep) (rest + HistoryLog(day, value ?: 0.0, status)).sortedBy { it.day } else rest)
        if (yes == true) haptics(Haptic.Success)
        change++
        scope.launch {
            try {
                write { api.log(task.id, if (task.kind == TaskKind.Abstain) null else value, status, day) }
            } catch (e: ApiError) {
                if (before != null) histories[task.id] = before else histories.remove(task.id)
                loadHistory(task.id)
                fail(e)
                return@launch
            }
            refresh(deleted = true)
        }
    }

    /** Дела «на потом» — для шторки «Потом · N». */
    suspend fun laterTodos(): List<Todo> = guard { api.laterTodos() }

    // Удаление с «Вернуть» (removal.tsx)

    fun isRemoved(key: String): Boolean = key in removed

    /**
     * Строка пропадает сразу, внизу 5 секунд «Вернуть»; на сервер удаление уходит, когда плашка закрылась (или
     * приложение свернули). Не вышло — экран перечитывается (строка вернётся), поверх — «Что-то пошло не так».
     */
    fun removeWithUndo(key: String, text: String, commit: suspend () -> Unit) {
        flushRemoval()
        removalFailed = false
        removed.add(key)
        removal = Removal(key, text)
        pendingCommit = commit
        haptics(Haptic.Impact)
        removalTimer = scope.launch {
            delay(undoMillis)
            flushRemoval()
        }
    }

    fun undoRemoval() {
        val r = removal ?: return
        removalTimer?.cancel()
        pendingCommit = null
        removed.remove(r.key)
        removal = null
    }

    /** Отправить отложенное удаление сейчас (плашка закрылась, приложение уходит в фон). */
    fun flushRemoval() {
        val r = removal ?: return
        val commit = pendingCommit ?: return
        removalTimer?.cancel()
        pendingCommit = null
        removal = null
        scope.launch {
            try {
                commit()
            } catch (e: ApiError) {
                log.severe("removal failed: $e")
                if (e.isSignedOut) {
                    signOutLocally()
                } else {
                    removalFailed = true
                    scope.launch {
                        delay(undoMillis)
                        removalFailed = false
                    }
                }
            }
            removed.remove(r.key)
        }
    }

    fun dismissRemovalError() {
        removalFailed = false
    }

    fun removeTask(task: TodayTask) {
        removeWithUndo("task:${task.id}", strings.swipe.removed(task.title)) {
            try {
                api.deleteTask(task.id)
            } finally {
                // Сервер не удалил — экран всё равно перечитываем (привычка вернётся), ошибку покажет плашка.
                refresh(deleted = true)
            }
        }
    }

    /** after — перечитать свой список (шторка «Потом»), удалилось дело или нет. */
    fun removeTodo(todo: Todo, after: suspend () -> Unit = {}) {
        removeWithUndo("todo:${todo.id}", strings.swipe.removed(todo.title)) {
            try {
                api.deleteTodo(todo.id)
            } finally {
                refresh()
                after()
            }
        }
    }

    // Редактор привычки и «Отложенные»: ошибки показывает сам экран (сообщение под формой), поэтому здесь — бросаем.

    /** Новая привычка или правка; true — цель стала легче и применится с завтра (сказать человеку). */
    suspend fun saveTask(id: Long?, input: TaskInput): Boolean = guard {
        var goalTomorrow = false
        if (id == null) {
            api.createTask(input)
        } else {
            val res = api.updateTask(id, patchOf(input))
            goalTomorrow = res.goalEffectiveFrom?.let { it > today.day } == true
        }
        refresh()
        haptics(Haptic.Success)
        goalTomorrow
    }

    suspend fun postpone(id: Long) = guard {
        api.archiveTask(id)
        refresh()
    }

    suspend fun restore(id: Long) = guard {
        api.restoreTask(id)
        refresh()
    }

    /** Удалить насовсем — вместе с историей (подтверждение спрашивает экран). */
    suspend fun deleteForever(id: Long) = guard {
        api.deleteTask(id)
        refresh(deleted = true)
    }

    /** Ключ больше не пускает — на вход, а не сообщение под формой. */
    private suspend fun <T> guard(block: suspend () -> T): T = try {
        block()
    } catch (e: ApiError) {
        if (e.isSignedOut) signOutLocally()
        throw e
    }

    // Ошибки

    /** Действие не вышло: ключ больше не пускает — на вход; иначе — плашка ошибки. */
    private fun fail(e: ApiError) {
        if (e.isSignedOut) {
            signOutLocally()
            return
        }
        log.severe("action failed: $e")
        banner = strings.error
    }

    companion object {
        const val SKIP_KEY = "lc-onboarding-skipped"

        /** PATCH — все поля формы, кроме вида (его в редакторе не меняют), null — очистить. */
        fun patchOf(input: TaskInput): JsonObject = buildJsonObject {
            put("title", input.title)
            put("unit", input.unit?.let(::JsonPrimitive) ?: JsonNull)
            put("schedule", input.schedule.wire)
            put("weekdays", input.weekdays)
            put("per_week", input.perWeek?.let(::JsonPrimitive) ?: JsonNull)
            put("visibility", input.visibility.wire)
            put("target", number(input.target))
            put("last_slip_on", input.lastSlipOn?.let(::JsonPrimitive) ?: JsonNull)
        }
    }
}
