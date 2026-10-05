// Шторка дела — как src/components/TodoSheet.tsx: название, «Сегодня» / «Завтра» в одно касание, другой день, время,
// место (у своих дел). У события из календаря сверху — подробности: где, ссылка на созвон, кто будет, описание.
package app.lifecommit.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.maxLength
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.lifecommit.core.Days
import app.lifecommit.core.Todo
import app.lifecommit.core.TodoDetails
import app.lifecommit.core.TodoEdit
import app.lifecommit.core.TodoEdits
import app.lifecommit.core.TodoSource
import app.lifecommit.core.isCallLink
import app.lifecommit.core.webLink
import java.time.LocalDate

/** Карта по адресу — снаружи (браузер или приложение карт). */
fun mapUrl(place: String) = "https://www.google.com/maps/search/?api=1&query=${java.net.URLEncoder.encode(place, Charsets.UTF_8)}"

@Composable
fun TodoSheet(todo: Todo, today: String, links: Links, onSave: (TodoEdit) -> Unit, onDelete: () -> Unit, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val context = LocalContext.current
    val title = rememberTextFieldState(todo.title)
    var day by remember { mutableStateOf(TodoEdits.initialDay(todo, today)) }
    var time by remember { mutableStateOf(todo.time) }
    val place = rememberTextFieldState(todo.details?.location.orEmpty())
    val tomorrow = Days.add(today, 1)
    val source = todo.source

    Sheet(if (source != null) t.todo.event else t.todo.edit, onClose) {
        SheetInput(title, t.todo.edit, maxLength = 120, tag = "todoTitle")
        if (source != null && todo.details != null) EventDetails(todo.details!!, links)
        // Повторяющееся: день не выбирают — он задан повтором.
        if (!todo.recurring) {
            Row(
                Modifier.padding(top = 12.dp).fillMaxWidth().background(p.heat[0], RoundedCornerShape(16.dp)).padding(4.dp).semantics { contentDescription = t.todo.whenLabel },
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                for ((value, label) in listOf(today to t.todo.today, tomorrow to t.todo.tomorrow)) {
                    val on = day == value
                    Box(
                        Modifier.weight(1f).heightIn(min = 44.dp).pressable(role = Role.RadioButton) { day = value }
                            .background(if (on) p.surface else Color.Transparent, RoundedCornerShape(12.dp)).semantics { selected = on },
                        contentAlignment = Alignment.Center,
                    ) { Text(label, style = onest(14, if (on) 600 else 500, p.text)) }
                }
            }
        }
        Column(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
            if (!todo.recurring) {
                // «Сегодня» и «Завтра» уже видны кнопками — здесь дата только для остальных дней.
                SettingRow(t.todo.otherDay, if (day > tomorrow) t.dayMonth(day) else t.todo.pick, onClick = {
                    val start = Days.date(if (day > tomorrow) day else Days.add(today, 2)) ?: LocalDate.now()
                    val dialog = DatePickerDialog(context, { _, y, m, d -> day = LocalDate.of(y, m + 1, d).toString() }, start.year, start.monthValue - 1, start.dayOfMonth)
                    Days.date(Days.add(today, 2))?.let { dialog.datePicker.minDate = it.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
                    dialog.show()
                })
                RowDivider()
            }
            SettingRow(t.todo.time, time ?: t.todo.allDay, onClick = {
                val (h, m) = (time ?: "12:00").split(":").map { it.toIntOrNull() ?: 0 }
                val dialog = TimePickerDialog(context, { _, hh, mm -> time = "%02d:%02d".format(hh, mm) }, h, m, true)
                if (time != null) dialog.setButton(TimePickerDialog.BUTTON_NEUTRAL, t.todo.noTime) { _, _ -> time = null }
                dialog.show()
            })
            // Своё дело: место можно вписать или поправить, оно уйдёт в календарь телефона.
            if (source == null) {
                RowDivider()
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 18.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(t.todo.place, style = onest(16, 500, p.text))
                    Box(Modifier.weight(1f).padding(start = 12.dp), contentAlignment = Alignment.CenterEnd) {
                        if (place.text.isEmpty()) Text(t.todo.placePh, style = onest(15, color = p.muted))
                        BasicTextField(
                            place,
                            inputTransformation = InputTransformation.maxLength(200),
                            lineLimits = TextFieldLineLimits.SingleLine,
                            textStyle = onest(15, color = p.text).copy(textAlign = TextAlign.End),
                            cursorBrush = SolidColor(p.accent),
                            modifier = Modifier.fillMaxWidth().semantics { contentDescription = t.todo.place },
                        )
                    }
                    if (place.text.isNotBlank()) {
                        Box(Modifier.heightIn(min = 40.dp).pressable(label = t.todo.onMap) { links.open(mapUrl(place.text.toString().trim()), true) }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                            StrokeGlyph(Glyph.PIN, p.accent, 18.dp)
                        }
                    }
                }
            }
        }
        if (source != null) {
            val open = webLink(todo.details?.openUrl)
            if (open != null) {
                Box(Modifier.fillMaxWidth().padding(top = 6.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.heightIn(min = 40.dp).pressable { links.open(open, true) }, contentAlignment = Alignment.Center) {
                        Text("${t.todo.openGoogle} ↗", style = onest(15, 600, p.accent))
                    }
                }
            } else {
                Text(if (source == TodoSource.Apple) t.todo.fromApple else t.todo.fromGoogle, style = onest(14, color = p.muted), modifier = Modifier.padding(start = 4.dp, top = 10.dp))
            }
        }
        PrimaryButton(t.done, Modifier.padding(top = 14.dp).testTag("todoDone"), wide = true, enabled = title.text.isNotBlank()) {
            onSave(TodoEdit(title.text.toString().trim(), day, time, if (source == null) place.text.toString().trim() else null))
            onClose()
        }
        Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
            QuietLink(if (source != null) t.todo.deleteEvent else t.todo.delete, p.danger) {
                onDelete()
                onClose()
            }
        }
    }
}

