// Тексты раздела «Вместе» — gr.*, fr.*, удаление общего дела (swipe.*) и карта «Месяц · Год» — слово в слово как
// src/i18n.ts мини-аппа.
import Foundation

public struct GroupStrings: Sendable {
    public struct Join: Sendable {
        public let invites: @Sendable (String) -> String
        public let invitesAnon: String
        public let what: String
        public let p1: String
        public let p1s: String
        public let p2: String
        public let p2s: String
        public let p3: String
        public let p3s: String
        public let btn: String
        public let later: String
        public let expired: String
        public let notFound: String
        public let already: String
        public let open: String
    }

    public let empty: String
    public let newGroup: String
    public let namePh: String
    public let create: String
    public let progress: @Sendable (Int, Int) -> String
    public let people: @Sendable (Int) -> String
    public let forYou: @Sendable (String) -> String
    public let tabItems: String
    public let tabPeople: String
    public let todayLabel: String
    public let soon: String
    public let settings: String
    public let name: String
    public let nothingToday: String
    public let invite: String
    public let inviteHint: String
    public let inviteSent: String
    public let connectChat: String
    public let chatLabel: String
    public let chatOther: String
    public let chatOff: String
    public let chatOffConfirm: @Sendable (String) -> String
    public let connectChatHint: String
    public let addItem: String
    public let newItem: @Sendable (String) -> String
    public let itemPh: String
    public let eventPh: String
    public let goalPh: String
    public let who: String
    public let modes: [GroupMode: String]
    public let modeHints: [GroupMode: String]
    public let all: String
    public let me: String
    public let rotate: String
    public let eachHint: String
    public let repeatLabel: String
    public let repeats: [GroupRepeat: String]
    public let date: String
    public let time: String
    public let allDay: String
    public let noTime: String
    public let target: String
    public let targetPh: String
    public let until: String
    public let add: String
    public let save: String
    public let remove: String
    public let anyone: String
    public let toYou: String
    public let toAll: String
    public let event: String
    public let turnOf: @Sendable (String) -> String
    public let yourTurn: String
    public let doneBy: @Sendable (String) -> String
    public let taken: String
    public let notYours: String
    public let goalOf: @Sendable (String, String) -> String
    public let put: String
    public let putTitle: @Sendable (String) -> String
    public let putPh: String
    public let leave: String
    public let leaveConfirm: String
    public let removeGroup: String
    public let removeConfirm: String
    public let adminsOnly: String
    public let join: Join

