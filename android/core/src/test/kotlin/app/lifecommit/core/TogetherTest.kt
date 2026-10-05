// Логика «Вместе» — случаи из shared/groups.test.ts, groupUi.tsx, GroupItemSheet.tsx и Heatmap.tsx.
package app.lifecommit.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun item(id: Long, mode: GroupMode = GroupMode.One, time: String? = null, done: Boolean = false, forMe: Boolean = true, people: List<Long> = emptyList(), recurring: Boolean = false) =
    GroupDayItem(id = id, title = "#$id", mode = mode, time = time, done = done, forMe = forMe, people = people, recurring = recurring)

class TogetherTest {
    @Test fun `формы слова по числу`() {
        val books = listOf("книга", "книги", "книг")
        assertEquals(listOf("книга", "книги", "книг", "книг", "книга", "книги"), listOf(1.0, 2.0, 5.0, 11.0, 21.0, 2.5).map { Groups.plural(it, books) })
    }

    @Test fun `число цели - просто число, с валютой, со словом`() {
        assertEquals("62\u00a0400", Groups.goalNumber(62400.0, null, Strings.ru))
        assertEquals("62\u00a0400 ₽", Groups.goalNumber(62400.0, GoalUnit("money", listOf("рубль", "рубля", "рублей"), currency = "₽"), Strings.ru))
        assertEquals("12 книг", Groups.goalNumber(12.0, GoalUnit("books", listOf("книга", "книги", "книг")), Strings.ru))
    }

    @Test fun `порядок на Сегодня - цели, по времени, без времени, мероприятия, сделанные, чужое не показываем`() {
        val list = listOf(
            item(1, done = true),
            item(2, mode = GroupMode.Event),
            item(3),
            item(4, time = "18:00"),
            item(5, time = "09:00"),
            item(6, mode = GroupMode.Goal),
            item(7, forMe = false),
        )
        assertEquals(listOf(6L, 5L, 4L, 3L, 2L, 1L), Groups.todayOrder(list).map { it.id })
    }

    @Test fun `экран группы - цели отдельно, порядок как на Сегодня`() {
        val list = listOf(item(1, done = true), item(2, mode = GroupMode.Goal), item(3, time = "10:00"), item(4, forMe = false))
        assertEquals(listOf(3L, 4L, 1L), Groups.screenOrder(list).map { it.id })
    }

    @Test fun `Скоро - только разовые и мероприятия, пустые дни пропадают`() {
        val ref = GroupRef(1, "Семья")
        val blocks = listOf(
            GroupDayBlock("2026-10-07", ref, listOf(item(1, recurring = true), item(2))),
            GroupDayBlock("2026-10-08", ref, listOf(item(3, recurring = true))),
            GroupDayBlock("2026-10-09", ref, listOf(item(4, mode = GroupMode.Event, recurring = true))),
        )
        assertEquals(listOf("2026-10-07" to listOf(2L), "2026-10-09" to listOf(4L)), Groups.soon(blocks).map { b -> b.day to b.items.map { it.id } })
    }

    @Test fun `Тебе - моё единственное несделанное дело`() {
        val g = GroupToday(1, "Семья", items = listOf(item(1, people = listOf(7, 8)), item(2, people = listOf(7)), item(3, people = listOf(7), done = true)))
        assertEquals(2L, Groups.forYou(g, 7)?.id)
        assertNull(Groups.forYou(g, 8))
    }

    @Test fun `отметка на экране - сделал я или снял`() {
        val it = item(1).copy(doneBy = listOf(5))
        assertEquals(listOf(5L, 7L), Groups.marked(it, true, 7).doneBy)
        assertEquals(listOf(5L), Groups.marked(it.copy(doneBy = listOf(5, 7)), false, 7).doneBy)
    }

    @Test fun `повтор группового дела туда и обратно`() {
        // 7 октября 2026 — среда.
        assertEquals("FREQ=WEEKLY;BYDAY=WE", GroupRepeat.toRRule(GroupRepeat.Weekly, "2026-10-07"))
        assertNull(GroupRepeat.toRRule(GroupRepeat.Once, "2026-10-07"))
        for (r in GroupRepeat.entries) assertEquals(r, GroupRepeat.fromRRule(GroupRepeat.toRRule(r, "2026-10-07")))
        assertEquals(GroupRepeat.Weekly, GroupRepeat.fromRRule("FREQ=WEEKLY;BYDAY=TU,TH"))
    }

