// Логика, которую клиент считает сам (docs/mobile.md, «Логика, которую повторяют клиенты»): дни, «сделано», вклад в
// карту, порядок дел, подписи дат, значок по названию. Те же случаи, что в shared/*.test.ts и apple/Kit.
package app.lifecommit.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

/** Дни — строки YYYY-MM-DD, как на сервере (логический день человека считает сервер). */
object Days {
    fun date(day: String): LocalDate? = if (day.length != 10) null else try {
        LocalDate.parse(day)
    } catch (_: DateTimeParseException) {
        null
    }

    fun add(day: String, n: Int): String = date(day)?.plusDays(n.toLong())?.toString() ?: day

    /** Сколько дней от a до b (b − a). */
    fun between(a: String, b: String): Int {
        val da = date(a) ?: return 0
        val db = date(b) ?: return 0
        return ChronoUnit.DAYS.between(da, db).toInt()
    }

    /** День недели: 0 — понедельник … 6 — воскресенье (как маска weekdays: пн = 1). */
    fun weekdayIndex(day: String): Int = date(day)?.dayOfWeek?.value?.minus(1) ?: 0
}

// Привычка на «Сегодня»: сделана ли, сколько даёт карте, «N дней без этого» — как src/components/TaskCard.tsx.

val TodayTask.isDone: Boolean
    get() = when (kind) {
        TaskKind.Count -> value >= target
        TaskKind.Check -> value >= 1
        TaskKind.Abstain -> status != null
    }

/** Вклад в «зелёность» дня, 0…1 — та же формула, что log_score в базе. */
val TodayTask.score: Double
    get() = when (kind) {
        TaskKind.Count -> if (target > 0) minOf(1.0, value / target) else 0.0
        TaskKind.Check -> if (value >= 1) 1.0 else 0.0
        TaskKind.Abstain -> if (status == AbstainStatus.Clean) 1.0 else 0.0
    }

/** «Бросить»: срыв счёт не обнуляет, сегодня прибавляется, только если получилось. */
val TodayTask.cleanDays: Int get() = cleanBefore + if (status == AbstainStatus.Clean) 1 else 0

object Heat {
    /** Уровень клетки карты по абсолютной сумме выполненного за день (решение владелицы: не «% от плана»). */
    fun level(score: Double): Int = when {
        score <= 0 -> 0
        score < 1 -> 1
        score < 3 -> 2
        score < 5 -> 3
        else -> 4
    }

    /**
     * Карта с сегодняшним днём, посчитанным из отметок на экране, — без ожидания сервера. Сделанное дело на день
     * зеленит клетку так же, как привычка; события из календаря — нет.
     */
    fun withToday(heat: List<HeatDay>, today: TodayResponse): List<HeatDay> {
        val score = today.tasks.sumOf { it.score } + today.todos.count { it.done && it.source == null }
        return heat.filter { it.day != today.day } + HeatDay(today.day, score)
    }
}

/** Нужные сегодня: несделанные сверху, сделанные — тихо вниз. Не на сегодня — отдельно. */
val TodayResponse.dueOrdered: List<TodayTask>
    get() {
        val due = tasks.filter { it.due }
        return due.filter { !it.isDone } + due.filter { it.isDone }
    }

val TodayResponse.notDue: List<TodayTask> get() = tasks.filter { !it.due }

/** Пусто совсем — первый экран «Чего я хочу?». */
val TodayResponse.isEmpty: Boolean get() = tasks.isEmpty() && archived.isEmpty() && todos.isEmpty() && todosLater == 0

val TodayResponse.canAddTask: Boolean get() = limits.maxTasks?.let { limits.active < it } ?: true

/** Дела на день: порядок, подписи «со вчера», конец события — как sortTodos, src/todoDates.ts, TodoList.tsx. */
object Todos {
    /** Несделанные со временем — по часам, потом без времени, сделанные — вниз; внутри — как пришли. */
    fun sorted(list: List<Todo>): List<Todo> {
        fun rank(d: Todo) = if (d.done) 2 else if (d.time != null) 0 else 1
        // sortedWith устойчива: равные остаются в порядке прихода.
        return list.sortedWith(compareBy<Todo> { rank(it) }.thenBy { if (rank(it) == 0) it.time else "" })
    }

    /**
     * Подпись рядом с названием: сегодняшнее — без подписи; переехавшее — тихое «со вчера» / «с 26 сентября»
     * (без красного и «просрочено»); запланированное — «завтра» или «пт, 3 октября».
     */
    fun whenLabel(day: String, today: String, t: Strings): String? {
        if (day == today) return null
        if (day < today) return if (day == Days.add(today, -1)) t.todo.sinceYesterday else t.todo.since(t.dayMonth(day))
        if (day == Days.add(today, 1)) return t.todo.tomorrow.lowercase(t.locale)
        return t.weekdayDayMonth(day)
    }

    /** Конец события: «10:00» + 60 минут → «11:00» (в пределах суток, иначе null). */
    fun endTime(start: String, minutes: Int): String? {
        val parts = start.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size < 2) return null
        val total = parts[0] * 60 + parts[1] + minutes
        if (total >= 24 * 60) return null
        return "%02d:%02d".format(total / 60, total % 60)
    }

    /** Событие без длительности считаем часовым (решение владелицы 05.10.2026). */
    const val EVENT_DEFAULT_MINUTES = 60

    /** Событие из календаря уже прошло. Своё дело не «проходит»; событие на весь день — тоже. */
    fun eventOver(d: Todo, now: ZonedDateTime, zone: ZoneId = now.zone): Boolean {
        if (d.source == null) return false
        val time = d.time ?: return false
        val date = Days.date(d.day) ?: return false
        val hm = time.split(":").mapNotNull { it.toIntOrNull() }
        if (hm.size < 2) return false
        val start = LocalDateTime.of(date.year, date.month, date.dayOfMonth, hm[0], hm[1]).atZone(zone)
        return !now.isBefore(start.plusMinutes((d.durationMin ?: EVENT_DEFAULT_MINUTES).toLong()))
    }
}