    public static let ru: GroupStrings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .ru) }
        return GroupStrings(
            empty: "Пока ни одной группы. Заведи семейную — или позови друга вдвоём.",
            newGroup: "Новая группа",
            namePh: "Как назовём? Например, Семья",
            create: "Создать группу",
            progress: { "\(num($0)) из \(num($1)) сегодня" },
            people: { "\(num($0)) \(Plural.ru($0, "человек", "человека", "человек"))" },
            forYou: { "Тебе: \($0)" },
            tabItems: "Дела",
            tabPeople: "Люди",
            todayLabel: "Сегодня",
            soon: "Скоро",
            settings: "Настройки группы",
            name: "Название группы",
            nothingToday: "На сегодня в группе ничего",
            invite: "Позвать в группу",
            inviteHint: "Ссылка действует 7 дней",
            inviteSent: "Ссылка готова — отправь её в чат",
            connectChat: "Подключить чат Telegram",
            chatLabel: "Чат Telegram",
            chatOther: "Другой чат",
            chatOff: "Отключить",
            chatOffConfirm: { "Отключить чат «\($0)»? Бот попрощается и выйдет из него." },
            connectChatHint: "Бот будет присылать в чат дела на сегодня с кнопками, а ответом ему можно добавлять дела голосом.",
            addItem: "Дело",
            newItem: { "Новое дело · \($0)" },
            itemPh: "Что сделать?",
            eventPh: "Что будет? Например, семейный ужин",
            goalPh: "Например, отпуск в Грузии",
            who: "Кто делает",
            modes: [.one: "Кто-то один", .assign: "Назначить", .goal: "Общая цель", .event: "Мероприятие"],
            modeHints: [.one: "сделал один — закрыто у всех", .assign: "одному, нескольким или всем", .goal: "вместе до одной цифры", .event: "ужин, поездка — без галочки"],
            all: "Все",
            me: "Я",
            rotate: "По очереди",
            eachHint: "каждый отмечает сам",
            repeatLabel: "Повторять",
            repeats: [.once: "Один раз", .daily: "Каждый день", .weekdays: "Будни", .weekends: "Выходные", .weekly: "Раз в неделю"],
            date: "Когда",
            time: "Время",
            allDay: "Весь день",
            noTime: "Без времени",
            target: "Цель — число",
            targetPh: "150 000",
            until: "К какому дню",
            add: "Добавить",
            save: "Сохранить",
            remove: "Удалить дело",
            anyone: "кто-то один",
            toYou: "тебе",
            toAll: "каждому",
            event: "мероприятие",
            turnOf: { "очередь: \($0)" },
            yourTurn: "твоя очередь",
            doneBy: { "сделано: \($0)" },
            taken: "Уже кто-то сделал",
            notYours: "Это дело сегодня не на тебе",
            goalOf: { "\($0) из \($1)" },
            put: "Положить",
            putTitle: { "Положить · \($0)" },
            putPh: "5 000",
            leave: "Выйти из группы",
            leaveConfirm: "Выйти из группы? Её дела пропадут у тебя с «Сегодня».",
            removeGroup: "Удалить группу",
            removeConfirm: "Удалить группу для всех? Дела и отметки пропадут у всех участников.",
            adminsOnly: "Дела заводят только админы",
            join: Join(
                invites: { "\($0) зовёт тебя в группу" },
                invitesAnon: "Тебя зовут в группу",
                what: "Что будет",
                p1: "Общие дела — у тебя на «Сегодня»",
                p1s: "отмечаешь — видят все в группе",
                p2: "Отмечать можно и в чате",
                p2s: "кнопками под сообщением бота",
                p3: "Твои личные дела группа не видит",
                p3s: "покажешь привычку сама, если захочешь",
                btn: "Вступить",
                later: "Не сейчас",
                expired: "Ссылка устарела — попроси новую.",
                notFound: "Приглашение не найдено.",
                already: "Ты уже в этой группе",
                open: "Открыть группу"
            )
        )
    }()

    public static let en: GroupStrings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .en) }
        return GroupStrings(
            empty: "No groups yet. Start one for your family — or invite a friend.",
            newGroup: "New group",
            namePh: "Name it, e.g. Family",
            create: "Create group",
            progress: { "\(num($0)) of \(num($1)) today" },
            people: { "\(num($0)) \($0 == 1 ? "person" : "people")" },
            forYou: { "For you: \($0)" },
            tabItems: "To-dos",
            tabPeople: "People",
            todayLabel: "Today",
            soon: "Coming up",
            settings: "Group settings",
            name: "Group name",
            nothingToday: "Nothing in the group today",
            invite: "Invite to the group",
            inviteHint: "The link works for 7 days",
            inviteSent: "Link ready — send it to the chat",
            connectChat: "Connect a Telegram chat",
            chatLabel: "Telegram chat",
            chatOther: "Another chat",
            chatOff: "Disconnect",
            chatOffConfirm: { "Disconnect “\($0)”? The bot will say goodbye and leave it." },
            connectChatHint: "The bot will post the day’s to-dos to the chat with buttons, and you can add to-dos by replying to it by voice.",
            addItem: "To-do",
            newItem: { "New to-do · \($0)" },
            itemPh: "What needs doing?",
            eventPh: "What is happening? E.g. family dinner",
            goalPh: "E.g. a trip to Georgia",
            who: "Who does it",
            modes: [.one: "Anyone", .assign: "Assign", .goal: "Shared goal", .event: "Event"],
            modeHints: [.one: "one person does it — done for all", .assign: "one, several or everyone", .goal: "together towards one number", .event: "dinner, trip — no checkbox"],
            all: "All",
            me: "Me",
            rotate: "Take turns",
            eachHint: "everyone checks their own",
            repeatLabel: "Repeat",
            repeats: [.once: "Once", .daily: "Every day", .weekdays: "Weekdays", .weekends: "Weekends", .weekly: "Once a week"],
            date: "When",
            time: "Time",
            allDay: "All day",
            noTime: "No time",
            target: "Goal — a number",
            targetPh: "150,000",
            until: "By",
            add: "Add",
            save: "Save",
            remove: "Delete to-do",
            anyone: "anyone",
            toYou: "yours",
            toAll: "everyone",
            event: "event",
            turnOf: { "\($0)'s turn" },
            yourTurn: "your turn",
            doneBy: { "done: \($0)" },
            taken: "Someone already did it",
            notYours: "This one is not on you today",
            goalOf: { "\($0) of \($1)" },
            put: "Add",
            putTitle: { "Add · \($0)" },
            putPh: "5,000",
            leave: "Leave the group",
            leaveConfirm: "Leave the group? Its to-dos will disappear from your Today.",
            removeGroup: "Delete group",
            removeConfirm: "Delete the group for everyone? To-dos and check-ins disappear for all members.",
            adminsOnly: "Only admins add to-dos",
            join: Join(
                invites: { "\($0) invites you to a group" },
                invitesAnon: "You are invited to a group",
                what: "What happens",
                p1: "Shared to-dos show up on your Today",
                p1s: "check one off — the group sees it",
                p2: "You can check off in the chat too",
                p2s: "with buttons under the bot's message",
                p3: "The group does not see your personal to-dos",
                p3s: "share a habit yourself if you want",
                btn: "Join",
                later: "Not now",
                expired: "The link has expired — ask for a new one.",
                notFound: "Invitation not found.",
                already: "You are already in this group",
                open: "Open the group"
            )
        )
    }()
}

