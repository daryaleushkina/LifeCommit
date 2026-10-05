// Логика из shared/ и src/ мини-аппа — те же случаи, что в shared/*.test.ts и src/*.test.ts.
import Foundation
import Testing
@testable import LifeCommitKit

@Suite("Карта и привычки")
struct HeatAndTaskTests {
    @Test("уровни по абсолютной сумме выполненного")
    func heatLevels() {
        #expect([0, 0.5, 1, 2.9, 3, 4.9, 5, 12].map(Heat.level) == [0, 1, 2, 2, 3, 3, 4, 4])
        #expect(Heat.level(-1) == 0)
    }

    @Test("сделано: «считать» — до цели, «делать» — отметка, «бросить» — любой ответ")
    func done() {
        #expect(TodayTask(id: 1, title: "", kind: .count, target: 8, value: 8).isDone)
        #expect(!TodayTask(id: 1, title: "", kind: .count, target: 8, value: 7).isDone)
        #expect(TodayTask(id: 1, title: "", kind: .check, value: 1).isDone)
        #expect(!TodayTask(id: 1, title: "", kind: .check).isDone)
        #expect(TodayTask(id: 1, title: "", kind: .abstain, status: .slip).isDone)
        #expect(!TodayTask(id: 1, title: "", kind: .abstain).isDone)
    }

    @Test("вклад в день: частичное засчитывается, срыв — ноль")
    func score() {
        #expect(TodayTask(id: 1, title: "", kind: .count, target: 8, value: 4).score == 0.5)
        #expect(TodayTask(id: 1, title: "", kind: .count, target: 8, value: 20).score == 1)
        #expect(TodayTask(id: 1, title: "", kind: .count, target: 0, value: 3).score == 0)
        #expect(TodayTask(id: 1, title: "", kind: .check, value: 1).score == 1)
        #expect(TodayTask(id: 1, title: "", kind: .abstain, status: .clean).score == 1)
        #expect(TodayTask(id: 1, title: "", kind: .abstain, status: .slip).score == 0)
    }

    @Test("«N дней без этого»: срыв не обнуляет, сегодня прибавляется, только если получилось")
    func cleanDays() {
        #expect(TodayTask(id: 1, title: "", kind: .abstain, status: .clean, cleanBefore: 6).cleanDays == 7)
        #expect(TodayTask(id: 1, title: "", kind: .abstain, status: .slip, cleanBefore: 6).cleanDays == 6)
        #expect(TodayTask(id: 1, title: "", kind: .abstain, cleanBefore: 6).cleanDays == 6)
    }

    @Test("сегодняшняя клетка карты считается из отметок на экране; события календаря — нет")
    func heatWithToday() {
        let today = TodayResponse(
            day: "2026-10-05",
            tasks: [TodayTask(id: 1, title: "", kind: .count, target: 4, value: 2), TodayTask(id: 2, title: "", kind: .check, value: 1)],
            todos: [Todo(id: 1, title: "", day: "2026-10-05", done: true), Todo(id: 2, title: "", day: "2026-10-05", done: true, source: .google), Todo(id: 3, title: "", day: "2026-10-05")]
        )
        let heat = Heat.withToday([HeatDay(day: "2026-10-04", score: 3), HeatDay(day: "2026-10-05", score: 9)], today: today)
        #expect(heat == [HeatDay(day: "2026-10-04", score: 3), HeatDay(day: "2026-10-05", score: 2.5)])
    }

    @Test("порядок на «Сегодня»: несделанные сверху, сделанные вниз; не на сегодня — отдельно")
    func ordering() {
        let r = TodayResponse(day: "2026-10-05", tasks: [
            TodayTask(id: 1, title: "", kind: .check, value: 1),
            TodayTask(id: 2, title: "", kind: .check),
            TodayTask(id: 3, title: "", kind: .check, due: false),
        ])
        #expect(r.dueOrdered.map(\.id) == [2, 1])
        #expect(r.notDue.map(\.id) == [3])
        #expect(!r.isEmpty)
        #expect(TodayResponse(day: "2026-10-05").isEmpty)
        #expect(TodayResponse(day: "2026-10-05", todosLater: 1).isEmpty == false)
        #expect(TodayResponse(day: "2026-10-05", limits: TaskLimits(maxTasks: 5, active: 5)).canAddTask == false)
        #expect(TodayResponse(day: "2026-10-05").canAddTask)
    }
}

