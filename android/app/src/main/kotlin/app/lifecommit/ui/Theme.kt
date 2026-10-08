// Палитра «Мягкий» — те же цвета, что токены src/styles/app.css (светлая :root, тёмная [data-color-scheme='dark']) и
// Palette.swift на iPhone. Поменяли токен в мини-аппе — меняем здесь (AGENTS.md «Платформы»: вид нативных — копия мини-аппа).
package app.lifecommit.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lifecommit.R
import app.lifecommit.core.Strings
import app.lifecommit.core.TaskKind

@Immutable
data class Palette(
    val bg: Color,
    val surface: Color,
    val text: Color,
    val muted: Color,
    val line: Color,
    val accent: Color,
    val accentText: Color,
    val accentSoft: Color,
    val accentSoftText: Color,
    val accentLabel: Color,
    val warn: Color,
    val warnSoft: Color,
    val warnText: Color,
    val danger: Color,
    val dangerText: Color,
    val neutralPill: Color,
    val neutralPillText: Color,
    val outside: Color,
    val heat: List<Color>,
    /** Стекло: заливка панели, обводка, тень. */
    val glass: Color,
    val glassEdge: Color,
    val glassShadow: Color,
    val glassShadowRadius: Float,
    val glassShadowY: Float,
    /** Цветные пятна фона (--glow). */
    val glow: List<Glow>,
    val isDark: Boolean,
    val kinds: Map<TaskKind, KindColors>,
) {
    /** radial-gradient(RX% RY% at X% Y%, цвет, transparent 70%): центр и радиусы — доли ширины и высоты экрана. */
    data class Glow(val color: Color, val center: Offset, val rx: Float, val ry: Float)

    data class KindColors(val bg: Color, val ink: Color, val mid: Color)

    fun kind(k: TaskKind): KindColors = kinds.getValue(k)

    companion object {
        val light = Palette(
            bg = Color(0xFFF6F4EE),
            surface = Color.White,
            text = Color(0xFF1F2A1F),
            muted = Color(0xFF5E665B),
            line = Color(0xFFE3E0D6),
            accent = Color(0xFF237A46),
            accentText = Color.White,
            accentSoft = Color(0xFFE6F2E9),
            accentSoftText = Color(0xFF1B6139),
            accentLabel = Color(0xFF237A46),
            warn = Color(0xFFB4532A),
            warnSoft = Color(0xFFF8E4DA),
            warnText = Color.White,
            danger = Color(0xFFC4413A),
            dangerText = Color.White,
            neutralPill = Color(0xFF6B7368),
            neutralPillText = Color.White,
            outside = Color(0xFF4470CC),
            heat = listOf(Color(0xFFE4E8DF), Color(0xFFB8E0C4), Color(0xFF7CCB96), Color(0xFF3FA968), Color(0xFF237A46)),
            glass = Color.White.copy(alpha = 0.58f),
            glassEdge = Color.White.copy(alpha = 0.75f),
            glassShadow = Color(0xFF1F2A1F).copy(alpha = 0.07f),
            glassShadowRadius = 24f,
            glassShadowY = 8f,
            glow = listOf(
                Glow(Color(178, 228, 196).copy(alpha = 0.7f), Offset(0f, 0.18f), 0.6f, 0.34f),
                Glow(Color(243, 226, 184).copy(alpha = 0.7f), Offset(1f, 0.40f), 0.6f, 0.32f),
                Glow(Color(246, 211, 194).copy(alpha = 0.65f), Offset(0f, 0.70f), 0.6f, 0.32f),
                Glow(Color(190, 232, 206).copy(alpha = 0.7f), Offset(1f, 0.88f), 0.7f, 0.34f),
            ),
            isDark = false,
            kinds = mapOf(
                TaskKind.Check to KindColors(Color(0xFFE6F2E9), Color(0xFF237A46), Color(0xFFBFE3CB)),
                TaskKind.Count to KindColors(Color(0xFFF5EBD3), Color(0xFF8A6412), Color(0xFFE9D29B)),
                TaskKind.Abstain to KindColors(Color(0xFFF8E4DA), Color(0xFFB4532A), Color(0xFFEFC3AE)),
            ),
        )

        val dark = Palette(
            bg = Color(0xFF0F1511),
            surface = Color(0xFF1B211C),
            text = Color(0xFFE8EEE6),
            muted = Color(0xFFA3AD9F),
            line = Color(0xFF2A322B),
            accent = Color(0xFF3FA968),
            accentText = Color(0xFF0E1A12),
            accentSoft = Color(0xFF1E3325),
            accentSoftText = Color(0xFF8FD6A6),
            accentLabel = Color(0xFF4CB878),
            warn = Color(0xFFE38A62),
            warnSoft = Color(0xFF3A241B),
            warnText = Color(0xFF1B110C),
            danger = Color(0xFFEC7A6F),
            dangerText = Color(0xFF1F0D0B),
            neutralPill = Color(0xFFA3AD9F),
            neutralPillText = Color(0xFF0F1511),
            outside = Color(0xFF7F9FE3),
            heat = listOf(Color.White.copy(alpha = 0.09f), Color(0xFF1E4A2E), Color(0xFF2B7143), Color(0xFF3FA968), Color(0xFF7CCB96)),
            glass = Color.White.copy(alpha = 0.07f),
            glassEdge = Color.White.copy(alpha = 0.07f),
            glassShadow = Color.Black.copy(alpha = 0.25f),
            glassShadowRadius = 30f,
            glassShadowY = 10f,
            glow = listOf(
                Glow(Color(31, 107, 63).copy(alpha = 0.55f), Offset(0f, 0.16f), 0.7f, 0.36f),
                Glow(Color(90, 74, 18).copy(alpha = 0.5f), Offset(1f, 0.42f), 0.6f, 0.32f),
                Glow(Color(107, 46, 24).copy(alpha = 0.5f), Offset(0f, 0.72f), 0.6f, 0.32f),
                Glow(Color(27, 92, 56).copy(alpha = 0.55f), Offset(1f, 0.88f), 0.7f, 0.34f),
            ),
            isDark = true,
            kinds = mapOf(
                TaskKind.Check to KindColors(Color(0xFF1E3325), Color(0xFF8FD6A6), Color(0xFF2B5A3A)),
                TaskKind.Count to KindColors(Color(0xFF3A3116), Color(0xFFE2C36B), Color(0xFF6B5720)),
                TaskKind.Abstain to KindColors(Color(0xFF3A241B), Color(0xFFE38A62), Color(0xFF6E3F2C)),
            ),
        )
    }
}

