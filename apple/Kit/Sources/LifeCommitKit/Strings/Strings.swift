// Тексты ru/en — дословно как src/i18n.ts мини-аппа (он источник формулировок, CLAUDE.md «Платформы»). Язык — как у
// человека в настройках (users.language_code), а не язык системы: его меняют в «Я», и приложение переключается сразу.
// Разделы переносятся вместе с экранами; поменяли текст в мини-аппе — меняем и здесь.
import Foundation

public struct Strings: Sendable {
    public enum Lang: String, Sendable { case ru, en }

    public let lang: Lang
    public var locale: Locale { Locale(identifier: lang == .ru ? "ru_RU" : "en_US") }

    // MARK: Общее
    public let loadError: String
    public let retry: String
    public let error: String
    public let today: String
    public let me: String
    public let calendar: String
    public let groups: String
    public let voiceMic: String
    /// «Назад» над экранами без нижней панели (в мини-аппе это кнопка Telegram).
    public let back: String

    // MARK: Вход
    public let signIn: String
    public let signInSub: String
    public let signInWaiting: String
    public let signInFailed: String
    public let cancel: String

    // MARK: «Сегодня»
    public let habits: String
    public let addTask: String
    public let nothingDue: String
    public let archivedLink: @Sendable (Int) -> String
    public let didItShort: String
    public let answerYes: String
    public let answerNo: String
    public let markDone: String
    public let of: String
    public let enterValue: String
    public let cleanDays: @Sendable (Int) -> String
    public let schedules: [Schedule: String]
    public let perWeek: @Sendable (Int) -> String
    public let todo: TodoStrings
    public let swipe: SwipeStrings

    // MARK: «Чего я хочу?»
    public let onboardingTitle: String
    public let onboardingSkip: String
    public let intents: [TaskKind: (title: String, examples: String)]

    // MARK: Редактор и «Отложенные»
    public let onboardingHint: String
    public let newTask: String
    public let editTask: String
    public let titlePh: [TaskKind: String]
    public let lastSlip: String
    public let notSet: String
    public let goal: String
    public let repeatLabel: String
    public let perWeekHint: @Sendable (Int) -> String
    public let weekdaysShort: [String]
    public let who: String
    public let visibility: [HabitVisibility: String]
    public let add: String
    public let save: String
    public let done: String
    public let postpone: String
    public let deleteTask: String
    public let goalTomorrow: String
    public let deleteForever: String
    public let deleteForeverConfirm: String
    public let archive: String
    public let restore: String
    public let limitReached: @Sendable (Int) -> String
    public let clearDate: String

    // MARK: Пока раздела в приложении нет (docs/parity.md — «ждёт»)
    /// Раздел ещё не перенесён — пока он в мини-аппе.
    public let pendingSection: String
    public let openInTelegram: String
    public let voiceSoon: String
    public let openBot: String
    public let logoutDevice: String
    public let logoutDeviceConfirm: String
    public let logoutOk: String

    // MARK: Экран привычки
    public let didIt: String
    public let goalLine: @Sendable (Double, String?) -> String
    public let since: @Sendable (String) -> String
    public let twoWeeks: String
    public let statOf: @Sendable (Int, Int) -> String
    public let statPlanIn: @Sendable (String) -> String
    public let statTimesIn: @Sendable (String) -> String
    public let statTimesAll: String
    public let statAvg: @Sendable (String?) -> String
    public let statBest: String
    public let statSumIn: @Sendable (String) -> String
    public let statRunNow: String
    public let statRunBest: String
    public let statSlipsIn: @Sendable (String) -> String
    public let markClean: String
    public let markSlip: String
    public let markNotDone: String
    public let markClear: String
    public let cleanDaysWord: @Sendable (Int) -> String
    public let goalShort: String
    public let prevMonth: String
    public let nextMonth: String

    public struct TodoStrings: Sendable {
        public let block: String
        public let blockEvents: String
        public let blockMixed: String
        public let showAll: String
        public let showLeft: String
        public let showWhich: String
        public let add: String
        public let addPh: String
        public let later: @Sendable (Int) -> String
        public let tomorrow: String
        public let until: @Sendable (String) -> String
        public let since: @Sendable (String) -> String
        public let sinceYesterday: String
        public let check: @Sendable (String) -> String
        public let uncheck: @Sendable (String) -> String
    }

