// Шторка «Календари» — как src/components/CalendarsSheet.tsx: Google (вход Google в Custom Tab, возврат в приложение,
// выбор календарей) и Apple (пароль приложения по шагам). Подключённый показывает, когда обновлялся, что забирать,
// куда пишем наши дела, и даёт отключить; перестал пускать — просит подключить заново.
package app.lifecommit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.lifecommit.CalendarModel
import app.lifecommit.core.CalendarAccount
import app.lifecommit.core.CalendarAccounts
import app.lifecommit.core.TodoSource
import kotlinx.coroutines.launch

const val APPLE_ID_URL = "https://account.apple.com/account/manage"

@Composable
fun CalendarsSheet(cal: CalendarModel, links: Links, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var form by remember { mutableStateOf(false) }
    val accounts = cal.accounts
    val apple = accounts?.firstOrNull { it.provider == TodoSource.Apple }
    val google = accounts?.firstOrNull { it.provider == TodoSource.Google }
    val destination = accounts?.let(CalendarAccounts::destination)
    val googleUrl = cal.googleUrl

    if (form) {
        AppleForm(cal, apple?.login.orEmpty(), links, onDone = { form = false }, onClose = { form = false })
        return
    }
    val signInGoogle = { googleUrl?.takeIf { it.isNotEmpty() }?.let { links.open(it, true) } }

    Sheet(t.cal.sheetTitle, onClose) {
        Text(t.cal.sheetHint, style = onest(14, color = p.muted), modifier = Modifier.padding(horizontal = 4.dp))
        if (cal.sheetFailed) ErrorNote(t.error, Modifier.padding(top = 10.dp)) { cal.sheetFailed = false }
        // Вернулись из входа Google ни с чем: что случилось и что делать (тексты страницы возврата, worker/google.ts).
        cal.googleReturn?.let { key -> t.cal.googleReturn[key] }?.let { (title, hint) ->
            ErrorNote("$title. $hint", Modifier.padding(top = 10.dp).testTag("googleReturn")) { cal.googleReturn = null }
        }

        // Google
        Provider(
            logo = "G",
            google = true,
            title = t.cal.google,
            sub = when {
                accounts == null -> null
                google != null -> when (google.status) {
                    "ok" -> "${t.cal.connected} · ${CalendarAccounts.syncedLabel(t, google.lastSyncAt)}"
                    "setup" -> t.cal.googleSetup
                    else -> google.login
                }
                googleUrl != "" -> t.cal.googleNeeds
                else -> null
            },
            dim = google == null && googleUrl == "",
        ) {
            if (accounts != null && google == null) {
                if (googleUrl == "") Text(t.cal.googleSoon, style = onest(13, color = p.muted))
                else ProviderGo(t.cal.connect, enabled = googleUrl != null, tag = "connectGoogle") { signInGoogle() }
            }
        }
        if (accounts != null && google == null && googleUrl != "") Text(t.cal.googleUnverified, style = onest(14, color = p.muted), modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp))
        if (google != null && (google.status == "auth_failed" || google.status == "error")) {
            Warn(t.cal.googleExpired, if (!googleUrl.isNullOrEmpty()) t.cal.reconnect else null) { signInGoogle() }
        }
        if (google?.status == "setup") GoogleSetup(cal, google)
        if (google != null && google.status != "setup") AccountSettings(cal, google, t.cal.google, destination?.id == google.id)

        // Apple
        Provider(
            logo = "A",
            google = false,
            title = t.cal.apple,
            // Пока список грузится, не говорим «не подключено» — это было бы неправдой.
            sub = when {
                accounts == null -> null
                apple == null -> t.cal.appleNeeds
                apple.status == "ok" -> "${t.cal.connected} · ${CalendarAccounts.syncedLabel(t, apple.lastSyncAt)}"
                else -> apple.login
            },
            dim = false,
        ) {
            if (accounts != null && apple == null) ProviderGo(t.cal.connect, tag = "connectApple") { form = true }
        }
        if (apple != null && apple.status != "ok") Warn(t.cal.authFailed, t.cal.newPassword) { form = true }
        if (apple != null) AccountSettings(cal, apple, t.cal.apple, destination?.id == apple.id)
    }
}

