// «Я» — как src/screens/Profile.tsx: имя и фото, карта «Месяц · Год», настройки (напоминание, конец дня, тема, язык),
// заблокированные, устройства («Выйти везде»), выход на этом устройстве и «Удалить аккаунт» (решение владелицы 06.10:
// просто подтверждением). Поделиться и «Сообщить о проблеме» придут своими разделами; донат Tribute в магазинных
// приложениях не показываем (docs/parity.md: «нет на платформе»). Время — системные часы Android, варианты — шторкой.
package app.lifecommit.ui

import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.lifecommit.AppModel
import app.lifecommit.core.GroupMember

private const val SUN = "M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"
private const val MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"

@Composable
fun Me(model: AppModel, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val user = model.user ?: return
    val me = model.me
    val context = LocalContext.current
    LaunchedEffect(Unit) { me.load() }
    var ask by remember { mutableStateOf<Ask?>(null) }
    var dayEnds by remember { mutableStateOf(false) }
    var language by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }

    Screen(withTabs = true, modifier = Modifier.testTag("me")) {
        item {
            Row(Modifier.padding(top = 24.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(GroupMember(user.id, user.firstName, user.photoUrl), 56.dp)
                Column {
                    Text(user.firstName, style = onest(26, 700, p.text))
                    user.username?.let { Text("@$it", style = onest(15, color = p.muted)) }
                }
            }
        }
        item { HeatCard(model.heat, model.today.day, Modifier.padding(top = 16.dp)) }
        if (me.error) item { ErrorNote(t.error, Modifier.padding(top = 12.dp).testTag("meError")) { me.error = false } }
        item {
            Card(Modifier.padding(top = 12.dp)) {
                if (!user.botChatOk) {
                    // Как requestWriteAccess в мини-аппе: человек жмёт «Старт» в чате с ботом — боту можно писать.
                    SettingRow(t.allowBot, onClick = {
                        model.askBot()
                        links.open(BOT_CHAT, false)
                    })
                    RowDivider()
                }
                SettingRow(t.reminders, user.remindEvening ?: t.off, onClick = {
                    val (h, m) = (user.remindEvening ?: "21:00").split(":").map { it.toIntOrNull() ?: 0 }
                    val dialog = TimePickerDialog(context, { _, hh, mm -> "%02d:%02d".format(hh, mm).takeIf { it != user.remindEvening }?.let { me.save(mapOf("remind_evening" to it)) } }, h, m, true)
                    if (user.remindEvening != null) dialog.setButton(TimePickerDialog.BUTTON_NEUTRAL, t.turnOff) { _, _ -> me.save(mapOf("remind_evening" to null)) }
                    dialog.show()
                })
                RowDivider()
                SettingRow(t.dayEnds, "%02d:00".format(user.dayStartHour), onClick = { dayEnds = true })
                RowDivider()
                SettingRow(t.theme, chevron = false) {
                    val dark = p == Palette.dark
                    Row(Modifier.background(p.heat[0], RoundedCornerShape(14.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        ThemeButton(SUN, t.themeLight, on = !dark) { model.chooseTheme("light") }
                        ThemeButton(MOON, t.themeDark, on = dark) { model.chooseTheme("dark") }
                    }
                }
                RowDivider()
                SettingRow(t.language, if (user.languageCode == "en") "English" else "Русский", onClick = { language = true })
                if (me.blocked.isNotEmpty()) {
                    RowDivider()
                    SettingRow(t.fr.blocked, t.num(me.blocked.size), onClick = { blocked = true })
                }
                if (me.devices.isNotEmpty()) {
                    RowDivider()
                    SettingRow(t.devices, t.num(me.devices.size), onClick = { ask = Ask.Everywhere })
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                QuietLink(t.logoutDevice, p.warn) { ask = Ask.Logout }
                QuietLink(t.deleteAccount, p.muted) { ask = Ask.Delete }
            }
        }
    }

    when (ask) {
        Ask.Logout -> Confirm(t.logoutDeviceConfirm, t.logoutOk, onConfirm = {
            ask = null
            model.logout()
        }, onDismiss = { ask = null })
        Ask.Everywhere -> Confirm(t.logoutAllConfirm, t.logoutAll, onConfirm = {
            ask = null
            me.logoutEverywhere()
        }, onDismiss = { ask = null })
        Ask.Delete -> Confirm(t.deleteConfirm, t.deleteForever, onConfirm = {
            ask = null
            me.deleteAccount()
        }, onDismiss = { ask = null })
        null -> Unit
    }
    if (dayEnds) {
        Sheet(t.dayEnds, onClose = { dayEnds = false }) {
            Options((0..12).map { it to "%02d:00".format(it) }, user.dayStartHour) {
                dayEnds = false
                if (it != user.dayStartHour) me.save(mapOf("day_start_hour" to it))
            }
        }
    }
    if (language) {
        Sheet(t.language, onClose = { language = false }) {
            Options(listOf("ru" to "Русский", "en" to "English"), if (user.languageCode == "en") "en" else "ru") {
                language = false
                if (it != user.languageCode) me.save(mapOf("language_code" to it))
            }
        }
    }
    if (blocked) {
        Sheet(t.fr.blocked, onClose = { blocked = false }) {
            if (me.unblockError) ErrorNote(t.error, Modifier.padding(bottom = 10.dp)) { me.unblockError = false }
            me.blocked.forEach { person ->
                Row(Modifier.fillMaxWidth().heightIn(min = 60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(GroupMember(person.id, person.firstName, person.photoUrl), 40.dp)
                    Column(Modifier.weight(1f)) {
                        Text(person.firstName, style = onest(16, 600, p.text))
                        person.username?.let { Text("@$it", style = onest(13, color = p.muted)) }
                    }
                    PrimaryButton(t.fr.unblock, small = true) { me.unblock(person) }
                }
            }
        }
    }
}

private enum class Ask { Logout, Everywhere, Delete }

/** Солнце и луна (.theme-toggle): выбранная — белая плашка. */
@Composable
private fun ThemeButton(path: String, label: String, on: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(44.dp, 36.dp).background(if (on) p.surface else Color.Transparent, RoundedCornerShape(11.dp))
            .pressable(role = Role.RadioButton, onClick = onClick).semantics { selected = on; contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { StrokeGlyph(path, if (on) p.text else p.muted, 20.dp) }
}
