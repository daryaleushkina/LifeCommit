// «Вместе»: группы и друзья — модели поле в поле как shared/groups.ts, shared/types.ts и src/api.ts, вызовы API
// (docs/mobile.md «Группы», «Друзья») и логика экранов (groupUi.tsx, GroupItemSheet.tsx, Heatmap.tsx).
package app.lifecommit.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Группы

@Serializable
enum class GroupMode(val wire: String) {
    /** Кто-то один: сделал один — закрыто у всех. */
    @SerialName("one") One("one"),

    /** Назначить: одному, нескольким или всем (по очереди или каждый сам). */
    @SerialName("assign") Assign("assign"),

    /** Общая цель — вместе до одной цифры. */
    @SerialName("goal") Goal("goal"),

    /** Мероприятие — без галочки. */
    @SerialName("event") Event("event"),
}

@Serializable
enum class GroupRole {
    @SerialName("owner") Owner,
    @SerialName("admin") Admin,
    @SerialName("member") Member,
}

@Serializable
data class GroupMember(val id: Long, val name: String, val photo: String? = null)

/** Единица общей цели; null — просто числа «27 из 40». forms — одна, две, пять: «книга, книги, книг». */
@Serializable
data class GoalUnit(val type: String, val forms: List<String>, val currency: String? = null, val icon: String? = null)

/** Групповое дело на конкретный день — глазами одного участника (кто делает и можно ли отметить считает сервер). */
@Serializable
data class GroupDayItem(
    val id: Long,
    val title: String,
    val mode: GroupMode,
    val time: String? = null,
    val durationMin: Int? = null,
    val dueDay: String? = null,
    /** Разовое с прошлого дня, ещё не сделано. */
    val carried: Boolean = false,
    val recurring: Boolean = false,
    /** Кому это дело сегодня (у очереди — один человек). */
    val people: List<Long> = emptyList(),
    val allMembers: Boolean = false,
    val rotate: Boolean = false,
    /** Чья сегодня очередь. */
    val turn: Long? = null,
    /** Показывать мне на «Сегодня». */
    val forMe: Boolean = false,
    /** Я могу отметить. */
    val canMark: Boolean = false,
    /** Закрыто для меня. */
    val done: Boolean = false,
    /** Кто сделал сегодня. */
    val doneBy: List<Long> = emptyList(),
    val target: Double? = null,
    val total: Double? = null,
    val unit: GoalUnit? = null,
    val goalUntil: String? = null,
    /** Как задано (для правки): первый день, повтор, выбранные люди. */
    val start: String = "",
    val rrule: String? = null,
    val assignees: List<Long> = emptyList(),
)

@Serializable
data class GroupRef(val id: Long, val title: String, val kind: String = "other", val members: List<GroupMember> = emptyList())

/** Дела группы на один день — для «Календаря» и «Скоро». */
@Serializable
data class GroupDayBlock(val day: String, val group: GroupRef, val items: List<GroupDayItem> = emptyList())

@Serializable
data class GroupSettings(
    val adminsOnlyEdit: Boolean = false,
    val ratingEnabled: Boolean = false,
    val chatDigest: Boolean = false,
    val chatReminders: Boolean = false,
    val tgChatTitle: String? = null,
)

/** Группа на «Сегодня» и в списке; с settings и upcoming — экран группы (GET /groups/:id). */
@Serializable
data class GroupToday(
    val id: Long,
    val title: String,
    val kind: String = "other",
    val color: String? = null,
    val role: GroupRole = GroupRole.Member,
    val members: List<GroupMember> = emptyList(),
    val items: List<GroupDayItem> = emptyList(),
    /** Сколько раз сегодня надо сделать на всю группу и сколько сделано (мероприятия и цели не считаем). */
    val planned: Int = 0,
    val done: Int = 0,
    val settings: GroupSettings? = null,
    val upcoming: List<GroupDayBlock> = emptyList(),
)

@Serializable
data class InvitationGroup(val id: Long, val title: String, val kind: String = "other", val color: String? = null)

@Serializable
data class InvitationMember(val id: Long, val name: String)

/** GET /invites/:code — кто зовёт, кто уже в группе, состою ли я. */
@Serializable
data class Invitation(val group: InvitationGroup, val inviter: String? = null, val members: List<InvitationMember> = emptyList(), val member: Boolean = false)

@Serializable
data class InviteLink(val code: String, val link: String, val expiresAt: String? = null)

@Serializable
data class MarkResult(val ok: Boolean = true, val taken: Boolean = false)

@Serializable
data class ChatCheck(val tgChatTitle: String? = null)