public struct FriendStrings: Sendable {
    public let tabGroups: String
    public let tabFriends: String
    public let invite: String
    public let empty: String
    public let requests: @Sendable (Int) -> String
    public let requestsTitle: String
    public let waiting: String
    public let cancel: String
    public let accept: String
    public let decline: String
    public let viaLink: String
    public let progress: @Sendable (Int, Int) -> String
    public let search: String
    public let nothingFound: String
    public let sendLink: String
    public let shareText: String
    public let usernamePh: String
    public let call: String
    public let status: [PersonStatus: String]
    public let notFound: String
    public let badUsername: String
    public let remove: String
    public let block: String
    public let removeConfirm: @Sendable (String) -> String
    public let blockConfirm: @Sendable (String) -> String
    public let habits: String
    public let noShown: String
    public let doneToday: String
    public let countToday: @Sendable (String, String, String?) -> String
    public let linkTitle: @Sendable (String) -> String
    public let linkSub: String
    public let linkBtn: String
    public let linkSent: @Sendable (String) -> String
    public let linkFriends: String
    public let linkSelf: String
    public let linkBlocked: String
    public let linkNotFound: String
    public let later: String
    public let open: String
    public let showTitle: String
    public let selectAll: String

    public static let ru: FriendStrings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .ru) }
        return FriendStrings(
            tabGroups: "Группы",
            tabFriends: "Друзья",
            invite: "Позвать друга",
            empty: "Позови друга — будете видеть карты друг друга.",
            requests: { "Заявки · \(num($0))" },
            requestsTitle: "Заявки",
            waiting: "ждём ответа",
            cancel: "Отменить",
            accept: "Принять",
            decline: "Отклонить",
            viaLink: "по вашей ссылке",
            progress: { "\(num($0)) из \(num($1))" },
            search: "Найти среди друзей",
            nothingFound: "Никого не нашли",
            sendLink: "Отправить ссылку в Telegram",
            shareText: "Давай дружить в LifeCommit",
            usernamePh: "Найти по @username",
            call: "Позвать",
            status: [.sent: "Заявка отправлена", .friends: "Уже друзья", .self: "Это вы", .blocked: "Вы его заблокировали"],
            notFound: "Такого человека нет в LifeCommit",
            badUsername: "Это не похоже на @username",
            remove: "Убрать из друзей",
            block: "Заблокировать",
            removeConfirm: { "Убрать из друзей: \($0)?" },
            blockConfirm: { "Заблокировать: \($0)? Не найдёт вас и не пришлёт заявку." },
            habits: "Привычки",
            noShown: "Пока ничего не открыто",
            doneToday: "сделано",
            countToday: { value, target, unit in "\(value) из \(target)\(unit.map { " \($0)" } ?? "")" },
            linkTitle: { "\($0) зовёт в друзья" },
            linkSub: "Будете видеть карты друг друга",
            linkBtn: "Хочу дружить",
            linkSent: { "Заявка отправлена — \($0) подтвердит" },
            linkFriends: "Вы уже друзья",
            linkSelf: "Это ваша ссылка — отправьте её другу",
            linkBlocked: "Вы заблокировали этого человека",
            linkNotFound: "Ссылка не работает",
            later: "Не сейчас",
            open: "Открыть",
            showTitle: "Что показать друзьям?",
            selectAll: "Выбрать все"
        )
    }()

    public static let en: FriendStrings = {
        let num: @Sendable (Int) -> String = { Strings.number(Double($0), .en) }
        return FriendStrings(
            tabGroups: "Groups",
            tabFriends: "Friends",
            invite: "Invite a friend",
            empty: "Invite a friend — you will see each other’s maps.",
            requests: { "Requests · \(num($0))" },
            requestsTitle: "Requests",
            waiting: "waiting for an answer",
            cancel: "Cancel",
            accept: "Accept",
            decline: "Decline",
            viaLink: "via your link",
            progress: { "\(num($0)) of \(num($1))" },
            search: "Search friends",
            nothingFound: "Nobody found",
            sendLink: "Send a link in Telegram",
            shareText: "Let’s be friends on LifeCommit",
            usernamePh: "Find by @username",
            call: "Invite",
            status: [.sent: "Request sent", .friends: "Already friends", .self: "That’s you", .blocked: "You blocked them"],
            notFound: "No such person on LifeCommit",
            badUsername: "That doesn’t look like a @username",
            remove: "Remove from friends",
            block: "Block",
            removeConfirm: { "Remove \($0) from friends?" },
            blockConfirm: { "Block \($0)? They won’t find you or send requests." },
            habits: "Habits",
            noShown: "Nothing shared yet",
            doneToday: "done",
            countToday: { value, target, unit in "\(value) of \(target)\(unit.map { " \($0)" } ?? "")" },
            linkTitle: { "\($0) invites you to be friends" },
            linkSub: "You will see each other’s maps",
            linkBtn: "Be friends",
            linkSent: { "Request sent — \($0) will confirm" },
            linkFriends: "You are already friends",
            linkSelf: "This is your link — send it to a friend",
            linkBlocked: "You blocked this person",
            linkNotFound: "This link doesn’t work",
            later: "Not now",
            open: "Open",
            showTitle: "What to show friends?",
            selectAll: "Select all"
        )
    }()
}

