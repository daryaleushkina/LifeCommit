// «Вместе» без экрана: порядок групповых дел, «Скоро», «Тебе: …», шторка группового дела (GroupItemSheet.tsx),
// цвета аватарок и значков (groupUi.tsx), ссылки-приглашения, карта «Месяц · Год» (Heatmap.tsx, HeatCard.tsx),
// друзья (Friends.tsx). Правило «кто делает сегодня» считает сервер (shared/groups.ts dayItem) — здесь его нет.
import Foundation

public enum GroupLogic {
    /// Форма слова по числу (plural в shared/groups.ts): 1 книга, 2 книги, 5 книг; дробное — «книги».
    public static func plural(_ n: Double, _ forms: [String]) -> String {
        guard forms.count >= 3 else { return forms.first ?? "" }
        if n.rounded() != n { return forms[1] }
        let a = Int(abs(n).truncatingRemainder(dividingBy: 100))
        let b = a % 10
        if a > 10 && a < 20 { return forms[2] }
        if b == 1 { return forms[0] }
        if (2...4).contains(b) { return forms[1] }
        return forms[2]
    }

    /// Число цели: «62 400», «62 400 ₽» или «12 книг».
    public static func goalNumber(_ n: Double, unit: GoalUnit?, strings t: Strings) -> String {
        guard let unit else { return t.num(n) }
        if let currency = unit.currency { return "\(t.num(n)) \(currency)" }
        return "\(t.num(n)) \(plural(n, unit.forms))"
    }

    /// «Сегодня» (GroupBlocks.tsx): моё, «кто-то один», мероприятия и цели; цели сверху, по времени, без времени,
    /// мероприятия, сделанные вниз.
    public static func todayOrder(_ items: [GroupDayItem]) -> [GroupDayItem] {
        sorted(items.filter(\.forMe)) { $0.mode == .goal ? -1 : rank($0) }
    }

    /// Экран группы (Group.tsx): без целей (они отдельно сверху); несделанные по времени, без времени, мероприятия,
    /// сделанные вниз.
    public static func screenOrder(_ items: [GroupDayItem]) -> [GroupDayItem] {
        sorted(items.filter { $0.mode != .goal }, rank)
    }

    public static func goals(_ items: [GroupDayItem]) -> [GroupDayItem] { items.filter { $0.mode == .goal } }

    private static func rank(_ it: GroupDayItem) -> Int {
        it.done ? 3 : it.mode == .event ? 2 : it.time != nil ? 0 : 1
    }

