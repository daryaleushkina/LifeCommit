// «Сегодня» — как src/screens/Today.tsx: дела на день сверху, привычки ниже (несделанные сверху), не на сегодня —
// отдельно, «Добавить привычку», «Отложенные · N». Карточки — TaskCard.tsx, дела — TodoList.tsx.
package app.lifecommit.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.maxLength
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.core.AbstainStatus
import app.lifecommit.core.Schedule
import app.lifecommit.core.TaskKind
import app.lifecommit.core.Todo
import app.lifecommit.core.TodayTask
import app.lifecommit.core.Todos
import app.lifecommit.core.canAddTask
import app.lifecommit.core.cleanDays
import app.lifecommit.core.dueOrdered
import app.lifecommit.core.isDone
import app.lifecommit.core.notDue
import kotlinx.coroutines.delay
import java.time.ZonedDateTime

@Composable
fun Today(model: AppModel, links: Links) {
    val t = LocalStrings.current
    val data = model.today
    val swipe = { task: TodayTask -> listOf(SwipeAction(t.swipe.remove, danger = true) { model.removeTask(task) }) }
    val due = data.dueOrdered.filter { !model.isRemoved("task:${it.id}") }
    val notDue = data.notDue.filter { !model.isRemoved("task:${it.id}") }
    Screen(withTabs = true, modifier = Modifier.testTag("today")) {
        item { PageHead(t.today, t.longDate(data.day)) }
        model.banner?.let { banner -> item { ErrorNote(banner, Modifier.padding(top = 12.dp)) { model.banner = null } } }

        // Разовые дела — над привычками: их обычно надо сделать сегодня и один раз.
        item { TodoBlock(model, links) }

        item { SectionLabel(t.habits, Modifier.padding(start = 4.dp, end = 4.dp, top = 24.dp, bottom = 8.dp)) }
        if (due.isEmpty()) {
            item { EmptyNote(t.nothingDue) }
        } else {
            items(due, key = { "task:${it.id}" }) { task ->
                SwipeRow(swipe(task), card = true, modifier = Modifier.padding(bottom = 10.dp)) {
                    TaskCard(task, onLog = { value, status -> model.log(task, value, status) }, onOpen = { model.open(Route.Detail(task.id)) })
                }
            }
        }
        // Не на сегодня — без кнопки, но открыть и поправить можно.
        if (notDue.isNotEmpty()) {
            item { Spacer(Modifier.height(14.dp)) }
            items(notDue, key = { "later:${it.id}" }) { task ->
                SwipeRow(swipe(task), card = true, modifier = Modifier.padding(bottom = 10.dp)) { NotDueCard(task) { model.open(Route.Detail(task.id)) } }
            }
        }
        item {
            if (data.canAddTask) {
                LinkButton(t.addTask, plus = true) { model.open(Route.Pick) }
            } else {
                Text(t.limitReached(data.limits.maxTasks ?: 0), style = onest(14, color = LocalPalette.current.muted), modifier = Modifier.padding(top = 12.dp, start = 4.dp))
            }
        }
        if (data.archived.isNotEmpty()) item { LinkButton(t.archivedLink(data.archived.size)) { model.open(Route.Archive) } }
    }
}

/** Карточка привычки (.task): плитка, название, кнопки отметки; у «считать» — полоса прогресса. */
@Composable
fun TaskCard(task: TodayTask, onLog: (Double?, AbstainStatus?) -> Unit, onOpen: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val done = task.isDone
    var editing by remember(task.id) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).glass().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = if (task.kind == TaskKind.Count) 14.dp else 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.heightIn(min = 48.dp)) {
            KindTile(task.kind, task.title)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    task.title,
                    style = onest(16, 500, if (done) p.muted else p.text, lineHeight = 22.sp),
                    modifier = Modifier.pressable(onClick = onOpen),
                )
                when (task.kind) {
                    TaskKind.Abstain -> Text(
                        if (task.status == null) t.didItShort else t.cleanDays(task.cleanDays),
                        style = onest(14, color = p.muted, lineHeight = 18.sp),
                    )
                    TaskKind.Count -> CountValue(task, editing, onEditing = { editing = it }, onLog = onLog)
                    TaskKind.Check -> Unit
                }
            }
            when (task.kind) {
                TaskKind.Abstain -> {
                    // Повторный тап по выбранному снимает ответ.
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
            Progress(task)
        }
    }
}

