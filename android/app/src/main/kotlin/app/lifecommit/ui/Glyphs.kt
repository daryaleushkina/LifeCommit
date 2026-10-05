// Значки интерфейса — те же пути SVG, что в мини-аппе (viewBox 24×24, линии цветом текста, концы круглые).
package app.lifecommit.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

object Glyph {
    /** Галочка отметки (RoundBtn ok, Check дела). */
    const val CHECK = "M5 12.5l4.5 4.5L19 7.5"

    /** Крестик «было» у «бросить». */
    const val CROSS = "M7 7l10 10M17 7L7 17"

    /** Карандаш «ввести число». */
    const val PENCIL = "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3"
    const val PLUS = "M12 5v14M5 12h14"
    const val CHEVRON = "M9.5 6l6 6-6 6"
    const val BACK = "M15 6l-6 6 6 6"
    const val TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
    const val UNDO = "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"
    const val CALENDAR_TAB = "M3.5 8.5a3.5 3.5 0 0 1 3.5-3.5h10a3.5 3.5 0 0 1 3.5 3.5v8.5a3.5 3.5 0 0 1-3.5 3.5h-10a3.5 3.5 0 0 1-3.5-3.5zM3.5 10h17M8 3v4M16 3v4"
    const val GROUPS_TAB = "M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0zM2.5 19.5c.6-3 3.2-4.8 6.5-4.8s5.9 1.8 6.5 4.8M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.3.5 3.8 2.1 4.2 4.6"
    const val ME_TAB = "M16 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0zM4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"

    /** Микрофон (MicIcon в VoiceSheet.tsx). */
    const val MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3"

    /** Подробности события и шторка дела (TodoSheet.tsx). */
    const val PIN = "M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21zM14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"
    const val VIDEO = "M6 6h7a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM16 10.5l5-3v9l-5-3"
    const val PEOPLE = "M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"
    const val NOTES = "M5 6h14M5 11h14M5 16h9"

    /** «Обновить» и «Календари» в шапке «Календаря» (Calendar.tsx). */
    const val REFRESH = "M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4"
    const val SETTINGS = "M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
    const val HIDE = "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4.2-1M9.9 10a3 3 0 0 0 4.1 4.1"

    /** Самолётик Telegram на кнопке входа. */
    const val TELEGRAM = "M21 4L3 11l6 2.5L19 7l-7.5 8L18 20l3-16z"
}

/** Путь SVG 24×24 линией. */
@Composable
fun StrokeGlyph(d: String, color: Color, size: Dp = 24.dp, lineWidth: Float = 2f, modifier: Modifier = Modifier) {
    val path = remember(d) { PathParser().parsePathString(d).toPath() }
    Canvas(modifier.size(size).clearAndSetSemantics {}) {
        val k = this.size.width / 24f
        scale(k, k, pivot = Offset.Zero) {
            drawPath(path, color, style = Stroke(width = lineWidth, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/** Значок «Сегодня» — сетка 3×3 залитых квадратиков (как TABS[0] в App.tsx). */
@Composable
fun GridGlyph(color: Color, size: Dp = 24.dp) {
    Canvas(Modifier.size(size).clearAndSetSemantics {}) {
        val s = this.size.width / 24f
        for (y in listOf(3f, 10f, 17f)) for (x in listOf(3f, 10f, 17f)) {
            drawRoundRect(color, Offset(x * s, y * s), Size(5 * s, 5 * s), CornerRadius(1.4f * s))
        }
    }
}