    /// Устойчивая сортировка, как Array.sort в JS: равные остаются в прежнем порядке.
    private static func sorted(_ items: [GroupDayItem], _ rank: (GroupDayItem) -> Int) -> [GroupDayItem] {
        items.enumerated().sorted { a, b in
            let ra = rank(a.element), rb = rank(b.element)
            if ra != rb { return ra < rb }
            let ta = a.element.time ?? "", tb = b.element.time ?? ""
            if ta != tb { return ta < tb }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// «Скоро» — разовые дела и мероприятия; повторяющиеся и так видны каждый день.
    public static func soon(_ upcoming: [GroupDayBlock]) -> [GroupDayBlock] {
        upcoming.compactMap { block in
            var b = block
            b.items = block.items.filter { !$0.recurring || $0.mode == .event }
            return b.items.isEmpty ? nil : b
        }
    }

    /// «Тебе: …» в списке групп — моё единственное несделанное дело.
    public static func forYou(_ group: GroupToday, me: Int) -> GroupDayItem? {
        group.items.first { $0.forMe && !$0.done && $0.mode != .goal && $0.mode != .event && $0.people == [me] }
    }

    /// Свайп по общему делу: повторяющееся — спросить «только сегодня или у всех»; разовое и цель — сразу с «Вернуть».
    public static func asksRemoval(_ it: GroupDayItem) -> Bool { it.recurring && it.mode != .goal }

    /// Отметить в дне календаря можно сегодня и неделю назад: раньше сервер откажет (400 bad_day), будущее — не наступило.
    public static func canMark(on day: String, today: String) -> Bool { day <= today && day >= Days.add(today, -7) }

    /// Отметка на экране сразу: сделал я — в «сделали», снял — убрал себя.
    public static func marked(_ it: GroupDayItem, done: Bool, me: Int) -> GroupDayItem {
        var next = it
        next.done = done
        next.doneBy = done ? it.doneBy + [me] : it.doneBy.filter { $0 != me }
        return next
    }

    /// Что человек сделал сегодня в группе — под его именем во вкладке «Люди».
    public static func doneToday(_ group: GroupToday, by user: Int) -> [String] {
        group.items.filter { $0.doneBy.contains(user) }.map(\.title)
    }

    /// Имя в строке дела: я — «Я», ушедший из группы — «…».
    public static func name(_ id: Int, members: [GroupMember], me: Int, strings t: Strings) -> String {
        id == me ? t.gr.me : members.first { $0.id == id }?.name ?? "…"
    }

    /// Подпись под групповым делом (GroupItemRow): кто делает и кто сделал.
    public enum Badge: Equatable, Sendable {
        /// Серая: «мероприятие», «кто-то один», «очередь: Аня».
        case gray(String)
        /// Моя: «тебе», «твоя очередь».
        case mine(String)
        /// Назначено одному другому — его имя.
        case other(String)
        /// «каждому».
        case all(String)
    }

    public static func badge(_ it: GroupDayItem, members: [GroupMember], me: Int, strings t: Strings) -> Badge? {
        let g = t.gr
        switch it.mode {
        case .event: return .gray(g.event)
        case .one: return .gray(g.anyone)
        case .goal: return nil
        case .assign:
            if let turn = it.turn { return turn == me ? .mine(g.yourTurn) : .gray(g.turnOf(name(turn, members: members, me: me, strings: t))) }
            if it.people.count == 1, let only = it.people.first { return only == me ? .mine(g.toYou) : .other(name(only, members: members, me: me, strings: t)) }
            return .all(g.toAll)
        }
    }

    /// «сделано: Аня, Я».
    public static func doneLine(_ it: GroupDayItem, members: [GroupMember], me: Int, strings t: Strings) -> String? {
        guard !it.doneBy.isEmpty, it.mode != .goal else { return nil }
        return t.gr.doneBy(it.doneBy.map { name($0, members: members, me: me, strings: t) }.joined(separator: ", "))
    }

    /// Число из поля («150 000», «5,5»): пробелы убираются, запятая — десятичная. Не число — 0.
    public static func number(_ text: String) -> Double {
        Double(text.filter { !$0.isWhitespace }.replacingOccurrences(of: ",", with: ".")) ?? 0
    }

    /// Что можно ввести в поле числа: цифры, пробелы, точка и запятая (как replace(/[^\d\s.,]/g, '')).
    public static func numberInput(_ text: String) -> String {
        text.filter { $0.isASCII && ($0.isNumber || $0 == " " || $0 == "." || $0 == ",") }
    }
}

/// Повтор группового дела в шторке: пять вариантов ↔ RRULE.
public enum GroupRepeat: String, Sendable, CaseIterable {
    case once, daily, weekdays, weekends, weekly

    private static let byDay = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

    public func rrule(day: String) -> String? {
        switch self {
        case .once: nil
        case .daily: "FREQ=DAILY"
        case .weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        case .weekends: "FREQ=WEEKLY;BYDAY=SA,SU"
        case .weekly: "FREQ=WEEKLY;BYDAY=\(Self.byDay[Days.weekdayIndex(day)])"
        }
    }

    public init(rrule: String?) {
        guard let rrule else {
            self = .once
            return
        }
        let r = rrule.uppercased()
        if r == "FREQ=DAILY" { self = .daily }
        else if r.contains("BYDAY=MO,TU,WE,TH,FR") { self = .weekdays }
        else if r.contains("BYDAY=SA,SU") { self = .weekends }
        else { self = .weekly }
    }

    /// День выбирают только у разового и «раз в неделю» (у остальных его задаёт повтор).
    public var hasDay: Bool { self == .once || self == .weekly }
}

/// Шторка группового дела (GroupItemSheet.tsx): что выбрано и что уйдёт на сервер.
public struct GroupItemForm: Sendable, Equatable {
    public var title: String
    public var mode: GroupMode
    /// «Все» — и будущие участники.
    public var all: Bool
    /// Выбранные люди — в порядке дела (по нему сервер считает очередь), новые — в конец.
    public var people: [Int]
    public var rotate: Bool
    public var repeatRule: GroupRepeat
    public var day: String
    public var time: String?
    /// Цель — как напечатали («150 000»).
    public var target: String
    public var until: String
    /// Повтор и первый день дела, как пришли: повтор не меняли — правило уходит как было (у «вт и чт» из голоса шторка
    /// показывает только «раз в неделю»).
    private var originalRule: String?
    private var originalDay: String?

    /// Новое дело: «кто-то один», назначено мне, сегодня, без времени.
    public init(me: Int, today: String) {
        title = ""
        mode = .one
        all = false
        people = [me]
        rotate = false
        repeatRule = .once
        day = today
        time = nil
        target = ""
        until = ""
    }

    /// Правка: как задано у дела.
    public init(item: GroupDayItem, me: Int) {
        title = item.title
        mode = item.mode
        all = item.allMembers
        people = item.assignees.isEmpty ? [me] : item.assignees
        rotate = item.rotate
        repeatRule = GroupRepeat(rrule: item.rrule)
        originalRule = item.rrule
        originalDay = item.start
        day = item.start
        time = item.time
        // Как String(item.target) в мини-аппе: «150000», «2.5».
        target = item.target.map { $0.rounded() == $0 && abs($0) < 1e15 ? String(Int64($0)) : String($0) } ?? ""
        until = item.goalUntil ?? ""
    }

    /// Люди выбираются у «Назначить» и «Мероприятия».
    public var choosesPeople: Bool { mode == .assign || mode == .event }

    /// Кто выбран: «Все» — все участники по порядку.
    public func chosen(_ members: [GroupMember]) -> [Int] {
        all ? members.map(\.id) : people.filter(Set(members.map(\.id)).contains)
    }

    /// «По очереди» — когда назначено двоим и больше.
    public func canRotate(_ members: [GroupMember]) -> Bool { mode == .assign && chosen(members).count >= 2 }

    public func valid(_ members: [GroupMember]) -> Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (mode != .goal || GroupLogic.number(target) > 0)
            && (!choosesPeople || !chosen(members).isEmpty)
    }

    /// Нажали на человека: был «Все» — снимается, выбор начинается со всех.
    public mutating func toggle(_ id: Int, members: [GroupMember]) {
        var next = all ? members.map(\.id) : people
        if next.contains(id) { next.removeAll { $0 == id } } else { next.append(id) }
        all = false
        people = next
    }

    /// Правило повтора для сервера: не меняли повтор (и день у «раз в неделю») — прежнее.
    private var rule: String? {
        if let originalRule, GroupRepeat(rrule: originalRule) == repeatRule, repeatRule != .weekly || day == originalDay { return originalRule }
        return repeatRule.rrule(day: day)
    }

    /// Что уходит на сервер. Цель — на сегодня, без времени и повтора.
    public func input(members: [GroupMember], today: String) -> GroupItemInput {
        let goal = mode == .goal
        return GroupItemInput(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            mode: mode,
            day: goal ? today : day,
            time: goal ? nil : time,
            rrule: goal ? nil : rule,
            assignees: choosesPeople && !all ? chosen(members) : [],
            allMembers: choosesPeople && all,
            rotate: canRotate(members) && rotate,
            target: goal ? GroupLogic.number(target) : nil,
            goalUntil: goal && !until.isEmpty ? until : nil
        )
    }
}

/// Цвета аватарок и значков групп по id (groupUi.tsx): у человека и группы один цвет везде. Фон и буква — 0xRRGGBB.
public enum Tints {
    public static let avatar: [(bg: UInt32, ink: UInt32)] = [
        (0xDCEBDD, 0x1F4A2C), (0xDDE3F0, 0x23365C), (0xF1E3C8, 0x5A4214), (0xEBDCE6, 0x5A2748), (0xE3E0F2, 0x3A2F6B), (0xD9ECEC, 0x1E4B4B),
    ]

