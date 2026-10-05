// Общие кусочки «Вместе» — как src/components/groupUi.tsx и GroupBlocks.tsx: аватарки, значок группы, строка группового
// дела (галочка, кто делает, кто сделал; у цели — полоса и «+ Положить»), удаление свайпом, блоки групп на «Сегодня».
package app.lifecommit.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.core.ApiError
import app.lifecommit.core.GroupDayItem
import app.lifecommit.core.GroupMember
import app.lifecommit.core.GroupMode
import app.lifecommit.core.GroupToday
import app.lifecommit.core.Groups
import app.lifecommit.core.Tints

/** Аватарка: буква имени на цвете по id (фото Telegram в приложение не грузим — только буква, как без фото). */
@Composable
fun Avatar(member: GroupMember, size: Dp = 28.dp) {
    val (bg, fg) = Tints.avatar(member.id)
    val loader = Photos.loader
    // Только https: фото с http (или чужой схемой) не грузим — буква.
    val url = member.photo?.takeIf { it.startsWith("https://") }
    val photo by produceState(url?.let(loader::cached), url) {
        if (value == null) value = url?.let { loader.load(it) }
    }
    photo?.let {
        Image(it, null, Modifier.size(size).clip(CircleShape).clearAndSetSemantics {}.testTag("avatarPhoto"), contentScale = ContentScale.Crop)
        return
    }
    Box(Modifier.size(size).background(Color(bg), CircleShape).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        Text(Tints.initial(member.name), style = onest((size.value * 0.42f).toInt().coerceAtLeast(9), 700, Color(fg)))
    }
}

@Composable
fun AvatarStack(members: List<GroupMember>, size: Dp = 24.dp, max: Int = 4) {
    val p = LocalPalette.current
    Row(Modifier.clearAndSetSemantics {}) {
        members.take(max).forEachIndexed { i, m ->
            Box(Modifier.offset(x = -(size * 0.3f) * i).border(2.dp, p.bg, CircleShape)) { Avatar(m, size) }
        }
        if (members.size > max) {
            Box(Modifier.offset(x = -(size * 0.3f) * max).size(size).background(p.heat[0], CircleShape).border(2.dp, p.bg, CircleShape), contentAlignment = Alignment.Center) {
                Text("+${members.size - max}", style = onest((size.value * 0.4f).toInt(), 600, p.muted))
            }
        }
    }
}

/** Значок группы: первая буква, цвет по id группы (тип группы не выбирают, 02.10.2026). */
@Composable
fun GroupBadge(id: Long, title: String, size: Dp = 48.dp) {
    val (bg, fg) = Tints.group(id)
    Box(Modifier.size(size).background(Color(bg), RoundedCornerShape(size * 0.33f)).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        Text(Tints.initial(title), style = onest((size.value * 0.42f).toInt(), 700, Color(fg)))
    }
}

private fun nameOf(members: List<GroupMember>, id: Long, me: Long, meLabel: String) = if (id == me) meLabel else members.firstOrNull { it.id == id }?.name ?: "…"

/** Подписи строки: время, кто делает (бейдж), кто сделал. */
private data class Badge(val text: String, val tone: String)

/**
 * Строка группового дела. swipe — группа, день строки и что сделать после удаления; удалить могут те, кому в группе
 * можно править (иначе сервер скажет 403 admins_only — подсказка).
 */
