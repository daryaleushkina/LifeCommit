// Раздел «Вместе»: группы и друзья — модели как shared/groups.ts и shared/types.ts, вызовы как api.groups/friends/… в
// src/api.ts. Пути и коды ошибок — docs/mobile.md («Группы», «Друзья»). Новое поле на сервере — сюда в том же коммите.
import Foundation

public enum GroupKind: String, Codable, Sendable, CaseIterable {
    case family, sport, pair, friends, work, other

    /// Тип группы на экране не нужен (значок — по id), поэтому незнакомый тип с сервера — «other», а не сбой всего
    /// «Сегодня».
    public init(from decoder: Decoder) throws {
        self = GroupKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }
}

/// Кто делает: кто-то один, назначено, общая цель, мероприятие.
public enum GroupMode: String, Codable, Sendable, CaseIterable {
    case one, assign, goal, event
}

public enum GroupRole: String, Codable, Sendable {
    case owner, admin, member

    /// Незнакомая роль — просто участник (меньше прав на экране; сервер всё равно проверяет сам).
    public init(from decoder: Decoder) throws {
        self = GroupRole(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .member
    }
}

/// Поле, которое при непонятном значении становится пустым, а не роняет весь ответ (единица цели — её пишут клиенты).
@propertyWrapper
public struct Lossy<Value: Codable & Sendable & Equatable>: Codable, Sendable, Equatable {
    public var wrappedValue: Value?

    public init(wrappedValue: Value?) { self.wrappedValue = wrappedValue }

    public init(from decoder: Decoder) throws {
        wrappedValue = try? decoder.singleValueContainer().decode(Value.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(wrappedValue)
    }
}

/// Список, из которого непонятные элементы (дело незнакомого вида) выпадают, а остальные остаются.
@propertyWrapper
public struct LossyList<Element: Codable & Sendable & Equatable>: Codable, Sendable, Equatable {
    public var wrappedValue: [Element]

    public init(wrappedValue: [Element]) { self.wrappedValue = wrappedValue }

    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !c.isAtEnd {
            if let x = try? c.decode(Element.self) {
                out.append(x)
            } else {
                // Пропустить непонятный элемент: без этого контейнер стоял бы на нём.
                _ = try c.decode(JSONValue.self)
            }
        }
        wrappedValue = out
    }

    public func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }
}

public extension KeyedDecodingContainer {
    /// Нет поля — пусто (как у обычного необязательного).
    func decode<V>(_ type: Lossy<V>.Type, forKey key: Key) throws -> Lossy<V> {
        try decodeIfPresent(type, forKey: key) ?? Lossy(wrappedValue: nil)
    }
}

public struct GroupMember: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var name: String
    /// Фото Telegram (https); нет — буква на цветном круге.
    public var photo: String?

    public init(id: Int, name: String, photo: String? = nil) {
        self.id = id
        self.name = name
        self.photo = photo
    }
}

/// Единица общей цели: «книга, книги, книг» или валюта; nil — просто числа «27 из 40».
public struct GoalUnit: Codable, Sendable, Equatable {
    public var type: String
    /// Формы слова: одна, две, пять.
    public var forms: [String]
    public var currency: String?
    public var icon: String?

    public init(type: String, forms: [String], currency: String? = nil, icon: String? = nil) {
        self.type = type
        self.forms = forms
        self.currency = currency
        self.icon = icon
    }
}