/** Поле в шторке (.sheet-input). */
@Composable
fun SheetInput(state: androidx.compose.foundation.text.input.TextFieldState, label: String, maxLength: Int, tag: String, placeholder: String? = null, keyboard: KeyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences)) {
    val p = LocalPalette.current
    Box(Modifier.padding(top = 10.dp).fillMaxWidth().height(52.dp).background(p.bg, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        if (state.text.isEmpty() && placeholder != null) Text(placeholder, style = onest(17, 500, p.muted))
        BasicTextField(
            state,
            inputTransformation = InputTransformation.maxLength(maxLength),
            lineLimits = TextFieldLineLimits.SingleLine,
            textStyle = onest(17, 500, p.text),
            cursorBrush = SolidColor(p.accent),
            keyboardOptions = keyboard,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label }.testTag(tag),
        )
    }
}

/** Подробности события: только то, что есть, каждая — одной строкой; длинное описание сворачивается. */
@Composable
private fun EventDetails(d: TodoDetails, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var open by remember { mutableStateOf(false) }
    Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
        var first = true
        val divider = @Composable { if (!first) RowDivider() else first = false }
        d.location?.let { loc ->
            divider()
            DetailRow(Glyph.PIN, loc, null, chevron = true) { links.open(mapUrl(loc), true) }
        }
        webLink(d.link)?.let { link ->
            divider()
            DetailRow(Glyph.VIDEO, if (isCallLink(link)) t.todo.join else t.todo.openLink, hostOf(link), chevron = true) { links.open(link, true) }
        }
        d.peopleCount?.takeIf { it > 0 }?.let { count ->
            divider()
            val shown = d.people.orEmpty()
            val names = shown.take(3).joinToString(", ")
            val rest = count - 1 - minOf(3, shown.size)
            DetailRow(Glyph.PEOPLE, t.todo.people(count), names.ifEmpty { null }?.let { if (rest > 0) "$it ${t.todo.andMore(rest)}" else it }, chevron = false, onClick = null)
        }
        d.notes?.let { notes ->
            divider()
            val long = notes.length > 140 || notes.lines().size > 3
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (long) Modifier.pressable { open = !open } else Modifier).padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StrokeGlyph(Glyph.NOTES, p.muted, 18.dp)
                Column(Modifier.weight(1f)) {
                    Text(notes, style = onest(14, color = p.muted), maxLines = if (open || !long) Int.MAX_VALUE else 3)
                    if (long && !open) Text(t.todo.more, style = onest(14, 600, p.accent))
                }
            }
        }
    }
}

@Composable
private fun DetailRow(glyph: String, title: String, sub: String?, chevron: Boolean, onClick: (() -> Unit)?) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (onClick != null) Modifier.pressable(onClick = onClick) else Modifier).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StrokeGlyph(glyph, p.muted, 18.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = onest(15, if (sub != null) 600 else 400, p.text))
            sub?.let { Text(it, style = onest(13, color = p.muted)) }
        }
        if (chevron) StrokeGlyph(Glyph.CHEVRON, p.muted, 16.dp, 2.2f)
    }
}

private fun hostOf(url: String): String = try {
    val u = java.net.URI(url)
    ((u.host ?: "") + (u.path?.takeIf { it.length > 1 } ?: "")).removePrefix("www.").take(40)
} catch (_: java.net.URISyntaxException) {
    url.take(40)
}