@Composable
fun GroupItemRow(model: AppModel, groupId: Long, it: GroupDayItem, members: List<GroupMember>, day: String, canMark: Boolean = it.canMark, onToggle: (() -> Unit)?, onOpen: () -> Unit, onPut: (() -> Unit)? = null) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val g = t.gr
    val me = model.user?.id ?: 0
    var ask by remember { mutableStateOf(false) }
    if (model.isGroupItemRemoved(groupId, it.id, day)) return
    val removeAll = { model.removeGroupItem(groupId, it, null) }
    val actions = listOf(SwipeAction(t.swipe.remove, danger = true) {
        if (it.recurring && it.mode != GroupMode.Goal) ask = true else removeAll()
    })

    SwipeRow(actions, radius = Dim.radius) {
        if (it.mode == GroupMode.Goal) {
            val total = it.total ?: 0.0
            val target = it.target ?: 1.0
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).pressable(onClick = onOpen).padding(start = 18.dp, end = 10.dp, top = 10.dp, bottom = 12.dp)) {
                    Text(it.title, style = onest(16, color = p.text, lineHeight = 21.sp))
                    Text(g.goalOf(Groups.goalNumber(total, it.unit, t), Groups.goalNumber(target, it.unit, t)), style = onest(13, color = p.muted))
                    Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(p.heat[0])) {
                        Box(Modifier.fillMaxWidth((total / target).toFloat().coerceIn(0f, 1f)).height(6.dp).background(p.heat[3]))
                    }
                }
                if (onPut != null) {
                    Box(Modifier.padding(end = 10.dp).heightIn(min = 40.dp).pressable(onClick = onPut).background(p.accentSoft, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                        Text("+ ${g.put}", style = onest(14, 600, p.accentSoftText))
                    }
                }
            }
            return@SwipeRow
        }
        val badges = buildList {
            when (it.mode) {
                GroupMode.Event -> add(Badge(g.event, "gray"))
                GroupMode.One -> add(Badge(g.anyone, "gray"))
                GroupMode.Assign -> when {
                    it.turn != null -> add(Badge(if (it.turn == me) g.yourTurn else g.turnOf(nameOf(members, it.turn!!, me, g.me)), if (it.turn == me) "me" else "gray"))
                    it.people.size == 1 -> add(Badge(if (it.people[0] == me) g.toYou else nameOf(members, it.people[0], me, g.me), if (it.people[0] == me) "me" else "amber"))
                    else -> add(Badge(g.toAll, "blue"))
                }
                GroupMode.Goal -> Unit
            }
        }
        val doneText = if (it.doneBy.isNotEmpty()) g.doneBy(it.doneBy.joinToString(", ") { id -> nameOf(members, id, me, g.me) }) else null
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                it.mode == GroupMode.Event -> Box(Modifier.size(Dim.tap), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(4.dp, 22.dp).background(p.outside, RoundedCornerShape(2.dp)))
                }
                canMark && onToggle != null -> Box(
                    Modifier.size(Dim.tap).pressable(role = Role.Checkbox, onClick = onToggle).semantics {
                        contentDescription = if (it.done) t.todo.uncheck(it.title) else t.todo.check(it.title)
                        selected = it.done
                    },
                    contentAlignment = Alignment.Center,
                ) { CheckCircle(it.done) }
                // Не моё: кружок только показывает, сделано ли.
                else -> Box(Modifier.size(Dim.tap).clearAndSetSemantics {}, contentAlignment = Alignment.Center) { CheckCircle(it.done, ghost = !it.done) }
            }
            Column(Modifier.weight(1f).heightIn(min = 52.dp).pressable(onClick = onOpen).padding(start = 4.dp, end = 14.dp, top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.Center) {
                Text(it.title, style = onest(16, color = if (it.done) p.muted else p.text, lineHeight = 21.sp))
                if (it.time != null || badges.isNotEmpty() || doneText != null) {
                    Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        it.time?.let { tm -> Text(tm, style = onest(13, 700, p.accent)) }
                        badges.forEach { b -> BadgeChip(b) }
                        doneText?.let { d -> Text(d, style = onest(13, color = p.muted)) }
                    }
                }
            }
        }
    }
    if (ask) {
        Sheet("«${it.title}»", onClose = { ask = false }) {
            Text(t.swipe.sharedHint, style = onest(14, color = p.muted), modifier = Modifier.padding(horizontal = 4.dp))
            Box(Modifier.padding(top = 14.dp).fillMaxWidth().heightIn(min = Dim.tap).pressable {
                ask = false
                model.removeGroupItem(groupId, it, day)
            }.background(p.bg, RoundedCornerShape(Dim.radiusBtn)), contentAlignment = Alignment.Center) { Text(t.swipe.onlyToday, style = onest(16, 700, p.text)) }
            Box(Modifier.padding(top = 8.dp).fillMaxWidth().heightIn(min = Dim.tap).pressable {
                ask = false
                removeAll()
            }.background(p.danger, RoundedCornerShape(Dim.radiusBtn)), contentAlignment = Alignment.Center) { Text(t.swipe.forAll, style = onest(16, 700, p.dangerText)) }
        }
    }
}

@Composable
private fun BadgeChip(b: Badge) {
    val p = LocalPalette.current
    val (bg, fg) = when (b.tone) {
        "me" -> p.accentSoft to p.accentSoftText
        "amber" -> Color(0x33D9A441) to (if (p.isDark) Color(0xFFE8C98A) else Color(0xFF6E4F0E))
        "blue" -> p.outside.copy(alpha = 0.16f) to p.outside
        else -> p.heat[0] to p.muted
    }
    Box(Modifier.background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp)) { Text(b.text, style = onest(12, 600, fg)) }
}

/** Кружок-галочка (.todo-check): сделано — залит; ghost — чужое несделанное, бледный. */
@Composable
fun CheckCircle(done: Boolean, ghost: Boolean = false) {
    val p = LocalPalette.current
    Box(
        Modifier.size(24.dp).then(if (done) Modifier.background(p.accent, CircleShape) else Modifier.border(2.dp, if (ghost) p.line else p.muted, CircleShape)),
        contentAlignment = Alignment.Center,
    ) { if (done) StrokeGlyph(Glyph.CHECK, p.accentText, 16.dp, 3f) }
}

/** Блоки групп (дизайн 16B): мои дела каждой группы под личным; заголовок ведёт в группу. */
@Composable
fun GroupBlocks(model: AppModel, groups: List<GroupToday>, day: String, canMark: Boolean = true) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    groups.forEach { group ->
        val items = Groups.todayOrder(group.items)
        if (items.isEmpty()) return@forEach
        key(group.id) {
            Column(Modifier.padding(top = 16.dp)) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 40.dp).pressable { model.open(Route.Group(group.id)) }.padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(group.title, style = onest(15, 700, p.text))
                    AvatarStack(group.members, 22.dp)
                    Box(Modifier.weight(1f))
                    if (group.planned > 0) Text(t.gr.progress(group.done, group.planned), style = onest(13, color = p.muted))
                    StrokeGlyph(Glyph.CHEVRON, p.muted, 18.dp, 2.2f)
                }
                Card {
                    items.forEachIndexed { i, it ->
                        key(it.id) {
                            if (i > 0) RowDivider()
                            GroupItemRow(
                                model, group.id, it, group.members, day,
                                canMark = canMark && it.canMark,
                                onToggle = { model.toggleGroupItem(group.id, it, day) },
                                onOpen = { model.open(Route.Group(group.id)) },
                                onPut = { model.open(Route.Group(group.id)) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Сообщение об ошибке удаления группового дела: «только админы» или общее. */
fun removalError(e: ApiError, t: app.lifecommit.core.Strings) = if (e.code == "admins_only") t.swipe.notAllowed else t.error
