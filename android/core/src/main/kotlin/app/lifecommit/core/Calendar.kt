// Логика «Календаря» — как src/screens/Calendar.tsx, src/useTodos.ts и CalendarsSheet.tsx: какие дни на экране,
// что отправить при правке дела, подпись «обновлено N мин назад», куда пишем наши дела.
package app.lifecommit.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

enum class CalMode { Day, Month }

object CalendarDays {
    /** Дни на экране: один день или месяц целыми неделями с понедельника (до 6 строк). */
    fun range(mode: CalMode, anchor: String): List<String> {
        if (mode == CalMode.Day) return listOf(anchor)
        val month = Months.of(anchor)
        val first = "$month-01"
        val last = Days.add("${Months.shift(month, 1)}-01", -1)
        val days = mutableListOf<String>()
        var d = Days.add(first, -Days.weekdayIndex(first))
        while (d <= last || Days.weekdayIndex(d) != 0) {
            days += d
            d = Days.add(d, 1)
        }
        return days
    }

    /** Листать стрелками: день — на день, месяц — на месяц (на его первое число). */
    fun shift(mode: CalMode, selected: String, n: Int): String =
        if (mode == CalMode.Day) Days.add(selected, n) else "${Months.shift(Months.of(selected), n)}-01"
}

/** Что меняют в шторке дела. location — только у своих дел; "" — убрать. */
data class TodoEdit(val title: String, val day: String, val time: String?, val location: String? = null)

object TodoEdits {
    /**
     * Только изменённые поля (useTodos.update): у повторяющегося день не меняется — он задаёт, в какие дни дело бывает.
     * Пусто — на сервер ничего не отправлять.
     */
    fun patch(todo: Todo, edit: TodoEdit): JsonObject = buildJsonObject {
        if (edit.title != todo.title) put("title", JsonPrimitive(edit.title))
        if (edit.day != todo.day && !todo.recurring) put("day", JsonPrimitive(edit.day))
        if (edit.time != todo.time) put("time", edit.time?.let(::JsonPrimitive) ?: JsonNull)
        if (edit.location != null && edit.location != (todo.details?.location ?: "")) put("location", JsonPrimitive(edit.location))
    }

    /** Дело на экране сразу после правки (сервер догоняет). */
    fun applied(todo: Todo, edit: TodoEdit): Todo {
        val details = if (edit.location == null) todo.details else {
            val rest = (todo.details ?: TodoDetails()).copy(location = edit.location.trim().ifEmpty { null })
            rest.takeIf { it != TodoDetails() }
        }
        return todo.copy(title = edit.title, time = edit.time, details = details)
    }

    /** Переехавшее со вчера дело в шторке — сегодняшнее: прошлым днём его уже не поставить. */
    fun initialDay(todo: Todo, today: String): String = if (!todo.recurring && todo.day < today) today else todo.day
}

object CalendarAccounts {
    /** «обновлено 3 мин назад». */
    fun syncedLabel(t: Strings, iso: String?, now: Instant = Instant.now()): String {
        if (iso == null) return ""
        val at = try {
            Instant.parse(iso)
        } catch (_: DateTimeParseException) {
            return ""
        }
        val min = Duration.between(at, now).toMinutes()
        return t.cal.synced(if (min < 1) t.cal.justNow else t.cal.minutesAgo(min.toInt()))
    }

    /** Новые дела пишутся в подключённый последним (список приходит по порядку подключения). */
    fun destination(accounts: List<CalendarAccount>): CalendarAccount? = accounts.lastOrNull { it.status == "ok" && it.defaultUrl != null }

    /** Пароль приложения Apple: 16 букв (дефисы и пробелы не считаем), почта — с «@». */
    fun appleFormValid(login: String, password: String): Boolean = login.contains('@') && password.replace(Regex("[\\s-]"), "").length >= 12
}

/**
 * Ссылка из чужих данных (событие календаря: созвон, «Открыть в Google»), которую можно открыть: только http и https.
 * Сервер берёт её из календаря как есть; мини-апп открывает через openLink Telegram, а тот пускает только http(s).
 * Здесь та же граница — иначе приглашение со ссылкой lifecommit://… или схемой чужого приложения увело бы туда
 * (/code-review и проверка безопасности 06.10). null — не открываем и строку не показываем.
 */
fun webLink(url: String?): String? {
    val u = url?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val scheme = u.substringBefore(':', "").lowercase()
    if (scheme != "http" && scheme != "https") return null
    // После схемы — «//» и хост: «https:evil» и «https:///x» не ссылки.
    val rest = u.substring(scheme.length + 1)
    if (!rest.startsWith("//") || rest.length < 3 || rest[2] == '/') return null
    return u
}

/** Ссылка на созвон — «Подключиться», остальное — «Открыть ссылку» (TodoSheet.tsx). */
fun isCallLink(url: String): Boolean = Regex("meet|zoom|teams|telemost|webex|whereby|jit\\.si|jazz|ktalk|t\\.me/call|facetime", RegexOption.IGNORE_CASE).containsMatchIn(url)

@kotlinx.serialization.Serializable
data class GoogleFinish(val accountId: Long, val fresh: Boolean)

/** Подключить Google по одноразовому коду из возврата (своим ключом: чужой код сервер не примет). */
suspend fun ApiClient.finishGoogle(pending: String): GoogleFinish =
    send("POST", "calendars/google/finish", kotlinx.serialization.json.buildJsonObject { put("pending", kotlinx.serialization.json.JsonPrimitive(pending)) }, GoogleFinish.serializer())
