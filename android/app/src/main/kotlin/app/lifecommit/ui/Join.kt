// Вступление по приглашению — как src/screens/Join.tsx (дизайн 16R): кто зовёт, что будет, что группа НЕ видит.
// Открывается ссылкой lifecommit.app/j/<код> (App Link) или lifecommit://join/<код> со страницы приглашения.
package app.lifecommit.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.core.ApiError
import app.lifecommit.core.GroupMember
import app.lifecommit.core.Invitation
import kotlinx.coroutines.launch

@Composable
fun JoinScreen(model: AppModel, code: String) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val j = t.gr.join
    val scope = rememberCoroutineScope()
    var inv by remember { mutableStateOf<Invitation?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(code) {
        try {
            inv = model.together.invitation(code)
        } catch (e: ApiError) {
            if (e.isSignedOut) return@LaunchedEffect model.signOutLocally()
            problem = if (e.code == "invite_expired") j.expired else j.notFound
        }
    }
    val openGroup = { id: Long ->
        model.backToMain()
        model.tab = app.lifecommit.Tab.Groups
        model.open(Route.Group(id))
    }
    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        problem?.let { msg ->
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).testTag("join"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)) {
                Text(msg, style = onest(16, color = p.muted), textAlign = TextAlign.Center)
                PrimaryButton(j.later) { model.back() }
            }
            return@Box
        }
        val i = inv ?: return@Box
        Screen(withTabs = false, modifier = Modifier.testTag("join")) {
            item { BackPill(model::back) }
            item {
                Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    GroupBadge(i.group.id, i.group.title, 96.dp)
                    Text(i.inviter?.let(j.invites) ?: j.invitesAnon, style = onest(15, color = p.muted))
                    Text(i.group.title, style = onest(28, 700, p.text), textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AvatarStack(i.members.take(4).map { GroupMember(it.id, it.name) }, 28.dp)
                        Text(i.members.joinToString(", ") { it.name }, style = onest(14, color = p.muted))
                    }
                }
            }
            item { SectionLabel(j.what, Modifier.padding(start = 4.dp, top = 24.dp, bottom = 8.dp)) }
            item {
                Card {
                    val glyphs = listOf(Glyph.CHECK, Glyph.TELEGRAM, "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v10h-13z")
                    j.points.forEachIndexed { n, (title, sub) ->
                        if (n > 0) RowDivider()
                        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            StrokeGlyph(glyphs[n], p.accent, 22.dp, 2.2f)
                            Column {
                                Text(title, style = onest(16, color = p.text))
                                Text(sub, style = onest(13, color = p.muted))
                            }
                        }
                    }
                }
            }
            item {
                if (i.member) {
                    PrimaryButton(j.open, Modifier.padding(top = 16.dp), wide = true) { openGroup(i.group.id) }
                } else {
                    PrimaryButton(j.btn, Modifier.padding(top = 16.dp).testTag("joinGroup"), wide = true, enabled = !busy, busy = busy) {
                        busy = true
                        scope.launch {
                            try {
                                openGroup(model.together.join(code))
                            } catch (e: ApiError) {
                                if (e.isSignedOut) return@launch model.signOutLocally()
                                problem = j.notFound
                            }
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) { QuietLink(if (i.member) j.already else j.later, p.muted) { model.back() } }
            }
        }
    }
}