/// Групповое дело на конкретный день — глазами одного участника (dayItem в shared/groups.ts считает сервер).
public struct GroupDayItem: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var mode: GroupMode
    public var time: String?
    public var durationMin: Int?
    public var dueDay: String?
    /// Разовое с прошлого дня, ещё не сделано.
    public var carried: Bool
    public var recurring: Bool
    /// Кому это дело сегодня (у очереди — один человек).
    public var people: [Int]
    /// «Все»: и будущие участники.
    public var allMembers: Bool
    public var rotate: Bool
    /// Чья сегодня очередь.
    public var turn: Int?
    /// Показывать мне на «Сегодня».
    public var forMe: Bool
    /// Я могу отметить.
    public var canMark: Bool
    /// Закрыто для меня: кто-то один сделал, моя отметка, очередь сделана.
    public var done: Bool
    /// Кто сделал сегодня.
    public var doneBy: [Int]
    public var target: Double?
    public var total: Double?
    /// Непонятная единица (её пишут клиенты, сервер раньше не проверял) — без единицы, а не сбой всего «Сегодня».
    @Lossy public var unit: GoalUnit?
    public var goalUntil: String?
    /// Как задано (для правки): первый день, повтор, выбранные люди.
    public var start: String
    public var rrule: String?
    public var assignees: [Int]

    public init(
        id: Int, title: String, mode: GroupMode, time: String? = nil, durationMin: Int? = nil, dueDay: String? = nil,
        carried: Bool = false, recurring: Bool = false, people: [Int] = [], allMembers: Bool = false, rotate: Bool = false,
        turn: Int? = nil, forMe: Bool = true, canMark: Bool = false, done: Bool = false, doneBy: [Int] = [],
        target: Double? = nil, total: Double? = nil, unit: GoalUnit? = nil, goalUntil: String? = nil, start: String,
        rrule: String? = nil, assignees: [Int] = []
    ) {
        self.id = id
        self.title = title
        self.mode = mode
        self.time = time
        self.durationMin = durationMin
        self.dueDay = dueDay
        self.carried = carried
        self.recurring = recurring
        self.people = people
        self.allMembers = allMembers
        self.rotate = rotate
        self.turn = turn
        self.forMe = forMe
        self.canMark = canMark
        self.done = done
        self.doneBy = doneBy
        self.target = target
        self.total = total
        self.unit = unit
        self.goalUntil = goalUntil
        self.start = start
        self.rrule = rrule
        self.assignees = assignees
    }
}

/// Настройки группы (GroupSettings в src/api.ts) — то, что показывает шторка настроек.
public struct GroupSettings: Codable, Sendable, Equatable {
    public var adminsOnlyEdit: Bool
    /// Подключённый чат Telegram; nil — не подключён.
    public var tgChatTitle: String?

    public init(adminsOnlyEdit: Bool = false, tgChatTitle: String? = nil) {
        self.adminsOnlyEdit = adminsOnlyEdit
        self.tgChatTitle = tgChatTitle
    }
}

/// Группа в «Сегодня» и в списке (GroupToday); экран группы (GET /groups/:id) добавляет настройки и «Скоро».
public struct GroupToday: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var kind: GroupKind
    public var role: GroupRole
    public var members: [GroupMember]
    @LossyList public var items: [GroupDayItem]
    /// Сколько раз сегодня надо сделать на всю группу и сколько сделано (мероприятия и цели не считаем).
    public var planned: Int
    public var done: Int
    /// Только у экрана группы.
    public var settings: GroupSettings?
    /// Только у экрана группы: дела следующих дней.
    public var upcoming: [GroupDayBlock]?

    public init(
        id: Int, title: String, kind: GroupKind = .other, role: GroupRole = .member, members: [GroupMember] = [],
        items: [GroupDayItem] = [], planned: Int = 0, done: Int = 0, settings: GroupSettings? = nil, upcoming: [GroupDayBlock]? = nil
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.role = role
        self.members = members
        self.items = items
        self.planned = planned
        self.done = done
        self.settings = settings
        self.upcoming = upcoming
    }
}

/// Дела группы на один день — для «Календаря» и «Скоро».
public struct GroupDayBlock: Codable, Sendable, Equatable {
    public struct Group: Codable, Sendable, Equatable {
        public var id: Int
        public var title: String
        public var kind: GroupKind
        public var members: [GroupMember]

        public init(id: Int, title: String, kind: GroupKind = .other, members: [GroupMember] = []) {
            self.id = id
            self.title = title
            self.kind = kind
            self.members = members
        }
    }

    public var day: String
    public var group: Group
    @LossyList public var items: [GroupDayItem]

    public init(day: String, group: Group, items: [GroupDayItem]) {
        self.day = day
        self.group = group
        self.items = items
    }
}

/// Приглашение в группу (GET /invites/:code): кто зовёт, кто уже там, состою ли я.
public struct Invitation: Codable, Sendable, Equatable {
    public struct Group: Codable, Sendable, Equatable {
        public var id: Int
        public var title: String

        public init(id: Int, title: String) {
            self.id = id
            self.title = title
        }
    }

    public struct Member: Codable, Sendable, Equatable {
        public var id: Int
        public var name: String

        public init(id: Int, name: String) {
            self.id = id
            self.name = name
        }
    }

    public var group: Group
    public var inviter: String?
    public var members: [Member]
    public var member: Bool

