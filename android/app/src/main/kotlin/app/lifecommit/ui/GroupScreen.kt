// Экран группы — как src/screens/Group.tsx (дизайн 16E/16F): дела на сегодня с отметками, «Скоро», люди, приглашение,
// вклад в общую цель; настройки (название, «только админы», чат Telegram, выйти, удалить); шторка дела — GroupItemSheet.tsx.
package app.lifecommit.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.maxLength
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.GroupNote
import app.lifecommit.TogetherModel
import app.lifecommit.core.ApiError
import app.lifecommit.core.Days
import app.lifecommit.core.GroupDayItem
import app.lifecommit.core.GroupItemInput
import app.lifecommit.core.GroupMode
import app.lifecommit.core.GroupRepeat
import app.lifecommit.core.GroupRole
import app.lifecommit.core.GroupToday
import app.lifecommit.core.Groups
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate

/** t.me/share — поделиться ссылкой в Telegram (как в мини-аппе: приглашения отправляют туда). */
fun telegramShare(link: String, text: String) =
    "https://t.me/share/url?url=${java.net.URLEncoder.encode(link, Charsets.UTF_8)}&text=${java.net.URLEncoder.encode(text, Charsets.UTF_8)}"

@Composable
fun GroupScreen(model: AppModel, id: Long, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val g = t.gr
    val tg = model.together
    val scope = rememberCoroutineScope()
    val today = model.today.day
    val me = model.user?.id ?: 0
    LaunchedEffect(id) { tg.loadGroup(id) }
    val group = tg.details[id] ?: model.today.groups.firstOrNull { it.id == id }
    // Чат ещё жив? Проверяем в фоне раз за открытие.
    LaunchedEffect(group?.settings?.tgChatTitle != null) { if (group?.settings?.tgChatTitle != null) tg.checkChat(id) }
    var peopleTab by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<GroupDayItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    var putting by remember { mutableStateOf<GroupDayItem?>(null) }
    // Подсказка поверх, сама уходит через 3,5 с; подсказка другой группы здесь не всплывает.
    LaunchedEffect(id) { if (tg.note?.groupId != id) tg.note = null }
    LaunchedEffect(tg.note) {
        if (tg.note?.groupId == id) {
            delay(3_500)
            tg.note = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        if (group == null) {
            Screen(withTabs = false) {
                item { BackPill(model::back) }
                if (tg.missing[id] == true) item { EmptyNote(g.join.notFound) }
            }
            return@Box
        }
        val goals = group.items.filter { it.mode == GroupMode.Goal }
        val items = Groups.screenOrder(group.items)
        val soon = Groups.soon(group.upcoming)
        Screen(withTabs = false, modifier = Modifier.testTag("group")) {
            item { BackPill(model::back) }
            item {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    GroupBadge(group.id, group.title, 60.dp)
                    Column(Modifier.weight(1f)) {
                        Text(group.title, style = onest(26, 700, p.text, lineHeight = 30.sp, tracking = -0.02f), modifier = Modifier.semantics { heading() })
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            AvatarStack(group.members, 20.dp)
                            Text(g.people(group.members.size) + if (group.planned > 0) " · ${g.progress(group.done, group.planned)}" else "", style = onest(14, color = p.muted))
                        }
                    }
                    Box(Modifier.size(44.dp).glass(14.dp).pressable(label = g.settings) { settings = true }.semantics { contentDescription = g.settings }, contentAlignment = Alignment.Center) {
                        StrokeGlyph(Glyph.SETTINGS, p.muted, 20.dp, 1.9f)
                    }
                }
            }
            item { Segmented(listOf(g.tabItems to !peopleTab, g.tabPeople to peopleTab), Modifier.padding(top = 16.dp)) { peopleTab = it == 1 } }
            if (!peopleTab) {
                if (goals.isNotEmpty()) item {
                    Card(Modifier.padding(top = 16.dp)) {
                        goals.forEachIndexed { i, it ->
                            if (i > 0) RowDivider()
                            GroupItemRow(model, group.id, it, group.members, today, onToggle = null, onOpen = { editing = it }, onPut = { putting = it })
                        }
                    }
                }
                item { SectionLabel(g.todayLabel, Modifier.padding(start = 4.dp, top = 24.dp, bottom = 8.dp)) }
                item {
                    Card {
                        if (items.isEmpty()) Text(g.nothingToday, style = onest(15, color = p.muted), modifier = Modifier.padding(horizontal = 14.dp, vertical = 15.dp))
                        items.forEachIndexed { i, it ->
                            androidx.compose.runtime.key(it.id) {
                                if (i > 0) RowDivider()
                                GroupItemRow(model, group.id, it, group.members, today, onToggle = { model.toggleGroupItem(group.id, it, today, onGroupScreen = true) }, onOpen = { editing = it })
                            }
                        }
                    }
                }
                if (soon.isNotEmpty()) {
                    item { SectionLabel(g.soon, Modifier.padding(start = 4.dp, top = 24.dp, bottom = 4.dp)) }
                    soon.forEach { b ->
                        item {
                            Text(t.weekdayLong(b.day), style = onest(15, 600, p.muted), modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 6.dp))
                            Card {
                                b.items.forEachIndexed { i, it ->
                                    if (i > 0) RowDivider()
                                    GroupItemRow(model, group.id, it, group.members, b.day, canMark = false, onToggle = null, onOpen = { editing = it })
                                }
                            }
                        }
                    }
                }
                item {
                    Box(Modifier.fillMaxWidth().padding(top = 18.dp), contentAlignment = Alignment.Center) {
                        PrimaryButton(g.addItem, Modifier.testTag("addGroupItem"), leading = { StrokeGlyph(Glyph.PLUS, p.accentText, 20.dp, 2.4f) }) { creating = true }
                    }
                }
            } else {
                item {
                    Card(Modifier.padding(top = 16.dp)) {
                        group.members.forEachIndexed { i, m ->
                            if (i > 0) RowDivider()
                            val done = group.items.filter { m.id in it.doneBy }.map { it.title }
                            Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Avatar(m, 40.dp)
                                Column {
                                    Text(if (m.id == me) "${m.name} (${g.me})" else m.name, style = onest(16, color = p.text))
                                    if (done.isNotEmpty()) Text(g.doneBy(done.joinToString(", ")), style = onest(13, color = p.muted))
                                }
                            }
                        }
                    }
                }
                item {
                    PrimaryButton(g.invite, Modifier.padding(top = 14.dp).testTag("inviteGroup"), wide = true) {
                        scope.launch {
                            try {
                                val link = tg.inviteLink(group.id)
                                links.open(telegramShare(link, "${group.title} · LifeCommit"), false)
                                tg.note = GroupNote(id, TogetherModel.INVITE_SENT)
                            } catch (e: ApiError) {
                                if (e.isSignedOut) model.signOutLocally() else tg.note = GroupNote(id, TogetherModel.ERROR)
                            }
                        }
                    }
                    Text(g.inviteHint, style = onest(14, color = p.muted), modifier = Modifier.fillMaxWidth().padding(top = 10.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }
        tg.note?.takeIf { it.groupId == id }?.let { note ->
            val text = when (note.key) {
                TogetherModel.TAKEN -> g.taken
                TogetherModel.NOT_YOURS -> g.notYours
                TogetherModel.INVITE_SENT -> g.inviteSent
                else -> t.error
            }
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 40.dp, start = 20.dp, end = 20.dp), contentAlignment = Alignment.BottomCenter) {
                Text(text, style = onest(14, 500, p.bg), modifier = Modifier.background(p.text.copy(alpha = 0.88f), RoundedCornerShape(16.dp)).pressable { tg.note = null }.padding(horizontal = 16.dp, vertical = 10.dp).testTag("groupNote"))
            }
        }
    }

    if (group != null) {
        if (settings) GroupSettingsSheet(model, group, links) { settings = false }
        if (creating || editing != null) GroupItemSheet(model, group, editing) {
            creating = false
            editing = null
        }
        putting?.let { PutSheet(model, group.id, it) { putting = null } }
    }
}