val LocalPalette = staticCompositionLocalOf { Palette.light }
val LocalStrings = staticCompositionLocalOf { Strings.ru }

/** Шрифт Onest (OFL) — переменный файл, начертания — осью wght, как 'Onest Variable' в мини-аппе. */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Onest = FontFamily(
    listOf(400, 500, 600, 700).map { w ->
        Font(R.font.onest, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

/** Текст в пикселях мини-аппа, но в sp: растёт вместе с размером шрифта в настройках телефона. */
fun onest(size: Int, weight: Int = 400, color: Color = Color.Unspecified, lineHeight: TextUnit = TextUnit.Unspecified, tracking: Float = 0f) = TextStyle(
    fontFamily = Onest,
    fontSize = size.sp,
    fontWeight = FontWeight(weight),
    color = color,
    lineHeight = lineHeight,
    letterSpacing = if (tracking == 0f) TextUnit.Unspecified else (tracking * size).sp,
)

/** Радиусы и цель нажатия — --radius 20, --radius-btn 14, --tap 48. */
object Dim {
    val radius = 20.dp
    val radiusBtn = 14.dp
    val tap = 48.dp
    val side = 20.dp
}

@Composable
fun LifeCommitTheme(dark: Boolean, strings: Strings, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalPalette provides if (dark) Palette.dark else Palette.light,
        LocalStrings provides strings,
        content = content,
    )
}
