// Общие детали экранов — классы мини-аппа (src/styles/app.css): .act.primary, .error, .page-head, .section-label,
// .link-btn, .quiet-link, .card, .row, шторка снизу, подтверждение.
package app.lifecommit.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Нажатие слегка уменьшает элемент (transform: scale(0.96) в мини-аппе). */
@Composable
fun Modifier.pressable(enabled: Boolean = true, role: Role = Role.Button, label: String? = null, onClick: () -> Unit): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, tween(160), label = "press")
    return this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(source, indication = null, enabled = enabled, role = role, onClickLabel = label, onClick = onClick)
}

/** Главная кнопка — зелёная, .act.primary. Неактивная — прозрачность 0.4 (button:disabled). */
@Composable
fun PrimaryButton(title: String, modifier: Modifier = Modifier, wide: Boolean = false, enabled: Boolean = true, busy: Boolean = false, small: Boolean = false, leading: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        modifier
            .alpha(if (enabled || busy) 1f else 0.4f)
            .then(if (wide) Modifier.fillMaxWidth() else Modifier.widthIn(min = 64.dp))
            .heightIn(min = if (small) 40.dp else Dim.tap)
            .pressable(enabled = enabled && !busy, onClick = onClick)
            .background(p.accent, RoundedCornerShape(Dim.radiusBtn))
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), color = p.accentText, strokeWidth = 2.dp)
        } else {
            leading?.invoke()
            Text(title, style = onest(if (small) 14 else 17, 700, p.accentText))
        }
    }
}

/** Плашка ошибки — терракотовая, как .error в мини-аппе. Тап (если есть) убирает. */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier, onDismiss: (() -> Unit)? = null) {
    val p = LocalPalette.current
    Text(
        text,
        style = onest(14, color = p.warn),
        modifier = modifier
            .fillMaxWidth()
            .background(p.warnSoft, RoundedCornerShape(14.dp))
            .then(if (onDismiss != null) Modifier.clickable(onClick = onDismiss) else Modifier)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

/** Место под строкой состояния — как var(--app-inset-top). */
@Composable
fun StatusBarSpace() = Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))

/** Шапка экрана: крупный заголовок и подпись (.page-head). */
@Composable
fun PageHead(title: String, subtitle: String? = null, top: Dp = 24.dp) {
    val p = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(top = top, start = 4.dp, end = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = onest(30, 700, p.text, lineHeight = 36.sp, tracking = -0.02f), modifier = Modifier.semantics { heading() })
        if (subtitle != null) Text(subtitle, style = onest(15, color = p.muted, lineHeight = 20.sp))
    }
}

/** Подпись раздела — прописными, серая (.section-label). */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Text(
        text.uppercase(LocalStrings.current.locale),
        style = onest(13, 600, p.muted, lineHeight = 18.sp, tracking = 0.04f),
        modifier = modifier.semantics { heading() },
    )
}

/** Тихая кнопка-ссылка с плюсом (.link-btn). */
@Composable
fun LinkButton(text: String, plus: Boolean = false, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.padding(top = 4.dp).heightIn(min = Dim.tap).pressable(onClick = onClick).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (plus) StrokeGlyph(Glyph.PLUS, p.muted, 18.dp, 2.2f)
        Text(text, style = onest(15, 500, p.muted))
    }
}

/** Тихая ссылка под формой (.quiet-link): серая, красная (удалить) или терракотовая (выйти). */
@Composable
fun QuietLink(text: String, color: Color, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = Dim.tap).pressable(onClick = onClick).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
        Text(text, style = onest(15, color = color))
    }
}

/** Карточка из стекла (.card): строки — через линию. */
@Composable
fun Card(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(0.dp), content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().glass().padding(padding), content = content)
}

/** Линия между строками карточки (.row + .row). */
@Composable
fun RowDivider(start: Dp = 0.dp) {
    Box(Modifier.fillMaxWidth().padding(start = start).height(1.dp).background(LocalPalette.current.line))
}

