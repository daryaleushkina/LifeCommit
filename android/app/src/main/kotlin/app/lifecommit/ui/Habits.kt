// «Чего я хочу?» (Onboarding.tsx), редактор привычки (TaskEditor.tsx) и «Отложенные» (Archive.tsx).
package app.lifecommit.ui

import android.app.DatePickerDialog
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.maxLength
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.AppModel
import app.lifecommit.core.ApiError
import app.lifecommit.core.Days
import app.lifecommit.core.Repeat
import app.lifecommit.core.Schedule
import app.lifecommit.core.TaskInput
import app.lifecommit.core.TaskKind
import app.lifecommit.core.TodayTask
import app.lifecommit.core.Visibility
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Три намерения = три вида привычки; тап открывает редактор уже нужного вида. */
private val INTENTS = listOf(TaskKind.Check, TaskKind.Count, TaskKind.Abstain)

/**
 * «Чего я хочу?» — первый экран и он же первый шаг при добавлении привычки. onBack есть только при добавлении: с первого
 * экрана уходить некуда; onSkip — только на первом экране.
 */
@Composable
fun Onboarding(onPick: (TaskKind) -> Unit, onBack: (() -> Unit)?, onSkip: (() -> Unit)?, withTabs: Boolean = false) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Box {
        GlowBackground()
        Screen(withTabs = withTabs, modifier = Modifier.testTag("onboarding")) {
            if (onBack != null) item { BackPill(onBack) }
            item { PageHead(t.onboardingTitle, t.onboardingHint, top = if (onBack != null) 12.dp else 24.dp) }
            item { Spacer(Modifier.height(28.dp)) }
            for (kind in INTENTS) item {
                val intent = t.intents.getValue(kind)
                Row(
                    Modifier
                        .padding(bottom = 12.dp)
                        .fillMaxWidth()
                        .heightIn(min = 88.dp)
                        .pressable(onClick = { onPick(kind) })
                        .glass()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    KindTile(kind, size = TileSize.Lg)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(intent.title, style = onest(17, 600, p.text, lineHeight = 22.sp))
                        Text(intent.examples, style = onest(14, color = p.muted, lineHeight = 18.sp))
                    }
                    StrokeGlyph(Glyph.CHEVRON, p.muted, 20.dp)
                }
            }
            // Можно ничего не заводить: посмотреть приложение, вступить в группу, вернуться позже.
            if (onSkip != null) item {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) { QuietLink(t.onboardingSkip, p.muted, onSkip) }
            }
        }
    }
}

private data class Form(
    val title: String = "",
    val kind: TaskKind = TaskKind.Check,
    val target: Int = 10,
    val unit: String = "",
    val schedule: Schedule = Schedule.Daily,
    val weekdays: Int = 31,
    val perWeek: Int = 3,
    val visibility: Visibility = Visibility.Private,
    val lastSlipOn: String = "",
) {
    val numeric get() = kind == TaskKind.Count
    val valid get() = title.isNotBlank() && (!numeric || target > 0) && (schedule != Schedule.Weekdays || weekdays > 0)

    fun input() = TaskInput(
        title = title.trim(),
        kind = kind,
        target = if (numeric) target.toDouble() else 1.0,
        unit = if (numeric) unit.trim().ifEmpty { null } else null,
        schedule = if (kind == TaskKind.Abstain) Schedule.Daily else schedule,
        weekdays = weekdays,
        perWeek = if (kind != TaskKind.Abstain && schedule == Schedule.PerWeek) perWeek else null,
        visibility = visibility,
        lastSlipOn = if (kind == TaskKind.Abstain) lastSlipOn.ifEmpty { null } else null,
    )

    companion object {
        fun of(task: TodayTask) = Form(
            title = task.title,
            kind = task.kind,
            target = task.target.toInt(),
            unit = task.unit.orEmpty(),
            schedule = task.schedule,
            weekdays = task.weekdays,
            perWeek = task.perWeek ?: 3,
            visibility = task.visibility,
            lastSlipOn = task.lastSlipOn.orEmpty(),
        )
    }
}