/** Вклад в общую цель: одно число. */
@Composable
private fun PutSheet(model: AppModel, groupId: Long, item: GroupDayItem, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val g = t.gr
    val scope = rememberCoroutineScope()
    val value = rememberTextFieldState()
    var busy by remember { mutableStateOf(false) }
    val n = value.text.toString().replace(Regex("\\s"), "").replace(',', '.').toDoubleOrNull() ?: 0.0
    Sheet(g.putTitle(item.title), onClose) {
        SheetInput(value, g.putPh, 12, "putAmount", g.putPh, KeyboardOptions(keyboardType = KeyboardType.Decimal))
        if (n > 0 && item.target != null) Text(g.goalOf(t.num((item.total ?: 0.0) + n), t.num(item.target!!)), style = onest(14, color = p.muted), modifier = Modifier.fillMaxWidth().padding(top = 10.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        PrimaryButton(g.put, Modifier.padding(top = 14.dp).testTag("putDone"), wide = true, enabled = n > 0 && !busy) {
            busy = true
            scope.launch {
                try {
                    model.together.put(groupId, item.id, n)
                } catch (e: ApiError) {
                    if (e.isSignedOut) model.signOutLocally() else model.together.note = GroupNote(groupId, TogetherModel.ERROR)
                }
                onClose()
            }
        }
    }
}

/** Настройки группы: название, «только админы заводят дела», чат Telegram, выйти, удалить. */
@Composable
private fun GroupSettingsSheet(model: AppModel, group: GroupToday, links: Links, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val g = t.gr
    val tg = model.together
    val scope = rememberCoroutineScope()
    val canManage = group.role != GroupRole.Member
    val title = rememberTextFieldState(group.title)
    var error by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf<Boolean?>(null) }
    var confirmChat by remember { mutableStateOf(false) }
    val save = {
        val next = title.text.toString().trim()
        if (next.isNotEmpty() && next != group.title) scope.launch {
            try {
                tg.rename(group.id, next)
            } catch (e: ApiError) {
                if (e.isSignedOut) model.signOutLocally()
                error = true
                tg.note = GroupNote(group.id, TogetherModel.ERROR)
            }
        }
    }
    // Добавить бота в чат Telegram: тот же код приглашения, но ссылка «в группу» (startgroup).
    val connectChat = {
        scope.launch {
            try {
                links.open(tg.inviteLink(group.id).replace("?startapp=", "?startgroup="), false)
            } catch (e: ApiError) {
                if (e.isSignedOut) model.signOutLocally() else error = true
            }
        }
    }
    Sheet(g.settings, onClose = {
        save()
        onClose()
    }) {
        if (canManage) SheetInput(title, g.name, 60, "groupTitle", g.namePh)
        else Text(group.title, style = onest(16, color = p.muted), modifier = Modifier.padding(horizontal = 4.dp))
        if (error) ErrorNote(t.error, Modifier.padding(top = 10.dp))
        if (canManage) {
            Column(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
                val on = group.settings?.adminsOnlyEdit == true
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).pressable(role = Role.Switch) {
                    scope.launch {
                        error = false
                        try {
                            tg.setAdminsOnly(group.id, !on)
                        } catch (e: ApiError) {
                            if (e.isSignedOut) model.signOutLocally()
                            error = true
                        }
                    }
                }.padding(start = 18.dp, end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(g.adminsOnly, style = onest(16, 500, p.text), modifier = Modifier.weight(1f))
                    Switch(checked = on, onCheckedChange = null, colors = SwitchDefaults.colors(checkedTrackColor = p.accent, checkedThumbColor = p.surface, uncheckedTrackColor = p.heat[0], uncheckedThumbColor = p.surface, uncheckedBorderColor = Color.Transparent))
                }
            }
        }
        // Чат Telegram: подключённый — строкой с названием, админам — «Другой чат · Отключить»; без чата — кнопка админам.
        val chat = group.settings?.tgChatTitle
        if (chat != null) {
            Row(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius)).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StrokeGlyph(Glyph.TELEGRAM, Color(0xFF2AABEE), 20.dp)
                Column {
                    Text(g.chatLabel, style = onest(13, color = p.muted))
                    Text(chat, style = onest(16, 600, p.text))
                    if (canManage) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(g.chatOther, style = onest(14, 600, p.accent), modifier = Modifier.pressable { connectChat() })
                        Text("·", style = onest(14, color = p.muted))
                        Text(g.chatOff, style = onest(14, 600, p.warn), modifier = Modifier.pressable { confirmChat = true })
                    }
                }
            }
        } else if (canManage) {
            Box(Modifier.padding(top = 12.dp).fillMaxWidth().heightIn(min = Dim.tap).border(1.5.dp, p.line, RoundedCornerShape(Dim.radiusBtn)).pressable { connectChat() }, contentAlignment = Alignment.Center) {
                Text(g.connectChat, style = onest(16, 700, p.text))
            }
            Text(g.connectChatHint, style = onest(14, color = p.muted), modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        Box(Modifier.fillMaxWidth().padding(top = 10.dp), contentAlignment = Alignment.Center) { QuietLink(g.leave, p.warn) { confirmLeave = false } }
        if (group.role == GroupRole.Owner) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QuietLink(g.removeGroup, p.danger) { confirmLeave = true } }
    }
    confirmLeave?.let { remove ->
        Confirm(if (remove) g.removeConfirm else g.leaveConfirm, if (remove) g.removeGroup else g.leave, onConfirm = {
            confirmLeave = null
            scope.launch {
                try {
                    tg.leave(group.id, remove)
                    onClose()
                    model.back()
                } catch (e: ApiError) {
                    // Сервер не выпустил — остаёмся на экране группы, подсказка поверх.
                    if (e.isSignedOut) model.signOutLocally()
                    onClose()
                    tg.note = GroupNote(group.id, TogetherModel.ERROR)
                }
            }
        }, onDismiss = { confirmLeave = null })
    }
    if (confirmChat) {
        Confirm(g.chatOffConfirm(group.settings?.tgChatTitle.orEmpty()), g.chatOff, onConfirm = {
            confirmChat = false
            scope.launch {
                try {
                    tg.disconnectChat(group.id)
                } catch (e: ApiError) {
                    if (e.isSignedOut) model.signOutLocally() else error = true
                }
            }
        }, onDismiss = { confirmChat = false })
    }
}

