// «Вместе» через интерфейс, как человек: группы (список, новая, экран, отметки, дело, цель, настройки, выйти),
// вступление по ссылке, друзья (позвать, заявки, экран друга, убрать), блоки групп на «Сегодня».
package app.lifecommit

import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import app.lifecommit.core.FoundPerson
import app.lifecommit.core.FriendCard
import app.lifecommit.core.FriendHabit
import app.lifecommit.core.FriendProfile
import app.lifecommit.core.FriendRequest
import app.lifecommit.core.GroupDayItem
import app.lifecommit.core.GroupMember
import app.lifecommit.core.GroupMode
import app.lifecommit.core.GroupRole
import app.lifecommit.core.GroupSettings
import app.lifecommit.core.GroupToday
import app.lifecommit.core.HeatDay
import app.lifecommit.core.Invitation
import app.lifecommit.core.InvitationGroup
import app.lifecommit.core.InvitationMember
import app.lifecommit.core.Person
import app.lifecommit.core.PersonStatus
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TogetherTest : AppTest() {
    private val me get() = server.user.id
    private val masha = GroupMember(2, "Маша")

    private fun family(items: List<GroupDayItem> = defaultItems(), role: GroupRole = GroupRole.Owner, chat: String? = null) =
        GroupToday(50, "Семья", role = role, members = listOf(GroupMember(me, "Даша"), masha), items = items, planned = 2, done = 0, settings = GroupSettings(tgChatTitle = chat))

    private fun defaultItems() = listOf(
        GroupDayItem(61, "Вынести мусор", GroupMode.Assign, people = listOf(me), forMe = true, canMark = true, turn = me, rotate = true),
        GroupDayItem(62, "Купить продукты", GroupMode.One, forMe = true, canMark = true, recurring = true, rrule = "FREQ=DAILY"),
        GroupDayItem(63, "Отпуск", GroupMode.Goal, forMe = true, target = 100000.0, total = 25000.0),
    )

    private fun seed() {
        server.today = TodayResponse("2026-10-05")
        server.groups = listOf(family())
    }

    private fun openTogether() {
        compose.waitText(t.groups).performClick()
        compose.waitText(t.fr.tabGroups)
    }

    @Test fun `на Сегодня - блок группы, отметка уходит на сервер`() {
        seed()
        launch()
        compose.waitText("Семья")
        compose.waitText("Вынести мусор")
        compose.waitText(t.gr.yourTurn)
        compose.waitLabel(t.todo.check("Вынести мусор")).performClick()
        compose.waitFor { server.calls("PUT", "/api/groups/50/items/61/mark").isNotEmpty() }
        assertEquals("true", server.calls("PUT", "/api/groups/50/items/61/mark").single().json["done"].toString())
    }

    @Test fun `список групп, новая группа - сразу её экран`() {
        server.today = TodayResponse("2026-10-05")
        launch()
        openTogether()
        compose.waitText(t.gr.empty)
        compose.onNodeWithTag("newGroup").performClick()
        compose.onNodeWithTag("groupName").performTextInput("Друзья по бегу")
        compose.onNodeWithTag("createGroup").performClick()
        compose.waitText(t.gr.nothingToday)
        compose.waitText("Друзья по бегу")
    }

    @Test fun `экран группы - дела, цель, люди, позвать в группу через Telegram`() {
        seed()
        launch()
        openTogether()
        compose.waitText("Семья").performClick()
        compose.waitText(t.gr.todayLabel.uppercase())
        compose.waitText(t.gr.goalOf("25\u00a0000", "100\u00a0000"))
        compose.waitText(t.gr.tabPeople).performClick()
        compose.waitText("Даша (${t.gr.me})")
        compose.onNodeWithTag("inviteGroup").performClick()
        compose.waitFor { opened.isNotEmpty() }
        assertTrue(opened.last().first.startsWith("https://t.me/share/url?url=https%3A%2F%2Ft.me%2FLifeCommit_bot"))
        compose.waitText(t.gr.inviteSent)
    }

    @Test fun `кто-то уже сделал - подсказка`() {
        seed()
        server.groups = listOf(family(listOf(GroupDayItem(62, "Купить продукты", GroupMode.One, forMe = true, canMark = true, doneBy = emptyList()))))
        launch()
        openTogether()
        compose.waitText("Семья").performClick()
        // Пока экран открыт, Маша успела сделать.
        server.groups = listOf(family(listOf(GroupDayItem(62, "Купить продукты", GroupMode.One, forMe = true, canMark = true, doneBy = listOf(2)))))
        compose.waitLabel(t.todo.check("Купить продукты")).performClick()
        compose.waitText(t.gr.taken)
    }

    @Test fun `положить в общую цель`() {
        seed()
        launch()
        openTogether()
        compose.waitText("Семья").performClick()
        compose.waitText("+ ${t.gr.put}").performClick()
        compose.onNodeWithTag("putAmount").performTextInput("5000")
        compose.onNodeWithTag("putDone").performClick()
        compose.waitFor { server.calls("POST", "/api/groups/50/items/63/entries").isNotEmpty() }
        compose.waitText(t.gr.goalOf("30\u00a0000", "100\u00a0000"))
    }

    @Test fun `новое групповое дело - назначить Маше, каждый день`() {
        seed()
        launch()
        openTogether()
        compose.waitText("Семья").performClick()
        compose.onNodeWithTag("addGroupItem").performClick()
        compose.onNodeWithTag("groupItemTitle").performTextInput("Погулять с собакой")
        compose.waitText(t.gr.modes.getValue(GroupMode.Assign)).performClick()
        compose.waitText("Маша").performClick()
        compose.waitText(t.gr.repeats.getValue(app.lifecommit.core.GroupRepeat.Once)).performClick()
        compose.waitText(t.gr.repeats.getValue(app.lifecommit.core.GroupRepeat.Daily)).performClick()
        compose.onNodeWithTag("groupItemSave").performClick()
        compose.waitFor { server.calls("POST", "/api/groups/50/items").isNotEmpty() }
        val body = server.calls("POST", "/api/groups/50/items").single().json
        assertEquals("\"assign\"", body["mode"].toString())
        assertEquals("\"FREQ=DAILY\"", body["rrule"].toString())
        assertTrue(body["assignees"].toString().contains("2"))
        compose.waitText("Погулять с собакой")
    }

    @Test fun `повторяющееся дело свайпом - убрать только сегодня`() {
        seed()
        launch(undoMillis = 300)
        openTogether()
        compose.waitText("Семья").performClick()
        compose.onAllNodes(hasText("Купить продукты"))[0].performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.onlyToday).performClick()
        compose.waitFor { server.calls("POST", "/api/groups/50/items/62/skip").size == 1 }
        assertEquals("\"2026-10-05\"", server.calls("POST", "/api/groups/50/items/62/skip").single().json["day"].toString())
    }

    @Test fun `удалять могут только админы - понятная подсказка`() {
        seed()
        server.groups = listOf(family(listOf(GroupDayItem(64, "Полить цветы", GroupMode.One, forMe = true, canMark = true)), role = GroupRole.Member))
        server.failures["DELETE /api/groups/50/items/64"] = 403 to "admins_only"
        launch(undoMillis = 300)
        openTogether()
        compose.waitText("Семья").performClick()
        compose.onAllNodes(hasText("Полить цветы"))[0].performTouchInput { swipeLeft(startX = right, endX = left - 900f) }
        compose.waitText(t.swipe.notAllowed)
    }

    @Test fun `настройки - переименовать, отключить чат, выйти из группы`() {
        seed()
        server.groups = listOf(family(chat = "Семейный чат"))
        launch()
        openTogether()
        compose.waitText("Семья").performClick()
        compose.waitLabel(t.gr.settings).performClick()
        compose.waitText("Семейный чат")
        compose.waitText(t.gr.chatOff).performClick()
        // Шторка — тоже диалог: кнопка подтверждения — последняя из «Отключить».
        compose.waitText(t.gr.chatOffConfirm("Семейный чат"))
        compose.onAllNodes(hasText(t.gr.chatOff).and(hasAnyAncestor(isDialog()))).let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitFor { server.calls("DELETE", "/api/groups/50/chat").size == 1 }
        compose.waitText(t.gr.leave).performClick()
        compose.waitText(t.gr.leaveConfirm)
        compose.onAllNodes(hasText(t.gr.leave).and(hasAnyAncestor(isDialog()))).let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitFor { server.calls("POST", "/api/groups/50/leave").size == 1 }
        compose.waitText(t.gr.newGroup)
    }

    @Test fun `приглашение по ссылке lifecommit app j - вступить и открыть группу`() {
        seed()
        server.groups = emptyList()
        server.invites["abcd1234"] = Invitation(InvitationGroup(50, "Семья"), "Маша", listOf(InvitationMember(2, "Маша")), member = false) to family()
        launch()
        // Пока ничего нет — первый экран «Чего я хочу?»; ссылка ведёт мимо него в приглашение.
        compose.waitText(t.onboardingTitle)
        compose.runOnUiThread { model.handleLink("https://lifecommit.app/j/abcd1234") }
        compose.waitText(t.gr.join.invites("Маша"))
        compose.waitText(t.gr.join.points[2].first)
        compose.onNodeWithTag("joinGroup").performClick()
        compose.waitFor { server.calls("POST", "/api/invites/abcd1234/join").size == 1 }
        compose.waitText("Вынести мусор")
    }

    @Test fun `устаревшее приглашение и чужие ссылки`() {
        seed()
        launch()
        compose.waitText("Семья")
        compose.runOnUiThread { model.handleLink("lifecommit://join/nope0000") }
        compose.waitText(t.gr.join.notFound)
        assertEquals(null, AppModel.invitePath("https://evil.example/j/abcd1234"))
        assertEquals(null, AppModel.invitePath("https://lifecommit.app/j/../../api"))
        assertEquals("friend" to "abcd1234", AppModel.invitePath("lifecommit://friend/abcd1234"))
    }

    // Друзья

    private fun seedFriends() {
        seed()
        server.friendsData = server.friendsData.copy(
            friends = listOf(FriendCard(2, "Маша", "masha", days = listOf(0.0, 1.0, 3.0), done = 1, due = 2)),
            incoming = listOf(FriendRequest(3, "Петя", via = "link")),
        )
        server.profiles[2] = FriendProfile(Person(2, "Маша", "masha"), today = "2026-10-05", heat = listOf(HeatDay("2026-10-04", 2.0)), habits = listOf(FriendHabit(9, "Бег", kind = TaskKind.Check, value = 1.0)))
    }

    private fun openFriends() {
        openTogether()
        compose.waitText(t.fr.tabFriends).performClick()
    }

    @Test fun `друзья - список, заявки, принять`() {
        seedFriends()
        launch()
        openFriends()
        compose.waitText("Маша")
        compose.waitText(t.fr.progress(1, 2))
        compose.waitText(t.fr.requests(1)).performClick()
        compose.waitText(t.fr.viaLink)
        compose.waitText(t.fr.accept).performClick()
        compose.waitFor { server.calls("POST", "/api/friends/requests/3/accept").size == 1 }
        compose.waitText(t.fr.nothingFound)
    }

    @Test fun `экран друга - карта и открытые привычки, убрать из друзей`() {
        seedFriends()
        launch()
        openFriends()
        compose.waitText("Маша").performClick()
        compose.waitText("@masha")
        compose.waitText(t.activeDays(1))
        compose.waitText("Бег")
        compose.waitText(t.fr.doneToday)
        compose.waitText(t.fr.remove).performClick()
        compose.onNode(hasText(t.fr.remove).and(hasAnyAncestor(isDialog()))).performClick()
        compose.waitFor { server.calls("DELETE", "/api/friends/2").size == 1 }
        compose.waitText(t.fr.tabFriends)
    }

    @Test fun `позвать друга - найти по username и позвать, ссылка в Telegram`() {
        seedFriends()
        server.people["vasya"] = FoundPerson(Person(4, "Вася", "vasya"), PersonStatus.None)
        launch()
        openFriends()
        compose.waitLabel(t.fr.invite).performClick()
        compose.onNodeWithTag("sendFriendLink").performClick()
        assertTrue(opened.last().first.startsWith("https://t.me/share/url?url=https%3A%2F%2Ft.me%2FLifeCommit_bot%3Fstartapp%3Df_me"))
        compose.onNodeWithTag("findUsername").performTextInput("@vasya")
        compose.waitText("Вася")
        compose.onNodeWithTag("callFriend").performClick()
        compose.waitFor { server.calls("POST", "/api/friends/requests").isNotEmpty() }
        assertEquals("\"vasya\"", server.calls("POST", "/api/friends/requests").single().json["username"].toString())
        compose.waitText(t.fr.status.getValue(PersonStatus.Sent))
    }

    @Test fun `чужая ссылка в друзья - хочу дружить`() {
        seedFriends()
        server.people["code:zzzz1111"] = FoundPerson(Person(5, "Оля"), PersonStatus.None)
        launch()
        compose.waitText("Семья")
        compose.runOnUiThread { model.handleLink("https://lifecommit.app/f/zzzz1111") }
        compose.waitText(t.fr.linkTitle("Оля"))
        compose.onNodeWithTag("beFriends").performClick()
        compose.waitText(t.fr.linkSent("Оля"))
        assertEquals("\"zzzz1111\"", server.calls("POST", "/api/friends/requests").single().json["code"].toString())
    }

    @Test fun `первый друг - один раз спросить, что показать, назад - отметка уже спросили`() {
        seedFriends()
        server.friendsData = server.friendsData.copy(prompt = true)
        server.today = TodayResponse("2026-10-05", tasks = listOf(app.lifecommit.core.TodayTask(id = 1, title = "Читать", kind = TaskKind.Check)))
        launch()
        openFriends()
        compose.waitText(t.fr.showTitle)
        compose.waitText(t.fr.selectAll).performClick()
        compose.onNodeWithTag("showDone").performClick()
        compose.waitFor { server.calls("PUT", "/api/friends/shown").size == 1 }
        assertEquals("[1]", server.calls("PUT", "/api/friends/shown").single().json["task_ids"].toString())
    }
}