@Composable
private fun Provider(logo: String, google: Boolean, title: String, sub: String?, dim: Boolean, action: @Composable () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.padding(top = 10.dp).fillMaxWidth().alpha(if (dim) 0.6f else 1f).background(p.bg, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).background(if (google) p.outside.copy(alpha = 0.16f) else p.heat[0], RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) { Text(logo, style = onest(17, 700, if (google) p.outside else p.text)) }
        Column(Modifier.weight(1f)) {
            Text(title, style = onest(16, 600, p.text))
            sub?.let { Text(it, style = onest(13, color = p.muted)) }
        }
        action()
    }
}

@Composable
private fun ProviderGo(label: String, enabled: Boolean = true, tag: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.heightIn(min = 40.dp).alpha(if (enabled) 1f else 0.4f).pressable(enabled = enabled, onClick = onClick)
            .background(p.accent, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, style = onest(14, 600, p.accentText)) }
}

/** Терракотовая плашка (.cal-warn) со ссылкой «подключить заново». */
@Composable
private fun Warn(text: String, link: String?, onLink: () -> Unit) {
    val p = LocalPalette.current
    Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(p.warnSoft, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Text(text, style = onest(14, color = p.warn))
        if (link != null) Text(link, style = onest(14, 600, p.warn).copy(textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline), modifier = Modifier.padding(top = 4.dp).pressable(onClick = onLink))
    }
}

/** Календари аккаунта с переключателями. */
@Composable
private fun CollectionToggles(account: CalendarAccount, onToggle: (String, Boolean) -> Unit) {
    val p = LocalPalette.current
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
        account.collections.forEachIndexed { i, c ->
            if (i > 0) RowDivider()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).pressable(role = Role.Switch) { onToggle(c.url, !c.enabled) }.padding(start = 18.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(10.dp).background(parseColor(c.color) ?: p.heat[2], CircleShape))
                Text(c.name, style = onest(16, 500, p.text), modifier = Modifier.weight(1f))
                Switch(
                    checked = c.enabled,
                    onCheckedChange = { onToggle(c.url, it) },
                    colors = SwitchDefaults.colors(checkedTrackColor = p.accent, checkedThumbColor = p.surface, uncheckedTrackColor = p.heat[0], uncheckedThumbColor = p.surface, uncheckedBorderColor = Color.Transparent),
                )
            }
        }
    }
}

/** Цвет календаря «#rrggbb» из ответа; не цвет — null (рисуем зелёным по умолчанию). */
private fun parseColor(hex: String?): Color? {
    val h = hex?.removePrefix("#") ?: return null
    if (h.length != 6) return null
    return h.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

/** Подключённый календарь: куда пишем наши дела (только у того, куда пишем сейчас), что забирать, отключить. */
@Composable
private fun AccountSettings(cal: CalendarModel, account: CalendarAccount, name: String, isDestination: Boolean) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var confirm by remember { mutableStateOf(false) }
    var pick by remember { mutableStateOf(false) }
    val writable = account.collections.filter { it.writable }
    if (isDestination && writable.isNotEmpty()) {
        Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(p.bg, RoundedCornerShape(Dim.radius))) {
            SettingRow(t.cal.writeTo, writable.firstOrNull { it.url == account.defaultUrl }?.name ?: "", onClick = { pick = true })
        }
    }
    if (account.collections.isNotEmpty()) {
        SectionLabel(t.cal.whatToTake, Modifier.padding(start = 4.dp, top = 14.dp))
        CollectionToggles(account) { url, on -> cal.toggleCollection(account, url, on, sync = true) }
    }
    Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
        QuietLink(t.cal.disconnectOf(name), p.warn) { confirm = true }
    }
    if (confirm) {
        Confirm(t.cal.disconnectConfirm, t.cal.disconnect, onConfirm = {
            confirm = false
            cal.disconnect(account)
        }, onDismiss = { confirm = false })
    }
    if (pick) {
        Sheet(t.cal.writeTo, onClose = { pick = false }) {
            writable.forEachIndexed { i, c ->
                if (i > 0) RowDivider()
                val on = c.url == account.defaultUrl
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).pressable(role = Role.RadioButton) {
                        pick = false
                        if (!on) cal.setDestination(account, c.url)
                    }.padding(horizontal = 4.dp).semantics { selected = on },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(c.name, style = onest(16, if (on) 600 else 500, if (on) p.accent else p.text), modifier = Modifier.weight(1f))
                    if (on) StrokeGlyph(Glyph.CHECK, p.accent, 20.dp, 2.4f)
                }
            }
        }
    }
}