    public init(group: Group, inviter: String? = nil, members: [Member] = [], member: Bool = false) {
        self.group = group
        self.inviter = inviter
        self.members = members
        self.member = member
    }
}

/// Новое групповое дело или правка (GroupItemInput в src/api.ts). Уходит целиком: null — «очистить» (время, повтор).
public struct GroupItemInput: Sendable, Equatable {
    public var title: String
    public var mode: GroupMode
    public var day: String
    public var time: String?
    public var rrule: String?
    public var assignees: [Int]
    public var allMembers: Bool
    public var rotate: Bool
    public var target: Double?
    public var goalUntil: String?

    public init(
        title: String, mode: GroupMode, day: String, time: String? = nil, rrule: String? = nil, assignees: [Int] = [],
        allMembers: Bool = false, rotate: Bool = false, target: Double? = nil, goalUntil: String? = nil
    ) {
        self.title = title
        self.mode = mode
        self.day = day
        self.time = time
        self.rrule = rrule
        self.assignees = assignees
        self.allMembers = allMembers
        self.rotate = rotate
        self.target = target
        self.goalUntil = goalUntil
    }

    /// Тело запроса: пустые поля — явным null (PATCH без поля оставил бы старое время или повтор).
    public var json: JSONValue {
        .object([
            "title": .string(title),
            "mode": .string(mode.rawValue),
            "day": .string(day),
            "time": .optional(time),
            "rrule": .optional(rrule),
            "assignees": .array(assignees.map { .number(Double($0)) }),
            "all_members": .bool(allMembers),
            "rotate": .bool(rotate),
            "target": .optional(target),
            "goal_until": .optional(goalUntil),
        ])
    }
}

/// Человек: друг, заявка, найденный по @username.
public struct Person: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var firstName: String
    public var username: String?
    public var photoUrl: String?

    public init(id: Int, firstName: String, username: String? = nil, photoUrl: String? = nil) {
        self.id = id
        self.firstName = firstName
        self.username = username
        self.photoUrl = photoUrl
    }

    /// Аватарка — как у участника группы.
    public var member: GroupMember { GroupMember(id: id, name: firstName, photo: photoUrl) }
}

/// Друг в списке: сколько открытых мне привычек он сделал сегодня из нужных сегодня.
public struct FriendCard: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var firstName: String
    public var username: String?
    public var photoUrl: String?
    /// Когда стали друзьями.
    public var since: String?
    public var done: Int
    public var due: Int
    /// Общая карта за последние 14 дней (с самого раннего по сегодня) — полоска в карточке.
    public var days: [Double]

    public init(id: Int, firstName: String, username: String? = nil, photoUrl: String? = nil, since: String? = nil, done: Int = 0, due: Int = 0, days: [Double] = []) {
        self.id = id
        self.firstName = firstName
        self.username = username
        self.photoUrl = photoUrl
        self.since = since
        self.done = done
        self.due = due
        self.days = days
    }

    public var person: Person { Person(id: id, firstName: firstName, username: username, photoUrl: photoUrl) }
}

/// Заявка ко мне: нашли по @username или открыли мою ссылку.
public struct FriendRequest: Codable, Sendable, Equatable, Identifiable {
    public enum Via: String, Codable, Sendable {
        case username, link
    }

    public var id: Int
    public var firstName: String
    public var username: String?
    public var photoUrl: String?
    public var via: Via

    public init(id: Int, firstName: String, username: String? = nil, photoUrl: String? = nil, via: Via = .username) {
        self.id = id
        self.firstName = firstName
        self.username = username
        self.photoUrl = photoUrl
        self.via = via
    }

    public var person: Person { Person(id: id, firstName: firstName, username: username, photoUrl: photoUrl) }
}

/// GET /friends.
public struct FriendsResponse: Codable, Sendable, Equatable {
    public var friends: [FriendCard]
    /// Заявки ко мне.
    public var incoming: [FriendRequest]
    /// Мои заявки, которые ещё не приняли.
    public var outgoing: [Person]
    /// Моя постоянная ссылка «Позвать друга» (открывший присылает заявку).
    public var link: String
    /// Показать один раз «Что показать друзьям?»: друг уже есть, а шторку ещё не видели.
    public var prompt: Bool

    public init(friends: [FriendCard] = [], incoming: [FriendRequest] = [], outgoing: [Person] = [], link: String = "", prompt: Bool = false) {
        self.friends = friends
        self.incoming = incoming
        self.outgoing = outgoing
        self.link = link
        self.prompt = prompt
    }
}