/** Строка настройки (.row): подпись слева, значение и шеврон справа. */
@Composable
fun SettingRow(label: String, value: String? = null, chevron: Boolean = true, onClick: (() -> Unit)? = null, trailing: (@Composable RowScope.() -> Unit)? = null) {
    val p = LocalPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(start = 18.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, style = onest(16, 500, p.text), modifier = Modifier.weight(1f), maxLines = 1)
        if (value != null) Text(value, style = onest(15, color = p.muted))
        trailing?.invoke(this)
        if (chevron && onClick != null) StrokeGlyph(Glyph.CHEVRON, p.muted, 20.dp)
    }
}

/** Шторка снизу (.sheet): тянется вниз, закрывается системным «назад» и тапом мимо. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(title: String?, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = state,
        containerColor = p.surface,
        contentColor = p.text,
        scrimColor = Color.Black.copy(alpha = 0.4f),
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        dragHandle = { Box(Modifier.padding(top = 12.dp, bottom = 14.dp).size(40.dp, 4.dp).background(p.line, RoundedCornerShape(2.dp))) },
    ) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding().padding(bottom = 20.dp)) {
            if (title != null) {
                Text(title, style = onest(18, 700, p.text, lineHeight = 24.sp), modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 10.dp).semantics { heading() })
            }
            content()
        }
    }
}

/** Подтверждение (popup Telegram в мини-аппе) — системный диалог в цветах приложения. */
@Composable
fun Confirm(message: String, confirm: String, destructive: Boolean = true, cancel: String? = LocalStrings.current.cancel, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.surface,
        textContentColor = p.text,
        text = { Text(message, style = onest(16, color = p.text)) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirm, style = onest(16, 600, if (destructive) p.danger else p.accent)) }
        },
        dismissButton = cancel?.let { c -> { TextButton(onClick = onDismiss) { Text(c, style = onest(16, 500, p.text)) } } },
    )
}

/** «‹ Назад» — стеклянная плашка слева сверху, как кнопка Telegram над мини-аппом; системный «назад» работает тоже. */
@Composable
fun BackPill(onClick: () -> Unit) {
    val p = LocalPalette.current
    val t = LocalStrings.current
    Row(
        Modifier
            .padding(top = 8.dp)
            .heightIn(min = 40.dp)
            .glass(14.dp)
            .pressable(onClick = onClick)
            .padding(start = 8.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        StrokeGlyph(Glyph.BACK, p.text, 20.dp)
        Text(t.back, style = onest(15, 500, p.text))
    }
}

/** Пустая подпись по центру (.empty). */
@Composable
fun EmptyNote(text: String) {
    Text(text, style = onest(16, color = LocalPalette.current.muted), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 24.dp))
}

/** Хаптика системы — нажатия на Android ощущаются как в других приложениях телефона. */
@Composable
fun rememberHaptics(): (app.lifecommit.Haptic) -> Unit {
    val view = LocalView.current
    return remember(view) {
        { kind ->
            val c = when (kind) {
                app.lifecommit.Haptic.Success ->
                    if (android.os.Build.VERSION.SDK_INT >= 30) android.view.HapticFeedbackConstants.CONFIRM else android.view.HapticFeedbackConstants.VIRTUAL_KEY
                app.lifecommit.Haptic.Impact -> android.view.HapticFeedbackConstants.LONG_PRESS
            }
            view.performHapticFeedback(c)
        }
    }
}

/** Только цифры и не длиннее max — для числовых полей (inputMode="numeric" и maxLength в мини-аппе). */
class DigitsOnly(private val max: Int) : androidx.compose.foundation.text.input.InputTransformation {
    override fun androidx.compose.foundation.text.input.TextFieldBuffer.transformInput() {
        val s = asCharSequence()
        if (s.length > max || !s.all(Char::isDigit)) revertAllChanges()
    }
}