@Suite("Дела на день")
struct TodosTests {
    @Test("несделанные со временем — по часам, потом без времени, сделанные — вниз")
    func sorted() {
        let list = [
            Todo(id: 1, title: "без времени", day: "d"),
            Todo(id: 2, title: "сделано", day: "d", done: true, time: "08:00"),
            Todo(id: 3, title: "в 15", day: "d", time: "15:00"),
            Todo(id: 4, title: "в 9", day: "d", time: "09:00"),
            Todo(id: 5, title: "ещё без времени", day: "d"),
        ]
        #expect(Todos.sorted(list).map(\.id) == [4, 3, 1, 5, 2])
    }

    @Test("подписи дней: сегодня — ничего, вчера — «со вчера», раньше — «с 26 сентября», завтра, потом — с днём недели")
    func when() {
        let ru = Strings.ru
        #expect(Todos.when("2026-10-05", today: "2026-10-05", strings: ru) == nil)
        #expect(Todos.when("2026-10-04", today: "2026-10-05", strings: ru) == "со вчера")
        #expect(Todos.when("2026-09-26", today: "2026-10-05", strings: ru) == "с 26 сентября")
        #expect(Todos.when("2026-10-06", today: "2026-10-05", strings: ru) == "завтра")
        #expect(Todos.when("2026-10-09", today: "2026-10-05", strings: ru) == "пт, 9 октября")
        let en = Strings.en
        #expect(Todos.when("2026-10-04", today: "2026-10-05", strings: en) == "since yesterday")
        #expect(Todos.when("2026-09-26", today: "2026-10-05", strings: en) == "since September 26")
        #expect(Todos.when("2026-10-06", today: "2026-10-05", strings: en) == "tomorrow")
        #expect(Todos.when("2026-10-09", today: "2026-10-05", strings: en) == "Fri, October 9")
    }

    @Test("конец события: в пределах суток, иначе нет")
    func endTime() {
        #expect(Todos.endTime("10:00", minutes: 60) == "11:00")
        #expect(Todos.endTime("23:30", minutes: 45) == nil)
        #expect(Todos.endTime("09:05", minutes: 30) == "09:35")
        #expect(Todos.endTime("плохо", minutes: 30) == nil)
    }

    @Test("событие прошло: своё дело и событие на весь день — никогда; без длительности — час")
    func eventOver() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        let at = { (h: Int, m: Int) in cal.date(from: DateComponents(year: 2026, month: 10, day: 5, hour: h, minute: m))! }
        let event = Todo(id: 1, title: "", day: "2026-10-05", time: "10:00", source: .apple)
        #expect(!Todos.eventOver(event, now: at(10, 59), calendar: cal))
        #expect(Todos.eventOver(event, now: at(11, 0), calendar: cal))
        var long = event
        long.durationMin = 120
        #expect(!Todos.eventOver(long, now: at(11, 30), calendar: cal))
        #expect(!Todos.eventOver(Todo(id: 2, title: "", day: "2026-10-05", time: "10:00"), now: at(23, 0), calendar: cal))
        #expect(!Todos.eventOver(Todo(id: 3, title: "", day: "2026-10-05", source: .google), now: at(23, 0), calendar: cal))
    }

    @Test("тот же раз дела: у повторяющегося различает день")
    func same() {
        let a = Todo(id: 1, title: "", day: "2026-10-05", recurring: true)
        #expect(a.isSame(as: a))
        #expect(!a.isSame(as: Todo(id: 1, title: "", day: "2026-10-06", recurring: true)))
        #expect(Todo(id: 2, title: "", day: "a").isSame(as: Todo(id: 2, title: "", day: "b")))
    }
}

