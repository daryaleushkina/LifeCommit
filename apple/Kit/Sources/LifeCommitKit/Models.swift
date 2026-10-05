// Модели API — поле в поле как shared/types.ts (контракт — docs/mobile.md). Имена полей в JSON — snake_case,
// здесь — camelCase: декодер переводит сам (API.decoder). Новое поле на сервере — сюда в том же коммите.
import Foundation

public enum TaskKind: String, Codable, Sendable, CaseIterable {
    case count, check, abstain
}

public enum Schedule: String, Codable, Sendable, CaseIterable {
    case daily, weekdays
    case perWeek = "per_week"
}

/// Кто видит привычку: только я или друзья (по умолчанию — только я).
public enum HabitVisibility: String, Codable, Sendable, CaseIterable {
    case `private`, friends
}

/// «Бросить»: получилось сегодня или было.
public enum AbstainStatus: String, Codable, Sendable {
    case clean, slip
}

public struct Subtask: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
}

public struct TodayTask: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var emoji: String?
    public var kind: TaskKind
    public var unit: String?
    public var step: Double
    public var schedule: Schedule
    /// Битовая маска дней недели, пн = 1.
    public var weekdays: Int
    public var perWeek: Int?
    public var visibility: HabitVisibility
    public var target: Double
    public var value: Double
    /// Есть ли отметка за сегодня.
    public var logged: Bool
    public var status: AbstainStatus?
    /// Сколько дней на этой неделе уже отмечено (для «несколько раз в неделю»).
    public var weekDone: Int
    /// Нужна ли сегодня.
    public var due: Bool
    public var subtasks: [Subtask]
    public var challengeId: Int?
    /// «Бросить»: чистых дней до сегодняшнего (вместе с днями до появления привычки в приложении).
    public var cleanBefore: Int
    /// «Бросить»: когда это было в последний раз до начала учёта.
    public var lastSlipOn: String?

    public init(
        id: Int, title: String, emoji: String? = nil, kind: TaskKind, unit: String? = nil, step: Double = 1,
        schedule: Schedule = .daily, weekdays: Int = 127, perWeek: Int? = nil, visibility: HabitVisibility = .private,
        target: Double = 1, value: Double = 0, logged: Bool = false, status: AbstainStatus? = nil, weekDone: Int = 0,
        due: Bool = true, subtasks: [Subtask] = [], challengeId: Int? = nil, cleanBefore: Int = 0, lastSlipOn: String? = nil
    ) {
        self.id = id
        self.title = title
        self.emoji = emoji
        self.kind = kind
        self.unit = unit
        self.step = step
        self.schedule = schedule
        self.weekdays = weekdays
        self.perWeek = perWeek
        self.visibility = visibility
        self.target = target
        self.value = value
        self.logged = logged
        self.status = status
        self.weekDone = weekDone
        self.due = due
        self.subtasks = subtasks
        self.challengeId = challengeId
        self.cleanBefore = cleanBefore
        self.lastSlipOn = lastSlipOn
    }
}

public struct UserSettings: Codable, Sendable, Equatable {
    public var id: Int
    public var firstName: String
    public var username: String?
    public var photoUrl: String?
    public var languageCode: String
    public var timezone: String
    public var dayStartHour: Int
    public var remindMorning: String?
    public var remindEvening: String?
    public var botChatOk: Bool
    public var premium: Bool

    public init(
        id: Int, firstName: String, username: String? = nil, photoUrl: String? = nil, languageCode: String = "ru",
        timezone: String = "Europe/Moscow", dayStartHour: Int = 4, remindMorning: String? = nil, remindEvening: String? = nil,
        botChatOk: Bool = false, premium: Bool = false
    ) {
        self.id = id
        self.firstName = firstName
        self.username = username
        self.photoUrl = photoUrl
        self.languageCode = languageCode
        self.timezone = timezone
        self.dayStartHour = dayStartHour
        self.remindMorning = remindMorning
        self.remindEvening = remindEvening
        self.botChatOk = botChatOk
        self.premium = premium
    }
}

/// Подробности события: из календаря или из голоса. Всё необязательное.
public struct TodoDetails: Codable, Sendable, Equatable {
    public var location: String?
    public var link: String?
    public var peopleCount: Int?
    public var people: [String]?
    public var notes: String?
    public var openUrl: String?

    public init(location: String? = nil, link: String? = nil, peopleCount: Int? = nil, people: [String]? = nil, notes: String? = nil, openUrl: String? = nil) {
        self.location = location
        self.link = link
        self.peopleCount = peopleCount
        self.people = people
        self.notes = notes
        self.openUrl = openUrl
    }
}

public enum TodoSource: String, Codable, Sendable {
    case apple, google
}