/** Google только что подключили: какие календари забирать. События приходят после «Готово». */
@Composable
private fun GoogleSetup(cal: CalendarModel, account: CalendarAccount) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    Text(t.cal.googleChoose, style = onest(14, color = p.muted), modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp))
    CollectionToggles(account) { url, on -> cal.toggleCollection(account, url, on, sync = false) }
    if (error) ErrorNote(t.cal.errGoogle, Modifier.padding(top = 10.dp))
    PrimaryButton(if (busy) t.cal.connecting else t.done, Modifier.padding(top = 14.dp).testTag("googleDone"), wide = true, enabled = !busy && account.collections.any { it.enabled }) {
        busy = true
        error = false
        scope.launch {
            if (!cal.confirmGoogle(account)) error = true
            busy = false
        }
    }
}

/** Подключение Apple: три шага, кнопка на сайт Apple ID, почта и пароль приложения. */
@Composable
private fun AppleForm(cal: CalendarModel, initialLogin: String, links: Links, onDone: () -> Unit, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val login = rememberTextFieldState(initialLogin)
    val password = rememberTextFieldState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Sheet(t.cal.appleTitle, onClose) {
        Text(t.cal.appleHint, style = onest(14, color = p.muted), modifier = Modifier.padding(horizontal = 4.dp))
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            t.cal.appleSteps.forEachIndexed { i, step ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(22.dp).background(p.accentSoft, CircleShape), contentAlignment = Alignment.Center) { Text("${i + 1}", style = onest(12, 700, p.accent)) }
                    Text(step, style = onest(15, color = p.text))
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.heightIn(min = 40.dp).pressable { links.open(APPLE_ID_URL, true) }, contentAlignment = Alignment.Center) {
                Text("${t.cal.openAppleId} ↗", style = onest(15, 600, p.accent))
            }
        }
        SheetInput(login, t.cal.appleLogin, 200, "appleLogin", t.cal.appleLogin, KeyboardOptions(keyboardType = KeyboardType.Email, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false))
        // Пароль приложения показываем открыто (его копируют с сайта Apple и сверяют глазами), но не запоминаем подсказками клавиатуры.
        SheetInput(password, t.cal.applePassword, 40, "applePassword", t.cal.applePassword, KeyboardOptions(keyboardType = KeyboardType.Password, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false))
        error?.let { ErrorNote(it, Modifier.padding(top = 10.dp)) }
        PrimaryButton(
            if (busy) t.cal.connecting else t.cal.connect,
            Modifier.padding(top = 14.dp).testTag("appleSubmit"),
            wide = true,
            enabled = !busy && CalendarAccounts.appleFormValid(login.text.toString(), password.text.toString()),
        ) {
            busy = true
            error = null
            scope.launch {
                val failed = cal.connectApple(login.text.toString(), password.text.toString(), t)
                busy = false
                if (failed == null) onDone() else error = failed
            }
        }
    }
}