    public struct SwipeStrings: Sendable {
        public let remove: String
        public let undo: String
        public let removed: @Sendable (String) -> String
    }

    // MARK: Числа и даты

    /// Число: разряды через неразрывный пробел с тысяч (146, 1 146, 25 546), до двух знаков после запятой.
    public func num(_ n: Double) -> String { Self.number(n, lang) }

    public func num(_ n: Int) -> String { Self.number(Double(n), lang) }

    static func number(_ n: Double, _ lang: Lang) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: lang == .ru ? "ru_RU" : "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    private func format(_ day: String, template: String) -> String {
        guard let date = Days.localNoon(day) else { return day }
        let f = DateFormatter()
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate(template)
        // Как в мини-аппе: «пт, 9 октября» строчными — подпись стоит внутри строки, а не в начале предложения.
        f.formattingContext = .middleOfSentence
        return f.string(from: date)
    }

    /// «26 сентября» / «September 26».
    public func dayMonth(_ day: String) -> String { format(day, template: "dMMMM") }

    /// «пт, 3 октября» / «Fri, October 3». Сокращение дня недели Apple по-русски пишет с заглавной («Пт»), мини-апп —
    /// строчными; подпись стоит внутри строки.
    public func weekdayDayMonth(_ day: String) -> String {
        let s = format(day, template: "EEEdMMMM")
        return lang == .ru ? s.prefix(1).lowercased(with: locale) + s.dropFirst() : s
    }

    /// Название месяца в именительном: «октябрь» / «October» (как toLocaleDateString(…, {month: 'long'})).
    public func monthName(_ month: String) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.dateFormat = "LLLL"
        guard let date = Days.localNoon("\(month)-15") else { return month }
        return f.string(from: date)
    }

    /// «Октябрь 2026» — над календарём месяца.
    public func monthYear(_ month: String) -> String {
        let name = monthName(month)
        return name.prefix(1).uppercased(with: locale) + name.dropFirst() + " " + month.prefix(4)
    }

    /// «понедельник, 5 октября» — заголовок шторки отметки задним числом.
    public func weekdayLong(_ day: String) -> String { format(day, template: "EEEEdMMMM") }

    /// Шапка «Сегодня»: «Понедельник, 5 октября» / «Monday, October 5» — с заглавной.
    public func longDate(_ day: String) -> String {
        let s = format(day, template: "EEEEdMMMM")
        return s.prefix(1).uppercased(with: locale) + s.dropFirst()
    }
}

public extension Strings {
    static func of(_ languageCode: String?) -> Strings { languageCode == "en" ? .en : .ru }

