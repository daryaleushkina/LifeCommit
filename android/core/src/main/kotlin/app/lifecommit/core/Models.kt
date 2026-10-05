// Модели API — поле в поле как shared/types.ts (контракт — docs/mobile.md). Имена полей в JSON — snake_case,
// здесь — camelCase: Json переводит сам (Api.json). Новое поле на сервере — сюда в том же коммите.
package app.lifecommit.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class TaskKind {
    @SerialName("count") Count,
    @SerialName("check") Check,
    @SerialName("abstain") Abstain,
}

@Serializable
enum class Schedule(val wire: String) {
    @SerialName("daily") Daily("daily"),
    @SerialName("weekdays") Weekdays("weekdays"),
    @SerialName("per_week") PerWeek("per_week"),
}

/** Кто видит привычку: только я или друзья (по умолчанию — только я). */
@Serializable
enum class Visibility(val wire: String) {
    @SerialName("private") Private("private"),
    @SerialName("friends") Friends("friends"),
}

/** «Бросить»: получилось сегодня или было. */
@Serializable
enum class AbstainStatus(val wire: String) {
    @SerialName("clean") Clean("clean"),
    @SerialName("slip") Slip("slip"),
}

@Serializable
data class Subtask(val id: Long, val title: String)

@Serializable
data class TodayTask(
    val id: Long,
    val title: String,
    val emoji: String? = null,
    val kind: TaskKind,
    val unit: String? = null,
    val step: Double = 1.0,
    val schedule: Schedule = Schedule.Daily,
    /** Битовая маска дней недели, пн = 1. */
    val weekdays: Int = 127,
    val perWeek: Int? = null,
    val visibility: Visibility = Visibility.Private,
    val target: Double = 1.0,
    val value: Double = 0.0,
    /** Есть ли отметка за сегодня. */
    val logged: Boolean = false,
    val status: AbstainStatus? = null,
    /** Сколько дней на этой неделе уже отмечено (для «несколько раз в неделю»). */
    val weekDone: Int = 0,
    /** Нужна ли сегодня. */
    val due: Boolean = true,
    val subtasks: List<Subtask> = emptyList(),
    val challengeId: Long? = null,
    /** «Бросить»: чистых дней до сегодняшнего (вместе с днями до появления привычки в приложении). */
    val cleanBefore: Int = 0,
    /** «Бросить»: когда это было в последний раз до начала учёта. */
    val lastSlipOn: String? = null,
)

@Serializable
data class UserSettings(
    val id: Long,
    val firstName: String,
    val username: String? = null,
    val photoUrl: String? = null,
    val languageCode: String = "ru",
    val timezone: String = "Europe/Moscow",
    val dayStartHour: Int = 4,
    val remindMorning: String? = null,
    val remindEvening: String? = null,
    val botChatOk: Boolean = false,
    val premium: Boolean = false,
)

/** Подробности события: из календаря или из голоса. Всё необязательное. */
@Serializable
data class TodoDetails(
    val location: String? = null,
    val link: String? = null,
    val peopleCount: Int? = null,
    val people: List<String>? = null,
    val notes: String? = null,
    val openUrl: String? = null,
)

@Serializable
enum class TodoSource {
    @SerialName("apple") Apple,
    @SerialName("google") Google,
}

/** Разовое дело. Несделанное остаётся в списке и в следующие дни («со вчера»). */
@Serializable
data class Todo(
    val id: Long,
    val title: String,
    /** На какой день запланировано (YYYY-MM-DD); раньше сегодняшнего — значит, переехало. У повторяющегося — день этого раза. */
    val day: String,
    val done: Boolean = false,
    /** «HH:MM» — на это время; null — на весь день. */
    val time: String? = null,
    /** Длительность события из календаря, минуты. */
    val durationMin: Int? = null,
    /** Повторяется, как событие календаря: «сделано» у каждого дня своё. */
    val recurring: Boolean = false,
    /** Пришло из календаря. */
    val source: TodoSource? = null,
    val details: TodoDetails? = null,
) {
    /** Тот же раз дела: у повторяющегося один id на все дни, различает их день. */
    fun isSame(other: Todo): Boolean = id == other.id && (!recurring || day == other.day)
}