    /// Значок группы: цвета типов family, sport, pair, friends, work, other — по id группы.
    public static let group: [(bg: UInt32, ink: UInt32)] = [
        (0xF5EBD3, 0x6E4F0E), (0xE6F2E9, 0x237A46), (0xE3E9F6, 0x2B4579), (0xEBDCE6, 0x5A2748), (0xE3E0F2, 0x3A2F6B), (0xECEAE3, 0x4A5449),
    ]

    /// Как Math.abs(id) % n в мини-аппе: у отрицательных id цвет тот же, что у положительных.
    public static func avatar(_ id: Int) -> (bg: UInt32, ink: UInt32) { avatar[abs(id) % avatar.count] }

    public static func group(_ id: Int) -> (bg: UInt32, ink: UInt32) { group[abs(id) % group.count] }

    /// Буква аватарки и значка: первая буква, нет имени — «?».
    public static func initial(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "?"
    }

    /// Фото — только https (адрес приходит с сервера, но берётся из Telegram).
    public static func photoURL(_ photo: String?) -> URL? {
        guard let photo, let url = URL(string: photo), url.scheme == "https", url.host() != nil else { return nil }
        return url
    }
}

/// Приглашение из ссылки: https://lifecommit.app/j/<код> (в группу) и /f/<код> (в друзья) — когда настроят universal
/// links; lifecommit://join/<код> и lifecommit://friend/<код> — кнопка «Открыть в приложении» на странице приглашения.
public struct InviteLink: Sendable, Equatable {
    public enum Kind: String, Sendable {
        case join, friend
    }

    public let kind: Kind
    public let code: String