@Composable
internal fun DoneButton(task: TodayTask, onLog: (Double?, AbstainStatus?) -> Unit) {
    val t = LocalStrings.current
    val done = task.isDone
    val full = if (task.kind == TaskKind.Count) task.target else 1.0
    // Подпись не просто название: рядом кнопка-название (открыть привычку), диктору их не различить.
    RoundBtn(RbKind.Ok, if (done) RbState.On else RbState.Off, "${task.title} — ${t.markDone.lowercase(t.locale)}") { onLog(if (done) null else full, null) }
}

enum class RbKind { Ok, No, Edit }
enum class RbState { Off, On, Dim }

/** Круглая кнопка отметки (.rb): всегда в своём цвете; выбранная заливается, вторая гаснет. */
@Composable
fun RoundBtn(kind: RbKind, state: RbState, label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    val (bg, ink) = when {
        state == RbState.Dim -> p.heat[0] to p.muted
        kind == RbKind.Ok -> if (state == RbState.On) p.accent to p.accentText else p.accentSoft to p.accent
        kind == RbKind.No -> if (state == RbState.On) p.warn to p.warnText else p.warnSoft to p.warn
        else -> p.heat[0] to p.muted
    }
    Box(
        Modifier
            .size(48.dp)
            .alpha(if (state == RbState.Dim) 0.6f else 1f)
            .pressable(role = if (kind == RbKind.Edit) Role.Button else Role.Checkbox, onClick = onClick)
            .background(bg, CircleShape)
            .semantics {
                contentDescription = label
                if (kind != RbKind.Edit) selected = state == RbState.On
            },
        contentAlignment = Alignment.Center,
    ) {
        when (kind) {
            RbKind.Ok -> StrokeGlyph(Glyph.CHECK, ink, 24.dp, 3f)
            RbKind.No -> StrokeGlyph(Glyph.CROSS, ink, 24.dp, 3f)
            RbKind.Edit -> StrokeGlyph(Glyph.PENCIL, ink, 20.dp, 2f)
        }
    }
}

