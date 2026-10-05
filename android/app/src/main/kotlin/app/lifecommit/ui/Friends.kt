// Друзья — как src/screens/Friends.tsx (допрос 03.10.2026): список во «Вместе» (24B′), «Позвать друга» (24E), заявки
// (25M), экран друга (25L: карта «Месяц · Год», открытые привычки), чужая ссылка, «Что показать друзьям?» (25H).
// Дружба всегда через заявку; с другом — только смотреть.
package app.lifecommit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.asMember
import app.lifecommit.core.AbstainStatus
import app.lifecommit.core.ApiError
import app.lifecommit.core.Days
import app.lifecommit.core.FoundPerson
import app.lifecommit.core.Heat
import app.lifecommit.core.HeatDay
import app.lifecommit.core.HeatMap
import app.lifecommit.core.Months
import app.lifecommit.core.PersonStatus
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayTask
import app.lifecommit.core.acceptFriend
import app.lifecommit.core.blockPerson
import app.lifecommit.core.dropRequest
import app.lifecommit.core.findPerson
import app.lifecommit.core.friendLink
import app.lifecommit.core.promptSeen
import app.lifecommit.core.removeFriend
import app.lifecommit.core.requestFriend
import app.lifecommit.core.setShown
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

// Список во «Вместе»

@Composable
fun FriendsPanel(model: AppModel, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    val tg = model.together
    val scope = rememberCoroutineScope()
    var showing by remember { mutableStateOf(false) }
    var showFailed by remember { mutableStateOf<List<Long>?>(null) }
    var inviting by remember { mutableStateOf(false) }
    var cancelFailed by remember { mutableStateOf(false) }
    // «Что показать» — не больше раза за открытие, даже если сервер ещё не узнал, что шторку закрыли.
    var asked by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        tg.reloadFriends { d ->
            if (d.prompt && !asked) {
                asked = true
                showing = true
            }
        }
    }
    val data = tg.friendsData ?: run {
        if (tg.friendsFailed) ErrorNote(LocalStrings.current.error, Modifier.padding(top = 14.dp).testTag("friendsError")) { tg.reloadFriends() }
        return
    }
    val query = rememberTextFieldState()
    val q = query.text.toString().trim().lowercase()
    val shown = if (q.isEmpty()) data.friends else data.friends.filter { it.firstName.lowercase().contains(q) || it.username?.lowercase()?.contains(q.removePrefix("@")) == true }

    Column {
        // Поиск по друзьям и «Позвать друга» — одной строкой (27F).
        Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.weight(1f).height(48.dp).glass(14.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StrokeGlyph("M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0zM16 16l4.5 4.5", p.muted, 18.dp)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (query.text.isEmpty()) Text(fr.search, style = onest(15, color = p.muted))
                    BasicTextField(query, lineLimits = TextFieldLineLimits.SingleLine, textStyle = onest(15, color = p.text), cursorBrush = SolidColor(p.accent),
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = fr.search }.testTag("friendSearch"))
                }
            }
            Box(Modifier.size(48.dp).pressable(label = fr.invite) { inviting = true }.background(p.accent, RoundedCornerShape(14.dp)).semantics { contentDescription = fr.invite }, contentAlignment = Alignment.Center) {
                StrokeGlyph(Glyph.PLUS, p.accentText, 22.dp, 2.4f)
            }
        }
        if (data.incoming.isNotEmpty()) {
            Row(Modifier.padding(top = 12.dp).fillMaxWidth().heightIn(min = 56.dp).glass().pressable { model.open(Route.Requests) }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AvatarStack(data.incoming.take(3).map { it.person.asMember() }, 28.dp)
                Text(fr.requests(data.incoming.size), style = onest(15, 700, p.text), modifier = Modifier.weight(1f))
                StrokeGlyph(Glyph.CHEVRON, p.muted, 18.dp, 2.2f)
            }
        }
        if (cancelFailed) ErrorNote(t.error, Modifier.padding(top = 12.dp)) { cancelFailed = false }
        if (data.friends.isEmpty() && data.outgoing.isEmpty()) EmptyNote(fr.empty)
        if (q.isNotEmpty() && shown.isEmpty()) EmptyNote(fr.nothingFound)
        shown.forEach { f ->
            Row(Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 68.dp).glass().pressable { model.open(Route.Friend(f.id)) }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(f.person.asMember(), 44.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(f.firstName, style = onest(16, 600, p.text))
                    // Общая карта за две недели — без названий.
                    Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        f.days.forEach { score -> Box(Modifier.size(9.dp).background(p.heat[Heat.level(score)], RoundedCornerShape(2.dp))) }
                    }
                }
                if (f.due > 0) Text(fr.progress(f.done, f.due), style = onest(13, 600, if (f.done > 0) p.accent else p.muted))
                StrokeGlyph(Glyph.CHEVRON, p.muted, 18.dp, 2.2f)
            }
        }
        if (q.isEmpty()) data.outgoing.forEach { o ->
            Row(Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 68.dp).glass().padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(o.asMember(), 44.dp)
                Column(Modifier.weight(1f)) {
                    Text(o.firstName, style = onest(16, 600, p.text))
                    Text(fr.waiting, style = onest(13, color = p.muted))
                }
                LinkButton(fr.cancel) {
                    cancelFailed = false
                    scope.launch {
                        try {
                            model.api.dropRequest(o.id)
                        } catch (e: ApiError) {
                            if (e.isSignedOut) model.signOutLocally() else cancelFailed = true
                        }
                        tg.reloadFriends()
                    }
                }
            }
        }
    }
    if (inviting) AddFriendSheet(model, links) { inviting = false }
    if (showing) ShowSheet(model.today.tasks, picked = showFailed, failed = showFailed != null) { ids ->
        showing = false
        showFailed = null
        scope.launch {
            if (ids != null) {
                try {
                    model.api.setShown(ids)
                    model.refresh()
                } catch (e: ApiError) {
                    if (e.isSignedOut) return@launch model.signOutLocally()
                    showFailed = ids
                    showing = true
                    return@launch
                }
            } else {
                // «Назад» — служебная отметка «уже спросили»: не дошла — спросим в другой раз, ошибку не показываем.
                try {
                    model.api.promptSeen()
                } catch (e: ApiError) {
                    if (e.isSignedOut) return@launch model.signOutLocally()
                }
            }
            tg.reloadFriends()
        }
    }
}