    public init(kind: Kind, code: String) {
        self.kind = kind
        self.code = code
    }

    /// Чужой хост, лишние части пути или код не из букв, цифр, «-» и «_» — nil: в путь API ничего другого не попадёт.
    public init?(url: URL) {
        let parts = url.path().split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        let kind: Kind
        let code: String
        if url.scheme == "https", url.host() == "lifecommit.app", parts.count == 2, parts[0] == "j" || parts[0] == "f" {
            kind = parts[0] == "j" ? .join : .friend
            code = parts[1]
        } else if url.scheme == "lifecommit", let host = url.host(), let k = Kind(rawValue: host), parts.count == 1 {
            kind = k
            code = parts[0]
        } else {
            return nil
        }
        guard Self.isCode(code) else { return nil }
        self.init(kind: kind, code: code)
    }

    /// ^[A-Za-z0-9_-]{4,64}$
    public static func isCode(_ s: String) -> Bool {
        (4...64).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }
}

/// Карта «Месяц · Год» — в профиле и на экране друга.
public enum HeatMap {
    /// Сколько месяцев назад можно листать: столько истории загружено для карты года.
    public static let monthsBack = 11
    /// Недель в карте года (371 день — столько отдаёт сервер).
    public static let yearWeeks = 53

    /// Уровень дня по очкам (heatLevel в shared/types.ts): 0 — пусто … 4 — ярко.
    public static func level(_ score: Double) -> Int {
        if score <= 0 { return 0 }
        if score < 1 { return 1 }
        if score < 3 { return 2 }
        if score < 5 { return 3 }
        return 4
    }

    /// Первый день карты года — понедельник 52 недели назад.
    public static func yearStart(_ today: String) -> String {
        Days.add(today, -Days.weekdayIndex(today) - (yearWeeks - 1) * 7)
    }

    /// Недели года: понедельник и месяц подписи (у недели, где месяц начался; у первой — всегда; иначе nil).
    public static func weeks(_ today: String) -> [(monday: String, month: String?)] {
        let start = yearStart(today)
        return (0..<yearWeeks).map { w in
            let monday = Days.add(start, w * 7)
            let first = (0..<7).map { Days.add(monday, $0) }.first { $0.hasSuffix("-01") }
            return (monday, first.map(Months.of) ?? (w == 0 ? Months.of(monday) : nil))
        }
    }

    /// Клетка дня: nil — будущее (не красим).
    public static func cell(_ day: String, levels: [String: Int], today: String) -> Int? {
        day > today ? nil : levels[day] ?? 0
    }

    public static func levels(_ days: [HeatDay]) -> [String: Int] {
        Dictionary(days.map { ($0.day, level($0.score)) }, uniquingKeysWith: { _, last in last })
    }

    /// Активные дни в месяце (или за год, month == nil).
    public static func activeDays(_ days: [HeatDay], month: String?) -> Int {
        days.filter { d in d.score > 0 && (month.map { d.day.hasPrefix($0) } ?? true) }.count
    }
}

public enum FriendsLogic {
    /// Поиск по друзьям: по имени или @username, без учёта регистра.
    public static func search(_ friends: [FriendCard], _ query: String) -> [FriendCard] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return friends }
        let name = q.hasPrefix("@") ? String(q.dropFirst()) : q
        return friends.filter { $0.firstName.lowercased().contains(q) || ($0.username?.lowercased().contains(name) ?? false) }
    }

    /// Строка под привычкой друга и сделана ли она: «5 дней без этого», «3 из 8 стаканов», «сделано»; ничего — nil.
    public static func habitNote(_ h: FriendHabit, strings t: Strings) -> (text: String?, done: Bool) {
        switch h.kind {
        case .abstain:
            return (h.cleanDays > 0 ? t.cleanDays(h.cleanDays) : nil, h.status == .clean)
        case .count:
            return (h.value > 0 ? t.fr.countToday(t.num(h.value), t.num(h.target), h.unit) : nil, h.value >= h.target)
        case .check:
            return (h.value > 0 ? t.fr.doneToday : nil, h.value >= 1)
        }
    }

    public enum SearchProblem: Equatable, Sendable { case badUsername, notFound, error }

    public static func searchProblem(_ error: Error) -> SearchProblem {
        guard let api = error as? APIError else { return .error }
        if api.code == "bad_username" { return .badUsername }
        return api.status == 404 ? .notFound : .error
    }

    /// Поиск по @username — когда напечатали хотя бы 4 знака (без «@»).
    public static func searchable(_ name: String) -> Bool {
        let clean = name.trimmingCharacters(in: .whitespaces)
        return (clean.hasPrefix("@") ? clean.dropFirst() : Substring(clean)).count >= 4
    }
}