/** «Считать»: строка «12 из 20 страниц», которая по тапу превращается в поле ввода (только цифры). */
@Composable
internal fun CountValue(task: TodayTask, editing: Boolean, onEditing: (Boolean) -> Unit, onLog: (Double?, AbstainStatus?) -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val rest = " ${t.of} ${t.num(task.target)}${task.unit?.let { " $it" } ?: ""}"
    val label = "${task.title}: ${t.enterValue}"
    if (!editing) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = p.text, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)) { append(t.num(task.value)) }
                append(rest)
            },
            style = onest(14, color = p.muted, lineHeight = 18.sp),
            modifier = Modifier.heightIn(min = 28.dp).pressable(label = label) { onEditing(true) }.padding(end = 12.dp, top = 5.dp),
        )
        return
    }
    val draft = rememberTextFieldState(if (task.value > 0) plain(task.value) else "", initialSelection = TextRange(0, if (task.value > 0) plain(task.value).length else 0))
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    val commit = {
        onEditing(false)
        val text = draft.text.toString()
        if (text.isNotEmpty()) {
            val next = text.toDouble()
            if (next != task.value) onLog(if (next > 0) next else null, null)
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(Modifier.heightIn(min = 28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicTextField(
            draft,
            inputTransformation = DigitsOnly(6),
            lineLimits = TextFieldLineLimits.SingleLine,
            textStyle = onest(16, 700, p.text),
            cursorBrush = SolidColor(p.accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            onKeyboardAction = { commit() },
            modifier = Modifier
                .width(72.dp)
                .focusRequester(focus)
                .onFocusChanged {
                    if (focused && !it.isFocused) commit()
                    focused = it.isFocused
                }
                .background(p.bg, RoundedCornerShape(8.dp))
                .border(1.dp, p.accent, RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp, vertical = 2.dp)
                .semantics { contentDescription = label }
                .testTag("countInput"),
        )
        Text(rest.trim(), style = onest(14, color = p.muted))
    }
}

/** Полоса прогресса «считать» во всю ширину (.progress). */
@Composable
fun Progress(task: TodayTask) {
    val p = LocalPalette.current
    val share by animateFloatAsState(if (task.target > 0) (task.value / task.target).toFloat().coerceIn(0f, 1f) else 0f, tween(240), label = "progress")
    Box(Modifier.fillMaxWidth().padding(end = 4.dp).height(6.dp).background(p.heat[0], RoundedCornerShape(3.dp))) {
        Box(Modifier.fillMaxWidth(share).height(6.dp).background(p.heat[3], RoundedCornerShape(3.dp)))
    }
}

/** Не на сегодня: тихая карточка с расписанием, открыть и поправить можно. */
@Composable
private fun NotDueCard(task: TodayTask, onOpen: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Column(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).glass().pressable(onClick = onOpen).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Text(task.title, style = onest(16, 500, p.muted, lineHeight = 22.sp))
        Text(
            if (task.schedule == Schedule.PerWeek) t.perWeek(task.perWeek ?: 0) else t.schedules.getValue(task.schedule),
            style = onest(14, color = p.muted),
        )
    }
}

// Дела

private const val LEFT_KEY = "lc-todos-left"

/** Блок «Дела» на «Сегодня»: общий список дел и «Потом · N». */
@Composable
private fun TodoBlock(model: AppModel, links: Links) {
    val t = LocalStrings.current
    val data = model.today
    Column {
        TodoListCard(
            model = model,
            todos = data.todos,
            today = data.day,
            day = data.day,
            actions = model.todayTodos,
            links = links,
            filterable = true,
        )
        var laterOpen by remember { mutableStateOf(false) }
        if (data.todosLater > 0) LinkButton(t.todo.later(data.todosLater)) { laterOpen = true }
        if (laterOpen) LaterSheet(model, data.day) { laterOpen = false }
    }
}

/**
 * Список дел (TodoList.tsx) — на «Сегодня» и в «Календаре»: свои дела с кружком-галочкой, события из календаря без него,
 * строка для нового дела; тап по делу — шторка дела; свайп — «Удалить» (у событий ещё «Скрыть»).
 * heading — заголовок (в «Календаре» — выбранный день); showCarry — подписи «со вчера» (только «Сегодня»);
 * canAdd — можно ли добавлять (в прошедший день календаря — нет); filterable — «Все · Осталось» (только «Сегодня»).
 */
@Composable
fun TodoListCard(
    model: AppModel,
    todos: List<Todo>,
    today: String,
    day: String,
    actions: app.lifecommit.TodoActions,
    links: Links,
    heading: String? = null,
    addLabel: String? = null,
    showCarry: Boolean = true,
    canAdd: Boolean = true,
    filterable: Boolean = false,
) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val listed = todos.filter { !model.isRemoved("todo:${it.id}") }
    // «Только несделанные» — запоминается на этом устройстве (решение владелицы 02.10.2026), как тема.
    var onlyLeft by rememberSaveable { mutableStateOf(model.prefs.bool(LEFT_KEY)) }
    val canFilter = filterable && listed.any { it.source == null || it.time != null }
    var now by remember { mutableStateOf(ZonedDateTime.now()) }
    // Часы раз в минуту: закончившееся событие уходит из «Осталось», даже если экран не трогают.
    if (canFilter && onlyLeft && listed.any { it.source != null && it.time != null }) {
        LaunchedEffect(Unit) {
            while (true) {
                now = ZonedDateTime.now()
                delay(60_000)
            }
        }
    }
    val shown = if (canFilter && onlyLeft) listed.filter { !it.done && !Todos.eventOver(it, now) } else listed
    val title = heading ?: when {
        listed.isNotEmpty() && listed.all { it.source != null } -> t.todo.blockEvents
        listed.any { it.source != null } -> t.todo.blockMixed
        else -> t.todo.block
    }
    var editing by remember { mutableStateOf<Todo?>(null) }
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(start = 4.dp, end = 4.dp, top = 16.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SectionLabel(title)
            if (canFilter) {
                Row(
                    Modifier.background(p.heat[0], RoundedCornerShape(14.dp)).padding(3.dp).semantics { contentDescription = t.todo.showWhich },
                ) {
                    SegMini(t.todo.showAll, !onlyLeft) {
                        onlyLeft = false
                        model.prefs.setBool(LEFT_KEY, false)
                    }
                    SegMini(t.todo.showLeft, onlyLeft) {
                        onlyLeft = true
                        model.prefs.setBool(LEFT_KEY, true)
                    }
                }
            }
        }
        Card {
            shown.forEachIndexed { i, d ->
                // Ключ — само дело (у повторяющегося — и его день): открытый свайп и поле ввода остаются у своей строки,
                // когда список переставился (отметили — ушло вниз; /code-review 05.10).
                key(d.id, d.day) {
                    if (i > 0) RowDivider()
                    // Только что добавленное ещё без номера с сервера (id < 0): смахнуть и отметить его пока нельзя.
                    val swipe = when {
                        d.id < 0 -> emptyList()
                        d.source == null -> listOf(SwipeAction(t.swipe.remove, danger = true) { actions.remove(d) })
                        // Событие из календаря: «Удалить» (и в календаре) и «Скрыть» — крайняя, она же «до конца».
                        else -> listOf(
                            SwipeAction(t.swipe.remove, danger = true) { actions.remove(d) },
                            SwipeAction(t.swipe.hide, danger = false, glyph = Glyph.HIDE) { actions.hide(d) },
                        )
                    }
                    SwipeRow(swipe, radius = Dim.radius) {
                        TodoRow(d, today, showCarry, onOpen = { if (d.id >= 0) editing = d }) { actions.toggle(d) }
                    }
                }
            }
            if (!canAdd && shown.isEmpty()) {
                Text(t.calEmpty, style = onest(15, color = p.muted), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 15.dp))
            }
            if (canAdd) {
                if (shown.isNotEmpty()) RowDivider()
                AddTodo(addLabel ?: t.todo.add) { actions.add(it, day) }
            }
        }
    }
    editing?.let { d ->
        TodoSheet(d, today, links, onSave = { actions.update(d, it) }, onDelete = { actions.remove(d) }, onClose = { editing = null })
    }
}