/** Новое или правка группового дела (POST/PATCH /groups/:id/items). */
data class GroupItemInput(
    val title: String,
    val mode: GroupMode,
    val day: String?,
    val time: String?,
    val rrule: String?,
    val assignees: List<Long>,
    val allMembers: Boolean,
    val rotate: Boolean,
    val target: Double?,
    val goalUntil: String?,
) {
    fun json(): JsonObject = buildJsonObject {
        put("title", title)
        put("mode", mode.wire)
        put("day", day?.let(::JsonPrimitive) ?: JsonNull)
        put("time", time?.let(::JsonPrimitive) ?: JsonNull)
        put("rrule", rrule?.let(::JsonPrimitive) ?: JsonNull)
        put("assignees", JsonArray(assignees.map { JsonPrimitive(it) }))
        put("all_members", allMembers)
        put("rotate", rotate)
        put("target", target?.let(::number) ?: JsonNull)
        put("goal_until", goalUntil?.let(::JsonPrimitive) ?: JsonNull)
    }
}

// Друзья

@Serializable
data class Person(val id: Long, val firstName: String, val username: String? = null, val photoUrl: String? = null)

/** Друг в списке: сколько открытых мне привычек он сделал сегодня из нужных; карта за 14 дней — полоска. */
@Serializable
data class FriendCard(
    val id: Long,
    val firstName: String,
    val username: String? = null,
    val photoUrl: String? = null,
    val since: String? = null,
    val done: Int = 0,
    val due: Int = 0,
    val days: List<Double> = emptyList(),
) {
    val person get() = Person(id, firstName, username, photoUrl)
}

/** Заявка ко мне: нашли по @username или открыли мою ссылку. */
@Serializable
data class FriendRequest(val id: Long, val firstName: String, val username: String? = null, val photoUrl: String? = null, val via: String = "username") {
    val person get() = Person(id, firstName, username, photoUrl)
}

@Serializable
data class FriendsResponse(
    val friends: List<FriendCard> = emptyList(),
    val incoming: List<FriendRequest> = emptyList(),
    val outgoing: List<Person> = emptyList(),
    /** Моя постоянная ссылка «Позвать друга». */
    val link: String = "",
    /** Один раз показать «Что показать друзьям?». */
    val prompt: Boolean = false,
)

/** Кто это для меня. */
@Serializable
enum class PersonStatus {
    @SerialName("none") None,
    @SerialName("friends") Friends,
    @SerialName("sent") Sent,
    @SerialName("incoming") Incoming,
    @SerialName("self") Self,
    @SerialName("blocked") Blocked,
}

@Serializable
data class FoundPerson(val person: Person, val status: PersonStatus)

@Serializable
data class RequestStatus(val status: PersonStatus)

@Serializable
data class FriendLog(val day: String, val value: Double, val status: AbstainStatus? = null)

/** Открытая друзьям привычка — на экране друга. */
@Serializable
data class FriendHabit(
    val id: Long,
    val title: String,
    val emoji: String? = null,
    val kind: TaskKind,
    val unit: String? = null,
    val target: Double = 1.0,
    val value: Double = 0.0,
    val status: AbstainStatus? = null,
    val due: Boolean = true,
    val cleanDays: Int = 0,
    val logs: List<FriendLog> = emptyList(),
)

@Serializable
data class FriendProfile(val person: Person, val since: String? = null, val today: String, val heat: List<HeatDay> = emptyList(), val habits: List<FriendHabit> = emptyList())

// API

suspend fun ApiClient.groups(): List<GroupToday> = get("groups")

suspend fun ApiClient.group(id: Long): GroupToday = get("groups/$id")

suspend fun ApiClient.createGroup(title: String): Long =
    send("POST", "groups", buildJsonObject {
        put("title", title)
        put("kind", "other")
    }, Created.serializer()).id

suspend fun ApiClient.renameGroup(id: Long, title: String) = call("PATCH", "groups/$id", buildJsonObject { put("title", title) })

suspend fun ApiClient.setAdminsOnly(id: Long, on: Boolean) = call("PATCH", "groups/$id", buildJsonObject { put("admins_only_edit", on) })

suspend fun ApiClient.deleteGroup(id: Long) = call("DELETE", "groups/$id")

suspend fun ApiClient.leaveGroup(id: Long) = call("POST", "groups/$id/leave")

suspend fun ApiClient.invite(id: Long): InviteLink = send("POST", "groups/$id/invite", null, InviteLink.serializer())

/** Чат группы ещё жив — название или null. */
suspend fun ApiClient.checkGroupChat(id: Long): ChatCheck = send("POST", "groups/$id/chat/check", null, ChatCheck.serializer())

suspend fun ApiClient.disconnectGroupChat(id: Long) = call("DELETE", "groups/$id/chat")

suspend fun ApiClient.invitation(code: String): Invitation = get("invites/$code")

suspend fun ApiClient.join(code: String): Long = send("POST", "invites/$code/join", null, Created.serializer()).id

suspend fun ApiClient.createItem(groupId: Long, input: GroupItemInput): Long = send("POST", "groups/$groupId/items", input.json(), Created.serializer()).id

