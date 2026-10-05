// Вкладка «Календарь» — как src/screens/Calendar.tsx: день или месяц (точки — несделанные дела дня), ниже — дела выбранного
// дня; повторяющиеся (из календаря телефона) стоят в каждом своём дне со своей отметкой. Подключённые календари — фишки
// под шапкой и шторка «Календари». Дела групп в дне — вместе с разделом «Вместе».
package app.lifecommit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.lifecommit.AppModel
import app.lifecommit.core.CalMode
import app.lifecommit.core.CalendarAccounts
import app.lifecommit.core.Months
import app.lifecommit.core.TodoSource

private const val BANNER_KEY = "lc-cal-banner-hidden"

@Composable
fun CalendarScreen(model: AppModel, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val cal = model.calendar
    val today = model.today.day
    LaunchedEffect(Unit) { cal.open() }
    val selected = cal.selected.ifEmpty { today }
    var bannerHidden by remember { mutableStateOf(model.prefs.bool(BANNER_KEY)) }
    val accounts = cal.accounts

    Screen(withTabs = true, modifier = Modifier.testTag("calendar")) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 24.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t.calendar, style = onest(30, 700, p.text, tracking = -0.02f), modifier = Modifier.weight(1f).semantics { heading() })
                if (!accounts.isNullOrEmpty()) {
                    HeadButton(Glyph.REFRESH, t.cal.refresh, enabled = !cal.syncing) { cal.syncNow() }
                    Spacer(Modifier.size(8.dp))
                }
                HeadButton(Glyph.SETTINGS, t.cal.sheetTitle) { cal.sheetOpen = true }
            }
        }
        if (accounts != null && accounts.isEmpty() && !bannerHidden) item {
            Box(Modifier.padding(top = 14.dp).fillMaxWidth().background(p.accentSoft, RoundedCornerShape(Dim.radius))) {
                Row(Modifier.padding(start = 16.dp, end = 40.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(t.cal.connectTitle, style = onest(15, 600, p.text))
                        Text(t.cal.connectHint, style = onest(13, color = p.muted))
                    }
                    // .cal-banner .act — кнопка поменьше: высота 40, шрифт 14.
                    PrimaryButton(t.cal.connect, small = true) { cal.sheetOpen = true }
                }
                Box(
                    Modifier.align(Alignment.TopEnd).size(36.dp).pressable(label = t.cancel) {
                        bannerHidden = true
                        model.prefs.setBool(BANNER_KEY, true)
                    }.semantics { contentDescription = t.cancel },
                    contentAlignment = Alignment.Center,
                ) { Text("×", style = onest(20, color = p.muted)) }
            }
        }
        if (!accounts.isNullOrEmpty()) item {
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                accounts.forEach { a ->
                    val bad = a.status == "auth_failed" || a.status == "error"
                    Row(
                        Modifier.heightIn(min = 32.dp).glass(12.dp).pressable { if (a.status == "ok") cal.syncNow() else cal.sheetOpen = true }.padding(start = 6.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        SourceMark(a.provider)
                        Text(
                            when {
                                a.status == "ok" -> CalendarAccounts.syncedLabel(t, a.lastSyncAt)
                                a.status == "setup" -> t.cal.googleSetup
                                a.provider == TodoSource.Apple -> t.cal.newPassword
                                else -> t.cal.reconnect
                            },
                            style = onest(13, 500, if (bad) p.warn else p.text),
                        )
                    }
                }
            }
        }
        item {
            Row(Modifier.padding(top = 14.dp).fillMaxWidth().background(p.heat[0], RoundedCornerShape(16.dp)).padding(4.dp).semantics { contentDescription = t.calendar }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((m, label) in listOf(CalMode.Day to t.day, CalMode.Month to t.month)) {
                    val on = cal.mode == m
                    Box(
                        Modifier.weight(1f).heightIn(min = 44.dp).pressable(role = Role.RadioButton) { cal.switchMode(m) }
                            .background(if (on) p.surface else Color.Transparent, RoundedCornerShape(12.dp)).semantics { this.selected = on },
                        contentAlignment = Alignment.Center,
                    ) { Text(label, style = onest(13, if (on) 600 else 500, p.text)) }
                }
            }
        }
        item {
            val dayMode = cal.mode == CalMode.Day
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                NavArrow("‹", if (dayMode) t.prevDay else t.prevMonth) { cal.shift(-1) }
                Text(
                    if (dayMode) t.weekdayLong(selected).replaceFirstChar { it.titlecase(t.locale) } else t.monthYear(Months.of(selected)),
                    style = onest(15, 600, p.text),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).testTag("calTitle"),
                )
                NavArrow("›", if (dayMode) t.nextDay else t.nextMonth) { cal.shift(1) }
            }
            // Место под «К сегодня» есть всегда: появилась ссылка — список не съезжает.
            if (dayMode) {
                Box(Modifier.fillMaxWidth().alpha(if (selected == today) 0f else 1f), contentAlignment = Alignment.Center) {
                    Box(Modifier.heightIn(min = 32.dp).pressable(enabled = selected != today) { cal.select(today) }, contentAlignment = Alignment.Center) {
                        Text(t.backToToday, style = onest(14, 500, p.muted))
                    }
                }
            }
        }
        if (cal.mode == CalMode.Month) item { MonthGrid(model, selected, today) }
        cal.error?.let { e -> item { ErrorNote(e, Modifier.padding(top = 12.dp)) { cal.error = null } } }
        if (cal.todos != null) item {
            TodoListCard(
                model = model,
                todos = cal.ofDay(selected),
                today = today,
                day = selected,
                actions = model.calendarTodos,
                links = links,
                heading = if (cal.mode == CalMode.Day) null else t.weekdayLong(selected),
                addLabel = t.calAdd,
                showCarry = false,
                canAdd = selected >= today,
            )
        }
        // Дела групп в этот день: отметить можно сегодня и в прошлые дни, будущие — только посмотреть.
        item {
            GroupBlocks(
                model,
                cal.groupsOfDay(selected).map { b -> app.lifecommit.core.GroupToday(b.group.id, b.group.title, b.group.kind, members = b.group.members, items = b.items) },
                selected,
                canMark = selected <= today,
            )
        }
    }
    if (cal.sheetOpen) CalendarsSheet(cal, links) {
        cal.sheetOpen = false
        cal.googleReturn = null
    }
}