/** Запланированные на потом, по дням. Список открывают редко — грузим его, только когда открыли. */
@Composable
private fun LaterSheet(model: AppModel, today: String, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var list by remember { mutableStateOf<List<Todo>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try {
            list = model.laterTodos()
        } catch (e: app.lifecommit.core.ApiError) {
            failed = true
        }
    }
    Sheet(t.todo.laterTitle, onClose) {
        if (failed) ErrorNote(t.error)
        list.orEmpty().filter { !model.isRemoved("todo:${it.id}") }.groupBy { it.day }.forEach { (day, items) ->
            Text(Todos.whenLabel(day, today, t) ?: t.today, style = onest(15, 600, p.muted), modifier = Modifier.padding(start = 4.dp, top = 14.dp, bottom = 6.dp))
            Column(Modifier.fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
                items.forEachIndexed { i, d ->
                    key(d.id) {
                    if (i > 0) RowDivider()
                    // Строку прячет model.isRemoved, пока идут 5 секунд «Вернуть»; после удаления список перечитывается.
                    SwipeRow(listOf(SwipeAction(t.swipe.remove, danger = true) {
                        model.removeTodo(d) {
                            list = try {
                                model.laterTodos()
                            } catch (e: app.lifecommit.core.ApiError) {
                                list
                            }
                        }
                    })) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(p.bg).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (d.time != null) Text(d.time!!, style = onest(15, 600, p.text), modifier = Modifier.padding(end = 10.dp))
                            Text(d.title, style = onest(16, color = p.text))
                        }
                    }
                    }
                }
            }
        }
    }
}

/** Число для поля ввода: 12, а не «12,0» и не «1 200». */
private fun plain(n: Double): String = if (n == Math.floor(n)) n.toLong().toString() else n.toString()