@Suite("Значок привычки по названию")
struct HabitIconTests {
    @Test("узнаёт привычку по названию")
    func known() {
        #expect(HabitIcon.of("Сходить в спортзал") == .gym)
        #expect(HabitIcon.of("Читать") == .read)
        #expect(HabitIcon.of("Выпить воды") == .water)
        #expect(HabitIcon.of("Не курить") == .smoke)
        #expect(HabitIcon.of("Без сладкого") == .sweets)
        #expect(HabitIcon.of("Зарядка") == .exercise)
        #expect(HabitIcon.of("Лечь до полуночи") == .sleep)
        #expect(HabitIcon.of("Учить английский") == .study)
        #expect(HabitIcon.of("Morning run") == .run)
    }

    @Test("смотрит на начало слова, а не на любую часть")
    func prefix() {
        #expect(HabitIcon.of("Съездить на завод") == nil)
        #expect(HabitIcon.of("Курсы вождения") == .study)
        #expect(HabitIcon.of("Курица на ужин") == .food)
    }

    @Test("буква ё и регистр не мешают; незнакомое — без значка")
    func caseAndUnknown() {
        #expect(HabitIcon.of("ПОДЪЁМ в 7") == .sleep)
        #expect(HabitIcon.of("Что-то своё") == nil)
        #expect(HabitIcon.of("") == nil)
    }
}

@Suite("Дни")
struct DaysTests {
    @Test("арифметика дней не спотыкается о переходы месяцев и високосный год")
    func add() {
        #expect(Days.add("2026-10-01", -1) == "2026-09-30")
        #expect(Days.add("2028-02-28", 1) == "2028-02-29")
        #expect(Days.add("2026-12-31", 1) == "2027-01-01")
        #expect(Days.between("2026-10-01", "2026-10-05") == 4)
        #expect(Days.add("не дата", 1) == "не дата")
    }

    @Test("день недели: понедельник — 0")
    func weekday() {
        #expect(Days.weekdayIndex("2026-10-05") == 0)
        #expect(Days.weekdayIndex("2026-10-11") == 6)
    }
}

@Suite("Тексты")
struct StringsTests {
    @Test("склонения по-русски")
    func plural() {
        let forms = [1, 2, 5, 11, 12, 21, 22, 25, 111, 101].map { Plural.ru($0, "день", "дня", "дней") }
        #expect(forms == ["день", "дня", "дней", "дней", "дней", "день", "дня", "дней", "дней", "день"])
    }

    @Test("числа: разряды с тысяч, неразрывным пробелом")
    func numbers() {
        #expect(Strings.ru.num(146) == "146")
        #expect(Strings.ru.num(1146) == "1\u{00a0}146")
        #expect(Strings.ru.num(25546) == "25\u{00a0}546")
        #expect(Strings.ru.num(2.5) == "2,5")
        #expect(Strings.en.num(1146) == "1,146")
    }

    @Test("дни без этого и раз в неделю")
    func phrases() {
        #expect(Strings.ru.cleanDays(1) == "1 день без этого")
        #expect(Strings.ru.cleanDays(22) == "22 дня без этого")
        #expect(Strings.en.cleanDays(1) == "1 day without it")
        #expect(Strings.ru.perWeek(3) == "3 раза в неделю")
        #expect(Strings.ru.todo.later(1200) == "Потом · 1\u{00a0}200")
    }

    @Test("шапка «Сегодня»: день недели с заглавной")
    func longDate() {
        #expect(Strings.ru.longDate("2026-10-05") == "Понедельник, 5 октября")
        #expect(Strings.en.longDate("2026-10-05") == "Monday, October 5")
    }

    @Test("язык человека: en — английский, всё остальное — русский")
    func language() {
        #expect(Strings.of("en").lang == .en)
        #expect(Strings.of("ru").lang == .ru)
        #expect(Strings.of(nil).lang == .ru)
    }
}

@Suite("Подпись «как часто» (src/repeat.test.ts)")
struct RepeatTests {
    @Test("каждый день; по дням недели, но отмечены все семь — тоже «Каждый день»")
    func daily() {
        #expect(Repeat.label(.ru, schedule: .daily, weekdays: 127, perWeek: nil) == "Каждый день")
        #expect(Repeat.label(.ru, schedule: .weekdays, weekdays: 127, perWeek: nil) == "Каждый день")
    }