/** Отложенная привычка: скрыта с «Сегодня», история остаётся. */
@Serializable
data class ArchivedTask(val id: Long, val title: String, val emoji: String? = null)

@Serializable
data class TaskLimits(val maxTasks: Int? = null, val active: Int = 0)

/** GET /today. Группы (`groups`) придут вместе с разделом «Вместе» — пока их поле не читаем. */
@Serializable
data class TodayResponse(
    /** Логический день человека (YYYY-MM-DD). */
    val day: String,
    val tasks: List<TodayTask> = emptyList(),
    val archived: List<ArchivedTask> = emptyList(),
    val limits: TaskLimits = TaskLimits(),
    val todos: List<Todo> = emptyList(),
    /** Сколько дел запланировано на потом. */
    val todosLater: Int = 0,
)

@Serializable
data class HeatDay(val day: String, val score: Double)

@Serializable
data class HeatmapResponse(val today: String, val days: List<HeatDay>)

@Serializable
data class SessionResponse(val user: UserSettings, val startParam: String? = null, val isNew: Boolean = false)

/** Устройство, где вошли: компьютер (mac, web) или приложение на телефоне (ios, android). */
@Serializable
data class DeviceSession(val id: Long, val device: String, val createdAt: String, val lastUsedAt: String, val current: Boolean)

/** Новая привычка или правка (PATCH — только изменённые поля, см. Api.updateTask). */
@Serializable
data class TaskInput(
    val title: String,
    val emoji: String? = null,
    val kind: TaskKind,
    val unit: String? = null,
    val schedule: Schedule = Schedule.Daily,
    val weekdays: Int = 127,
    val perWeek: Int? = null,
    val visibility: Visibility = Visibility.Private,
    val target: Double = 1.0,
    val lastSlipOn: String? = null,
)

/** История привычки: экран статистики считает её сам. */
@Serializable
data class HistoryLog(val day: String, val value: Double, val status: AbstainStatus? = null)

@Serializable
data class HistoryGoal(val effectiveFrom: String, val target: Double)

@Serializable
data class TaskHistory(val start: String, val goals: List<HistoryGoal>, val logs: List<HistoryLog>)

/** Ответ создания: 201 {id}. */
@Serializable
data class Created(val id: Long)

/** PATCH /tasks/:id: цель стала легче — действует с этого дня. */
@Serializable
data class TaskUpdated(val goalEffectiveFrom: String? = null)

/** Вход через Telegram: ключ сессии и «новый ли человек». */
@Serializable
data class SignedIn(val token: String, val isNew: Boolean = false)

@Serializable
data class TelegramLoginConfig(val clientId: String)

// «Календарь»

/** Календарь внутри подключённого аккаунта: включён ли, можно ли писать туда наши дела. */
@Serializable
data class CalendarCollection(val url: String, val name: String, val color: String? = null, val enabled: Boolean = false, val writable: Boolean = false)

/** Подключённый календарь (src/api.ts CalendarAccount). */
@Serializable
data class CalendarAccount(
    val id: Long,
    val provider: TodoSource,
    val login: String = "",
    /** ok, auth_failed, error; setup — Google подключён, но календари ещё не выбраны. */
    val status: String,
    val lastSyncAt: String? = null,
    /** Куда пишем наши дела. */
    val defaultUrl: String? = null,
    val collections: List<CalendarCollection> = emptyList(),
)

/** GET /calendar?from&to: дела по дням (повторы раскрыты сервером). Группы (`groups`) — вместе с «Вместе». */
@Serializable
data class CalendarRange(val today: String, val todos: List<Todo> = emptyList())

@Serializable
data class LinkUrl(val url: String)
