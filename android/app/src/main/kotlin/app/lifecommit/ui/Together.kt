// Вкладка «Вместе» — как src/screens/Groups.tsx (дизайн 16A, друзья 24B′): «Группы · Друзья»; группы — с прогрессом дня
// и «Новая группа» (16Q); друзья — Friends.kt. Последний выбор помним на устройстве.
package app.lifecommit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.rememberTextFieldState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.core.ApiError
import app.lifecommit.core.GroupMode
import app.lifecommit.core.Groups
import kotlinx.coroutines.launch

@Composable
fun Together(model: AppModel, links: Links) {
    val t = LocalStrings.current
    val tg = model.together
    // Список обновляется вместе с «Сегодня»; первым кадром — группы из «Сегодня», свежее — следом.
    LaunchedEffect(Unit) { tg.loadList() }
    var creating by remember { mutableStateOf(false) }
    Screen(withTabs = true, modifier = Modifier.testTag("together")) {
        item { PageHead(t.groups) }
        item { Segmented(listOf(t.fr.tabGroups to !model.togetherFriends, t.fr.tabFriends to model.togetherFriends), Modifier.padding(top = 14.dp)) { model.showFriends(it == 1) } }
        if (model.togetherFriends) {
            item { FriendsPanel(model, links) }
        } else {
            val list = tg.list ?: model.today.groups
            if (tg.list != null && list.isEmpty()) item { EmptyNote(t.gr.empty) }
            list.forEach { group ->
                item(key = "g${group.id}") { GroupCard(model, group) }
            }
            item {
                Row(
                    Modifier.padding(top = 12.dp).fillMaxWidth().heightIn(min = 56.dp)
                        .border(1.5.dp, LocalPalette.current.line, RoundedCornerShape(Dim.radius))
                        .pressable { creating = true }.testTag("newGroup"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    StrokeGlyph(Glyph.PLUS, LocalPalette.current.muted, 18.dp, 2.4f)
                    Text(t.gr.newGroup, style = onest(15, 600, LocalPalette.current.muted))
                }
            }
        }
    }
    if (creating) NewGroupSheet(model, onClose = { creating = false })
}

/** Сегмент из двух-трёх кнопок (.segmented): выбранная — белая. */
@Composable
fun Segmented(options: List<Pair<String, Boolean>>, modifier: Modifier = Modifier, onPick: (Int) -> Unit) {
    val p = LocalPalette.current
    Row(modifier.fillMaxWidth().background(p.heat[0], RoundedCornerShape(16.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEachIndexed { i, (label, on) ->
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).pressable(role = Role.Tab) { onPick(i) }
                    .background(if (on) p.surface else Color.Transparent, RoundedCornerShape(12.dp)).semantics { selected = on },
                contentAlignment = Alignment.Center,
            ) { Text(label, style = onest(13, if (on) 600 else 500, p.text)) }
        }
    }
}

@Composable
private fun GroupCard(model: AppModel, group: app.lifecommit.core.GroupToday) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val me = model.user?.id ?: 0
    val mine = Groups.forYou(group, me)
    val goal = group.items.firstOrNull { it.mode == GroupMode.Goal }
    Column(
        Modifier.padding(top = 12.dp).fillMaxWidth().glass().pressable { model.open(Route.Group(group.id)) }.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GroupBadge(group.id, group.title)
            Column(Modifier.weight(1f)) {
                Text(group.title, style = onest(17, 600, p.text))
                Text(t.gr.people(group.members.size), style = onest(13, color = p.muted))
            }
            AvatarStack(group.members)
        }
        if (group.planned > 0) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(p.heat[0])) {
                    Box(Modifier.fillMaxWidth(group.done.toFloat() / group.planned).height(6.dp).background(p.heat[3]))
                }
                Text(t.gr.progress(group.done, group.planned), style = onest(13, 700, p.text))
            }
        }
        if (goal?.target != null) Text(t.gr.goalOf("${goal.title}: ${t.num(goal.total ?: 0.0)}", t.num(goal.target!!)), style = onest(13, color = p.muted))
        if (mine != null) Text(t.gr.forYou(mine.title), style = onest(13, color = p.muted))
    }
}

/** Новая группа: только название — тип не нужен, значок и цвет берутся из самой группы. */
@Composable
private fun NewGroupSheet(model: AppModel, onClose: () -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val title = rememberTextFieldState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    Sheet(t.gr.newGroup, onClose) {
        SheetInput(title, t.gr.namePh, 60, "groupName", t.gr.namePh)
        if (error) ErrorNote(t.error, Modifier.padding(top = 10.dp))
        PrimaryButton(t.gr.create, Modifier.padding(top = 14.dp).testTag("createGroup"), wide = true, enabled = title.text.isNotBlank() && !busy, busy = busy) {
            busy = true
            error = false
            scope.launch {
                try {
                    val id = model.together.create(title.text.toString())
                    onClose()
                    model.open(Route.Group(id))
                } catch (e: ApiError) {
                    if (e.isSignedOut) model.signOutLocally()
                    error = true
                    busy = false
                }
            }
        }
    }
}