suspend fun ApiClient.updateItem(groupId: Long, itemId: Long, input: GroupItemInput) = call("PATCH", "groups/$groupId/items/$itemId", input.json())

suspend fun ApiClient.deleteItem(groupId: Long, itemId: Long) = call("DELETE", "groups/$groupId/items/$itemId")

/** Повторяющееся дело — убрать только в этот день. */
suspend fun ApiClient.skipItem(groupId: Long, itemId: Long, day: String) = call("POST", "groups/$groupId/items/$itemId/skip", buildJsonObject { put("day", day) })

/** Отметить групповое дело; taken — кто-то уже сделал «кто-то один». */
suspend fun ApiClient.markItem(groupId: Long, itemId: Long, done: Boolean, day: String? = null): MarkResult =
    send("PUT", "groups/$groupId/items/$itemId/mark", buildJsonObject {
        put("done", done)
        if (day != null) put("day", day)
    }, MarkResult.serializer())

suspend fun ApiClient.addEntry(groupId: Long, itemId: Long, amount: Double) =
    call("POST", "groups/$groupId/items/$itemId/entries", buildJsonObject { put("amount", number(amount)) })

suspend fun ApiClient.friends(): FriendsResponse = get("friends")

suspend fun ApiClient.friend(id: Long): FriendProfile = get("friends/$id")

suspend fun ApiClient.findPerson(username: String): FoundPerson = get("friends/find", mapOf("username" to username))

suspend fun ApiClient.friendLink(code: String): FoundPerson = get("friends/link/$code")

suspend fun ApiClient.requestFriend(username: String? = null, code: String? = null): PersonStatus =
    send("POST", "friends/requests", buildJsonObject {
        if (username != null) put("username", username)
        if (code != null) put("code", code)
    }, RequestStatus.serializer()).status

suspend fun ApiClient.acceptFriend(id: Long) = call("POST", "friends/requests/$id/accept")

suspend fun ApiClient.dropRequest(id: Long) = call("DELETE", "friends/requests/$id")

suspend fun ApiClient.removeFriend(id: Long) = call("DELETE", "friends/$id")

suspend fun ApiClient.blockPerson(id: Long) = call("POST", "friends/$id/block")

suspend fun ApiClient.blocks(): List<Person> = get("blocks")

suspend fun ApiClient.unblock(id: Long) = call("DELETE", "blocks/$id")

suspend fun ApiClient.setShown(taskIds: List<Long>) = call("PUT", "friends/shown", buildJsonObject { put("task_ids", JsonArray(taskIds.map { JsonPrimitive(it) })) })

suspend fun ApiClient.promptSeen() = call("POST", "friends/prompted")

// Логика

object Groups {
    /** Форма слова по числу (shared/groups.ts plural): 1 книга, 2 книги, 5 книг; дробное — «книги». */
    fun plural(n: Double, forms: List<String>): String {
        if (forms.size < 3) return forms.firstOrNull().orEmpty()
        if (n != Math.floor(n)) return forms[1]
        val a = Math.abs(n.toLong()) % 100
        val b = a % 10
        if (a in 11..19) return forms[2]
        if (b == 1L) return forms[0]
        if (b in 2..4) return forms[1]
        return forms[2]
    }

    /** Число цели: «62 400», «62 400 ₽» или «12 книг». */
    fun goalNumber(n: Double, unit: GoalUnit?, t: Strings): String = when {
        unit == null -> t.num(n)
        unit.currency != null -> "${t.num(n)} ${unit.currency}"
        else -> "${t.num(n)} ${plural(n, unit.forms)}"
    }

    /** Порядок на «Сегодня» (GroupBlocks.tsx): цели сверху, по времени, без времени, мероприятия, сделанные вниз. */
    fun todayOrder(items: List<GroupDayItem>): List<GroupDayItem> =
        items.filter { it.forMe }.sortedWith(compareBy<GroupDayItem>({ rankToday(it) }, { it.time.orEmpty() }))

    private fun rankToday(it: GroupDayItem) = when {
        it.mode == GroupMode.Goal -> -1
        it.done -> 3
        it.mode == GroupMode.Event -> 2
        it.time != null -> 0
        else -> 1
    }

    /** Порядок на экране группы (Group.tsx): несделанные по времени, без времени, мероприятия, сделанные вниз. */
    fun screenOrder(items: List<GroupDayItem>): List<GroupDayItem> =
        items.filter { it.mode != GroupMode.Goal }.sortedWith(compareBy<GroupDayItem>({ rankScreen(it) }, { it.time.orEmpty() }))

    private fun rankScreen(it: GroupDayItem) = when {
        it.done -> 3
        it.mode == GroupMode.Event -> 2
        it.time != null -> 0
        else -> 1
    }

