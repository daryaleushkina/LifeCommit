// Состояние «Вместе» — как src/screens/Groups.tsx, Group.tsx, Friends.tsx и GroupBlocks.tsx: группы (список, экран,
// дела с отметками, настройки), друзья (список, заявки, экран друга, «Что показать»). Экран меняется сразу, сервер
// догоняет; не вышло — как было и ошибка. Ответ, начатый раньше правки, её не затирает.
package app.lifecommit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.lifecommit.core.ApiClient
import app.lifecommit.core.ApiError
import app.lifecommit.core.FriendProfile
import app.lifecommit.core.FriendsResponse
import app.lifecommit.core.GroupDayItem
import app.lifecommit.core.GroupItemInput
import app.lifecommit.core.GroupToday
import app.lifecommit.core.Groups
import app.lifecommit.core.Invitation
import app.lifecommit.core.Person
import app.lifecommit.core.acceptFriend
import app.lifecommit.core.addEntry
import app.lifecommit.core.checkGroupChat
import app.lifecommit.core.createGroup
import app.lifecommit.core.createItem
import app.lifecommit.core.deleteGroup
import app.lifecommit.core.deleteItem
import app.lifecommit.core.disconnectGroupChat
import app.lifecommit.core.dropRequest
import app.lifecommit.core.friend
import app.lifecommit.core.friends
import app.lifecommit.core.group
import app.lifecommit.core.groups
import app.lifecommit.core.invitation
import app.lifecommit.core.invite
import app.lifecommit.core.join
import app.lifecommit.core.leaveGroup
import app.lifecommit.core.markItem
import app.lifecommit.core.promptSeen
import app.lifecommit.core.renameGroup
import app.lifecommit.core.setShown
import app.lifecommit.core.setAdminsOnly
import app.lifecommit.core.skipItem
import app.lifecommit.core.updateItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.util.logging.Logger

private val log = Logger.getLogger("app.lifecommit.together")

