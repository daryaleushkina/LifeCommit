// Матовое стекло мини-аппа (--glass, --glass-edge, --glass-shadow) и мягкие цветные пятна фона (--glow).
// Размытия подложки (backdrop-filter) в Compose нет: под стеклом и так только неподвижные пятна фона, поэтому заливка,
// кромка и тень дают тот же вид.
package app.lifecommit.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp

/** Фон всех экранов: цвет --bg и четыре размытых пятна. Пятна стоят на месте, экран листается поверх. */
@Composable
fun GlowBackground(modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    Canvas(modifier.fillMaxSize().clearAndSetSemantics {}) {
        drawRect(palette.bg)
        for (glow in palette.glow) {
            val rx = glow.rx * size.width
            val ry = glow.ry * size.height
            val center = Offset(glow.center.x * size.width, glow.center.y * size.height)
            // Эллипс — круг, растянутый по высоте.
            scale(1f, ry / rx, pivot = center) {
                drawCircle(
                    brush = Brush.radialGradient(0f to glow.color, 0.7f to glow.color.copy(alpha = 0f), center = center, radius = rx),
                    radius = rx,
                    center = center,
                )
            }
        }
    }
}

/** Карточка из стекла: полупрозрачная заливка, светлая кромка и мягкая тень. */
fun Modifier.glass(radius: Dp = Dim.radius, palette: Palette): Modifier {
    val shape: Shape = RoundedCornerShape(radius)
    return this
        .dropShadow(shape, Shadow(radius = palette.glassShadowRadius.dp, color = palette.glassShadow, offset = DpOffset(0.dp, palette.glassShadowY.dp)))
        .background(palette.glass, shape)
        .border(1.dp, palette.glassEdge, shape)
}

@Composable
fun Modifier.glass(radius: Dp = Dim.radius): Modifier = glass(radius, LocalPalette.current)