// «Позвать друга»

@Composable
private fun AddFriendSheet(model: AppModel, links: Links, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    val scope = rememberCoroutineScope()
    val link = model.together.friendsData?.link.orEmpty()
    val name = rememberTextFieldState()
    var found by remember { mutableStateOf<FoundPerson?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // Ищем, когда перестали печатать.
    LaunchedEffect(name) {
        snapshotFlow { name.text.toString().trim() }.collectLatest { clean ->
            found = null
            problem = null
            if (clean.removePrefix("@").length < 4) return@collectLatest
            delay(400)
            try {
                found = model.api.findPerson(clean)
            } catch (e: ApiError) {
                if (e.isSignedOut) return@collectLatest model.signOutLocally()
                problem = if (e.code == "bad_username") fr.badUsername else fr.notFound
            }
        }
    }
    Sheet(fr.invite, onClose) {
        PrimaryButton(fr.sendLink, Modifier.testTag("sendFriendLink"), wide = true, enabled = link.isNotEmpty()) { links.open(telegramShare(link, fr.shareText), false) }
        SheetInput(name, fr.usernamePh, 40, "findUsername", fr.usernamePh, KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false))
        problem?.let { Text(it, style = onest(14, color = p.muted), modifier = Modifier.padding(start = 4.dp, top = 10.dp)) }
        found?.let { f ->
            Row(Modifier.padding(top = 10.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(16.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(f.person.asMember(), 40.dp)
                Column(Modifier.weight(1f)) {
                    Text(f.person.firstName, style = onest(16, 600, p.text))
                    f.person.username?.let { Text("@$it", style = onest(13, color = p.muted)) }
                }
                if (f.status == PersonStatus.None || f.status == PersonStatus.Incoming) {
                    PrimaryButton(fr.call, Modifier.testTag("callFriend"), small = true, enabled = !busy) {
                        busy = true
                        scope.launch {
                            try {
                                val status = model.api.requestFriend(username = f.person.username ?: name.text.toString())
                                found = f.copy(status = status)
                                model.together.reloadFriends()
                            } catch (e: ApiError) {
                                if (e.isSignedOut) model.signOutLocally()
                                problem = t.error
                            }
                            busy = false
                        }
                    }
                } else {
                    Text(fr.status[f.status].orEmpty(), style = onest(13, color = p.muted))
                }
            }
        }
    }
}

// Заявки (25M)

@Composable
fun RequestsScreen(model: AppModel) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    val tg = model.together
    val scope = rememberCoroutineScope()
    // Уже принятые и отклонённые: ответ, ушедший до нажатия, не должен вернуть их на экран.
    val done = remember { mutableSetOf<Long>() }
    var error by remember { mutableStateOf(false) }
    var hidden by remember { mutableStateOf(setOf<Long>()) }
    LaunchedEffect(Unit) { tg.reloadFriends() }
    val list = tg.friendsData?.incoming.orEmpty().filter { it.id !in hidden && it.id !in done }
    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        Screen(withTabs = false, modifier = Modifier.testTag("requests")) {
            item { BackPill(model::back) }
            item { PageHead(fr.requestsTitle, top = 12.dp) }
            if (error) item { ErrorNote(t.error, Modifier.padding(top = 12.dp)) { error = false } }
            if (list.isEmpty()) item { EmptyNote(fr.nothingFound) }
            list.forEach { r ->
                item(key = r.id) {
                    Column(Modifier.padding(top = 10.dp).fillMaxWidth().glass().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Avatar(r.person.asMember(), 44.dp)
                            Column {
                                Text(r.firstName, style = onest(16, 600, p.text))
                                val sub = if (r.via == "link") fr.viaLink else r.username?.let { "@$it" }
                                sub?.let { Text(it, style = onest(13, color = p.muted)) }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for ((accept, label) in listOf(true to fr.accept, false to fr.decline)) {
                                val act = {
                                    error = false
                                    done += r.id
                                    hidden = hidden + r.id
                                    scope.launch {
                                        try {
                                            if (accept) model.api.acceptFriend(r.id) else model.api.dropRequest(r.id)
                                        } catch (e: ApiError) {
                                            if (e.isSignedOut) return@launch model.signOutLocally()
                                            done -= r.id
                                            hidden = hidden - r.id
                                            error = true
                                        }
                                        tg.reloadFriends()
                                    }
                                }
                                if (accept) PrimaryButton(label, Modifier.weight(1f), wide = true, small = true, onClick = { act() })
                                else Box(Modifier.weight(1f).heightIn(min = 40.dp).pressable { act() }.background(p.bg, RoundedCornerShape(Dim.radiusBtn)), contentAlignment = Alignment.Center) {
                                    Text(label, style = onest(14, 700, p.text))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// Экран друга (25L)

@Composable
fun FriendScreen(model: AppModel, id: Long) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    val tg = model.together
    val scope = rememberCoroutineScope()
    var missing by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    var leaveFailed by remember { mutableStateOf(false) }
    LaunchedEffect(id) {
        // Убрали из друзей (или заблокировали) — экрана нет; моргнула сеть — остаётся как был.
        if (tg.loadFriend(id) == null && id !in tg.profiles) missing = true
    }
    val f = tg.profiles[id]
    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        Screen(withTabs = false, modifier = Modifier.testTag("friend")) {
            item { BackPill(model::back) }
            if (f == null) {
                if (missing) item { EmptyNote(fr.linkNotFound) }
                return@Screen
            }
            item {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(f.person.asMember(), 64.dp)
                    Column {
                        Text(f.person.firstName, style = onest(26, 700, p.text, tracking = -0.02f), modifier = Modifier.semantics { heading() })
                        f.person.username?.let { Text("@$it", style = onest(14, color = p.muted)) }
                    }
                }
            }
            item { HeatCard(f.heat, f.today, Modifier.padding(top = 16.dp)) }
            item { SectionLabel(fr.habits, Modifier.padding(start = 4.dp, top = 24.dp, bottom = 8.dp)) }
            if (f.habits.isEmpty()) item { EmptyNote(fr.noShown) } else item {
                Card {
                    f.habits.forEachIndexed { i, h ->
                        if (i > 0) RowDivider()
                        val note = when (h.kind) {
                            TaskKind.Abstain -> if (h.cleanDays > 0) t.cleanDays(h.cleanDays) else null
                            TaskKind.Count -> if (h.value > 0) fr.countToday(t.num(h.value), t.num(h.target), h.unit) else null
                            TaskKind.Check -> if (h.value > 0) fr.doneToday else null
                        }
                        val done = if (h.kind == TaskKind.Abstain) h.status == AbstainStatus.Clean else h.value >= (if (h.kind == TaskKind.Check) 1.0 else h.target)
                        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KindTile(h.kind, h.title, TileSize.Sm)
                            Column {
                                Text(h.title, style = onest(16, 600, p.text))
                                note?.let { Text(it, style = onest(13, if (done) 600 else 400, if (done) p.accent else p.muted)) }
                            }
                        }
                    }
                }
            }
            if (leaveFailed) item { ErrorNote(t.error, Modifier.padding(top = 12.dp)) { leaveFailed = false } }
            item {
                Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
                    QuietLink(fr.remove, p.muted) { confirm = false }
                    QuietLink(fr.block, p.warn) { confirm = true }
                }
            }
        }
    }
    val person = f?.person
    confirm?.let { block ->
        if (person == null) return@let
        Confirm(if (block) fr.blockConfirm(person.firstName) else fr.removeConfirm(person.firstName), if (block) fr.block else fr.remove, onConfirm = {
            confirm = null
            leaveFailed = false
            scope.launch {
                try {
                    if (block) model.api.blockPerson(id) else model.api.removeFriend(id)
                } catch (e: ApiError) {
                    if (e.isSignedOut) return@launch model.signOutLocally()
                    leaveFailed = true
                    return@launch
                }
                tg.profiles.remove(id)
                tg.reloadFriends()
                model.back()
            }
        }, onDismiss = { confirm = null })
    }
}

/** Карта «Месяц · Год» (HeatCard.tsx): один блок в профиле и на экране друга, высота не прыгает. */
@Composable
fun HeatCard(days: List<HeatDay>, today: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var year by rememberSaveable { mutableStateOf(false) }
    var offset by rememberSaveable { mutableStateOf(0) }
    val month = Months.shift(Months.of(today), offset)
    val levels = remember(days) { days.associate { it.day to Heat.level(it.score) } }
    val from = Months.of(HeatMap.yearStart(today))
    val label = if (year) "${t.monthShort(from)} ${from.take(4)} — ${t.monthShort(Months.of(today))} ${today.take(4)}" else t.monthYear(month)
    Card(modifier, padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
        Segmented(listOf(t.month to !year, t.year to year)) { year = it == 1 }
        Row(Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp, 44.dp).then(if (!year && offset > -HeatMap.MONTHS_BACK) Modifier.pressable(label = t.prevMonth) { offset-- } else Modifier), contentAlignment = Alignment.Center) {
                if (!year) Text("‹", style = onest(22, color = if (offset > -HeatMap.MONTHS_BACK) p.muted else p.muted.copy(alpha = 0.3f)))
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(label, style = onest(15, 600, p.text))
                Text(t.activeDays(HeatMap.activeDays(days, if (year) null else month)), style = onest(13, color = p.muted))
            }
            Box(Modifier.size(40.dp, 44.dp).then(if (!year && offset < 0) Modifier.pressable(label = t.nextMonth) { offset++ } else Modifier), contentAlignment = Alignment.Center) {
                if (!year) Text("›", style = onest(22, color = if (offset < 0) p.muted else p.muted.copy(alpha = 0.3f)))
            }
        }
        Box(Modifier.padding(top = 12.dp).clearAndSetSemantics {}) {
            if (!year) {
                val grid = Months.cells(month)
                val slots: List<String?> = List(grid.lead) { null } + grid.days
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    slots.chunked(7).forEach { week ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (i in 0 until 7) {
                                val day = week.getOrNull(i)
                                Box(Modifier.weight(1f).aspectRatio(1f)) {
                                    if (day != null) HeatCell(day, today, levels, 9.dp)
                                }
                            }
                        }
                    }
                }
            } else {
                // Год одной лентой: открывается на текущей неделе, назад листается пальцем.
                val scroll = rememberScrollState()
                LaunchedEffect(Unit) { scroll.scrollTo(scroll.maxValue) }
                Row(Modifier.horizontalScroll(scroll), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    HeatMap.weeks(today) { t.monthShort(it) }.forEach { (monday, name) ->
                        Column(Modifier.width(24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(name, style = onest(11, color = p.muted, lineHeight = 16.sp), maxLines = 1, softWrap = false, modifier = Modifier.height(16.dp))
                            for (d in 0 until 7) Box(Modifier.size(24.dp)) { HeatCell(Days.add(monday, d), today, levels, 6.dp) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeatCell(day: String, today: String, levels: Map<String, Int>, radius: androidx.compose.ui.unit.Dp) {
    val p = LocalPalette.current
    val shape = RoundedCornerShape(radius)
    Box(
        Modifier.fillMaxSize().then(
            when {
                day > today -> Modifier.border(1.dp, p.line, shape)
                day == today -> Modifier.background(p.heat[levels[day] ?: 0], shape).border(2.dp, p.text, shape)
                else -> Modifier.background(p.heat[levels[day] ?: 0], shape)
            },
        ),
    )
}

// Открыли чужую ссылку

@Composable
fun FriendLinkScreen(model: AppModel, code: String) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    val scope = rememberCoroutineScope()
    var who by remember { mutableStateOf<FoundPerson?>(null) }
    var missing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(code) {
        try {
            who = model.api.friendLink(code)
        } catch (e: ApiError) {
            if (e.isSignedOut) return@LaunchedEffect model.signOutLocally()
            missing = true
        }
    }
    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).testTag("friendLink"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
            if (missing) {
                Text(fr.linkNotFound, style = onest(16, color = p.muted), textAlign = TextAlign.Center)
                PrimaryButton(fr.later) { model.back() }
                return@Column
            }
            val w = who ?: return@Column
            val name = w.person.firstName
            Avatar(w.person.asMember(), 88.dp)
            Text(if (w.status == PersonStatus.Self) name else fr.linkTitle(name), style = onest(24, 700, p.text), textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
            val line = when (w.status) {
                PersonStatus.Sent -> fr.linkSent(name)
                PersonStatus.Friends -> fr.linkFriends
                PersonStatus.Self -> fr.linkSelf
                PersonStatus.Blocked -> fr.linkBlocked
                else -> fr.linkSub
            }
            Text(line, style = onest(15, color = p.muted), textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            if (w.status == PersonStatus.None || w.status == PersonStatus.Incoming) {
                PrimaryButton(fr.linkBtn, Modifier.testTag("beFriends"), wide = true, enabled = !busy) {
                    busy = true
                    scope.launch {
                        try {
                            who = w.copy(status = model.api.requestFriend(code = code))
                            model.together.reloadFriends()
                        } catch (e: ApiError) {
                            if (e.isSignedOut) return@launch model.signOutLocally()
                            missing = true
                        }
                        busy = false
                    }
                }
            } else {
                PrimaryButton(fr.open, wide = true) {
                    model.back()
                    if (w.status == PersonStatus.Friends || w.status == PersonStatus.Sent) model.showFriends(true)
                }
            }
            QuietLink(fr.later, p.muted) { model.back() }
        }
    }
}

// «Что показать друзьям?» (25H)

/** На весь экран: плитки привычек, тап выбирает; «Выбрать все»; «назад» — ничего не меняем. */
@Composable
fun ShowSheet(habits: List<TodayTask>, picked: List<Long>?, failed: Boolean, onClose: (List<Long>?) -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val fr = t.fr
    var chosen by remember { mutableStateOf(picked?.toSet() ?: habits.filter { it.visibility == app.lifecommit.core.Visibility.Friends }.map { it.id }.toSet()) }
    val all = habits.isNotEmpty() && chosen.size == habits.size
    androidx.compose.ui.window.Dialog(onDismissRequest = { onClose(null) }, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(p.bg)) {
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 24.dp).testTag("showSheet")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(fr.showTitle, style = onest(26, 700, p.text), modifier = Modifier.weight(1f).semantics { heading() })
                    if (habits.isNotEmpty()) LinkButton(fr.selectAll) { chosen = if (all) emptySet() else habits.map { it.id }.toSet() }
                }
                Column(Modifier.weight(1f).padding(top = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    habits.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { h ->
                                val on = h.id in chosen
                                Column(
                                    Modifier.weight(1f).heightIn(min = 110.dp).glass()
                                        .then(if (on) Modifier.border(2.dp, p.accent, RoundedCornerShape(Dim.radius)) else Modifier)
                                        .pressable(role = Role.Checkbox) { chosen = if (on) chosen - h.id else chosen + h.id }
                                        .semantics { selected = on }.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Row {
                                        KindTile(h.kind, h.title)
                                        Box(Modifier.weight(1f), contentAlignment = Alignment.TopEnd) {
                                            Box(Modifier.size(22.dp).background(if (on) p.accent else Color.Transparent, CircleShape).border(2.dp, if (on) p.accent else p.line, CircleShape), contentAlignment = Alignment.Center) {
                                                if (on) StrokeGlyph(Glyph.CHECK, p.accentText, 14.dp, 3f)
                                            }
                                        }
                                    }
                                    Text(h.title, style = onest(15, 600, p.text))
                                }
                            }
                            if (row.size == 1) Box(Modifier.weight(1f))
                        }
                    }
                }
                if (failed) ErrorNote(t.error, Modifier.padding(top = 10.dp))
                PrimaryButton(t.done, Modifier.padding(top = 12.dp).testTag("showDone"), wide = true) { onClose(chosen.toList()) }
            }
        }
    }
}
