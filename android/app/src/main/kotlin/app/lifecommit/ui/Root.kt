// Что на экране: заставка, вход, ошибка загрузки или приложение — как App.tsx (boot.state) и RootView.swift.
package app.lifecommit.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
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
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import app.lifecommit.AppModel
import app.lifecommit.Route
import app.lifecommit.Tab

/** Что умеет делать снаружи: открыть ссылку (Telegram, Custom Tab). У Activity — настоящее, в тестах — запись. */
fun interface Links {
    /** false — открыть нечем (нет браузера и приложения для ссылки). */
    fun open(url: String, inBrowser: Boolean): Boolean
}

const val BOT_APP = "https://t.me/LifeCommit_bot?startapp"
const val BOT_CHAT = "https://t.me/LifeCommit_bot"

private val easeOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

@Composable
fun Root(model: AppModel, links: Links, telegramInstalled: () -> Boolean) {
    Box(Modifier.fillMaxSize()) {
        GlowBackground()
        when (model.phase) {
            AppModel.Phase.Loading -> Splash()
            AppModel.Phase.SignedOut -> SignIn(model, links, telegramInstalled)
            AppModel.Phase.Failed -> LoadError(model)
            AppModel.Phase.Ready -> Main(model, links)
        }
    }
}

/** Знак 3×3: самые тёмные клетки складываются в галочку; на заставке клетки загораются по очереди. */
@Composable
fun Logo(cell: Int = 24, gap: Int = 8, padding: Int = 14, radius: Int = 26, cellRadius: Int = 7, animated: Boolean = false) {
    val p = LocalPalette.current
    val levels = listOf(0, 1, 4, 1, 4, 2, 4, 2, 0)
    Column(
        Modifier.background(p.surface, RoundedCornerShape(radius.dp)).padding(padding.dp).clearAndSetSemantics {},
        verticalArrangement = Arrangement.spacedBy(gap.dp),
    ) {
        for (row in 0 until 3) {
            Row(horizontalArrangement = Arrangement.spacedBy(gap.dp)) {
                for (col in 0 until 3) {
                    val i = row * 3 + col
                    val shown = remember { Animatable(if (animated) 0f else 1f) }
                    if (animated) LaunchedEffect(Unit) { shown.animateTo(1f, tween(320, delayMillis = i * 60, easing = easeOut)) }
                    Box(
                        Modifier
                            .size(cell.dp)
                            .alpha(shown.value)
                            .scale(0.6f + 0.4f * shown.value)
                            .background(p.heat[levels[i]], RoundedCornerShape(cellRadius.dp)),
                    )
                }
            }
        }
    }
}

@Composable
private fun Brand() {
    val p = LocalPalette.current
    Text(
        buildAnnotatedString {
            append("Life")
            withStyle(SpanStyle(color = p.accent)) { append("Commit") }
        },
        style = onest(26, 700, p.text, tracking = -0.02f),
    )
}

@Composable
fun Splash() {
    Column(
        Modifier.fillMaxSize().semantics(mergeDescendants = true) { contentDescription = "LifeCommit" }.testTag("splash"),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Logo(animated = !isReducedMotion())
        Brand()
    }
}

/** Вход — как экран входа на компьютере (src/desktop/Login.tsx): знак, название, «Войти через Telegram». */
@Composable
fun SignIn(model: AppModel, links: Links, telegramInstalled: () -> Boolean) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Column(
        Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Logo()
        Brand()
        Text(t.signInSub, style = onest(16, color = p.muted), textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 320.dp))
        model.signInError?.let { ErrorNote(it, Modifier.widthIn(max = 360.dp).semantics { liveRegion = LiveRegionMode.Polite }) }
        PrimaryButton(
            t.signIn,
            modifier = Modifier.widthIn(max = 360.dp).testTag("signIn"),
            wide = true,
            busy = model.signingIn,
            leading = { StrokeGlyph(Glyph.TELEGRAM, p.accentText, 20.dp, 2.2f) },
        ) { model.beginSignIn(telegramInstalled()) { url, inBrowser -> links.open(url, inBrowser) } }
    }
}