/// Разовое дело. Несделанное остаётся в списке и в следующие дни («со вчера»).
public struct Todo: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    /// На какой день запланировано (YYYY-MM-DD); раньше сегодняшнего — значит, переехало. У повторяющегося — день этого раза.
    public var day: String
    public var done: Bool
    /// «HH:MM» — на это время; nil — на весь день.
    public var time: String?
    /// Длительность события из календаря, минуты.
    public var durationMin: Int?
    /// Повторяется, как событие календаря: «сделано» у каждого дня своё.
    public var recurring: Bool
    /// Пришло из календаря.
    public var source: TodoSource?
    public var details: TodoDetails?

    public init(
        id: Int, title: String, day: String, done: Bool = false, time: String? = nil, durationMin: Int? = nil,
        recurring: Bool = false, source: TodoSource? = nil, details: TodoDetails? = nil
    ) {
        self.id = id
        self.title = title
        self.day = day
        self.done = done
        self.time = time
        self.durationMin = durationMin
        self.recurring = recurring
        self.source = source
        self.details = details
    }

    /// Тот же раз дела: у повторяющегося один id на все дни, различает их день.
    public func isSame(as other: Todo) -> Bool {
        id == other.id && (!recurring || day == other.day)
    }
}

/// Отложенная привычка: скрыта с «Сегодня», история остаётся.
public struct ArchivedTask: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var emoji: String?

    public init(id: Int, title: String, emoji: String? = nil) {
        self.id = id
        self.title = title
        self.emoji = emoji
    }
}

public struct TaskLimits: Codable, Sendable, Equatable {
    public var maxTasks: Int?
    public var active: Int

    public init(maxTasks: Int? = nil, active: Int = 0) {
        self.maxTasks = maxTasks
        self.active = active
    }
}

/// GET /today. Группы (`groups`) придут вместе с разделом «Вместе» — пока их поле не читаем.
public struct TodayResponse: Codable, Sendable, Equatable {
    /// Логический день человека (YYYY-MM-DD).
    public var day: String
    public var tasks: [TodayTask]
    public var archived: [ArchivedTask]
    public var limits: TaskLimits
    public var todos: [Todo]
    /// Сколько дел запланировано на потом.
    public var todosLater: Int

    public init(day: String, tasks: [TodayTask] = [], archived: [ArchivedTask] = [], limits: TaskLimits = .init(), todos: [Todo] = [], todosLater: Int = 0) {
        self.day = day
        self.tasks = tasks
        self.archived = archived
        self.limits = limits
        self.todos = todos
        self.todosLater = todosLater
    }
}

public struct HeatDay: Codable, Sendable, Equatable {
    public var day: String
    public var score: Double

    public init(day: String, score: Double) {
        self.day = day
        self.score = score
    }
}

public struct HeatmapResponse: Codable, Sendable, Equatable {
    public var today: String
    public var days: [HeatDay]
}

public struct SessionResponse: Codable, Sendable, Equatable {
    public var user: UserSettings
    public var startParam: String?
    public var isNew: Bool
}

/// Устройство, где вошли: компьютер (mac, web) или приложение на телефоне (ios, android).
public struct DeviceSession: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var device: String
    public var createdAt: String
    public var lastUsedAt: String
    public var current: Bool
}

/// Новая привычка или правка (PATCH — только изменённые поля, см. TaskPatch).
public struct TaskInput: Codable, Sendable, Equatable {
    public var title: String
    public var emoji: String?
    public var kind: TaskKind
    public var unit: String?
    public var schedule: Schedule
    public var weekdays: Int
    public var perWeek: Int?
    public var visibility: HabitVisibility
    public var target: Double
    public var lastSlipOn: String?

    public init(
        title: String, emoji: String? = nil, kind: TaskKind, unit: String? = nil, schedule: Schedule = .daily,
        weekdays: Int = 127, perWeek: Int? = nil, visibility: HabitVisibility = .private, target: Double = 1, lastSlipOn: String? = nil
    ) {
        self.title = title
        self.emoji = emoji
        self.kind = kind
        self.unit = unit
        self.schedule = schedule
        self.weekdays = weekdays
        self.perWeek = perWeek
        self.visibility = visibility
        self.target = target
        self.lastSlipOn = lastSlipOn
    }
}

/// История привычки: экран статистики считает её сам (Stats).
public struct HistoryLog: Codable, Sendable, Equatable {
    public var day: String
    public var value: Double
    public var status: AbstainStatus?

    public init(day: String, value: Double, status: AbstainStatus? = nil) {
        self.day = day
        self.value = value
        self.status = status
    }
}

public struct HistoryGoal: Codable, Sendable, Equatable {
    public var effectiveFrom: String
    public var target: Double

    public init(effectiveFrom: String, target: Double) {
        self.effectiveFrom = effectiveFrom
        self.target = target
    }
}

public struct TaskHistory: Codable, Sendable, Equatable {
    /// Первый день привычки в приложении.
    public var start: String
    public var goals: [HistoryGoal]
    public var logs: [HistoryLog]

    public init(start: String, goals: [HistoryGoal], logs: [HistoryLog]) {
        self.start = start
        self.goals = goals
        self.logs = logs
    }
}

/// Ответ создания: 201 {id}.
public struct Created: Codable, Sendable, Equatable {
    public var id: Int
}

/// PATCH /tasks/:id: цель стала легче — действует с этого дня.
public struct TaskUpdated: Codable, Sendable, Equatable {
    public var goalEffectiveFrom: String?
}

/// Вход через Telegram: ключ сессии и «новый ли человек».
public struct SignedIn: Codable, Sendable, Equatable {
    public var token: String
    public var isNew: Bool
}

public struct TelegramLoginConfig: Codable, Sendable, Equatable {
    public var clientId: String
}