    @Test("по дням недели: «Пн, ср, пт» — заглавная только первая")
    func weekdays() {
        #expect(Repeat.label(.ru, schedule: .weekdays, weekdays: 0b10101, perWeek: nil) == "Пн, ср, пт")
        #expect(Repeat.label(.ru, schedule: .weekdays, weekdays: 0b1100000, perWeek: nil) == "Сб, вс")
        #expect(Repeat.label(.en, schedule: .weekdays, weekdays: 0b10, perWeek: nil) == "Tu")
    }

    @Test("несколько раз в неделю; без числа — три")
    func perWeek() {
        #expect(Repeat.label(.ru, schedule: .perWeek, weekdays: 127, perWeek: 2) == "2 раза в неделю")
        #expect(Repeat.label(.ru, schedule: .perWeek, weekdays: 127, perWeek: nil) == "3 раза в неделю")
        #expect(Repeat.label(.en, schedule: .perWeek, weekdays: 127, perWeek: 1) == "1 time a week")
    }
}

@Suite("Статистика привычки (shared/stats.test.ts)")
struct StatsTests {
    func clean(_ d: String) -> HistoryLog { HistoryLog(day: d, value: 1, status: .clean) }
    func slip(_ d: String) -> HistoryLog { HistoryLog(day: d, value: 0, status: .slip) }

    @Test("цель, действовавшая в этот день")
    func targetOn() {
        let goals = [HistoryGoal(effectiveFrom: "2026-09-10", target: 30), HistoryGoal(effectiveFrom: "2026-09-01", target: 20)]
        #expect(Stats.targetOn(goals, day: "2026-09-05") == 20)
        #expect(Stats.targetOn(goals, day: "2026-09-10") == 30)
        #expect(Stats.targetOn(goals, day: "2026-09-30") == 30)
    }

    @Test("периоды «без этого»: срыв начинает заново, сегодня без ответа не рвёт, пропуск в прошлом рвёт")
    func runs() {
        let a = Stats.cleanRuns([clean("2026-09-01"), clean("2026-09-02"), clean("2026-09-03"), slip("2026-09-04"), clean("2026-09-05"), clean("2026-09-06")], start: "2026-09-01", lastSlipOn: nil, today: "2026-09-06")
        #expect(a.longest == 3 && a.current == 2)
        let b = Stats.cleanRuns([clean("2026-09-01"), clean("2026-09-02")], start: "2026-09-01", lastSlipOn: nil, today: "2026-09-03")
        #expect(b.longest == 2 && b.current == 2)
        let c = Stats.cleanRuns([clean("2026-09-01"), clean("2026-09-03")], start: "2026-09-01", lastSlipOn: nil, today: "2026-09-03")
        #expect(c.longest == 1 && c.current == 1)
    }

    @Test("дни до появления привычки продолжают первый период; срыв в первый день обнуляет")
    func before() {
        let a = Stats.cleanRuns([clean("2026-09-01"), clean("2026-09-02")], start: "2026-09-01", lastSlipOn: "2026-08-25", today: "2026-09-02")
        #expect(a.longest == 8 && a.current == 8)
        let b = Stats.cleanRuns([slip("2026-09-01")], start: "2026-09-01", lastSlipOn: "2026-08-25", today: "2026-09-01")
        #expect(b.longest == 6 && b.current == 0)
    }

    @Test("последние n дней по порядку, без отметки — ноль")
    func last() {
        let days = Stats.lastDays([HistoryLog(day: "2026-09-29", value: 12)], today: "2026-09-30", count: 3)
        #expect(days.map(\.day) == ["2026-09-28", "2026-09-29", "2026-09-30"])
        #expect(days.map(\.value) == [0, 12, 0])
    }

    @Test("месяцы: сдвиг через год, сетка с понедельника")
    func months() {
        #expect(Months.shift("2026-01", -1) == "2025-12")
        #expect(Months.shift("2026-12", 1) == "2027-01")
        let oct = Months.cells("2026-10")
        #expect(oct.lead == 3)
        #expect(oct.days.count == 31)
        #expect(Months.cells("2028-02").days.count == 29)
    }