/** Не загрузилось — «Проверьте интернет» и «Ещё раз». */
@Composable
fun LoadError(model: AppModel) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Column(
        Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(t.loadError, style = onest(16, color = p.muted), textAlign = TextAlign.Center)
        PrimaryButton(t.retry) { model.retry() }
    }
}

/** Приложение: вкладки и экраны поверх них (Navigation 3 — системный «назад» и предиктивный жест). */
@Composable
fun Main(model: AppModel, links: Links) {
    NavDisplay(
        backStack = model.backStack,
        onBack = { model.back() },
        entryProvider = entryProvider {
            entry<Route.Main> { Tabs(model, links) }
            entry<Route.Pick> { Onboarding(onPick = { model.open(Route.NewTask(it)) }, onBack = model::back, onSkip = null) }
            entry<Route.NewTask> { TaskEditor(model, taskId = null, kind = it.kind) }
            entry<Route.EditTask> { TaskEditor(model, taskId = it.id, kind = null) }
            entry<Route.Detail> { TaskDetail(model, it.id) }
            entry<Route.Archive> { Archive(model) }
        },
    )
    UndoToast(model)
}

/** Колонка экрана с отступами мини-аппа (.app-shell.with-tabs): по бокам 20, снизу — место под нижнюю панель. */
@Composable
fun Screen(withTabs: Boolean, modifier: Modifier = Modifier, content: LazyListScope.() -> Unit) {
    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Dim.side),
    ) {
        item { StatusBarSpace() }
        content()
        item {
            Spacer(Modifier.height(if (withTabs) 96.dp else 32.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun Tabs(model: AppModel, links: Links) {
    var voice by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        when (model.tab) {
            Tab.Today -> if (model.onboarding) {
                Onboarding(onPick = { model.open(Route.NewTask(it)) }, onBack = null, onSkip = model::skipOnboarding, withTabs = true)
            } else {
                Today(model, links)
            }
            Tab.Calendar -> CalendarScreen(model, links)
            Tab.Groups -> PendingSection(LocalStrings.current.groups, links)
            Tab.Me -> Me(model, links)
        }
        TabBar(model.tab, onTab = { model.tab = it }, onMic = { voice = true }, modifier = Modifier.align(Alignment.BottomCenter))
    }
    if (voice) VoiceSoon(links) { voice = false }
}

/** Нижняя панель: Сегодня · Календарь · микрофон · Вместе · Я (.tabbar). Микрофон крупнее и выступает над панелью. */
@Composable
fun TabBar(tab: Tab, onTab: (Tab) -> Unit, onMic: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Box(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                // В мини-аппе панель — размытое стекло (backdrop-filter); размытия подложки в Compose нет, поэтому фон почти
                // плотный: список под панелью не должен читаться сквозь неё.
                .background(p.bg.copy(alpha = 0.98f))
                .glass(0.dp)
                .navigationBarsPadding()
                .padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 12.dp)
                .testTag("tabbar"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TabButton(t.today, tab == Tab.Today, Modifier.weight(1f), { GridGlyph(it, 22.dp) }) { onTab(Tab.Today) }
            TabButton(t.calendar, tab == Tab.Calendar, Modifier.weight(1f), { StrokeGlyph(Glyph.CALENDAR_TAB, it, 22.dp, 1.9f) }) { onTab(Tab.Calendar) }
            Spacer(Modifier.size(80.dp, 56.dp))
            TabButton(t.groups, tab == Tab.Groups, Modifier.weight(1f), { StrokeGlyph(Glyph.GROUPS_TAB, it, 22.dp, 1.9f) }) { onTab(Tab.Groups) }
            TabButton(t.me, tab == Tab.Me, Modifier.weight(1f), { StrokeGlyph(Glyph.ME_TAB, it, 22.dp, 1.9f) }) { onTab(Tab.Me) }
        }
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .offset(y = (-26).dp + 6.dp)
                .size(68.dp + 14.dp)
                .background(p.bg, CircleShape)
                .padding(7.dp)
                .dropShadow(CircleShape, Shadow(22.dp, Color(0x47237A46), offset = DpOffset(0.dp, 8.dp)))
                .background(p.accent, CircleShape)
                .pressable(label = t.voiceMic, onClick = onMic)
                .semantics { contentDescription = t.voiceMic },
            contentAlignment = Alignment.Center,
        ) { StrokeGlyph(Glyph.MIC, p.accentText, 30.dp, 2.2f) }
    }
}

@Composable
private fun TabButton(label: String, active: Boolean, modifier: Modifier, icon: @Composable (Color) -> Unit, onClick: () -> Unit) {
    val p = LocalPalette.current
    val ink = if (active) p.accentLabel else p.muted
    Column(
        modifier
            .heightIn(min = 56.dp)
            .pressable(role = Role.Tab, onClick = onClick)
            .semantics(mergeDescendants = true) { selected = active },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Box(Modifier.size(48.dp, 30.dp).background(if (active) p.accentSoft else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) { icon(ink) }
        Text(label, style = onest(12, if (active) 700 else 500, ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Раздела ещё нет в приложении (docs/parity.md «ждёт»): он есть в мини-аппе — с теми же данными. */
@Composable
fun PendingSection(title: String, links: Links, extra: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Screen(withTabs = true) {
        item { PageHead(title) }
        item {
            Card(Modifier.padding(top = 16.dp), padding = PaddingValues(18.dp)) {
                Text(t.pendingSection, style = onest(16, color = p.text))
                Spacer(Modifier.height(14.dp))
                PrimaryButton(t.openInTelegram, wide = true) { links.open(BOT_APP, false) }
            }
        }
        if (extra != null) item { extra() }
    }
}

/** «Я»: пока — имя, ссылка на мини-апп и «Выйти на этом устройстве» (нужно магазинам приложений уже сейчас). */
@Composable
fun Me(model: AppModel, links: Links) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    var confirm by remember { mutableStateOf(false) }
    PendingSection(model.user?.firstName ?: t.me, links) {
        Box(Modifier.fillMaxWidth().padding(top = 20.dp), contentAlignment = Alignment.Center) {
            QuietLink(t.logoutDevice, p.warn) { confirm = true }
        }
    }
    if (confirm) {
        Confirm(t.logoutDeviceConfirm, t.logoutOk, onConfirm = {
            confirm = false
            model.logout()
        }, onDismiss = { confirm = false })
    }
}

/** Микрофон, пока голоса нет в приложении: шторка с ссылкой на чат с ботом (он понимает голосовые). */
@Composable
fun VoiceSoon(links: Links, onClose: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Sheet(title = null, onClose = onClose) {
        Text(t.voiceMic, style = onest(22, 700, p.text), modifier = Modifier.padding(horizontal = 4.dp))
        Text(t.voiceSoon, style = onest(15, color = p.muted), modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 18.dp))
        PrimaryButton(t.openBot, wide = true) {
            onClose()
            links.open(BOT_CHAT, false)
        }
    }
}

/** Плашка «Вернуть» после удаления (.undo-toast) и «Что-то пошло не так», если сервер не удалил. */
@Composable
fun UndoToast(model: AppModel) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    val removal = model.removal
    val text = removal?.text ?: if (model.removalFailed) t.error else return
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 104.dp), contentAlignment = Alignment.BottomCenter) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .dropShadow(RoundedCornerShape(16.dp), Shadow(30.dp, Color.Black.copy(alpha = 0.2f), offset = DpOffset(0.dp, 10.dp)))
                .background(p.text.copy(alpha = 0.92f), RoundedCornerShape(16.dp))
                .then(if (removal == null) Modifier.pressable { model.dismissRemovalError() } else Modifier)
                .padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp)
                .semantics { liveRegion = LiveRegionMode.Polite }
                .testTag("undoToast"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(text, style = onest(15, color = p.bg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (removal != null) {
                Row(
                    Modifier
                        .heightIn(min = 40.dp)
                        .background(p.bg.copy(alpha = 0.16f), RoundedCornerShape(12.dp))
                        .pressable { model.undoRemoval() }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    StrokeGlyph(Glyph.UNDO, p.bg, 16.dp, 2.2f)
                    Text(t.swipe.undo, style = onest(15, 600, p.bg))
                }
            }
        }
    }
}

/** «Уменьшить движение» в настройках телефона (аниматор выключен) — заставка без анимации. */
@Composable
fun isReducedMotion(): Boolean {
    val context = androidx.compose.ui.platform.LocalContext.current
    return remember {
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
