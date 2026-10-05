// Экран привычки — как src/screens/TaskDetail.tsx: отметка за сегодня, ключевые числа, календарь месяца с отметками
// задним числом, у «считать» — столбики за две недели. Расчёты — HabitDetail в core.
package app.lifecommit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.core.AbstainStatus
import app.lifecommit.core.HabitDetail
import app.lifecommit.core.HabitDetail.Cell
import app.lifecommit.core.Months
import app.lifecommit.core.Stats
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayTask
import app.lifecommit.core.cleanDays

@Composable
fun TaskDetail(model: AppModel, id: Long) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val task = model.today.tasks.firstOrNull { it.id == id }
    // Привычки уже нет (удалили, отложили) — экран закрывается.
    if (task == null) {
        LaunchedEffect(Unit) { model.back() }
        return
    }
    val today = model.today.day
    LaunchedEffect(id) { model.loadHistory(id) }
    var month by rememberSaveable { mutableStateOf(Months.of(today)) }
    var marking by remember { mutableStateOf<String?>(null) }
    val history = model.histories[id]
    val detail = HabitDetail.make(task, history, today, month, t)
    val logs = HabitDetail.logs(task, history, today)

    Box {
        GlowBackground()
        Screen(withTabs = false, modifier = Modifier.testTag("detail")) {
            item { BackPill(model::back) }
            item {
                Row(Modifier.padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    KindTile(task.kind, task.title, TileSize.Lg)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(task.title, style = onest(26, 700, p.text, lineHeight = 30.sp, tracking = -0.02f), modifier = Modifier.semantics { heading() })
                        Text(detail.subtitle, style = onest(14, color = p.muted, lineHeight = 18.sp))
                    }
                    Box(
                        Modifier.size(44.dp).glass(14.dp).pressable(label = t.editTask) { model.open(Route.EditTask(id)) }.semantics { contentDescription = t.editTask },
                        contentAlignment = Alignment.Center,
                    ) { StrokeGlyph(Glyph.PENCIL, p.muted, 20.dp) }
                }
            }
            model.banner?.let { b -> item { ErrorNote(b, Modifier.padding(top = 12.dp)) { model.banner = null } } }
            item { TodayBlock(task) { value, status -> model.log(task, value, status) } }
            if (task.kind == TaskKind.Abstain) item {
                Card(Modifier.padding(top = 16.dp), padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(t.num(task.cleanDays), style = onest(44, 700, p.accent, lineHeight = 48.sp, tracking = -0.02f))
                        Text(t.cleanDaysWord(task.cleanDays), style = onest(16, color = p.muted), modifier = Modifier.padding(bottom = 8.dp))
                    }
                }
            }
            item {
                Card(Modifier.padding(top = 16.dp), padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        detail.stats.forEachIndexed { i, s ->
                            Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                val ink = if (i == 0 && task.kind != TaskKind.Abstain) p.kind(task.kind).ink else p.text
                                Text(s.value, style = onest(22, 700, ink, lineHeight = 26.sp))
                                Text(s.label, style = onest(13, color = p.muted, lineHeight = 17.sp))
                            }
                        }
                    }
                }
            }
            item { MonthCard(detail, month, today, onMonth = { month = it }, onDay = { marking = it }) }
            if (task.kind == TaskKind.Count) item { TwoWeeks(Stats.lastDays(logs, today, 14), task.target) }
        }
    }

    marking?.let { day ->
        Sheet(t.weekdayLong(day), onClose = { marking = null }) {
            Text(task.title, style = onest(15, color = p.muted), modifier = Modifier.padding(start = 4.dp, bottom = 14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton(if (task.kind == TaskKind.Abstain) t.markClean else t.markDone, Modifier.weight(1f), wide = true) {
                    marking = null
                    model.markDay(task, day, true)
                }
                Box(
                    Modifier.weight(1f).heightIn(min = Dim.tap).pressable {
                        marking = null
                        model.markDay(task, day, false)
                    }.background(p.warnSoft, RoundedCornerShape(Dim.radiusBtn)),
                    contentAlignment = Alignment.Center,
                ) { Text(if (task.kind == TaskKind.Abstain) t.markSlip else t.markNotDone, style = onest(16, 700, p.warn)) }
            }
            val start = history?.start ?: today
            if (logs.any { it.day == day } && !(task.kind == TaskKind.Abstain && day < start)) {
                Box(Modifier.fillMaxWidth().padding(top = 12.dp), contentAlignment = Alignment.Center) {
                    QuietLink(t.markClear, p.muted) {
                        marking = null
                        model.markDay(task, day, null)
                    }
                }
            }
        }
    }
}