class TogetherModel(
    private val api: ApiClient,
    private val scope: CoroutineScope,
    /** Мой id: чьи дела, чья очередь. */
    private val me: () -> Long,
    /** Что-то поменялось — «Сегодня» перечитает себя (блоки групп, счётчики). */
    private val onChanged: suspend () -> Unit,
    private val onSignedOut: () -> Unit,
) {
    /** Список групп; null — ещё не знаем. */
    var list by mutableStateOf<List<GroupToday>?>(null)
        private set

    /** Экраны групп, уже открытые (или подтянутые) — открываются сразу. */
    val details = mutableStateMapOf<Long, GroupToday>()

    /** Группы, которых больше нет (удалили, вышла) — экран это показывает. */
    val missing = mutableStateMapOf<Long, Boolean>()

    var friendsData by mutableStateOf<FriendsResponse?>(null)
        private set

    /** Друзей не удалось загрузить, а показать нечего — экран предлагает ещё раз. */
    var friendsFailed by mutableStateOf(false)
        private set

    val profiles = mutableStateMapOf<Long, FriendProfile>()

    /** Подсказка после действия на экране группы («Уже кто-то сделал», «Ссылка готова…») — только на экране этой группы. */
    var note by mutableStateOf<GroupNote?>(null)

    /** Номер правки: ответ, начатый раньше, правку не затирает. */
    private var version = 0
    private var friendsSeq = 0

    /** Номер человека: растёт при выходе — ответы, начатые при прошлом аккаунте, ничего не записывают. */
    private var epoch = 0

    fun reset() {
        epoch++
        version++
        friendsSeq++
        list = null
        details.clear()
        missing.clear()
        friendsData = null
        friendsFailed = false
        answered = emptySet()
        answeredAt.clear()
        answerFailed = false
        cancelFailed = false
        showFailed = null
        profiles.clear()
        note = null
    }

    private fun handle(e: ApiError) {
        if (e.isSignedOut) onSignedOut() else log.info("together: $e")
    }

    // Группы

    fun loadList() {
        val seq = version
        scope.launch {
            try {
                val fresh = api.groups()
                if (seq == version) list = fresh
            } catch (e: ApiError) {
                // Как в мини-аппе: не вышло — остаётся то, что было (на экране — группы из «Сегодня»), не «нет групп».
                handle(e)
            }
        }
    }

    suspend fun loadGroup(id: Long) {
        val seq = version
        val e0 = epoch
        try {
            val g = api.group(id)
            if (seq == version) {
                details[id] = g
                missing.remove(id)
            }
        } catch (e: ApiError) {
            if (e0 != epoch) return
            // «Не найдено» — только когда группы правда нет (404) или показать нечего; моргнула сеть — экран как был.
            if (e.status == 404 || id !in details) missing[id] = true
            handle(e)
        }
    }

    /** Новая группа: только название (тип не выбирают). Вернёт id или бросит ApiError. */
    suspend fun create(title: String): Long {
        val id = api.createGroup(title.trim())
        loadGroup(id)
        details[id]?.let { g -> list = (list.orEmpty().filter { it.id != id }) + g }
        return id
    }

    /**
     * Отметка группового дела на сервере. day == null — сегодня: экран группы меняется сразу, не вышло — назад.
     * Перечитать экраны — дело вызывающего (после отметки, а не во время).
     */
    suspend fun mark(groupId: Long, it: GroupDayItem, day: String?): Marked {
        val done = !it.done
        version++
        if (day == null) patchItem(groupId) { x -> if (x.id == it.id) Groups.marked(x, done, me()) else x }
        return try {
            Marked(ok = true, note = if (api.markItem(groupId, it.id, done, day).taken) TAKEN else null)
        } catch (e: ApiError) {
            if (day == null) patchItem(groupId) { x -> if (x.id == it.id) it else x }
            if (e.isSignedOut) {
                onSignedOut()
                Marked(ok = false, signedOut = true)
            } else {
                log.info("group mark: $e")
                Marked(ok = false, note = if (e.code == "not_yours") NOT_YOURS else ERROR)
            }
        }
    }

    private fun patchItem(groupId: Long, f: (GroupDayItem) -> GroupDayItem) {
        details[groupId]?.let { g -> details[groupId] = g.copy(items = g.items.map(f)) }
    }

    suspend fun saveItem(groupId: Long, itemId: Long?, input: GroupItemInput) {
        if (itemId == null) api.createItem(groupId, input) else api.updateItem(groupId, itemId, input)
        version++
        onChanged()
        loadGroup(groupId)
    }

    /** Удалить дело совсем (или только в этот день у повторяющегося) — после «Вернуть». */
    suspend fun removeItem(groupId: Long, itemId: Long, skipDay: String?) {
        try {
            if (skipDay != null) api.skipItem(groupId, itemId, skipDay) else api.deleteItem(groupId, itemId)
        } finally {
            version++
            onChanged()
            loadGroup(groupId)
        }
    }

    suspend fun put(groupId: Long, itemId: Long, amount: Double) {
        api.addEntry(groupId, itemId, amount)
        version++
        onChanged()
        loadGroup(groupId)
    }

    /** Ссылка-приглашение в группу (для «Позвать в группу» и подключения чата). */
    suspend fun inviteLink(groupId: Long): String = api.invite(groupId).link

    /**
     * Новое название: на экране сразу, сервер — в фоне модели, а не шторки (её закрывают тем же жестом, что и сохраняют:
     * запрос шторки отменился бы вместе с ней, /lc-review 06.10). Не вышло — старое название и подсказка на экране группы.
     */
    fun rename(groupId: Long, title: String) {
        val before = details[groupId]?.title
        val beforeInList = list?.firstOrNull { it.id == groupId }?.title
        details[groupId]?.let { details[groupId] = it.copy(title = title) }
        list = list?.map { if (it.id == groupId) it.copy(title = title) else it }
        val e0 = epoch
        scope.launch {
            try {
                api.renameGroup(groupId, title)
                if (e0 == epoch) onChanged()
            } catch (e: ApiError) {
                if (e0 != epoch) return@launch
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("rename group $groupId: $e")
                // Назад — только название этой группы: остальное в списке за это время могло поменяться (вышли из другой).
                before?.let { old -> details[groupId]?.let { details[groupId] = it.copy(title = old) } }
                beforeInList?.let { old -> list = list?.map { if (it.id == groupId) it.copy(title = old) else it } }
                note = GroupNote(groupId, ERROR)
            }
        }
    }

    /** «Дела заводят только админы»: сразу; сервер — в фоне модели (шторку могут сразу закрыть); не вышло — назад и подсказка. */
    fun setAdminsOnly(groupId: Long, on: Boolean) {
        fun set(v: Boolean) {
            details[groupId]?.let { g -> details[groupId] = g.copy(settings = g.settings?.copy(adminsOnlyEdit = v)) }
        }
        set(on)
        val e0 = epoch
        scope.launch {
            try {
                api.setAdminsOnly(groupId, on)
            } catch (e: ApiError) {
                if (e0 != epoch) return@launch
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("admins only $groupId: $e")
                set(!on)
                note = GroupNote(groupId, ERROR)
            }
        }
    }

    /** Чат ещё жив? Удалённый в Telegram пропадает из настроек сразу. */
    fun checkChat(groupId: Long) {
        val e0 = epoch
        scope.launch {
            try {
                val title = api.checkGroupChat(groupId).tgChatTitle
                if (e0 == epoch) details[groupId]?.let { g -> details[groupId] = g.copy(settings = g.settings?.copy(tgChatTitle = title)) }
            } catch (e: ApiError) {
                if (e0 == epoch) handle(e)
            }
        }
    }

    suspend fun disconnectChat(groupId: Long) {
        val before = details[groupId]
        details[groupId]?.let { g -> details[groupId] = g.copy(settings = g.settings?.copy(tgChatTitle = null)) }
        try {
            api.disconnectGroupChat(groupId)
        } catch (e: ApiError) {
            before?.let { details[groupId] = it }
            throw e
        }
    }

    /** Выйти или удалить группу; ApiError — остаёмся на экране группы с подсказкой. */
    suspend fun leave(groupId: Long, remove: Boolean) {
        if (remove) api.deleteGroup(groupId) else api.leaveGroup(groupId)
        version++
        details.remove(groupId)
        list = list?.filter { it.id != groupId }
        onChanged()
    }

    // Приглашение в группу

    suspend fun invitation(code: String): Invitation = api.invitation(code)

    suspend fun join(code: String): Long {
        val id = api.join(code)
        version++
        loadGroup(id)
        onChanged()
        loadList()
        return id
    }

    // Друзья

    /** Перечитать друзей: всегда новым запросом, ответ старше последнего запроса не применяем. */
    fun reloadFriends(after: (FriendsResponse) -> Unit = {}) {
        val seq = ++friendsSeq
        scope.launch {
            try {
                val d = api.friends()
                if (seq == friendsSeq) {
                    friendsData = d
                    friendsFailed = false
                    // Ответ сервера начат после того, как заявку приняли или отклонили: он уже без неё. Если в нём снова
                    // заявка от этого человека — она новая (позвал ещё раз), её показываем.
                    answered = answered.filterTo(mutableSetOf()) { id -> (answeredAt[id] ?: Int.MAX_VALUE) >= seq }
                    answeredAt.keys.retainAll(answered)
                    after(d)
                }
            } catch (e: ApiError) {
                // Нет сети — остаётся то, что было; не было ничего — ошибка, а не «пока нет друзей».
                handle(e)
                if (seq == friendsSeq && friendsData == null) friendsFailed = true
            }
        }
    }

    // Ответы на заявки и «Что показать» — в фоне модели, а не экрана: экран убирает заявку сразу, и человек тут же
    // уходит «Назад» — запрос экрана отменился бы вместе с ним, и ничего бы не дошло (/lc-review 06.10).

    /** Заявки, на которые уже ответили: на экране их нет, даже если старый ответ сервера ещё с ними. */
    var answered by mutableStateOf(setOf<Long>())
        private set

    /** Номер последнего перечитывания друзей на момент, когда сервер принял ответ на заявку: начатые позже её уже не знают. */
    private val answeredAt = mutableMapOf<Long, Int>()

    /** Ответ на заявку не дошёл — заявка снова на экране, строка ошибки. */
    var answerFailed by mutableStateOf(false)

    fun answer(id: Long, accept: Boolean) {
        answerFailed = false
        answered = answered + id
        answeredAt.remove(id)
        val e0 = epoch
        scope.launch {
            try {
                if (accept) api.acceptFriend(id) else api.dropRequest(id)
                if (e0 == epoch) answeredAt[id] = friendsSeq
            } catch (e: ApiError) {
                if (e0 != epoch) return@launch
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("answer request $id: $e")
                answered = answered - id
                answerFailed = true
            }
            if (e0 == epoch) reloadFriends()
        }
    }

    /** Своя заявка не отменилась — строка ошибки в списке друзей. */
    var cancelFailed by mutableStateOf(false)

    fun cancelRequest(id: Long) {
        cancelFailed = false
        val e0 = epoch
        scope.launch {
            try {
                api.dropRequest(id)
            } catch (e: ApiError) {
                if (e0 != epoch) return@launch
                if (e.isSignedOut) return@launch onSignedOut()
                log.info("cancel request $id: $e")
                cancelFailed = true
            }
            if (e0 == epoch) reloadFriends()
        }
    }

    /** «Что показать друзьям?» не сохранилось — шторка снова с тем, что выбрали. */
    var showFailed by mutableStateOf<List<Long>?>(null)

    /** Шторку «Что показать» закрыли: ids — выбранные привычки; null — «Назад» (служебное «уже спросили»). */
    fun saveShown(ids: List<Long>?) {
        showFailed = null
        val e0 = epoch
        scope.launch {
            if (ids != null) {
                try {
                    api.setShown(ids)
                    if (e0 == epoch) onChanged()
                } catch (e: ApiError) {
                    if (e0 != epoch) return@launch
                    if (e.isSignedOut) return@launch onSignedOut()
                    log.info("shown: $e")
                    showFailed = ids
                    return@launch
                }
            } else {
                // Служебная отметка «уже спросили»: не дошла — спросим в другой раз, ошибку не показываем.
                try {
                    api.promptSeen()
                } catch (e: ApiError) {
                    if (e0 != epoch) return@launch
                    if (e.isSignedOut) return@launch onSignedOut()
                    log.info("prompt seen: $e")
                }
            }
            if (e0 == epoch) reloadFriends()
        }
    }

    suspend fun loadFriend(id: Long): FriendProfile? {
        val e0 = epoch
        return try {
            api.friend(id).also { if (e0 == epoch) profiles[id] = it }
        } catch (e: ApiError) {
            if (e0 != epoch) return null
            handle(e)
            if (e.status == 404) profiles.remove(id)
            null
        }
    }

    companion object {
        /** Ключи подсказок — текст по языку человека выбирает экран. */
        const val TAKEN = "taken"
        const val NOT_YOURS = "not_yours"
        const val ERROR = "error"
        const val INVITE_SENT = "invite_sent"
    }
}

/** Итог отметки группового дела: ok — сервер принял; note — подсказка для экрана группы. */
data class Marked(val ok: Boolean, val note: String? = null, val signedOut: Boolean = false)

/** Подсказка на экране группы groupId; key — TogetherModel.TAKEN и др. */
data class GroupNote(val groupId: Long, val key: String)

/** Человек как участник (аватарка): из друга, заявки, найденного. */
fun Person.asMember() = app.lifecommit.core.GroupMember(id, firstName, photoUrl)
