// Плитка вида привычки с рисунком (src/components/KindIcon.tsx): цвет — по виду, рисунок — по названию (HabitIcon),
// не узнали — рисунок вида. Сами рисунки — KindIcons.generated.kt (android/scripts/icons.mjs).
package app.lifecommit.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import app.lifecommit.core.HabitIcon
import app.lifecommit.core.TaskKind

enum class Ink { Ink, Mid }

data class Rotation(val degrees: Float, val cx: Float, val cy: Float)

sealed interface Shape {
    data class Rect(val x: Float, val y: Float, val width: Float, val height: Float, val radius: Float) : Shape
    data class Circle(val cx: Float, val cy: Float, val r: Float) : Shape
    data class Path(val d: String) : Shape
}

data class IconPart(val shape: Shape, val fill: Ink?, val stroke: Ink?, val lineWidth: Float, val rotate: Rotation?) {
    fun path(): androidx.compose.ui.graphics.Path {
        val p = when (shape) {
            is Shape.Rect -> Path().apply {
                addRoundRect(RoundRect(Rect(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height), CornerRadius(shape.radius)))
            }
            is Shape.Circle -> Path().apply { addOval(Rect(Offset(shape.cx, shape.cy), shape.r)) }
            is Shape.Path -> PathParser().parsePathString(shape.d).toPath()
        }
        rotate?.let { r ->
            p.transform(Matrix().apply {
                translate(r.cx, r.cy)
                rotateZ(r.degrees)
                translate(-r.cx, -r.cy)
            })
        }
        return p
    }
}

object KindIcons {
    fun parts(kind: TaskKind, title: String?): List<IconPart> {
        val icon = title?.let(HabitIcon::of)
        return icon?.let { KindIconData.habit[it] } ?: KindIconData.kind[kind].orEmpty()
    }
}

/** Плитка: 44 (по умолчанию), 56 (крупная), 36 (мелкая) — как .kind-tile, .lg, .sm. */
enum class TileSize(val side: Int, val radius: Int, val icon: Int) { Sm(36, 12, 22), Md(44, 14, 26), Lg(56, 18, 30) }

@Composable
fun KindTile(kind: TaskKind, title: String? = null, size: TileSize = TileSize.Md) {
    val colors = LocalPalette.current.kind(kind)
    val parts = remember(kind, title) { KindIcons.parts(kind, title).map { it to it.path() } }
    Box(
        Modifier.size(size.side.dp).background(colors.bg, RoundedCornerShape(size.radius.dp)).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size.icon.dp)) {
            val k = this.size.width / 48f
            scale(k, k, pivot = Offset.Zero) {
                for ((part, path) in parts) {
                    part.fill?.let { drawPath(path, if (it == Ink.Ink) colors.ink else colors.mid) }
                    part.stroke?.let {
                        drawPath(path, if (it == Ink.Ink) colors.ink else colors.mid, style = Stroke(part.lineWidth, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        }
    }
}