@Composable
private fun HeadButton(glyph: String, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(44.dp).glass(14.dp).alpha(if (enabled) 1f else 0.4f).pressable(enabled = enabled, label = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { StrokeGlyph(glyph, p.muted, 20.dp) }
}

@Composable
private fun NavArrow(sign: String, label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.size(40.dp, 44.dp).pressable(label = label, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Text(sign, style = onest(22, color = p.muted))
    }
}

/** Метка «откуда пришло»: G — Google, A — Apple (.src-mark). */
@Composable
fun SourceMark(source: TodoSource) {
    val p = LocalPalette.current
    val google = source == TodoSource.Google
    Box(
        Modifier.size(20.dp).background(if (google) p.outside.copy(alpha = 0.16f) else p.heat[0], RoundedCornerShape(6.dp)).semantics { contentDescription = if (google) "Google" else "Apple" },
        contentAlignment = Alignment.Center,
    ) { Text(if (google) "G" else "A", style = onest(11, 700, if (google) p.outside else p.text)) }
}

/** Месяц целыми неделями: число, до трёх точек несделанных дел (синие — из календаря), выбранный день — зелёный. */
@Composable
private fun MonthGrid(model: AppModel, selected: String, today: String) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val cal = model.calendar
    val month = Months.of(selected)
    Column(Modifier.padding(top = 4.dp).semantics { contentDescription = t.monthYear(month) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            t.weekdaysShort.forEach { Text(it, style = onest(11, 600, p.muted), textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
        }
        cal.days.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                week.forEach { day ->
                    val on = day == selected
                    val out = Months.of(day) != month
                    val open = cal.ofDay(day).filter { !it.done && !model.isRemoved("todo:${it.id}") }
                    Column(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp)
                            .alpha(if (out) 0.4f else 1f)
                            .background(if (on) p.accent else p.surface.copy(alpha = if (out) 0.3f else 0.72f), RoundedCornerShape(14.dp))
                            .pressable(role = Role.Tab, label = t.dayMonth(day)) { cal.select(day) }
                            .semantics { this.selected = on; contentDescription = t.dayMonth(day) }
                            .padding(top = 5.dp, bottom = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Text(
                            day.takeLast(2).trimStart('0'),
                            style = onest(14, if (day == today) 700 else 500, when {
                                on -> p.accentText
                                day == today -> p.accent
                                else -> p.text
                            }),
                        )
                        Row(Modifier.height(5.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            open.take(3).forEach { d ->
                                Box(Modifier.size(5.dp).background(if (on) p.accentText else if (d.source != null) p.outside else p.heat[3], CircleShape))
                            }
                        }
                    }
                }
            }
        }
    }
}