    static let ru: Strings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .ru) }
        return Strings(
            lang: .ru,
            loadError: "Не получилось загрузиться. Проверьте интернет и попробуйте ещё раз.",
            retry: "Ещё раз",
            error: "Что-то пошло не так. Попробуй ещё раз.",
            today: "Сегодня",
            me: "Я",
            calendar: "Календарь",
            groups: "Вместе",
            voiceMic: "Сказать голосом",
            back: "Назад",
            signIn: "Войти через Telegram",
            signInSub: "Привычки, дела и группы\u{00a0}— те же, что в Telegram.",
            signInWaiting: "Подтверди вход в Telegram",
            signInFailed: "Не получилось\u{00a0}— проверь интернет и попробуй ещё раз.",
            cancel: "Отмена",
            habits: "Привычки",
            addTask: "Добавить привычку",
            nothingDue: "На сегодня всё",
            archivedLink: { "Отложенные · \($0)" },
            didItShort: "Получилось?",
            answerYes: "Да, получилось",
            answerNo: "Нет, сегодня было",
            markDone: "Сделано",
            of: "из",
            enterValue: "ввести число",
            cleanDays: { "\(num($0)) \(Plural.ru($0, "день", "дня", "дней")) без этого" },
            schedules: [.daily: "Каждый день", .weekdays: "По дням недели", .perWeek: "Несколько раз в неделю"],
            perWeek: { "\($0) \(Plural.ru($0, "раз", "раза", "раз")) в неделю" },
            todo: TodoStrings(
                block: "Дела",
                blockEvents: "События",
                blockMixed: "События и дела",
                showAll: "Все",
                showLeft: "Осталось",
                showWhich: "Какие дела показывать",
                add: "Дело на сегодня",
                addPh: "Что сделать?",
                later: { "Потом · \(num($0))" },
                tomorrow: "Завтра",
                until: { "до \($0)" },
                since: { "с \($0)" },
                sinceYesterday: "со вчера",
                check: { "Сделано: \($0)" },
                uncheck: { "Не сделано: \($0)" }
            ),
            swipe: SwipeStrings(remove: "Удалить", undo: "Вернуть", removed: { "«\($0)» удалено" }),
            onboardingTitle: "Чего я хочу?",
            onboardingSkip: "Пропустить",
            intents: [
                .check: ("Делать регулярно", "каждый день или пару раз в неделю: спортзал, уборка"),
                .count: ("Считать что-то", "8 стаканов воды, 20 страниц"),
                .abstain: ("Бросить", "курение, алкоголь, сладкое"),
            ],
            onboardingHint: "Выбери одно — остальное можно добавить потом",
            newTask: "Новая привычка",
            editTask: "Привычка",
            titlePh: [.count: "Например, читать", .check: "Например, сходить в спортзал", .abstain: "Например, не курить"],
            lastSlip: "Последний раз",
            notSet: "Не указано",
            goal: "Цель на день",
            repeatLabel: "Повторять",
            perWeekHint: { "\(Plural.ru($0, "раз", "раза", "раз")) в неделю, в любые дни" },
            weekdaysShort: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
            who: "Кто видит",
            visibility: [.private: "Только я", .friends: "Друзья"],
            add: "Добавить",
            save: "Сохранить",
            done: "Готово",
            postpone: "Отложить",
            deleteTask: "Удалить",
            goalTomorrow: "Цель стала легче — применится с завтра.",
            deleteForever: "Удалить",
            deleteForeverConfirm: "Удалить привычку вместе с историей?",
            archive: "Отложенные",
            restore: "Вернуть",
            limitReached: { "Бесплатно — до \($0) привычек. Можно отложить какую-нибудь." },
            clearDate: "Сбросить дату",
            pendingSection: "Этот раздел скоро появится здесь. Пока он есть в LifeCommit в Telegram — с теми же данными.",
            openInTelegram: "Открыть в Telegram",
            voiceSoon: "Скоро — прямо здесь. Пока скажи то же самое боту в чате: голосовые он понимает.",
            openBot: "Открыть чат с ботом",
            logoutDevice: "Выйти на этом устройстве",
            logoutDeviceConfirm: "Выйти из LifeCommit на этом устройстве?",
            logoutOk: "Выйти",
            didIt: "Сегодня получилось?",
            goalLine: { n, unit in "Цель — \(Strings.number(n, .ru))\(unit.map { " \($0)" } ?? "") в день" },
            since: { "С \($0)" },
            twoWeeks: "Последние две недели",
            statOf: { "\(num($0)) из \(num($1))" },
            statPlanIn: { "по плану за \($0)" },
            statTimesIn: { "раз за \($0)" },
            statTimesAll: "раз за всё время",
            statAvg: { "\($0 ?? "раз") в день в среднем" },
            statBest: "лучший день",
            statSumIn: { "всего за \($0)" },
            statRunNow: "подряд сейчас",
            statRunBest: "самый долгий период",
            statSlipsIn: { "раз было за \($0)" },
            markClean: "Получилось",
            markSlip: "Не получилось",
            markNotDone: "Не сделано",
            markClear: "Убрать отметку",
            cleanDaysWord: { "\(Plural.ru($0, "день", "дня", "дней")) без этого" },
            goalShort: "цель",
            prevMonth: "Предыдущий месяц",
            nextMonth: "Следующий месяц"
        )
    }()

    static let en: Strings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .en) }
        return Strings(
            lang: .en,
            loadError: "Couldn't load. Check your connection and try again.",
            retry: "Try again",
            error: "Something went wrong. Try again.",
            today: "Today",
            me: "Me",
            calendar: "Calendar",
            groups: "Together",
            voiceMic: "Say it",
            back: "Back",
            signIn: "Sign in with Telegram",
            signInSub: "The same habits, to-dos and groups as in Telegram.",
            signInWaiting: "Confirm the sign-in in Telegram",
            signInFailed: "That didn’t work\u{00a0}— check your connection and try again.",
            cancel: "Cancel",
            habits: "Habits",
            addTask: "Add a habit",
            nothingDue: "All done for today",
            archivedLink: { "Postponed · \($0)" },
            didItShort: "Worked out?",
            answerYes: "Yes, it did",
            answerNo: "No, it happened today",
            markDone: "Done",
            of: "of",
            enterValue: "enter a number",
            cleanDays: { "\(num($0)) \(Plural.en($0, "day", "days")) without it" },
            schedules: [.daily: "Every day", .weekdays: "On weekdays", .perWeek: "A few times a week"],
            perWeek: { "\($0) \(Plural.en($0, "time", "times")) a week" },
            todo: TodoStrings(
                block: "To-dos",
                blockEvents: "Events",
                blockMixed: "Events & to-dos",
                showAll: "All",
                showLeft: "To do",
                showWhich: "Which to-dos to show",
                add: "To-do for today",
                addPh: "What to do?",
                later: { "Later · \(num($0))" },
                tomorrow: "Tomorrow",
                until: { "until \($0)" },
                since: { "since \($0)" },
                sinceYesterday: "since yesterday",
                check: { "Done: \($0)" },
                uncheck: { "Not done: \($0)" }
            ),
            swipe: SwipeStrings(remove: "Delete", undo: "Undo", removed: { "“\($0)” deleted" }),
            onboardingTitle: "What do I want?",
            onboardingSkip: "Skip",
            intents: [
                .check: ("Do it regularly", "every day or a few times a week: gym, tidying up"),
                .count: ("Count something", "8 glasses of water, 20 pages"),
                .abstain: ("Quit", "smoking, alcohol, sweets"),
            ],
            onboardingHint: "Pick one — you can add the rest later",
            newTask: "New habit",
            editTask: "Habit",
            titlePh: [.count: "e.g. reading", .check: "e.g. go to the gym", .abstain: "e.g. no smoking"],
            lastSlip: "Last time",
            notSet: "Not set",
            goal: "Daily goal",
            repeatLabel: "Repeat",
            perWeekHint: { "\(Plural.en($0, "time", "times")) a week, any days" },
            weekdaysShort: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
            who: "Who sees it",
            visibility: [.private: "Only me", .friends: "Friends"],
            add: "Add",
            save: "Save",
            done: "Done",
            postpone: "Postpone",
            deleteTask: "Delete",
            goalTomorrow: "The goal got easier — it applies from tomorrow.",
            deleteForever: "Delete",
            deleteForeverConfirm: "Delete this habit with its history?",
            archive: "Postponed",
            restore: "Restore",
            limitReached: { "Free plan: up to \($0) habits. You can postpone one." },
            clearDate: "Clear date",
            pendingSection: "This section is coming here soon. For now it lives in LifeCommit in Telegram — with the same data.",
            openInTelegram: "Open in Telegram",
            voiceSoon: "Coming here soon. For now, say the same to the bot in the chat: it understands voice messages.",
            openBot: "Open the bot chat",
            logoutDevice: "Sign out on this device",
            logoutDeviceConfirm: "Sign out of LifeCommit on this device?",
            logoutOk: "Sign out",
            didIt: "Did it work out today?",
            goalLine: { n, unit in "Goal: \(Strings.number(n, .en))\(unit.map { " \($0)" } ?? "") a day" },
            since: { "Since \($0)" },
            twoWeeks: "Last two weeks",
            statOf: { "\(num($0)) of \(num($1))" },
            statPlanIn: { "as planned in \($0)" },
            statTimesIn: { "times in \($0)" },
            statTimesAll: "times in total",
            statAvg: { "\($0 ?? "times") a day on average" },
            statBest: "best day",
            statSumIn: { "total in \($0)" },
            statRunNow: "in a row now",
            statRunBest: "longest period",
            statSlipsIn: { "times it happened in \($0)" },
            markClean: "Made it",
            markSlip: "Didn't make it",
            markNotDone: "Not done",
            markClear: "Clear the mark",
            cleanDaysWord: { "\(Plural.en($0, "day", "days")) without it" },
            goalShort: "goal",
            prevMonth: "Previous month",
            nextMonth: "Next month"
        )
    }()
}