@Composable
private fun SegMini(label: String, on: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier
            .heightIn(min = 30.dp)
            .pressable(role = Role.Tab, onClick = onClick)
            .background(if (on) p.surface else Color.Transparent, RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp)
            .semantics { selected = on },
        contentAlignment = Alignment.Center,
    ) { Text(label, style = onest(13, 600, if (on) p.text else p.muted)) }
}

@Composable
private fun TodoRow(d: Todo, today: String, showCarry: Boolean, onOpen: () -> Unit, onToggle: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val whenLabel = if (showCarry && !d.recurring) Todos.whenLabel(d.day, today, t) else null
    val end = if (d.time != null && d.durationMin != null) Todos.endTime(d.time!!, d.durationMin!!) else null
    val note = listOfNotNull(whenLabel, end?.let(t.todo.until)).joinToString(" · ")
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(Color.Transparent).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (d.source != null) {
            // Событие из календаря — «что сегодня будет»: отмечать нечего, на карту не влияет.
            Box(Modifier.size(Dim.tap), contentAlignment = Alignment.Center) {
                Box(Modifier.size(4.dp, 22.dp).background(p.outside, RoundedCornerShape(2.dp)))
            }
        } else {
            Box(
                Modifier
                    .size(Dim.tap)
                    .pressable(enabled = d.id >= 0, role = Role.Checkbox, onClick = onToggle)
                    .semantics {
                        contentDescription = if (d.done) t.todo.uncheck(d.title) else t.todo.check(d.title)
                        stateDescription = if (d.done) t.markDone else ""
                    },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(24.dp)
                        .then(if (d.done) Modifier.background(p.accent, CircleShape) else Modifier.border(2.dp, p.muted, CircleShape)),
                    contentAlignment = Alignment.Center,
                ) { if (d.done) StrokeGlyph(Glyph.CHECK, p.accentText, 16.dp, 3f) }
            }
        }
        Row(Modifier.weight(1f).heightIn(min = 52.dp).pressable(onClick = onOpen).padding(start = 4.dp, end = 14.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (d.time != null) Text(d.time!!, style = onest(14, 600, if (d.done) p.muted else p.accent), modifier = Modifier.widthIn(min = 40.dp).padding(end = 10.dp))
            Column(Modifier.weight(1f)) {
                // Сделанное — серым и зачёркнутым (.todo-list li.done).
                Text(
                    d.title,
                    style = onest(16, color = if (d.done) p.muted else p.text, lineHeight = 21.sp).copy(
                        textDecoration = if (d.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null,
                    ),
                )
                if (note.isNotEmpty() && !d.done) Text(note, style = onest(13, color = p.muted))
            }
            // Откуда пришло событие: G — Google, A — Apple (.src-mark).
            d.source?.let { Box(Modifier.padding(start = 10.dp)) { SourceMark(it) } }
        }
    }
}

/** Строка «+ Дело на сегодня» → поле; Enter добавляет и оставляет поле открытым для следующего дела. */
@Composable
private fun AddTodo(label: String, onAdd: (String) -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var adding by remember { mutableStateOf(false) }
    val draft = rememberTextFieldState()
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    val submit = {
        val text = draft.text.toString()
        if (text.isNotBlank()) onAdd(text)
        draft.clearText()
    }
    if (!adding) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).pressable { adding = true }.padding(horizontal = 14.dp).testTag("addTodo"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StrokeGlyph(Glyph.PLUS, p.muted, 18.dp, 2.2f)
            Text(label, style = onest(15, 500, p.muted))
        }
        return
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 20.dp, end = 14.dp), contentAlignment = Alignment.CenterStart) {
        if (draft.text.isEmpty()) Text(t.todo.addPh, style = onest(16, color = p.muted))
        BasicTextField(
            draft,
            inputTransformation = InputTransformation.maxLength(120),
            lineLimits = TextFieldLineLimits.SingleLine,
            textStyle = onest(16, color = p.text),
            cursorBrush = SolidColor(p.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            // Поле остаётся открытым: следующее дело можно вписать сразу.
            onKeyboardAction = { submit() },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focus)
                .onFocusChanged {
                    if (focused && !it.isFocused) {
                        submit()
                        adding = false
                    }
                    focused = it.isFocused
                }
                .semantics { contentDescription = label }
                .testTag("todoInput"),
        )
    }
}
