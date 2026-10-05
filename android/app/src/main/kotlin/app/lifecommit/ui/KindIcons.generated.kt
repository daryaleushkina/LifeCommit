// Создано android/scripts/icons.mjs из src/components/KindIcon.tsx — не править руками.
// Рисунки 48×48: заливка — средний цвет плитки (Ink.Mid), линии — тёмный (Ink.Ink), как в мини-аппе.
package app.lifecommit.ui

import app.lifecommit.core.HabitIcon
import app.lifecommit.core.TaskKind

internal object KindIconData {
    val kind: Map<TaskKind, List<IconPart>> = mapOf(
        TaskKind.Check to listOf(
            IconPart(Shape.Rect(8f, 10f, 32f, 30f, 8f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M8 20h32M17 6v8M31 6v8"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M17 30l5 5 9-10"), fill = null, stroke = Ink.Ink, lineWidth = 3f, rotate = null),
        ),
        TaskKind.Count to listOf(
            IconPart(Shape.Rect(8f, 26f, 8f, 14f, 3f), fill = Ink.Mid, stroke = null, lineWidth = 0f, rotate = null),
            IconPart(Shape.Rect(20f, 18f, 8f, 22f, 3f), fill = Ink.Mid, stroke = null, lineWidth = 0f, rotate = null),
            IconPart(Shape.Rect(32f, 9f, 8f, 31f, 3f), fill = Ink.Ink, stroke = null, lineWidth = 0f, rotate = null),
            IconPart(Shape.Path("M6 42h36"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        TaskKind.Abstain to listOf(
            IconPart(Shape.Circle(24f, 24f, 15f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M13.5 34.5l21-21"), fill = null, stroke = Ink.Ink, lineWidth = 3f, rotate = null),
        ),
    )

    val habit: Map<HabitIcon, List<IconPart>> = mapOf(
        HabitIcon.Gym to listOf(
            IconPart(Shape.Rect(5f, 18f, 6f, 12f, 2f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Rect(37f, 18f, 6f, 12f, 2f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Rect(11f, 13f, 6f, 22f, 2.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Rect(31f, 13f, 6f, 22f, 2.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M17 24h14"), fill = null, stroke = Ink.Ink, lineWidth = 3.5f, rotate = null),
        ),
        HabitIcon.Run to listOf(
            IconPart(Shape.Path("M6 33c0-3 1-7 3-10l7 4c3 2 7 3 11 4 7 1 13 2 15 6v2H6z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M17 23l-3 4M22 25l-3 4M6 33h36"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M9 15h8M5 20h6"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Walk to listOf(
            IconPart(Shape.Path("M13 22c0-5 2-9 5-9s5 4 5 9-2 8-5 8-5-3-5-8z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M26 30c0-5 2-9 5-9s5 4 5 9-2 8-5 8-5-3-5-8z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M15 34h6M28 42h6"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Yoga to listOf(
            IconPart(Shape.Circle(24f, 11f, 4.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M24 17v10M10 22c5 3 9 4 14 4s9-1 14-4"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M8 38c5-7 10-10 16-10s11 3 16 10z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Exercise to listOf(
            IconPart(Shape.Circle(24f, 10f, 4.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M24 16v14M24 21L12 12M24 21l12-9M24 30l-8 11M24 30l8 11"), fill = null, stroke = Ink.Ink, lineWidth = 3f, rotate = null),
        ),
        HabitIcon.Swim to listOf(
            IconPart(Shape.Circle(33f, 14f, 4.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M10 24l10-7 8 6"), fill = null, stroke = Ink.Ink, lineWidth = 3f, rotate = null),
            IconPart(Shape.Path("M5 31c4-3 7-3 10 0s7 3 10 0 7-3 10 0 5 2 8 0M5 39c4-3 7-3 10 0s7 3 10 0 7-3 10 0 5 2 8 0"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Bike to listOf(
            IconPart(Shape.Circle(12f, 31f, 8f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(36f, 31f, 8f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M12 31l8-14h10l6 14M20 17l7 14M17 12h6M30 17l-2-5h5"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Water to listOf(
            IconPart(Shape.Path("M24 5c8 10 12 16 12 23a12 12 0 0 1-24 0c0-7 4-13 12-23z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M18 29a6 6 0 0 0 5 6"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Read to listOf(
            IconPart(Shape.Path("M24 13c-4-3-9-4-16-4v27c7 0 12 1 16 4 4-3 9-4 16-4V9c-7 0-12 1-16 4z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M24 13v27M13 17h5M13 23h5M30 17h5M30 23h5"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Study to listOf(
            IconPart(Shape.Path("M4 19l20-9 20 9-20 9z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M12 23v9c5 5 19 5 24 0v-9M40 21v10"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Write to listOf(
            IconPart(Shape.Path("M9 39l3-10L31 10l7 7-19 19z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M27 14l7 7M9 39l10-3M26 40h14"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Sleep to listOf(
            IconPart(Shape.Path("M38 28A15 15 0 1 1 20 10a12 12 0 0 0 18 18z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M29 8h8l-8 9h8"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Meds to listOf(
            IconPart(Shape.Rect(6f, 17f, 36f, 14f, 7f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = Rotation(-35f, 24f, 24f)),
            IconPart(Shape.Path("M18 16l12 16"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Food to listOf(
            IconPart(Shape.Path("M24 15c-3-3-8-3-11 0-4 4-3 12 0 18 2 5 6 7 11 5 5 2 9 0 11-5 3-6 4-14 0-18-3-3-8-3-11 0z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M24 15c0-4 1-7 4-9M27 9c3-2 6-1 8 1-2 3-5 4-8 2"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Sweets to listOf(
            IconPart(Shape.Circle(24f, 24f, 9f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M15 24L6 17v14zM33 24l9-7v14z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M20 21c3-2 6-2 8 1"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Smoke to listOf(
            IconPart(Shape.Rect(5f, 28f, 30f, 8f, 2.5f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M27 28v8M39 28v8M43 28v8"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M38 22c0-4-5-4-5-8s4-4 4-7"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Alcohol to listOf(
            IconPart(Shape.Path("M13 7h22c0 11-4 18-11 18S13 18 13 7z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M24 25v15M16 41h16M14 14h20"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Coffee to listOf(
            IconPart(Shape.Path("M8 19h26v10a11 11 0 0 1-11 11h-4A11 11 0 0 1 8 29z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M34 22h3a5 5 0 0 1 0 10h-3M16 13c0-3 3-3 3-6M25 13c0-3 3-3 3-6"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Phone to listOf(
            IconPart(Shape.Rect(13f, 5f, 22f, 38f, 6f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M21 11h6M21 37h6"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Clean to listOf(
            IconPart(Shape.Path("M20 8l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M35 25l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Money to listOf(
            IconPart(Shape.Circle(24f, 24f, 16f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M20 33V15h6a5 5 0 0 1 0 10h-9M17 30h10"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Work to listOf(
            IconPart(Shape.Rect(9f, 10f, 30f, 21f, 4f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M4 38h40M16 18h10M16 24h16"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Music to listOf(
            IconPart(Shape.Circle(14f, 34f, 6f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(34f, 30f, 6f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M20 34V11l20-4v23M20 18l20-4"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Art to listOf(
            IconPart(Shape.Path("M24 7C13 7 6 14 6 24s7 17 16 17c4 0 5-3 3-6-2-4 1-6 5-6h5c5 0 7-4 7-8 0-8-8-14-18-14z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(15f, 22f, 2.2f), fill = Ink.Ink, stroke = null, lineWidth = 0f, rotate = null),
            IconPart(Shape.Circle(22f, 15f, 2.2f), fill = Ink.Ink, stroke = null, lineWidth = 0f, rotate = null),
            IconPart(Shape.Circle(31f, 17f, 2.2f), fill = Ink.Ink, stroke = null, lineWidth = 0f, rotate = null),
        ),
        HabitIcon.Care to listOf(
            IconPart(Shape.Path("M14 11c4-3 7 0 10 0s6-3 10 0c5 4 2 13 0 19-1 4-2 9-4 9s-2-9-6-9-4 9-6 9-3-5-4-9c-2-6-5-15 0-19z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Path("M19 17c2-1 4-1 5 0"), fill = null, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.Pet to listOf(
            IconPart(Shape.Path("M24 24c-6 0-11 6-11 11 0 4 4 5 11 5s11-1 11-5c0-5-5-11-11-11z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(11f, 21f, 4f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(19f, 12f, 4f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(29f, 12f, 4f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
            IconPart(Shape.Circle(37f, 21f, 4f), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
        HabitIcon.People to listOf(
            IconPart(Shape.Path("M24 41S6 30 6 18a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 12-18 23-18 23z"), fill = Ink.Mid, stroke = Ink.Ink, lineWidth = 2.5f, rotate = null),
        ),
    )
}