/// Кто это для меня: друг, заявка от меня, заявка ко мне, я сам, я его заблокировала — или никто.
public enum PersonStatus: String, Codable, Sendable {
    case none, friends, sent, incoming, `self`, blocked
}

/// Найденный человек или хозяин чужой ссылки — и кто он мне.
public struct FoundPerson: Codable, Sendable, Equatable {
    public var person: Person
    public var status: PersonStatus

    public init(person: Person, status: PersonStatus) {
        self.person = person
        self.status = status
    }
}

/// Открытая друзьям привычка — на экране друга.
public struct FriendHabit: Codable, Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var emoji: String?
    public var kind: TaskKind
    public var unit: String?
    public var target: Double
    public var value: Double
    public var status: AbstainStatus?
    public var due: Bool
    /// «Бросить»: «N дней без».
    public var cleanDays: Int

    public init(id: Int, title: String, emoji: String? = nil, kind: TaskKind, unit: String? = nil, target: Double = 1, value: Double = 0, status: AbstainStatus? = nil, due: Bool = true, cleanDays: Int = 0) {
        self.id = id
        self.title = title
        self.emoji = emoji
        self.kind = kind
        self.unit = unit
        self.target = target
        self.value = value
        self.status = status
        self.due = due
        self.cleanDays = cleanDays
    }
}

/// Экран друга (GET /friends/:id).
public struct FriendProfile: Codable, Sendable, Equatable {
    public var person: Person
    public var since: String?
    /// Логический день друга (его «сегодня»).
    public var today: String
    /// Общая карта за год — по всем привычкам и делам, без названий.
    public var heat: [HeatDay]
    public var habits: [FriendHabit]

    public init(person: Person, since: String? = nil, today: String, heat: [HeatDay] = [], habits: [FriendHabit] = []) {
        self.person = person
        self.since = since
        self.today = today
        self.heat = heat
        self.habits = habits
    }
}

/// Отметка группового дела: taken — «кто-то один» уже сделал до меня.
public struct GroupMarked: Codable, Sendable, Equatable {
    public var taken: Bool

    public init(taken: Bool) { self.taken = taken }
}

/// Ссылка-приглашение в группу (действует 7 дней).
public struct GroupInvite: Codable, Sendable, Equatable {
    public var code: String
    public var link: String

    public init(code: String, link: String) {
        self.code = code
        self.link = link
    }
}

public extension APIClient {
    // MARK: Группы

    func groups() async throws -> [GroupToday] {
        try await send("GET", "groups")
    }

    /// Экран группы: дела на сегодня, люди, настройки, «Скоро». 404 — группы нет или я в ней не состою.
    func group(id: Int) async throws -> GroupToday {
        try await send("GET", "groups/\(id)")
    }

    /// Новая группа: тип не выбирают (значок и цвет — из самой группы), уходит «other», как в мини-аппе.
    func createGroup(title: String) async throws -> Int {
        try await send("POST", "groups", json: JSONValue.object(["title": .string(title), "kind": "other"]), as: Created.self).id
    }

    /// Название или «дела заводят только админы»: только переданное.
    func updateGroup(id: Int, _ patch: [String: JSONValue]) async throws {
        _ = try await send("PATCH", "groups/\(id)", json: JSONValue.object(patch), as: Empty.self)
    }

    func deleteGroup(id: Int) async throws {
        _ = try await send("DELETE", "groups/\(id)", as: Empty.self)
    }

    func leaveGroup(id: Int) async throws {
        _ = try await send("POST", "groups/\(id)/leave", as: Empty.self)
    }

    /// Ссылка «Позвать в группу» (и для подключения чата Telegram).
    func invite(groupId: Int) async throws -> GroupInvite {
        try await send("POST", "groups/\(groupId)/invite")
    }

    /// Чат ещё жив? Удалённый в Telegram пропадает из настроек.
    func checkGroupChat(groupId: Int) async throws -> String? {
        struct Answer: Decodable { let tgChatTitle: String? }
        let answer: Answer = try await send("POST", "groups/\(groupId)/chat/check")
        return answer.tgChatTitle
    }

    func disconnectGroupChat(groupId: Int) async throws {
        _ = try await send("DELETE", "groups/\(groupId)/chat", as: Empty.self)
    }