/// Удаление группового дела свайпом и карта «Месяц · Год».
public struct TogetherMiscStrings: Sendable {
    public let skipped: @Sendable (String) -> String
    public let sharedHint: String
    public let onlyToday: String
    public let forAll: String
    public let notAllowed: String
    public let month: String
    public let year: String
    public let activeDays: @Sendable (Int) -> String

    public static let ru = TogetherMiscStrings(
        skipped: { "«\($0)» убрано на сегодня" },
        sharedHint: "Дело общее и повторяется. Убрать его только сегодня или удалить у всех в группе?",
        onlyToday: "Убрать только сегодня",
        forAll: "Удалить для всех",
        notAllowed: "В этой группе дела удаляют только админы",
        month: "Месяц",
        year: "Год",
        activeDays: { "\(Strings.number(Double($0), .ru)) \(Plural.ru($0, "активный день", "активных дня", "активных дней"))" }
    )

    public static let en = TogetherMiscStrings(
        skipped: { "“\($0)” skipped today" },
        sharedHint: "This to-do is shared and repeats. Skip it just today or delete it for everyone in the group?",
        onlyToday: "Skip just today",
        forAll: "Delete for everyone",
        notAllowed: "Only admins can delete to-dos in this group",
        month: "Month",
        year: "Year",
        activeDays: { "\(Strings.number(Double($0), .en)) active \($0 == 1 ? "day" : "days")" }
    )
}

public extension Strings {
    var gr: GroupStrings { lang == .ru ? .ru : .en }
    var fr: FriendStrings { lang == .ru ? .ru : .en }
    var together: TogetherMiscStrings { lang == .ru ? .ru : .en }
}
