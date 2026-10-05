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

    fun reset() {
        seq++
        blocked = emptyList()
        devices = emptyList()
        error = false
        unblockError = false
    }

    /** Открыли «Я»: заблокированные и устройства. Не загрузилось — строк нет (как в мини-аппе), причина — в лог. */
    fun load() {
        scope.launch {
            try {
                blocked = api.blocks()
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("blocks: $e")
            }
        }
        scope.launch {
            try {
                devices = api.deviceSessions()
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("devices: $e")
            }
        }
    }

    /** Напоминание (HH:MM или null — выключено), конец дня (0–12), язык — на экране сразу, потом с сервера. */
    fun save(patch: Map<String, Any?>) {
        val before = user() ?: return
        val mine = ++seq
        error = false
        setUser(apply(before, patch))
        scope.launch {
            try {
                val fresh = api.updateSettings(JsonObject(patch.mapValues { (_, v) -> json(v) }))
                if (mine == seq) setUser(fresh)
            } catch (e: ApiError) {
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("settings: $e")
                if (mine == seq) setUser(before)
                error = true
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
        scope.launch {
            try {
                api.unblock(p.id)
            } catch (e: ApiError) {
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