/** Редактор: taskId null — новая привычка вида kind; иначе — правка (берётся из «Сегодня», без загрузки). */
@Composable
fun TaskEditor(model: AppModel, taskId: Long?, kind: TaskKind?) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val task = taskId?.let { id -> model.today.tasks.firstOrNull { it.id == id } }
    // Привычки уже нет (отложили или удалили) — редактор закрывается.
    if (taskId != null && task == null) {
        LaunchedEffect(Unit) { model.back() }
        return
    }
    val isNew = taskId == null
    var form by remember { mutableStateOf(task?.let(Form::of) ?: Form(kind = kind ?: TaskKind.Check)) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var repeatOpen by remember { mutableStateOf(false) }
    var whoOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var goalTomorrow by remember { mutableStateOf(false) }
    val failMessage = { e: ApiError -> if (e.code == "task_limit") t.limitReached(5) else t.error }
    // Ушли из редактора (сохранили, «Назад», жест) — клавиатура закрывается вместе с ним, а не висит над «Сегодня».
    val keyboard = LocalSoftwareKeyboardController.current
    DisposableEffect(Unit) { onDispose { keyboard?.hide() } }

    val save: () -> Unit = {
        keyboard?.hide()
        busy = true
        scope.launch {
            try {
                val easier = model.saveTask(taskId, form.input())
                if (easier) goalTomorrow = true else model.backToMain()
            } catch (e: ApiError) {
                message = failMessage(e)
                busy = false
            }
        }
    }

    Box {
        GlowBackground()
        Screen(withTabs = false, modifier = Modifier.testTag("editor")) {
            item { BackPill(model::back) }
            item { PageHead(if (isNew) t.newTask else t.editTask, top = 12.dp) }
            message?.let { m -> item { ErrorNote(m, Modifier.padding(top = 12.dp)) } }
            item {
                Row(
                    Modifier.padding(top = 16.dp).glass(16.dp).padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    KindTile(form.kind, form.title, TileSize.Sm)
                    Text(t.intents.getValue(form.kind).title, style = onest(15, 600, p.text))
                }
            }
            item { TitleInput(form.title, t.titlePh.getValue(form.kind), t.newTask) { form = form.copy(title = it) } }
            item {
                Card(Modifier.padding(top = 16.dp)) {
                    var first = true
                    val divider = @Composable { if (!first) RowDivider() else first = false }
                    if (form.kind == TaskKind.Abstain) {
                        divider()
                        LastSlipRow(form.lastSlipOn) { form = form.copy(lastSlipOn = it) }
                    }
                    if (form.numeric) {
                        divider()
                        SettingRow(t.goal, chevron = false) {
                            Stepper(
                                value = form.target,
                                label = t.goal,
                                editable = true,
                                onMinus = { form = form.copy(target = maxOf(1, form.target - if (form.target > 20) 5 else 1)) },
                                onPlus = { form = form.copy(target = form.target + if (form.target >= 20) 5 else 1) },
                                onSet = { form = form.copy(target = it) },
                            )
                        }
                    }
                    // «Бросить» — это про каждый день, расписания у него нет.
                    if (form.kind != TaskKind.Abstain) {
                        divider()
                        SettingRow(t.repeat, Repeat.label(t, form.schedule, form.weekdays, form.perWeek), onClick = { repeatOpen = true })
                    }
                    divider()
                    SettingRow(t.who, t.visibility.getValue(form.visibility), onClick = { whoOpen = true })
                }
            }
            item {
                PrimaryButton(
                    if (isNew) t.add else t.save,
                    modifier = Modifier.padding(top = 16.dp).testTag("save"),
                    wide = true,
                    enabled = form.valid,
                    busy = busy,
                    onClick = save,
                )
            }
            if (!isNew) item {
                Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
                    QuietLink(t.postpone, p.muted) {
                        scope.launch {
                            try {
                                model.postpone(taskId)
                                model.backToMain()
                            } catch (e: ApiError) {
                                message = failMessage(e)
                            }
                        }
                    }
                    QuietLink(t.deleteTask, p.danger) { confirmDelete = true }
                }
            }
        }
    }

    if (repeatOpen) RepeatSheet(form.schedule, form.weekdays, form.perWeek, onChange = { s, w, n -> form = form.copy(schedule = s, weekdays = w, perWeek = n) }) { repeatOpen = false }
    if (whoOpen) {
        Sheet(t.who, onClose = { whoOpen = false }) {
            Options(Visibility.entries.map { it to t.visibility.getValue(it) }, form.visibility) {
                form = form.copy(visibility = it)
                whoOpen = false
            }
        }
    }
    if (confirmDelete) {
        Confirm(t.deleteForeverConfirm, t.deleteForever, onConfirm = {
            confirmDelete = false
            scope.launch {
                try {
                    model.deleteForever(taskId!!)
                    model.backToMain()
                } catch (e: ApiError) {
                    message = failMessage(e)
                }
            }
        }, onDismiss = { confirmDelete = false })
    }
    if (goalTomorrow) {
        Confirm(t.goalTomorrow, "OK", destructive = false, cancel = null, onConfirm = {
            goalTomorrow = false
            model.backToMain()
        }, onDismiss = {
            goalTomorrow = false
            model.backToMain()
        })
    }
}