/** Блок «сегодня»: отметить привычку можно прямо с её экрана (.today-block). */
@Composable
private fun TodayBlock(task: TodayTask, onLog: (Double?, AbstainStatus?) -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var editing by remember(task.id) { mutableStateOf(false) }
    Card(Modifier.padding(top = 16.dp), padding = androidx.compose.foundation.layout.PaddingValues(start = 18.dp, end = 12.dp, top = 12.dp, bottom = if (task.kind == TaskKind.Count) 14.dp else 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (task.kind == TaskKind.Abstain) t.didIt else t.today, style = onest(17, 600, p.text))
                if (task.kind == TaskKind.Count) CountValue(task, editing, onEditing = { editing = it }, onLog = onLog)
            }
            when (task.kind) {
                TaskKind.Abstain -> {
                    val pick = { s: AbstainStatus -> onLog(null, if (task.status == s) null else s) }
                    val state = { s: AbstainStatus -> if (task.status == s) RbState.On else if (task.status != null) RbState.Dim else RbState.Off }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RoundBtn(RbKind.No, state(AbstainStatus.Slip), t.answerNo) { pick(AbstainStatus.Slip) }
                        RoundBtn(RbKind.Ok, state(AbstainStatus.Clean), t.answerYes) { pick(AbstainStatus.Clean) }
                    }
                }
                TaskKind.Check -> DoneButton(task, onLog)
                TaskKind.Count -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RoundBtn(RbKind.Edit, RbState.Off, "${task.title}: ${t.enterValue}") { editing = true }
                    DoneButton(task, onLog)
                }
            }
        }
        if (task.kind == TaskKind.Count) {
            Spacer(Modifier.height(8.dp))
            Box(Modifier.padding(end = 6.dp)) { Progress(task) }
        }
    }
}

/** Календарь месяца (.hcal): прошедший день можно нажать и отметить задним числом. */
@Composable
private fun MonthCard(detail: HabitDetail, month: String, today: String, onMonth: (String) -> Unit, onDay: (String) -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val grid = Months.cells(month)
    Card(Modifier.padding(top = 16.dp), padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            MonthArrow("‹", t.prevMonth, enabled = month > detail.oldestMonth) { onMonth(Months.shift(month, -1)) }
            Text(t.monthYear(month), style = onest(15, 600, p.text), textAlign = TextAlign.Center, modifier = Modifier.weight(1f).testTag("month"))
            MonthArrow("›", t.nextMonth, enabled = month < Months.of(today)) { onMonth(Months.shift(month, 1)) }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            t.weekdaysShort.forEach { Text(it, style = onest(12, color = p.muted), textAlign = TextAlign.Center, modifier = Modifier.weight(1f).clearAndSetSemantics {}) }
        }
        val slots: List<String?> = List(grid.lead) { null } + grid.days
        slots.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth().padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                for (i in 0 until 7) {
                    val day = week.getOrNull(i)
                    Box(Modifier.weight(1f).height(34.dp)) {
                        if (day != null) DayCell(day, detail.cells[day] ?: Cell.Off, isToday = day == today, clickable = detail.markable && day <= today) { onDay(day) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthArrow(sign: String, label: String, enabled: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(40.dp, 44.dp).alpha(if (enabled) 1f else 0f).pressable(enabled = enabled, label = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(sign, style = onest(22, color = p.muted)) }
}

@Composable
private fun DayCell(day: String, cell: Cell, isToday: Boolean, clickable: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val (bg, ink, outline) = when (cell) {
        Cell.Plan -> Triple(Color.Transparent, p.text, p.line)
        Cell.Some -> Triple(p.heat[1], p.text, null)
        Cell.Half, Cell.Clean -> Triple(p.heat[2], p.text, null)
        Cell.Full -> Triple(p.heat[3], p.accentText, null)
        Cell.Slip -> Triple(p.warnSoft, p.warn, null)
        Cell.Off -> Triple(Color.Transparent, p.muted, null)
    }
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .fillMaxHeight()
            .then(if (isToday) Modifier.border(2.dp, p.text, RoundedCornerShape(12.dp)).padding(3.dp) else Modifier)
            .then(if (clickable) Modifier.pressable(label = t.dayMonth(day), onClick = onClick) else Modifier)
            .background(bg, shape)
            .then(if (outline != null) Modifier.border(1.5.dp, outline, shape) else Modifier)
            .semantics { contentDescription = t.dayMonth(day) },
        contentAlignment = Alignment.Center,
    ) { Text(day.takeLast(2).trimStart('0'), style = onest(13, 500, ink)) }
}

/** Столбики за две недели с линией цели: тёмные — цель достигнута. */
@Composable
private fun TwoWeeks(days: List<Pair<String, Double>>, goal: Double) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val colors = p.kind(TaskKind.Count)
    val max = maxOf(goal, days.maxOfOrNull { it.second } ?: 0.0) * 1.08
    var heightPx by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    Card(Modifier.padding(top = 16.dp).clearAndSetSemantics {}, padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
        Text(t.twoWeeks, style = onest(15, 600, p.text), modifier = Modifier.padding(bottom = 10.dp))
        Box(Modifier.fillMaxWidth().height(96.dp).onSizeChanged { heightPx = it.height }) {
            Row(Modifier.fillMaxWidth().fillMaxHeight(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                days.forEach { (_, v) ->
                    Box(
                        Modifier.weight(1f).fillMaxHeight(maxOf(0.03f, (v / max).toFloat()))
                            .background(if (v >= goal) colors.ink else colors.mid, RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp, bottomStart = 2.dp, bottomEnd = 2.dp)),
                    )
                }
            }
            val goalY = with(density) { (heightPx * (1 - goal / max)).toFloat().toDp() }
            Box(Modifier.fillMaxWidth().offset(y = goalY).height(1.5.dp).background(p.muted.copy(alpha = 0.7f)))
            Text("${t.goalShort} ${t.num(goal)}", style = onest(11, color = p.muted), modifier = Modifier.align(Alignment.TopEnd).offset(y = goalY - 16.dp))
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(days.first().first.takeLast(2).trimStart('0'), style = onest(12, color = p.muted))
            Text(days.last().first.takeLast(2).trimStart('0'), style = onest(12, color = p.muted))
        }
    }
}