    @Test fun `цвета по id - у человека и группы всегда один`() {
        assertEquals(Tints.avatar(7), Tints.avatar(7 + 6))
        assertEquals(Tints.avatar[1], Tints.avatar(7))
        assertEquals(Tints.group(-1), Tints.group(1))
        assertEquals("Д", Tints.initial("даша"))
        assertEquals("?", Tints.initial(" "))
    }

    @Test fun `карта года - с понедельника 52 недели назад, подписи месяцев`() {
        assertEquals("2025-10-06", HeatMap.yearStart("2026-10-05"))
        val weeks = HeatMap.weeks("2026-10-05") { Strings.ru.monthShort(it) }
        assertEquals(53, weeks.size)
        assertEquals("окт", weeks.first().second)
        assertTrue(weeks.count { it.second.isNotEmpty() } in 12..13)
        assertEquals(2, HeatMap.activeDays(listOf(HeatDay("2026-10-01", 1.0), HeatDay("2026-10-02", 0.0), HeatDay("2026-09-30", 2.0)), null))
        assertEquals(1, HeatMap.activeDays(listOf(HeatDay("2026-10-01", 1.0), HeatDay("2026-09-30", 2.0)), "2026-10"))
    }

    @Test fun `тексты групп и друзей`() {
        assertEquals("3 из 5 сегодня", Strings.ru.gr.progress(3, 5))
        assertEquals("2 человека", Strings.ru.gr.people(2))
        assertEquals("21 активный день", Strings.ru.activeDays(21))
        assertEquals("12 из 20 страниц", Strings.ru.fr.countToday("12", "20", "страниц"))
        assertEquals("Ann's turn", Strings.en.gr.turnOf("Ann"))
    }

    @Test fun `ответы групп, друзей и приглашения читаются`() {
        val g = ApiClient.json.decodeFromString(GroupToday.serializer(), """{"id":1,"title":"Семья","kind":"family","color":null,"role":"owner","members":[{"id":7,"name":"Даша","photo":null}],"items":[{"id":3,"title":"Мусор","mode":"assign","time":null,"duration_min":null,"due_day":null,"carried":false,"recurring":true,"people":[7],"all_members":false,"rotate":true,"turn":7,"for_me":true,"can_mark":true,"done":false,"done_by":[],"target":null,"total":null,"unit":null,"goal_until":null,"start":"2026-10-01","rrule":"FREQ=DAILY","assignees":[7,8]}],"planned":1,"done":0,"settings":{"admins_only_edit":false,"rating_enabled":false,"chat_digest":true,"chat_reminders":true,"tg_chat_title":"Семейный чат"},"upcoming":[]}""")
        assertEquals(GroupRole.Owner, g.role)
        assertEquals(7L, g.items.single().turn)
        assertEquals("Семейный чат", g.settings?.tgChatTitle)
        val f = ApiClient.json.decodeFromString(FriendsResponse.serializer(), """{"friends":[{"id":2,"first_name":"Маша","username":"masha","photo_url":null,"since":"2026-10-01","done":1,"due":2,"days":[0,1,2.5]}],"incoming":[{"id":3,"first_name":"Петя","username":null,"photo_url":null,"via":"link"}],"outgoing":[],"link":"https://t.me/LifeCommit_bot?startapp=f_abc","prompt":true}""")
        assertEquals(2.5, f.friends.single().days.last(), 0.0)
        assertEquals("link", f.incoming.single().via)
        val inv = ApiClient.json.decodeFromString(Invitation.serializer(), """{"group":{"id":1,"title":"Семья","kind":"family","color":null},"inviter":"Даша","members":[{"id":7,"name":"Даша"}],"member":false}""")
        assertEquals("Даша", inv.inviter)
        val found = ApiClient.json.decodeFromString(FoundPerson.serializer(), """{"person":{"id":2,"first_name":"Маша","username":"masha","photo_url":null},"status":"incoming"}""")
        assertEquals(PersonStatus.Incoming, found.status)
    }
}