/** Поле названия (.title-input): стекло, рамка цвета акцента в фокусе. */
@Composable
private fun TitleInput(initial: String, placeholder: String, label: String, onChange: (String) -> Unit) {
    val p = LocalPalette.current
    var focused by remember { mutableStateOf(false) }
    val state = rememberTextFieldState(initial)
    LaunchedEffect(state) { snapshotFlow { state.text.toString() }.collect(onChange) }
    Box(
        Modifier
            .padding(top = 14.dp)
            .fillMaxWidth()
            .height(56.dp)
            .glass(16.dp)
            .then(if (focused) Modifier.border(2.dp, p.accent, RoundedCornerShape(16.dp)) else Modifier)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (state.text.isEmpty()) Text(placeholder, style = onest(17, 500, p.muted))
        BasicTextField(
            state,
            inputTransformation = InputTransformation.maxLength(80),
            lineLimits = TextFieldLineLimits.SingleLine,
            textStyle = onest(17, 500, p.text),
            cursorBrush = SolidColor(p.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = label }
                .testTag("title"),
        )
    }
}

/** «Последний раз» у «бросить»: системный выбор даты, не позже сегодня; можно сбросить. */
@Composable
private fun LastSlipRow(value: String, onChange: (String) -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val today = LocalDate.now()
    val shown = if (value.isEmpty()) t.notSet else {
        val d = Days.date(value)
        t.dayMonth(value) + if (d != null && d.year != today.year) " ${d.year}" else ""
    }
    SettingRow(t.lastSlip, shown, onClick = {
        val start = Days.date(value) ?: today
        val dialog = DatePickerDialog(context, { _, y, m, d -> onChange(LocalDate.of(y, m + 1, d).toString()) }, start.year, start.monthValue - 1, start.dayOfMonth)
        dialog.datePicker.maxDate = System.currentTimeMillis()
        dialog.setButton(DatePickerDialog.BUTTON_NEUTRAL, t.clearDate) { _, _ -> onChange("") }
        dialog.show()
    })
}

/** Кнопки «− число +» (.stepper). */
@Composable
private fun Stepper(value: Int, label: String, editable: Boolean, onMinus: () -> Unit, onPlus: () -> Unit, onSet: (Int) -> Unit = {}) {
    val p = LocalPalette.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        StepButton("−", onMinus)
        if (editable) {
            val state = rememberTextFieldState(value.toString())
            // − и + меняют число снаружи — поле показывает новое; набранное в поле — уходит в форму.
            LaunchedEffect(value) { if (state.text.toString() != value.toString()) state.setTextAndPlaceCursorAtEnd(value.toString()) }
            LaunchedEffect(state) { snapshotFlow { state.text.toString() }.collect { onSet(it.toIntOrNull() ?: 0) } }
            BasicTextField(
                state,
                inputTransformation = DigitsOnly(6),
                lineLimits = TextFieldLineLimits.SingleLine,
                textStyle = onest(18, 700, p.text).copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center),
                cursorBrush = SolidColor(p.accent),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.width(48.dp).semantics { contentDescription = label }.testTag("goal"),
            )
        } else {
            Text(value.toString(), style = onest(18, 700, p.text).copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center), modifier = Modifier.width(48.dp))
        }
        StepButton("+", onPlus)
    }
}

@Composable
private fun StepButton(sign: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(40.dp).pressable(label = sign, onClick = onClick).background(p.heat[0], RoundedCornerShape(12.dp)).semantics { contentDescription = sign },
        contentAlignment = Alignment.Center,
    ) { Text(sign, style = onest(20, 500, p.text)) }
}

