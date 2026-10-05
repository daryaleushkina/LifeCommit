// Строка, которую можно смахнуть влево (SwipeRow.tsx, круг 21, как в «Почте»): короткий свайп открывает кнопку,
// протянул дальше 55% ширины — срабатывает крайняя (обычно «Удалить»). Вертикальная прокрутка работает как обычно:
// строка ловит только горизонтальное движение. Для TalkBack действие доступно из меню действий строки.
package app.lifecommit.ui

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

data class SwipeAction(val label: String, val danger: Boolean, val run: () -> Unit)

/** Ширина одной кнопки под строкой. */
private val BUTTON = 84.dp

/** Дальше этой доли ширины — «до конца»: срабатывает крайнее действие. */
private const val FULL = 0.55f

@Composable
fun SwipeRow(actions: List<SwipeAction>, card: Boolean = false, radius: Dp = Dim.radius, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    if (actions.isEmpty()) {
        Box(modifier) { content() }
        return
    }
    val p = LocalPalette.current
    val view = LocalView.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    // Смещение строки меняется прямо в жесте (без корутины на каждый сдвиг пальца); анимация — только доводка.
    var x by remember { mutableFloatStateOf(0f) }
    val settle: suspend (Float, Int) -> Unit = { target, ms -> animate(x, target, animationSpec = tween(ms)) { v, _ -> x = v } }
    val openPx = with(density) { (BUTTON * actions.size).toPx() }
    BoxWithConstraints(
        modifier
            .clipToBounds()
            .semantics { customActions = actions.map { a -> CustomAccessibilityAction(a.label) { a.run(); true } } },
    ) {
        val width = constraints.maxWidth.toFloat()
        // Перешли ли черту «до конца» — чтобы хаптика щёлкнула один раз на пересечение.
        val full = remember { booleanArrayOf(false) }
        // Кнопки лежат под строкой и открываются вместе с её сдвигом.
        val shown = -x
        Row(
            Modifier.matchParentSize().clearAndSetSemantics {},
            horizontalArrangement = Arrangement.End,
        ) {
            val shownDp = with(density) { shown.toDp() }
            actions.forEachIndexed { i, a ->
                val last = i == actions.lastIndex
                val w = if (shown > width * FULL) (if (last) shownDp else 0.dp) else shownDp / actions.size
                Box(
                    Modifier
                        .width(w)
                        .fillMaxHeight()
                        .padding(start = if (card) 8.dp else 6.dp, top = if (card) 0.dp else 4.dp, bottom = if (card) 0.dp else 4.dp, end = if (last && !card) 4.dp else 0.dp)
                        .pressable {
                            scope.launch { settle(0f, 240) }
                            a.run()
                        }
                        .background(if (a.danger) p.danger else p.neutralPill, RoundedCornerShape(if (card) radius else radius - 4.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        val ink = if (a.danger) p.dangerText else p.neutralPillText
                        if (w > 40.dp) {
                            StrokeGlyph(Glyph.TRASH, ink, 20.dp)
                            Text(a.label, style = onest(12, 600, ink), maxLines = 1)
                        }
                    }
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .offset { IntOffset(x.roundToInt(), 0) }
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { delta ->
                        val next = (x + delta).coerceIn(-width, 0f)
                        val nowFull = -next > width * FULL
                        if (nowFull != full[0]) {
                            full[0] = nowFull
                            view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                        }
                        x = next
                    },
                    onDragStopped = {
                        if (-x > width * FULL) {
                            // Протянули до конца — крайнее действие сразу; строка уходит из списка (или вернётся на место).
                            actions.last().run()
                            settle(0f, 200)
                        } else {
                            settle(if (-x > openPx / 2) -openPx else 0f, 240)
                        }
                    },
                ),
        ) { content() }
    }
}