    /** «Скоро» — разовые дела и мероприятия; повторяющиеся и так видны каждый день. */
    fun soon(upcoming: List<GroupDayBlock>): List<GroupDayBlock> =
        upcoming.map { b -> b.copy(items = b.items.filter { !it.recurring || it.mode == GroupMode.Event }) }.filter { it.items.isNotEmpty() }

    /** «Тебе: …» в списке групп — моё единственное несделанное дело. */
    fun forYou(group: GroupToday, me: Long): GroupDayItem? = group.items.firstOrNull {
        it.forMe && !it.done && it.mode != GroupMode.Goal && it.mode != GroupMode.Event && it.people == listOf(me)
    }

    /** Отметка на экране сразу: сделал я — в «сделали», снял — убрал себя. */
    fun marked(it: GroupDayItem, done: Boolean, me: Long): GroupDayItem =
        it.copy(done = done, doneBy = if (done) it.doneBy + me else it.doneBy - me)
}

/** Повтор группового дела в шторке (GroupItemSheet.tsx): пять вариантов ↔ RRULE. */
enum class GroupRepeat { Once, Daily, Weekdays, Weekends, Weekly;

    companion object {
        private val WD = listOf("MO", "TU", "WE", "TH", "FR", "SA", "SU")

        fun toRRule(r: GroupRepeat, day: String): String? = when (r) {
            Daily -> "FREQ=DAILY"
            Weekdays -> "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
            Weekends -> "FREQ=WEEKLY;BYDAY=SA,SU"
            Weekly -> "FREQ=WEEKLY;BYDAY=${WD[Days.weekdayIndex(day)]}"
            Once -> null
        }

        fun fromRRule(rrule: String?): GroupRepeat {
            if (rrule == null) return Once
            val r = rrule.uppercase()
            return when {
                r == "FREQ=DAILY" -> Daily
                r.contains("BYDAY=MO,TU,WE,TH,FR") -> Weekdays
                r.contains("BYDAY=SA,SU") -> Weekends
                else -> Weekly
            }
        }
    }
}

/** Цвета аватарок и значков групп по id (groupUi.tsx): у человека и группы один цвет везде. */
object Tints {
    /** Фон и буква аватарки. */
    val avatar = listOf(0xFFDCEBDD to 0xFF1F4A2C, 0xFFDDE3F0 to 0xFF23365C, 0xFFF1E3C8 to 0xFF5A4214, 0xFFEBDCE6 to 0xFF5A2748, 0xFFE3E0F2 to 0xFF3A2F6B, 0xFFD9ECEC to 0xFF1E4B4B)

    /** Значок группы: family, sport, pair, friends, work, other. */
    val group = listOf(0xFFF5EBD3 to 0xFF6E4F0E, 0xFFE6F2E9 to 0xFF237A46, 0xFFE3E9F6 to 0xFF2B4579, 0xFFEBDCE6 to 0xFF5A2748, 0xFFE3E0F2 to 0xFF3A2F6B, 0xFFECEAE3 to 0xFF4A5449)

    /** Как Math.abs(id) % n в мини-аппе: у отрицательных id цвет тот же, что у положительных. */
    fun avatar(id: Long) = avatar[(Math.abs(id) % avatar.size).toInt()]

    fun group(id: Long) = group[(Math.abs(id) % group.size).toInt()]

    /** Буква аватарки: первая буква имени, нет имени — «?». */
    fun initial(name: String) = name.trim().take(1).uppercase().ifEmpty { "?" }
}

/** Карта «Месяц · Год» (Heatmap.tsx, HeatCard.tsx). */
object HeatMap {
    /** Сколько месяцев назад можно листать: столько истории загружено для карты года. */
    const val MONTHS_BACK = 11

    /** Недель в карте года (371 день — столько отдаёт /api/heatmap). */
    const val YEAR_WEEKS = 53

    /** Первый день карты года — понедельник 52 недели назад. */
    fun yearStart(today: String): String = Days.add(today, -Days.weekdayIndex(today) - (YEAR_WEEKS - 1) * 7)

    /** Недели года: понедельник и подпись месяца (у недели, где месяц начался; у первой — всегда). */
    fun weeks(today: String, monthName: (String) -> String): List<Pair<String, String>> {
        val start = yearStart(today)
        return (0 until YEAR_WEEKS).map { w ->
            val monday = Days.add(start, w * 7)
            val first = (0 until 7).map { Days.add(monday, it) }.firstOrNull { it.endsWith("-01") }
            monday to (first?.let { monthName(Months.of(it)) } ?: if (w == 0) monthName(Months.of(monday)) else "")
        }
    }

    /** Активные дни за месяц (или за всё, month = null). */
    fun activeDays(days: List<HeatDay>, month: String?): Int = days.count { it.score > 0 && (month == null || it.day.startsWith(month)) }
}
