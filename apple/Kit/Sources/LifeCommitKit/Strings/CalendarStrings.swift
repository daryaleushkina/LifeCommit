// Тексты раздела «Календарь» — вкладка, шторка дела, «Потом», шторка «Календари» — как cal.*, todo.* и строки вкладки
// в src/i18n.ts мини-аппа (слово в слово).
import Foundation

public struct CalendarStrings: Sendable {
    public let day: String
    public let month: String
    public let prevDay: String
    public let nextDay: String
    public let prevYear: String
    public let nextYear: String
    public let backToToday: String
    /// Строка добавления во вкладке: дело на выбранный день.
    public let add: String
    public let empty: String

    public let connectTitle: String
    public let connectHint: String
    public let connect: String
    public let sheetTitle: String
    public let refresh: String
    public let sheetHint: String
    public let google: String
    public let googleSoon: String
    public let googleNeeds: String
    public let googleUnverified: String
    public let googleSetup: String
    public let googleChoose: String
    public let googleExpired: String
    public let reconnect: String
    public let errGoogle: String
    public let disconnectOf: @Sendable (String) -> String
    public let apple: String
    public let appleNeeds: String
    public let connected: String
    public let synced: @Sendable (String) -> String
    public let justNow: String
    public let minutesAgo: @Sendable (Int) -> String
    public let authFailed: String
    public let newPassword: String
    public let whatToTake: String
    public let writeTo: String
    public let disconnect: String
    public let disconnectConfirm: String
    public let appleTitle: String
    public let appleHint: String
    public let appleSteps: [String]
    public let openAppleId: String
    public let appleLogin: String
    public let applePassword: String
    public let connecting: String
    public let errAuth: String
    public let errInput: String
    public let errNet: String
    /// Возврат из входа Google в приложение (lifecommit://calendars?status=…) — как страница возврата в worker/google.ts.
    public let googleDenied: String
    public let googleLinkExpired: String
    public let googleFailed: String

    public static let ru = CalendarStrings(
        day: "День",
        month: "Месяц",
        prevDay: "Предыдущий день",
        nextDay: "Следующий день",
        prevYear: "Предыдущий год",
        nextYear: "Следующий год",
        backToToday: "К сегодня",
        add: "Дело на этот день",
        empty: "В этот день ничего",
        connectTitle: "Подключите календарь",
        connectHint: "Дела появятся в календаре телефона, а события оттуда — здесь",
        connect: "Подключить",
        sheetTitle: "Календари",
        refresh: "Обновить",
        sheetHint: "Дела из LifeCommit появятся в календаре, а события оттуда — в делах. Работает в обе стороны.",
        google: "Google Календарь",
        googleSoon: "Скоро",
        googleNeeds: "Вход через Google",
        googleUnverified: "Google может предупредить, что приложение ещё не проверено, — нажмите «Дополнительные настройки» → «Перейти».",
        googleSetup: "Выберите календари",
        googleChoose: "Свои календари уже отмечены. Праздники и чужие календари — по желанию.",
        googleExpired: "Google больше не пускает: доступ истёк или его отозвали.",
        reconnect: "Подключить заново",
        errGoogle: "Не достучался до Google. Попробуйте ещё раз чуть позже.",
        disconnectOf: { "Отключить \($0)" },
        apple: "Apple (iCloud)",
        appleNeeds: "Нужен пароль приложения",
        connected: "Подключено",
        synced: { "обновлено \($0)" },
        justNow: "только что",
        minutesAgo: { "\($0) мин назад" },
        authFailed: "Apple перестал пускать: пароль приложения отозван или сменён пароль Apple ID.",
        newPassword: "Ввести новый пароль",
        whatToTake: "Что забирать",
        writeTo: "Наши дела — в",
        disconnect: "Отключить",
        disconnectConfirm: "Отключить календарь? Дела, пришедшие из него, уберём, ваши останутся.",
        appleTitle: "Подключить Apple",
        appleHint: "Apple не пускает приложения к календарю по обычному входу. Нужен отдельный пароль — его можно отозвать в любой момент, основной пароль не нужен.",
        appleSteps: ["Откройте сайт Apple ID и войдите", "«Вход и безопасность» → «Пароли приложений» → «+»", "Назовите «LifeCommit», скопируйте пароль"],
        openAppleId: "Открыть сайт Apple ID",
        appleLogin: "Apple ID (почта)",
        applePassword: "Пароль приложения: xxxx-xxxx-xxxx-xxxx",
        connecting: "Подключаю…",
        errAuth: "Apple не пустил: проверьте почту и пароль приложения.",
        errInput: "Нужна почта Apple ID и пароль приложения из 16 букв.",
        errNet: "Не достучался до Apple. Попробуйте ещё раз чуть позже.",
        googleDenied: "Доступ не дали: без доступа к событиям календарь не подключить. Попробуйте ещё раз и оставьте галочки на экране Google.",
        googleLinkExpired: "Ссылка устарела — нажмите «Подключить» ещё раз.",
        googleFailed: "Не получилось подключить: Google не ответил как надо. Попробуйте ещё раз чуть позже."
    )