/** Варианты в шторке (.options): выбранный — зелёный с галочкой. */
@Composable
private fun <T> Options(options: List<Pair<T, String>>, value: T, onPick: (T) -> Unit) {
    val p = LocalPalette.current
    Column {
        options.forEachIndexed { i, (v, label) ->
            if (i > 0) RowDivider()
            val on = v == value
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).pressable(role = Role.RadioButton) { onPick(v) }.padding(horizontal = 4.dp).semantics { selected = on },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, style = onest(16, if (on) 600 else 500, if (on) p.accent else p.text), modifier = Modifier.weight(1f))
                if (on) StrokeGlyph(Glyph.CHECK, p.accent, 20.dp, 2.4f)
            }
        }
    }
}

/** «Повторять»: каждый день, по дням недели, несколько раз в неделю. Ни одного дня — «Готово» неактивна. */
@Composable
private fun RepeatSheet(schedule: Schedule, weekdays: Int, perWeek: Int, onChange: (Schedule, Int, Int) -> Unit, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Sheet(t.repeat, onClose = { if (schedule != Schedule.Weekdays || weekdays != 0) onClose() }) {
        Options(Schedule.entries.map { it to t.schedules.getValue(it) }, schedule) { onChange(it, weekdays, perWeek) }
        if (schedule == Schedule.Weekdays) {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                t.weekdaysShort.forEachIndexed { i, d ->
                    val on = weekdays and (1 shl i) != 0
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .pressable(role = Role.Checkbox) { onChange(schedule, weekdays xor (1 shl i), perWeek) }
                            .background(if (on) p.accent else p.heat[0], RoundedCornerShape(12.dp))
                            .semantics { selected = on },
                        contentAlignment = Alignment.Center,
                    ) { Text(d, style = onest(13, 600, if (on) p.accentText else p.text)) }
                }
            }
        }
        if (schedule == Schedule.PerWeek) {
            Row(Modifier.padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Stepper(perWeek, t.schedules.getValue(Schedule.PerWeek), editable = false, onMinus = { onChange(schedule, weekdays, maxOf(1, perWeek - 1)) }, onPlus = { onChange(schedule, weekdays, minOf(6, perWeek + 1)) })
                Text(t.perWeekHint(perWeek), style = onest(15, color = p.muted))
            }
        }
        PrimaryButton(t.done, modifier = Modifier.padding(top = 14.dp), wide = true, enabled = schedule != Schedule.Weekdays || weekdays != 0, onClick = onClose)
    }
}

/** Отложенные привычки: вернуть одним тапом или удалить насовсем. */
@Composable
fun Archive(model: AppModel) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val items = model.today.archived
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(items.isEmpty()) { if (items.isEmpty()) model.back() }
    Box {
        GlowBackground()
        Screen(withTabs = false, modifier = Modifier.testTag("archive")) {
            item { BackPill(model::back) }
            item { PageHead(t.archive, top = 12.dp) }
            message?.let { m -> item { ErrorNote(m, Modifier.padding(top = 12.dp)) } }
            if (items.isNotEmpty()) item {
                Card(Modifier.padding(top = 16.dp)) {
                    items.forEachIndexed { i, task ->
                        if (i > 0) RowDivider()
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 18.dp, end = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(task.title, style = onest(16, 500, p.text), modifier = Modifier.weight(1f))
                            Box(Modifier.heightIn(min = Dim.tap).pressable { confirm = task.id }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                                Text(t.deleteForever, style = onest(16, 500, p.muted))
                            }
                            Box(
                                Modifier.heightIn(min = Dim.tap).pressable {
                                    scope.launch {
                                        try {
                                            model.restore(task.id)
                                        } catch (e: ApiError) {
                                            message = if (e.code == "task_limit") t.limitReached(5) else t.error
                                        }
                                    }
                                }.background(p.bg, RoundedCornerShape(Dim.radiusBtn)).padding(horizontal = 14.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text(t.restore, style = onest(16, 700, p.text)) }
                        }
                    }
                }
            }
        }
    }
    confirm?.let { id ->
        Confirm(t.deleteForeverConfirm, t.deleteForever, onConfirm = {
            confirm = null
            scope.launch {
                try {
                    model.deleteForever(id)
                } catch (e: ApiError) {
                    message = t.error
                }
            }
        }, onDismiss = { confirm = null })
    }
}