/** Новое или правка группового дела (GroupItemSheet.tsx, 16H): четыре плитки «Кто делает», люди, повтор, время, цель. */
@Composable
private fun GroupItemSheet(model: AppModel, group: GroupToday, item: GroupDayItem?, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val g = t.gr
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val today = model.today.day
    val me = model.user?.id ?: 0
    val title = rememberTextFieldState(item?.title.orEmpty())
    var mode by remember { mutableStateOf(item?.mode ?: GroupMode.One) }
    var all by remember { mutableStateOf(item?.allMembers ?: false) }
    var people by remember { mutableStateOf(item?.assignees?.takeIf { it.isNotEmpty() }?.toSet() ?: setOf(me)) }
    var rotate by remember { mutableStateOf(item?.rotate ?: false) }
    var repeat by remember { mutableStateOf(GroupRepeat.fromRRule(item?.rrule)) }
    var day by remember { mutableStateOf(item?.start?.takeIf { it.isNotEmpty() } ?: today) }
    var time by remember { mutableStateOf(item?.time) }
    val target = rememberTextFieldState(item?.target?.let { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }.orEmpty())
    var until by remember { mutableStateOf(item?.goalUntil.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var repeatOpen by remember { mutableStateOf(false) }

    val chosen = if (all) group.members.map { it.id } else people.toList()
    val canRotate = mode == GroupMode.Assign && chosen.size >= 2
    val targetNum = target.text.toString().replace(Regex("\\s"), "").replace(',', '.').toDoubleOrNull() ?: 0.0
    val valid = title.text.isNotBlank() && (mode != GroupMode.Goal || targetNum > 0) && ((mode != GroupMode.Assign && mode != GroupMode.Event) || chosen.isNotEmpty())
    val placeholder = when (mode) {
        GroupMode.Event -> g.eventPh
        GroupMode.Goal -> g.goalPh
        else -> g.itemPh
    }

    Sheet(item?.title ?: g.newItem(group.title), onClose) {
        SheetInput(title, placeholder, 120, "groupItemTitle", placeholder)
        SectionLabel(g.who, Modifier.padding(start = 4.dp, top = 16.dp, bottom = 8.dp))
        // Плитки 2×2.
        listOf(listOf(GroupMode.One, GroupMode.Assign), listOf(GroupMode.Goal, GroupMode.Event)).forEach { row ->
            Row(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { m ->
                    val on = mode == m
                    Column(
                        Modifier.weight(1f).heightIn(min = 84.dp)
                            .background(if (on) p.accentSoft else p.bg, RoundedCornerShape(16.dp))
                            .then(if (on) Modifier.border(1.5.dp, p.accent, RoundedCornerShape(16.dp)) else Modifier)
                            .pressable(role = Role.RadioButton) { mode = m }.semantics { selected = on }
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(g.modes.getValue(m), style = onest(15, 700, if (on) p.accentSoftText else p.text))
                        Text(g.modeHints.getValue(m), style = onest(12, color = p.muted))
                    }
                }
            }
        }
        if (mode == GroupMode.Assign || mode == GroupMode.Event) {
            FlowRow(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip(g.all, all) { all = !all }
                group.members.forEach { m ->
                    val on = all || m.id in people
                    Chip(if (m.id == me) g.me else m.name, on, avatar = { Avatar(m, 30.dp) }) {
                        val next = (if (all) group.members.map { it.id }.toSet() else people).toMutableSet()
                        if (!next.remove(m.id)) next.add(m.id)
                        all = false
                        people = next
                    }
                }
            }
        }
        Column(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
            if (mode == GroupMode.Goal) {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 18.dp, end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(g.target, style = onest(16, 500, p.text), modifier = Modifier.weight(1f))
                    Box(Modifier.size(140.dp, 44.dp), contentAlignment = Alignment.CenterEnd) {
                        if (target.text.isEmpty()) Text(g.targetPh, style = onest(16, color = p.muted))
                        androidx.compose.foundation.text.BasicTextField(
                            target,
                            inputTransformation = androidx.compose.foundation.text.input.InputTransformation.maxLength(12),
                            lineLimits = androidx.compose.foundation.text.input.TextFieldLineLimits.SingleLine,
                            textStyle = onest(16, 600, p.text).copy(textAlign = androidx.compose.ui.text.style.TextAlign.End),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.fillMaxWidth().semantics { contentDescription = g.target }.testTag("goalTarget"),
                        )
                    }
                }
                RowDivider()
                SettingRow(g.until, if (until.isEmpty()) "—" else t.dayMonth(until), onClick = {
                    val start = Days.date(until.ifEmpty { today }) ?: LocalDate.now()
                    val d = DatePickerDialog(context, { _, y, mo, dd -> until = LocalDate.of(y, mo + 1, dd).toString() }, start.year, start.monthValue - 1, start.dayOfMonth)
                    Days.date(today)?.let { d.datePicker.minDate = it.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
                    d.show()
                })
            } else {
                if (canRotate) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).pressable(role = Role.Switch) { rotate = !rotate }.padding(start = 18.dp, end = 14.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(g.rotate, style = onest(16, 500, p.text))
                            Text(if (rotate) chosen.joinToString(" → ") { id -> if (id == me) g.me else group.members.firstOrNull { it.id == id }?.name.orEmpty() } else g.eachHint, style = onest(13, color = p.muted))
                        }
                        Switch(checked = rotate, onCheckedChange = null, colors = SwitchDefaults.colors(checkedTrackColor = p.accent, checkedThumbColor = p.surface, uncheckedTrackColor = p.heat[0], uncheckedThumbColor = p.surface, uncheckedBorderColor = Color.Transparent))
                    }
                    RowDivider()
                }
                SettingRow(g.repeat, g.repeats.getValue(repeat), onClick = { repeatOpen = true })
                if (repeat == GroupRepeat.Once || repeat == GroupRepeat.Weekly) {
                    RowDivider()
                    SettingRow(g.date, t.dayMonth(day), onClick = {
                        val start = Days.date(day) ?: LocalDate.now()
                        val d = DatePickerDialog(context, { _, y, mo, dd -> day = LocalDate.of(y, mo + 1, dd).toString() }, start.year, start.monthValue - 1, start.dayOfMonth)
                        Days.date(today)?.let { d.datePicker.minDate = it.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
                        d.show()
                    })
                }
                RowDivider()
                SettingRow(g.time, time ?: g.allDay, onClick = {
                    val (h, m) = (time ?: "19:00").split(":").map { it.toIntOrNull() ?: 0 }
                    val d = TimePickerDialog(context, { _, hh, mm -> time = "%02d:%02d".format(hh, mm) }, h, m, true)
                    if (time != null) d.setButton(TimePickerDialog.BUTTON_NEUTRAL, g.noTime) { _, _ -> time = null }
                    d.show()
                })
            }
        }
        if (error) ErrorNote(t.error, Modifier.padding(top = 10.dp))
        PrimaryButton(if (item != null) g.save else g.add, Modifier.padding(top = 14.dp).testTag("groupItemSave"), wide = true, enabled = valid && !busy, busy = busy) {
            busy = true
            error = false
            val input = GroupItemInput(
                title = title.text.toString().trim(),
                mode = mode,
                day = if (mode == GroupMode.Goal) today else day,
                time = if (mode == GroupMode.Goal) null else time,
                rrule = if (mode == GroupMode.Goal) null else GroupRepeat.toRRule(repeat, day),
                assignees = if (mode == GroupMode.Assign || mode == GroupMode.Event) (if (all) emptyList() else people.toList()) else emptyList(),
                allMembers = (mode == GroupMode.Assign || mode == GroupMode.Event) && all,
                rotate = canRotate && rotate,
                target = if (mode == GroupMode.Goal) targetNum else null,
                goalUntil = if (mode == GroupMode.Goal) until.ifEmpty { null } else null,
            )
            scope.launch {
                try {
                    model.together.saveItem(group.id, item?.id, input)
                    model.calendar.reloadQuiet()
                    onClose()
                } catch (e: ApiError) {
                    if (e.isSignedOut) model.signOutLocally()
                    error = true
                    busy = false
                }
            }
        }
        if (item != null) Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
            QuietLink(g.remove, p.danger) {
                onClose()
                model.removeGroupItem(group.id, item, null)
            }
        }
    }
    if (repeatOpen) {
        Sheet(g.repeat, onClose = { repeatOpen = false }) {
            GroupRepeat.entries.forEachIndexed { i, r ->
                if (i > 0) RowDivider()
                val on = r == repeat
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).pressable(role = Role.RadioButton) {
                    repeat = r
                    repeatOpen = false
                }.padding(horizontal = 4.dp).semantics { selected = on }, verticalAlignment = Alignment.CenterVertically) {
                    Text(g.repeats.getValue(r), style = onest(16, if (on) 600 else 500, if (on) p.accent else p.text), modifier = Modifier.weight(1f))
                    if (on) StrokeGlyph(Glyph.CHECK, p.accent, 20.dp, 2.4f)
                }
            }
        }
    }
}

/** Человек в шторке дела (.chip): выбран — зелёный. */
@Composable
private fun Chip(label: String, on: Boolean, avatar: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.heightIn(min = 40.dp).background(if (on) p.accentSoft else p.bg, RoundedCornerShape(20.dp))
            .then(if (on) Modifier.border(1.5.dp, p.accent, RoundedCornerShape(20.dp)) else Modifier)
            .pressable(role = Role.Checkbox, onClick = onClick).semantics { selected = on }
            .padding(start = if (avatar != null) 4.dp else 14.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        avatar?.invoke()
        Text(label, style = onest(14, 600, if (on) p.accentSoftText else p.text))
    }
}