    public static let en = CalendarStrings(
        day: "Day",
        month: "Month",
        prevDay: "Previous day",
        nextDay: "Next day",
        prevYear: "Previous year",
        nextYear: "Next year",
        backToToday: "Back to today",
        add: "To-do for this day",
        empty: "Nothing on this day",
        connectTitle: "Connect your calendar",
        connectHint: "To-dos appear in your phone calendar, and events from it appear here",
        connect: "Connect",
        sheetTitle: "Calendars",
        refresh: "Refresh",
        sheetHint: "To-dos from LifeCommit appear in your calendar and its events appear as to-dos. Works both ways.",
        google: "Google Calendar",
        googleSoon: "Soon",
        googleNeeds: "Sign in with Google",
        googleUnverified: "Google may warn that the app isn’t verified yet — tap “Advanced” → “Go to LifeCommit”.",
        googleSetup: "Choose calendars",
        googleChoose: "Your own calendars are already ticked. Holidays and other people’s calendars are up to you.",
        googleExpired: "Google stopped letting us in: access expired or was revoked.",
        reconnect: "Reconnect",
        errGoogle: "Could not reach Google. Please try again a bit later.",
        disconnectOf: { "Disconnect \($0)" },
        apple: "Apple (iCloud)",
        appleNeeds: "Needs an app-specific password",
        connected: "Connected",
        synced: { "updated \($0)" },
        justNow: "just now",
        minutesAgo: { "\($0) min ago" },
        authFailed: "Apple stopped letting us in: the app password was revoked or the Apple ID password changed.",
        newPassword: "Enter a new password",
        whatToTake: "What to bring in",
        writeTo: "Our to-dos go to",
        disconnect: "Disconnect",
        disconnectConfirm: "Disconnect the calendar? To-dos that came from it will be removed, yours will stay.",
        appleTitle: "Connect Apple",
        appleHint: "Apple does not let apps into your calendar with a regular sign-in. You need a separate password — you can revoke it any time, your main password is not needed.",
        appleSteps: ["Open the Apple ID website and sign in", "“Sign-In and Security” → “App-Specific Passwords” → “+”", "Name it “LifeCommit” and copy the password"],
        openAppleId: "Open the Apple ID website",
        appleLogin: "Apple ID (email)",
        applePassword: "App password: xxxx-xxxx-xxxx-xxxx",
        connecting: "Connecting…",
        errAuth: "Apple refused: check the email and the app password.",
        errInput: "Enter your Apple ID email and the 16-letter app password.",
        errNet: "Could not reach Apple. Please try again a bit later.",
        googleDenied: "Access not granted: the calendar can’t be connected without access to events. Try again and keep the boxes ticked on the Google screen.",
        googleLinkExpired: "This link has expired — tap “Connect” again.",
        googleFailed: "Couldn’t connect: Google didn’t respond as expected. Please try again a bit later."
    )
}

/// Шторка дела и «Потом» (todo.* мини-аппа, чего нет в TodoStrings «Сегодня»).
public struct TodoSheetStrings: Sendable {
    public let laterTitle: String
    public let edit: String
    public let event: String
    public let deleteEvent: String
    public let place: String
    public let placePh: String
    public let onMap: String
    public let join: String
    public let openLink: String
    public let people: @Sendable (Int) -> String
    public let andMore: @Sendable (Int) -> String
    public let more: String
    public let openGoogle: String
    public let when: String
    public let today: String
    public let tomorrow: String
    public let otherDay: String
    public let pick: String
    public let time: String
    public let allDay: String
    public let noTime: String
    public let hours: String
    public let minutes: String
    public let fromApple: String
    public let fromGoogle: String
    public let delete: String

    public static let ru = TodoSheetStrings(
        laterTitle: "Запланировано",
        edit: "Дело",
        event: "Событие",
        deleteEvent: "Удалить событие",
        place: "Место",
        placePh: "Где?",
        onMap: "Открыть на карте",
        join: "Подключиться",
        openLink: "Открыть ссылку",
        people: { n in "\(Strings.number(Double(n), .ru)) \(Plural.ru(n, "участник", "участника", "участников"))" },
        andMore: { "и ещё \(Strings.number(Double($0), .ru))" },
        more: "Ещё",
        openGoogle: "Открыть в Google Календаре",
        when: "Когда",
        today: "Сегодня",
        tomorrow: "Завтра",
        otherDay: "Другой день",
        pick: "Выбрать",
        time: "Время",
        allDay: "Весь день",
        noTime: "Без времени",
        hours: "Часы",
        minutes: "Минуты",
        fromApple: "Из Apple Календаря",
        fromGoogle: "Из Google Календаря",
        delete: "Удалить дело"
    )

    public static let en = TodoSheetStrings(
        laterTitle: "Planned",
        edit: "To-do",
        event: "Event",
        deleteEvent: "Delete event",
        place: "Place",
        placePh: "Where?",
        onMap: "Open in maps",
        join: "Join",
        openLink: "Open link",
        people: { n in "\(Strings.number(Double(n), .en)) \(Plural.en(n, "guest", "guests"))" },
        andMore: { "and \(Strings.number(Double($0), .en)) more" },
        more: "More",
        openGoogle: "Open in Google Calendar",
        when: "When",
        today: "Today",
        tomorrow: "Tomorrow",
        otherDay: "Another day",
        pick: "Pick",
        time: "Time",
        allDay: "All day",
        noTime: "No time",
        hours: "Hours",
        minutes: "Minutes",
        fromApple: "From Apple Calendar",
        fromGoogle: "From Google Calendar",
        delete: "Delete to-do"
    )
}

public extension Strings {
    var cal: CalendarStrings { lang == .ru ? .ru : .en }
    var todoSheet: TodoSheetStrings { lang == .ru ? .ru : .en }
}
