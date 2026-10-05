// Состояние «Я» — как src/screens/Profile.tsx: настройки (напоминание, конец дня, язык), заблокированные, устройства,
// «Выйти везде», «Удалить аккаунт». Настройка меняется сразу, сервер догоняет; не вышло — как было и ошибка.
package app.lifecommit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.lifecommit.core.ApiClient
import app.lifecommit.core.ApiError
import app.lifecommit.core.DeviceSession
import app.lifecommit.core.Person
import app.lifecommit.core.UserSettings
import app.lifecommit.core.blocks
import app.lifecommit.core.deleteAccount
import app.lifecommit.core.deviceSessions
import app.lifecommit.core.signOutEverywhere
import app.lifecommit.core.unblock
import app.lifecommit.core.updateSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.logging.Logger

private val log = Logger.getLogger("app.lifecommit.me")

class MeModel(
    private val api: ApiClient,
    private val scope: CoroutineScope,
    private val user: () -> UserSettings?,
    private val setUser: (UserSettings) -> Unit,
    private val onSignedOut: () -> Unit,
) {
    /** Заблокированные: строка в «Я» видна, только если кто-то есть. */
    var blocked by mutableStateOf<List<Person>>(emptyList())
        private set

    /** Устройства, где вошли (это — тоже, с current). */
    var devices by mutableStateOf<List<DeviceSession>>(emptyList())
        private set

    /** Действие не вышло — строка ошибки (тап убирает). */
    var error by mutableStateOf(false)

    /** Сервер не разблокировал — строка ошибки в шторке. */
    var unblockError by mutableStateOf(false)

    /** Номер правки настроек: ответ на старую правку новую не затирает. */
    private var seq = 0

    /** Номер человека: растёт при выходе — ответы, начатые при прошлом аккаунте, ничего не записывают. */
    private var epoch = 0

    /**
     * Настройки, которые сервер точно сохранил, пока правки ещё идут; null — правок в пути нет. Не вышло — экран к ним, а
     * не к «до этой правки»: там могла остаться прошлая правка, которую сервер тоже не принял (/lc-review 06.10).
     */
    private var saved: UserSettings? = null
    private var saving = 0

    fun reset() {
        seq++
        epoch++
        saved = null
        saving = 0
        blocked = emptyList()
        devices = emptyList()
        error = false
        unblockError = false
    }

    /** Открыли «Я»: заблокированные и устройства. Не загрузилось — строк нет (как в мини-аппе), причина — в лог. */
    fun load() {
        val e = epoch
        inFlight += 2
        scope.launch {
            try {
                val fresh = api.blocks()
                if (e == epoch) blocked = fresh
            } catch (err: ApiError) {
                if (e != epoch) return@launch
                if (err.isSignedOut) return@launch onSignedOut()
                log.info("blocks: $err")
            } finally {
                inFlight--
            }
        }
        scope.launch {
            try {
                val fresh = api.deviceSessions()
                if (e == epoch) devices = fresh
            } catch (err: ApiError) {
                if (e != epoch) return@launch
                if (err.isSignedOut) return@launch onSignedOut()
                log.info("devices: $err")
            } finally {
                inFlight--
            }
        }
    }

    /** Сколько загрузок «Я» ещё в пути — тесты ждут их, а не паузу. */
    internal var inFlight by mutableStateOf(0)
        private set

    /** Напоминание (HH:MM или null — выключено), конец дня (0–12), язык — на экране сразу, потом с сервера. */
    fun save(patch: Map<String, Any?>) {
        val before = user() ?: return
        val mine = ++seq
        val e = epoch
        if (saving++ == 0) saved = before
        error = false
        setUser(apply(before, patch))
        scope.launch {
            try {
                val fresh = api.updateSettings(JsonObject(patch.mapValues { (_, v) -> json(v) }))
                if (e != epoch) return@launch
                saved = fresh
                if (mine == seq) setUser(fresh)
            } catch (err: ApiError) {
                if (e != epoch) return@launch
                if (err.isSignedOut) return@launch onSignedOut()
                log.info("settings: $err")
                if (mine == seq) saved?.let(setUser)
                error = true
            } finally {
                if (e == epoch && --saving == 0) saved = null
            }
        }
    }

    private fun json(v: Any?) = when (v) {
        null -> kotlinx.serialization.json.JsonNull
        is Number -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        else -> JsonPrimitive(v.toString())
    }

    private fun apply(u: UserSettings, patch: Map<String, Any?>): UserSettings = patch.entries.fold(u) { acc, (k, v) ->
        when (k) {
            "remind_evening" -> acc.copy(remindEvening = v as String?)
            "day_start_hour" -> acc.copy(dayStartHour = v as Int)
            "language_code" -> acc.copy(languageCode = v as String)
            else -> acc
        }
    }

    /** «Разблокировать»: из списка сразу; не вышло — на прежнее место и строка ошибки. */
    fun unblock(p: Person) {
        unblockError = false
        val at = blocked.indexOfFirst { it.id == p.id }.takeIf { it >= 0 } ?: return
        blocked = blocked.filter { it.id != p.id }
        val e0 = epoch
        scope.launch {
            try {
                api.unblock(p.id)
            } catch (e: ApiError) {
                if (e0 != epoch) return@launch
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("unblock: $e")
                blocked = blocked.toMutableList().apply { add(at.coerceAtMost(size), p) }
                unblockError = true
            }
        }
    }

    /** «Выйти везде»: гасит все ключи, и этот тоже — после ответа сервера здесь тоже выходим. */
    fun logoutEverywhere() {
        error = false
        scope.launch {
            try {
                api.signOutEverywhere()
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("logout everywhere: $e")
                error = true
                return@launch
            }
            onSignedOut()
        }
    }

    /** «Удалить аккаунт» (решение владелицы 06.10: просто подтверждением). Удалили — ключа больше нет, экран входа. */
    fun deleteAccount() {
        error = false
        scope.launch {
            try {
                api.deleteAccount()
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.warning("delete account: $e")
                error = true
                return@launch
            }
            onSignedOut()
        }
    }
}