    /// Приглашение по коду. 404 — нет такого, 410 invite_expired — устарело.
    func invitation(code: String) async throws -> Invitation {
        try await send("GET", "invites/\(code)")
    }

    func join(code: String) async throws -> Int {
        try await send("POST", "invites/\(code)/join", as: Created.self).id
    }

    func createGroupItem(groupId: Int, _ input: GroupItemInput) async throws -> Int {
        try await send("POST", "groups/\(groupId)/items", json: input.json, as: Created.self).id
    }

    func updateGroupItem(groupId: Int, itemId: Int, _ input: GroupItemInput) async throws {
        _ = try await send("PATCH", "groups/\(groupId)/items/\(itemId)", json: input.json, as: Empty.self)
    }

    /// 403 admins_only — в этой группе дела правят только админы.
    func deleteGroupItem(groupId: Int, itemId: Int) async throws {
        _ = try await send("DELETE", "groups/\(groupId)/items/\(itemId)", as: Empty.self)
    }

    /// Убрать повторяющееся дело только в этот день.
    func skipGroupItem(groupId: Int, itemId: Int, day: String) async throws {
        _ = try await send("POST", "groups/\(groupId)/items/\(itemId)/skip", json: JSONValue.object(["day": .string(day)]), as: Empty.self)
    }

    /// Отметить (или снять) за сегодня; day — в другой день календаря. 403 not_yours — дело сегодня не на мне.
    func markGroupItem(groupId: Int, itemId: Int, done: Bool, day: String? = nil) async throws -> GroupMarked {
        var body: [String: JSONValue] = ["done": .bool(done)]
        if let day { body["day"] = .string(day) }
        return try await send("PUT", "groups/\(groupId)/items/\(itemId)/mark", json: JSONValue.object(body))
    }

    /// Вклад в общую цель.
    func addGoalEntry(groupId: Int, itemId: Int, amount: Double) async throws {
        _ = try await send("POST", "groups/\(groupId)/items/\(itemId)/entries", json: JSONValue.object(["amount": .number(amount)]), as: Empty.self)
    }

    // MARK: Друзья

    func friends() async throws -> FriendsResponse {
        try await send("GET", "friends")
    }

    /// Экран друга. 404 — уже не друзья.
    func friend(id: Int) async throws -> FriendProfile {
        try await send("GET", "friends/\(id)")
    }

    /// Найти по @username. 400 bad_username, 404 — нет такого в LifeCommit.
    func findPerson(username: String) async throws -> FoundPerson {
        try await send("GET", "friends/find", query: [URLQueryItem(name: "username", value: username)])
    }

    /// Хозяин чужой ссылки «Позвать друга».
    func friendLink(code: String) async throws -> FoundPerson {
        try await send("GET", "friends/link/\(code)")
    }

    /// Заявка: по @username или по коду чужой ссылки. Ответ — sent или friends (встречная заявка — сразу друзья).
    func requestFriend(username: String) async throws -> PersonStatus {
        try await requestFriend(["username": .string(username)])
    }

    func requestFriend(code: String) async throws -> PersonStatus {
        try await requestFriend(["code": .string(code)])
    }

    private func requestFriend(_ body: [String: JSONValue]) async throws -> PersonStatus {
        struct Answer: Decodable { let status: PersonStatus }
        let answer: Answer = try await send("POST", "friends/requests", json: JSONValue.object(body))
        return answer.status
    }

    func acceptFriend(id: Int) async throws {
        _ = try await send("POST", "friends/requests/\(id)/accept", as: Empty.self)
    }

    /// Отклонить заявку ко мне или отменить свою.
    func dropFriendRequest(id: Int) async throws {
        _ = try await send("DELETE", "friends/requests/\(id)", as: Empty.self)
    }

    func removeFriend(id: Int) async throws {
        _ = try await send("DELETE", "friends/\(id)", as: Empty.self)
    }

    func block(id: Int) async throws {
        _ = try await send("POST", "friends/\(id)/block", as: Empty.self)
    }

    /// «Что показать друзьям?»: эти привычки видят друзья, остальные — только я.
    func setShown(taskIds: [Int]) async throws {
        _ = try await send("PUT", "friends/shown", json: JSONValue.object(["task_ids": .array(taskIds.map { .number(Double($0)) })]), as: Empty.self)
    }

    /// Служебная отметка «уже спросили, что показать».
    func promptSeen() async throws {
        _ = try await send("POST", "friends/prompted", as: Empty.self)
    }
}