    @Test("экран «делать»: план по дням недели («2 из 4 по плану за октябрь»), цвет дней")
    func checkDetail() {
        // 1 октября 2026 — четверг. Пн, ср, пт до 9-го: 2, 5, 7, 9 — четыре дня; сделаны 2 и 5.
        let task = TodayTask(id: 1, title: "Спортзал", kind: .check, schedule: .weekdays, weekdays: 0b0010101)
        let history = TaskHistory(start: "2026-10-01", goals: [HistoryGoal(effectiveFrom: "2026-10-01", target: 1)], logs: [HistoryLog(day: "2026-10-02", value: 1), HistoryLog(day: "2026-10-05", value: 1)])
        let d = HabitDetail.make(task: task, history: history, today: "2026-10-09", month: "2026-10", strings: .ru)
        #expect(d.subtitle == "Пн, ср, пт")
        #expect(d.stats == [HabitDetail.Stat(value: "2 из 4", label: "по плану за октябрь"), HabitDetail.Stat(value: "2", label: "раз за всё время")])
        #expect(d.cells["2026-10-02"] == .full)
        #expect(d.cells["2026-10-03"] == .off)
        #expect(d.cells["2026-10-07"] == .plan)
        #expect(d.cells["2026-10-09"] == .plan)
        #expect(d.markable)
    }

    @Test("экран «считать»: среднее, лучший день, сумма; доля цели — цвет")
    func countDetail() {
        let task = TodayTask(id: 2, title: "Вода", kind: .count, unit: "стаканов", target: 8, value: 4, logged: true)
        let history = TaskHistory(start: "2026-10-01", goals: [HistoryGoal(effectiveFrom: "2026-10-01", target: 8)], logs: [HistoryLog(day: "2026-10-01", value: 8), HistoryLog(day: "2026-10-02", value: 2)])
        let d = HabitDetail.make(task: task, history: history, today: "2026-10-05", month: "2026-10", strings: .ru)
        #expect(d.subtitle == "Цель — 8 стаканов в день")
        #expect(d.stats.map(\.value) == ["3", "8", "14"])
        #expect(d.stats.map(\.label) == ["стаканов в день в среднем", "лучший день", "всего за октябрь"])
        #expect(d.cells["2026-10-01"] == .full)
        #expect(d.cells["2026-10-02"] == .some)
        #expect(d.cells["2026-10-05"] == .half)
        #expect(!d.markable)
    }

    @Test("экран «бросить»: с дня после «последнего раза», дни до приложения — чистые, сам «последний раз» — красный")
    func abstainDetail() {
        let task = TodayTask(id: 3, title: "Не курить", kind: .abstain, logged: true, status: .clean, lastSlipOn: "2026-09-28")
        let history = TaskHistory(start: "2026-10-03", goals: [], logs: [HistoryLog(day: "2026-10-04", value: 0, status: .slip)])
        let d = HabitDetail.make(task: task, history: history, today: "2026-10-05", month: "2026-10", strings: .ru)
        #expect(d.subtitle == "С 29 сентября")
        #expect(d.stats == [
            HabitDetail.Stat(value: "1", label: "подряд сейчас"),
            // 29 сентября – 2 октября — чистые до приложения (4), 3-го ответа нет — период рвётся.
            HabitDetail.Stat(value: "4", label: "самый долгий период"),
            HabitDetail.Stat(value: "1", label: "раз было за октябрь"),
        ])
        #expect(d.cells["2026-10-01"] == .clean)
        #expect(d.cells["2026-10-04"] == .slip)
        #expect(d.cells["2026-10-05"] == .clean)
        #expect(d.oldestMonth == "2025-11")
        let sep = HabitDetail.make(task: task, history: history, today: "2026-10-05", month: "2026-09", strings: .ru)
        #expect(sep.cells["2026-09-28"] == .slip)
        #expect(sep.cells["2026-09-30"] == .clean)
        #expect(sep.stats.last?.value == "1")
    }

    @Test("месяц по-русски и по-английски")
    func monthNames() {
        #expect(Strings.ru.monthYear("2026-10") == "Октябрь 2026")
        #expect(Strings.en.monthYear("2026-10") == "October 2026")
        #expect(Strings.ru.weekdayLong("2026-10-05") == "понедельник, 5 октября")
    }
}