/**
 * Значок привычки по её названию — без ИИ: словарь начал слов (русских и английских), как shared/habitIcon.ts.
 * Правило срабатывает, если какое-то слово названия НАЧИНАЕТСЯ с корня: «вод» ловит «воды», но не «завод».
 * Порядок правил важен: первое совпадение побеждает. Меняется словарь в мини-аппе — меняется и здесь.
 */
enum class HabitIcon {
    Gym, Run, Walk, Yoga, Exercise, Swim, Bike, Water, Read, Study, Write, Sleep, Meds, Food,
    Sweets, Smoke, Alcohol, Coffee, Phone, Clean, Money, Work, Music, Art, Care, Pet, People;

    companion object {
        private val rules: List<Pair<HabitIcon, List<String>>> = listOf(
            // «курс» и «куриц» раньше, чем «кури»: иначе курсы и курица стали бы сигаретой
            Study to listOf("курс", "англ", "язык", "слов", "учи", "учеб", "урок", "лекци", "экзамен", "study", "learn", "english", "lesson", "course", "word"),
            Food to listOf("куриц", "еда", "есть", "завтрак", "обед", "ужин", "овощ", "фрукт", "салат", "готов", "eat", "food", "breakfast", "lunch", "dinner", "cook", "vegetable", "fruit"),
            Smoke to listOf("кури", "курен", "сигарет", "вейп", "табак", "smok", "cigarette", "vape"),
            Alcohol to listOf("алкогол", "пив", "вино", "вина", "выпив", "буха", "alcohol", "beer", "wine", "booze"),
            Coffee to listOf("кофе", "кофеин", "coffee", "caffeine"),
            Sweets to listOf("сладк", "сахар", "конфет", "шоколад", "десерт", "sugar", "sweet", "candy", "chocolate", "dessert"),
            Phone to listOf("соцсет", "телефон", "инст", "тикток", "ютуб", "экран", "скрол", "сериал", "phone", "social", "scroll", "screen", "tiktok", "instagram", "youtube"),
            Gym to listOf("спортзал", "зал", "трениров", "качалк", "фитнес", "штанг", "гантел", "gym", "workout", "training", "fitness", "lift"),
            Run to listOf("бег", "пробеж", "run", "jog"),
            Swim to listOf("плав", "бассейн", "swim", "pool"),
            Bike to listOf("вело", "bike", "cycl"),
            Pet to listOf("собак", "кот", "кошк", "питом", "dog", "cat", "pet"),
            Walk to listOf("прогул", "гуля", "шаг", "ходьб", "ходить", "walk", "step"),
            Yoga to listOf("йог", "растяж", "медит", "дыхан", "yoga", "stretch", "meditat", "breath"),
            Exercise to listOf("зарядк", "отжим", "присед", "планк", "подтяг", "пресс", "exercise", "push", "squat", "plank"),
            Water to listOf("вод", "стакан", "water", "hydrat"),
            Read to listOf("чит", "чтен", "книг", "страниц", "read", "book", "page"),
            Write to listOf("дневник", "писать", "пишу", "замет", "journal", "diary", "writ"),
            Sleep to listOf("сон", "спать", "лечь", "ложи", "встать", "встав", "подъем", "sleep", "bed", "wake"),
            Meds to listOf("таблет", "витамин", "лекарств", "pill", "vitamin", "med"),
            Care to listOf("зуб", "душ", "умы", "уход", "кож", "крем", "teeth", "shower", "skin", "floss"),
            Clean to listOf("убор", "убра", "посуд", "стирк", "порядок", "пылесос", "clean", "tidy", "dish", "laundry"),
            Money to listOf("деньг", "копи", "бюджет", "расход", "трат", "money", "budget", "sav", "spend"),
            Music to listOf("музык", "гитар", "пиани", "петь", "вокал", "music", "guitar", "piano", "sing"),
            Art to listOf("рис", "живопис", "draw", "paint", "sketch"),
            People to listOf("позвон", "мам", "пап", "родител", "друз", "семь", "call", "mom", "dad", "family", "friend"),
            Work to listOf("работ", "проект", "задач", "фокус", "код", "work", "project", "focus", "code"),
        )

        /** Слова — только латиница a–z и кириллица а–я, как /[^a-zа-я]+/ в мини-аппе. */
        private val separator = Regex("[^a-zа-я]+")

        /** Значок по названию или null — тогда рисуем значок вида привычки. */
        fun of(title: String): HabitIcon? {
            val words = title.lowercase().replace('ё', 'е').split(separator).filter { it.isNotEmpty() }
            return rules.firstOrNull { (_, stems) -> words.any { w -> stems.any { w.startsWith(it) } } }?.first
        }
    }
}

/** Подпись «как часто» одной строкой: «Каждый день», «Пн, ср, пт», «3 раза в неделю» — как src/repeat.ts. */
object Repeat {
    private const val ALL_DAYS = 127

    fun label(t: Strings, schedule: Schedule, weekdays: Int, perWeek: Int?): String {
        if (schedule == Schedule.PerWeek) return t.perWeek(perWeek ?: 3)
        if (schedule == Schedule.Weekdays && weekdays != ALL_DAYS) {
            val names = t.weekdaysShort.filterIndexed { i, _ -> weekdays and (1 shl i) != 0 }
            return names.joinToString(", ").lowercase(t.locale).replaceFirstChar { it.titlecase(t.locale) }
        }
        return t.schedules.getValue(Schedule.Daily)
    }
}
