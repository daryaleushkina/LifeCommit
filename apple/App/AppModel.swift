// Состояние приложения — как App.tsx и хуки мини-аппа (useTaskLog, useTodos, removal.tsx): вход, загрузка «Сегодня»,
// отметки и дела с мгновенным откликом и откатом при ошибке, удаление с «Вернуть».
import LifeCommitKit
import Observation
import os
import SwiftUI

private let modelLog = Logger(subsystem: "app.lifecommit", category: "model")

@Observable
@MainActor
final class AppModel {
    enum Phase: Equatable { case loading, signedOut, failed, ready }
    enum Tab: Hashable { case today, calendar, groups, me }
    enum Route: Hashable {
        /// «Чего я хочу?» — выбор вида новой привычки.
        case pick
        /// Редактор: новая привычка этого вида или правка существующей.
        case newTask(TaskKind)
        case editTask(Int)
        /// Экран привычки: сегодня, числа, календарь месяца.
        case detail(Int)
        case archive
        /// Экран группы.
        case group(Int)
        /// Вступить по приглашению (lifecommit://join/<код>, lifecommit.app/j/<код>).
        case join(String)
        /// Заявки в друзья.
        case requests
        /// Экран друга.
        case friend(Int)
        /// Открыли чужую ссылку «Позвать друга» (lifecommit://friend/<код>, lifecommit.app/f/<код>).
        case friendLink(String)
    }

    /// Убранная строка, пока можно «Вернуть».
    struct Removal: Equatable {
        let key: String
        let text: String
    }

    private(set) var phase: Phase = .loading
    private(set) var user: UserSettings?
    private(set) var today = TodayResponse(day: "")
    /// Ошибка действия на экране — тап убирает (как .error в мини-аппе).
    var banner: String?
    /// Первый экран «Чего я хочу?»: ничего нет и «Пропустить» ещё не нажимали.
    private(set) var onboarding = false
    var tab: Tab = .today
    var path: [Route] = []
    private(set) var removal: Removal?
    /// Сервер не выполнил удаление — плашка поверх любого экрана: «Что-то пошло не так» или своя причина.
    private(set) var removalFailed = false
    private(set) var removalFailedText: String?
    private(set) var removed: Set<String> = []
    /// История привычек для их экранов (GET /tasks/:id/history), подтягивается при открытии.
    private(set) var histories: [Int: TaskHistory] = [:]
    var signInError: String?
    private(set) var signingIn = false

    let api: APIClient
    /// «Вместе»: группы и друзья.
    let together: TogetherModel
    private let tokens: TokenStore
    /// Номер последнего изменения привычек и дел: перечитка «Сегодня», за время которой он сменился, устарела.
    private var change = 0
    /// Правки, которые ещё идут на сервер (как trackEdit в src/caches.ts), и перечитки, которые их ждут.
    private var editsInFlight = 0
    private var editsSettled: [CheckedContinuation<Void, Never>] = []
    private var loadedAt: Date?
    private var pendingCommit: (() async throws -> Void)?
    private var pendingFailure: ((Error) -> String?)?
    private var removalTimer: Task<Void, Never>?

    init(api: APIClient, tokens: TokenStore) {
        self.api = api
        self.tokens = tokens
        together = TogetherModel(api: api)
        together.app = self
    }

    /// Язык: как у человека в настройках; до входа — язык телефона.
    var strings: Strings {
        if let code = user?.languageCode { return .of(code) }
        return Locale.preferredLanguages.first?.hasPrefix("ru") == true ? .ru : .en
    }

    // MARK: Вход и загрузка

    func start() async {
        if let dev = Config.devUserId {
            api.setCredential(.telegramInitData(DevTelegram.initData(userId: dev)))
            await load()
            return
        }
        let token: String?
        do {
            token = try tokens.load()
        } catch {
            modelLog.error("keychain read failed: \(String(describing: error), privacy: .public)")
            token = nil
        }
        guard let token else {
            phase = .signedOut
            return
        }
        api.setCredential(.session(token))
        await load()
    }

    /// Сессия и «Сегодня» — пока видна заставка: после неё ждать уже нечего. Карту (GET /heatmap) не грузим: её
    /// показывает «Я», придёт вместе с ним (docs/parity.md).
    func load() async {
        phase = .loading
        do {
            let session = try await api.session(timezone: TimeZone.current.identifier)
            user = session.user
            let seq = change
            let fresh = try await api.today()
            if seq == change {
                today = fresh
                loadedAt = Date()
            }
            onboarding = fresh.isEmpty && !onboardingSkipped
            phase = .ready
            // Календари телефона подтягиваем в фоне при каждом входе — не задерживая экран (как App.tsx).
            Task { await afterLoad() }
        } catch let error as APIError where error.isSignedOut {
            signOutLocally()
        } catch {
            modelLog.error("load failed: \(String(describing: error), privacy: .public)")
            phase = .failed
        }
    }

    /// Ключ получен от сервера по id_token Telegram — сохранить и загрузиться.
    func finishSignIn(idToken: String) async {
        signingIn = true
        defer { signingIn = false }
        do {
            let language = Locale.preferredLanguages.first ?? "ru"
            let signed = try await api.signInWithTelegram(idToken: idToken, device: Config.device, language: language)
            try tokens.save(signed.token)
            api.setCredential(.session(signed.token))
            signInError = nil
            await load()
        } catch {
            modelLog.error("sign-in failed: \(String(describing: error), privacy: .public)")
            signInError = strings.signInFailed
        }
    }

    func beginSignIn() {
        signingIn = true
        signInError = nil
    }

    /// Ждём возврата из приложения Telegram с кодом.
    struct TelegramPending {
        let pkce: TelegramOAuth.PKCE
        let clientId: String
    }

    private var telegramPending: TelegramPending?

    /// Ушли в приложение Telegram: кнопка снова нажимается — вдруг вернутся без кода; код придёт ссылкой
    /// lifecommit://tglogin, и вход продолжится по ожиданию.
    func handOffToTelegram(_ pending: TelegramPending) {
        telegramPending = pending
        signingIn = false
    }

    /// Код пришёл — ожидание забирается один раз.
    func takeTelegramPending() -> TelegramPending? {
        defer { telegramPending = nil }
        return telegramPending
    }

    func signInFailed(_ message: String?) {
        signingIn = false
        signInError = message
    }

    /// Ключ больше не пускает (или вышли) — забыть его и показать вход.
    func signOutLocally() {
        do {
            try tokens.clear()
        } catch {
            modelLog.error("keychain clear failed: \(String(describing: error), privacy: .public)")
        }
        api.setCredential(nil)
        user = nil
        today = TodayResponse(day: "")
        // Календарь прошлого человека — забыть (дни, подключения, «Потом»); ответы, что ещё в пути, — тоже.
        epoch += 1
        ranges = [:]
        shownRange = nil
        accounts = nil
        later = nil
        calendarNotice = nil
        calendarsSheetOpen = false
        deferredGoogle = nil
        rangeGroups = [:]
        // «Вместе» прошлого человека — тоже.
        together.reset()
        deferredInvite = nil
        path = []
        tab = .today
        phase = .signedOut
    }

    /// Перечитать «Сегодня» (после правки, удаления, отметки задним числом).
    func refresh() async {
        // Привычки только что изменили — ответы, запрошенные раньше, уже устарели.
        change += 1
        do {
            if let fresh = try await freshToday() {
                today = fresh
                loadedAt = Date()
            }
        } catch let error as APIError where error.isSignedOut {
            signOutLocally()
        } catch {
            modelLog.notice("today refresh failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Вернулись на «Сегодня»: данным больше минуты — тихо обновить в фоне.
    func refreshIfStale() async {
        guard phase == .ready, let loadedAt, Date().timeIntervalSince(loadedAt) > 60 else { return }
        do {
            if let fresh = try await freshToday() {
                today = fresh
                self.loadedAt = Date()
            }
        } catch {
            modelLog.notice("background refresh failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// «Сегодня», за время ответа на которое ничего не менялось (как load.range в src/caches.ts): пока шёл запрос,
    /// что-то отметили, добавили или удалили — ответ без этой правки лёг бы поверх неё, спрашиваем ещё раз. Правка ещё
    /// у сервера — сначала дождаться её. Четыре раза подряд устарело — nil: на экране остаётся то, что есть.
    private func freshToday() async throws -> TodayResponse? {
        for _ in 0..<4 {
            let seq = change
            let fresh = try await api.today()
            await settleEdits()
            if seq == change { return fresh }
        }
        modelLog.notice("today kept changing while reading — keeping the screen as is")
        return nil
    }

    /// Правка уходит на сервер: перечитки «Сегодня», начатые раньше или во время неё, её дождутся и спросят заново.
    private func track<T>(_ edit: () async throws -> T) async throws -> T {
        change += 1
        editsInFlight += 1
        defer {
            editsInFlight -= 1
            change += 1
            if editsInFlight == 0 {
                let waiting = editsSettled
                editsSettled = []
                waiting.forEach { $0.resume() }
            }
        }
        return try await edit()
    }

    private func settleEdits() async {
        guard editsInFlight > 0 else { return }
        await withCheckedContinuation { editsSettled.append($0) }
    }

    /// Приложение свернули или вернули. Свернули — отложенное удаление уходит на сервер сейчас, а не теряется (как
    /// visibilitychange в removal.tsx). Только неактивно (шторка уведомлений, переключатель приложений) — «Вернуть»
    /// ещё можно.
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background: flushRemoval()
        case .active: Task { await refreshIfStale() }
        default: break
        }
    }

    // MARK: Онбординг

    private static let skipKey = "lc-onboarding-skipped"

    private var onboardingSkipped: Bool { !Config.isUITest && UserDefaults.standard.bool(forKey: Self.skipKey) }

    /// «Пропустить» — запоминаем на этом устройстве.
    func skipOnboarding() {
        if !Config.isUITest { UserDefaults.standard.set(true, forKey: Self.skipKey) }
        onboarding = false
    }

    // MARK: Отметки привычек

    /// Отметка за сегодня: экран меняется сразу, сервер догоняет; не вышло — откат и ошибка.
    func log(_ task: TodayTask, value: Double?, status: AbstainStatus?) async {
        let cleared = task.kind == .abstain ? status == nil : value == nil
        var next = task
        next.value = value ?? (status == .clean ? 1 : 0)
        next.status = status
        next.logged = !cleared
        patchTask(next)
        if !task.isDone && next.isDone { Haptics.success() }
        do {
            try await track { try await api.log(taskId: task.id, value: value, status: status) }
        } catch {
            patchTask(task)
            fail(error)
        }
    }

    private func patchTask(_ task: TodayTask) {
        guard let i = today.tasks.firstIndex(where: { $0.id == task.id }) else { return }
        today.tasks[i] = task
    }

    // MARK: Дела

    func toggle(_ todo: Todo) async {
        let done = !todo.done
        patchTodos { list in list.map { $0.isSame(as: todo) ? Self.with($0, done: done) : $0 } }
        if done { Haptics.success() }
        do {
            var patch: [String: JSONValue] = ["done": .bool(done)]
            // У повторяющегося дела «сделано» — на этот его день.
            if todo.recurring { patch["on"] = .string(todo.day) }
            try await track { try await api.updateTodo(id: todo.id, patch) }
        } catch {
            patchTodos { list in list.map { $0.isSame(as: todo) ? todo : $0 } }
            fail(error)
        }
    }

    /// Новое дело появляется сразу (временный отрицательный id), настоящий id приходит с сервера. day — во вкладке
    /// «Календарь» выбранный день; без него — сегодня.
    func addTodo(_ title: String, day chosen: String? = nil) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let day = chosen ?? today.day
        let temp = Todo(id: -Int(Date().timeIntervalSince1970 * 1000), title: trimmed, day: day)
        insertTodo(temp)
        do {
            let id = try await track { try await api.createTodo(title: trimmed, day: day) }
            // Дело на другой день — на «Сегодня» меняется «Потом · N».
            if day != today.day { Task { await refresh() } }
            patchTodos { list in list.map { $0.id == temp.id ? Self.with($0, id: id) : $0 } }
        } catch {
            patchTodos { list in list.filter { $0.id != temp.id } }
            fail(error)
        }
    }

    /// Правка дел на экране — сразу везде, где дело видно: «Сегодня» и дни календаря.
    private func patchTodos(_ transform: ([Todo]) -> [Todo]) {
        today.todos = Todos.sorted(transform(today.todos))
        for key in ranges.keys { ranges[key] = transform(ranges[key] ?? []) }
        if let list = later { later = transform(list) }
    }

    /// Новое дело — на «Сегодня», если оно на сегодня, и в дни календаря, куда попадает его день.
    private func insertTodo(_ todo: Todo) {
        if todo.day == today.day { today.todos = Todos.sorted(today.todos + [todo]) }
        // «Потом» — дела на следующие дни, по дням.
        if let list = later, todo.day > today.day { later = (list + [todo]).sorted { $0.day < $1.day } }
        for key in ranges.keys {
            let bounds = key.split(separator: ":").map(String.init)
            if bounds.count == 2, todo.day >= bounds[0], todo.day <= bounds[1] { ranges[key]?.append(todo) }
        }
    }

    /// Правка из шторки дела: на экране сразу (название, время, место), на сервер — только изменённое; потом «Сегодня»
    /// и дни перечитываются (день мог смениться). Не сохранилось — плашка, перечитанный экран покажет, как было.
    func updateTodo(_ todo: Todo, _ edit: TodoEdit) async {
        let patch = edit.patch(for: todo)
        guard !patch.isEmpty else { return }
        patchTodos { list in list.map { $0.id == todo.id ? Self.edited($0, edit) : $0 } }
        do {
            try await track { try await api.updateTodo(id: todo.id, patch) }
        } catch {
            fail(error)
        }
        await refresh()
        await reloadCalendar()
    }

    private static func edited(_ todo: Todo, _ edit: TodoEdit) -> Todo {
        var t = todo
        t.title = edit.title
        t.time = edit.time
        if let location = edit.location {
            var details = t.details ?? TodoDetails()
            details.location = location.isEmpty ? nil : location
            t.details = details
        }
        return t
    }

    private static func with(_ todo: Todo, done: Bool) -> Todo {
        var t = todo
        t.done = done
        return t
    }

    private static func with(_ todo: Todo, id: Int) -> Todo {
        var t = todo
        t.id = id
        return t
    }

    // MARK: Удаление с «Вернуть» (removal.tsx)

    private static let undoSeconds: Double = 5

    func isRemoved(_ key: String) -> Bool { removed.contains(key) }

    /// Строка пропадает сразу, внизу 5 секунд «Вернуть»; на сервер удаление уходит, когда плашка закрылась (или
    /// приложение свернули). Не вышло — экран перечитывается (строка вернётся), поверх — «Что-то пошло не так».
    /// failure — своя причина отказа (например, «дела удаляют только админы»); nil — «Что-то пошло не так».
    func removeWithUndo(key: String, text: String, failure: ((Error) -> String?)? = nil, commit: @escaping () async throws -> Void) {
        flushRemoval()
        removalFailed = false
        removalFailedText = nil
        removed.insert(key)
        removal = Removal(key: key, text: text)
        pendingCommit = commit
        pendingFailure = failure
        Haptics.impact()
        removalTimer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.undoSeconds))
            guard !Task.isCancelled else { return }
            self?.flushRemoval()
        }
    }

    func undoRemoval() {
        guard let removal else { return }
        removalTimer?.cancel()
        pendingCommit = nil
        pendingFailure = nil
        removed.remove(removal.key)
        self.removal = nil
    }

    /// Отправить отложенное удаление сейчас (плашка закрылась, приложение уходит в фон). Задача — для тестов.
    @discardableResult
    func flushRemoval() -> Task<Void, Never>? {
        guard let removal, let commit = pendingCommit else { return nil }
        let failure = pendingFailure
        removalTimer?.cancel()
        pendingCommit = nil
        pendingFailure = nil
        self.removal = nil
        return Task {
            do {
                try await commit()
            } catch {
                modelLog.error("removal failed: \(String(describing: error), privacy: .public)")
                removalFailedText = failure?(error)
                removalFailed = true
                Task {
                    try? await Task.sleep(for: .seconds(Self.undoSeconds))
                    removalFailed = false
                }
            }
            removed.remove(removal.key)
        }
    }

    func dismissRemovalError() {
        removalFailed = false
        removalFailedText = nil
    }

    /// Удаление уходит на сервер, потом «Сегодня» перечитывается — строка остаётся скрытой, пока не придёт список
    /// без неё (иначе она мигнула бы). Не вышло — перечитываем (строка вернётся) и отдаём ошибку плашке.
    private func commitThenRefresh(_ commit: @escaping () async throws -> Void) -> () async throws -> Void {
        { [weak self] in
            do {
                try await self?.track(commit)
            } catch {
                await self?.refresh()
                await self?.reloadCalendar()
                throw error
            }
            await self?.refresh()
            await self?.reloadCalendar()
        }
    }

    func removeTask(_ task: TodayTask) {
        removeWithUndo(key: "task:\(task.id)", text: strings.swipe.removed(task.title), commit: commitThenRefresh { [api] in
            try await api.deleteTask(id: task.id)
        })
    }

    func removeTodo(_ todo: Todo) {
        // Повторяющееся удаляется целиком — со всеми днями.
        removeWithUndo(key: "todo:\(todo.id)", text: strings.swipe.removed(todo.title), commit: commitThenRefresh { [api] in
            try await api.deleteTodo(id: todo.id)
        })
    }

    /// «Скрыть» событие календаря (свайп): у нас пропадает, в календаре остаётся.
    func hideTodo(_ todo: Todo) {
        removeWithUndo(key: "todo:\(todo.id)", text: strings.swipe.hidden(todo.title), commit: commitThenRefresh { [api] in
            try await api.updateTodo(id: todo.id, ["hidden": .bool(true)])
        })
    }

    // MARK: Календарь (вкладка «Календарь», шторка «Календари», «Потом»)

    /// Дела по промежуткам дней «from:to» (как caches.days мини-аппа): уже виденное открывается сразу.
    private(set) var ranges: [String: [Todo]] = [:]
    /// Дела групп тех же промежутков — по дням.
    private(set) var rangeGroups: [String: [GroupDayBlock]] = [:]
    /// Промежуток на экране вкладки — его перечитываем после правок и синхронизации.
    private var shownRange: (from: String, to: String)?
    /// Подключённые календари; nil — ещё не знаем (не пишем «не подключено» — это было бы неправдой).
    private(set) var accounts: [CalendarAccount]?
    /// «Потом» — дела на следующие дни; грузится, когда открыли.
    private(set) var later: [Todo]?
    private(set) var calendarSyncing = false
    /// Попросили обновить, пока шло обновление, — после него ещё раз (иначе просьба терялась).
    private var syncAgain = false
    var calendarsSheetOpen = false
    /// Строка в шторке «Календари»: возврат из Google не удался, не сохранилось.
    var calendarNotice: String?
    /// На сервере не настроен Google — «Скоро».
    var googleUnavailable = false
    /// Возврат из Google пришёл, пока приложение ещё загружалось (ключа нет) — разберём после загрузки.
    private var deferredGoogle: GoogleReturn?
    /// Номер входа: растёт при выходе. Ответ, ушедший до выхода, сверяет его и не возвращает календарь прошлого человека.
    private var epoch = 0

    private static func rangeKey(_ from: String, _ to: String) -> String { "\(from):\(to)" }

    func calendarTodos(from: String, to: String) -> [Todo]? { ranges[Self.rangeKey(from, to)] }

    func calendarGroups(from: String, to: String) -> [GroupDayBlock] { rangeGroups[Self.rangeKey(from, to)] ?? [] }

    /// Вкладка показывает этот промежуток: из памяти сразу, свежий — с сервера.
    func showRange(from: String, to: String) async {
        shownRange = (from, to)
        await loadRange(from: from, to: to)
    }

    /// Соседние дни и месяц — заранее, если их ещё нет.
    func prefetchRange(from: String, to: String) async {
        guard ranges[Self.rangeKey(from, to)] == nil else { return }
        await loadRange(from: from, to: to)
    }

    /// Свежие дела промежутка — как load.range в caches.ts: правка ещё у сервера — дождаться; за время ответа что-то
    /// поменялось — спросить ещё раз (до 4 раз), иначе ответ без правки лёг бы поверх неё.
    func loadRange(from: String, to: String) async {
        let session = epoch
        do {
            for _ in 0..<4 {
                let seq = change
                let fresh = try await api.calendar(from: from, to: to)
                await settleEdits()
                guard session == epoch else { return }
                if seq == change {
                    ranges[Self.rangeKey(from, to)] = fresh.todos
                    rangeGroups[Self.rangeKey(from, to)] = fresh.groups
                    return
                }
            }
            modelLog.notice("calendar \(from, privacy: .public)…\(to, privacy: .public) kept changing while reading")
        } catch is CancellationError {
            // Ушли с экрана, пока шёл запрос, — не сбой.
        } catch let error as APIError where error.isSignedOut {
            if session == epoch { signOutLocally() }
        } catch {
            modelLog.notice("calendar \(from, privacy: .public)…\(to, privacy: .public) failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// После правки дел: виденные промежутки устарели — на экране перечитываем сразу, остальные — когда откроют.
    private func reloadCalendar() async {
        if let shown = shownRange {
            ranges = ranges.filter { $0.key == Self.rangeKey(shown.from, shown.to) }
            rangeGroups = rangeGroups.filter { $0.key == Self.rangeKey(shown.from, shown.to) }
            await loadRange(from: shown.from, to: shown.to)
        } else {
            ranges = [:]
            rangeGroups = [:]
        }
        // «Потом» открывают с «Сегодня» — и без вкладки «Календарь».
        if later != nil { await loadLater() }
    }

    func loadAccounts() async {
        let session = epoch
        do {
            let list = try await api.calendars()
            if session == epoch { accounts = list }
        } catch is CancellationError {
            // Ушли с экрана, пока шёл запрос, — не сбой и не «ничего не подключено».
        } catch let error as APIError where error.isSignedOut {
            if session == epoch { signOutLocally() }
        } catch {
            modelLog.notice("calendars failed: \(String(describing: error), privacy: .public)")
            // Не загрузились — показываем как неподключённые (CalendarsSheet.tsx), но не затираем известное.
            if session == epoch, accounts == nil { accounts = [] }
        }
    }

    func loadLater() async {
        let session = epoch
        do {
            let list = try await api.laterTodos()
            if session == epoch { later = list }
        } catch is CancellationError {
            // Шторку закрыли, пока шёл запрос, — не сбой.
        } catch let error as APIError where error.isSignedOut {
            if session == epoch { signOutLocally() }
        } catch {
            modelLog.notice("later failed: \(String(describing: error), privacy: .public)")
            if session == epoch, later == nil { later = [] }
        }
    }

    /// «Обновить» (и при запуске): забрать события из календарей, перечитать календари, дни и «Сегодня».
    func syncCalendars() async {
        if calendarSyncing {
            syncAgain = true
            return
        }
        calendarSyncing = true
        defer { calendarSyncing = false }
        var session = epoch
        repeat {
            syncAgain = false
            do {
                try await api.syncCalendars()
                guard session == epoch else {
                    // Вышли, пока шёл запрос: ответ прошлого человека не применяем, а просьбу вошедшего следом
                    // (syncAgain) выполняем — repeat-while её проверит.
                    modelLog.notice("calendar sync: signed out mid-sync, stale result dropped")
                    session = epoch
                    continue
                }
            } catch {
                // Не синхронизировалось — состояние подключения покажут календари (auth_failed, error), не плашка.
                modelLog.notice("calendar sync failed: \(String(describing: error), privacy: .public)")
            }
            await loadAccounts()
            change += 1
            await reloadCalendar()
            await refresh()
        } while syncAgain
    }

    // MARK: Шторка «Календари»

    /// Включить или выключить календарь: на экране сразу, сервер догоняет; не сохранил — как было и строка ошибки.
    func toggleCollection(_ account: CalendarAccount, url: String, enabled: Bool) async {
        setCollection(account.id, url: url, enabled: enabled)
        do {
            try await api.toggleCollection(accountId: account.id, url: url, enabled: enabled)
        } catch {
            setCollection(account.id, url: url, enabled: !enabled)
            fail(error, notice: strings.error)
            return
        }
        // Выбор у подключения в работе — события поменялись (у «setup» — ещё нет, их заберёт «Готово»).
        if account.status != .setup { await syncCalendars() }
    }

    private func setCollection(_ id: Int, url: String, enabled: Bool) {
        accounts = accounts?.map { a in
            guard a.id == id else { return a }
            var next = a
            next.collections = a.collections.map { c in
                var col = c
                if c.url == url { col.enabled = enabled }
                return col
            }
            return next
        }
    }

    /// Куда писать наши дела: сразу, сервер догоняет; не сохранил — как было.
    func setDestination(_ account: CalendarAccount, url: String) async {
        let before = account.defaultUrl
        setDefault(account.id, url)
        do {
            try await api.setDefaultCalendar(accountId: account.id, url: url)
        } catch {
            setDefault(account.id, before)
            fail(error, notice: strings.error)
            return
        }
        await syncCalendars()
    }

    private func setDefault(_ id: Int, _ url: String?) {
        accounts = accounts?.map { a in
            guard a.id == id else { return a }
            var next = a
            next.defaultUrl = url
            return next
        }
    }

    func disconnectCalendar(_ provider: CalendarProvider) async {
        do {
            try await api.disconnectCalendar(provider)
        } catch {
            fail(error, notice: strings.error)
            return
        }
        await syncCalendars()
    }

    /// Google подключён, календари выбраны — «Готово»: забрать события. false — Google не ответил.
    func confirmGoogle(_ account: CalendarAccount) async -> Bool {
        do {
            try await api.confirmGoogle(accountId: account.id)
        } catch let error as APIError where error.isSignedOut {
            signOutLocally()
            return false
        } catch {
            modelLog.error("google confirm failed: \(String(describing: error), privacy: .public)")
            return false
        }
        await syncCalendars()
        return true
    }

    /// Apple — паролем приложения. nil — подключили; иначе текст ошибки для формы.
    func connectApple(login: String, password: String) async -> String? {
        do {
            try await api.connectApple(login: login, password: password)
        } catch let e as APIError where e.isSignedOut {
            // Ключ LifeCommit протух — это не «нет связи с Apple»: на вход.
            signOutLocally()
            return nil
        } catch let e as APIError where e.code == "apple_auth" {
            return strings.cal.errAuth
        } catch let e as APIError where e.code == "apple_bad_input" {
            return strings.cal.errInput
        } catch {
            modelLog.notice("apple connect failed: \(String(describing: error), privacy: .public)")
            return strings.cal.errNet
        }
        // Подключено — форма закрывается сразу, события подтянутся в фоне (как onDone → syncNow в мини-аппе).
        await loadAccounts()
        Task { await syncCalendars() }
        return nil
    }

    /// Ушли с вкладки «Календарь»: её дни больше не перечитываем после каждой правки (вернутся — перечитаются).
    func hideRange() {
        shownRange = nil
    }

    /// Вернулись из входа Google: ok — закончить подключение своим ключом (сервер примет код только от того, кто начал
    /// вход), остальное — строкой в шторке. Пришло, пока приложение загружается, — разберём после загрузки.
    func googleReturned(_ result: GoogleReturn) async {
        guard phase == .ready else {
            deferredGoogle = result
            return
        }
        // Шторка «Календари» живёт во вкладке «Календарь» — туда и возвращаемся (как startapp=calendars в мини-аппе).
        tab = .calendar
        path = []
        calendarsSheetOpen = true
        switch result.status {
        case .denied: calendarNotice = strings.cal.googleDenied
        case .expired: calendarNotice = strings.cal.googleLinkExpired
        case .failed: calendarNotice = strings.cal.googleFailed
        case .ok:
            guard let pending = result.pending else {
                calendarNotice = strings.cal.googleFailed
                return
            }
            do {
                let done = try await api.finishGoogle(pending: pending)
                calendarNotice = nil
                await loadAccounts()
                // Подключён заново — события могли поменяться; новый ждёт выбора календарей.
                if !done.fresh { await syncCalendars() }
            } catch let error as APIError where error.code == "pending_not_found" || error.code == "pending_expired" {
                calendarNotice = strings.cal.googleLinkExpired
            } catch {
                fail(error, notice: strings.cal.errGoogle)
            }
        }
    }

    /// После загрузки: отложенные возврат из Google и приглашение, синхронизация календарей в фоне (как при каждом
    /// входе в мини-апп).
    private func afterLoad() async {
        if let invite = deferredInvite {
            deferredInvite = nil
            openInvite(invite)
        }
        if let deferred = deferredGoogle {
            deferredGoogle = nil
            await googleReturned(deferred)
        }
        await syncCalendars()
    }

    // MARK: «Вместе»: блоки групп на «Сегодня» и в дне календаря, приглашения

    /// В группах что-то поменялось (отметка, дело, вступили, вышли) — «Сегодня» и дни календаря перечитываются.
    func groupsChanged() async {
        change += 1
        await refresh()
        await reloadCalendar()
    }

    /// Отметка группового дела в блоке на «Сегодня»: галочка сразу; не вышло — как было и сказано. Счётчики «5 из 8»
    /// и чужие отметки — потом с сервера.
    func markGroupOnToday(groupId: Int, _ item: GroupDayItem) async {
        let done = !item.done
        let me = user?.id ?? 0
        patchTodayGroupItem(groupId, item.id) { GroupLogic.marked($0, done: done, me: me) }
        if done { Haptics.success() }
        do {
            _ = try await track { try await api.markGroupItem(groupId: groupId, itemId: item.id, done: done) }
        } catch {
            patchTodayGroupItem(groupId, item.id) { _ in item }
            failGroupMark(error)
        }
        await groupsChanged()
        await together.loadGroup(groupId)
    }

    private func patchTodayGroupItem(_ groupId: Int, _ itemId: Int, _ f: (GroupDayItem) -> GroupDayItem) {
        today.groups = today.groups.map { g in
            guard g.id == groupId else { return g }
            var next = g
            next.items = g.items.map { $0.id == itemId ? f($0) : $0 }
            return next
        }
    }

    /// Отметка в дне календаря (сегодня или прошлый день): галочка — после ответа сервера и перечитывания дня.
    func markGroupOnDay(groupId: Int, _ item: GroupDayItem, day: String) async {
        do {
            _ = try await track { try await api.markGroupItem(groupId: groupId, itemId: item.id, done: !item.done, day: day) }
            if !item.done { Haptics.success() }
        } catch {
            failGroupMark(error)
        }
        await groupsChanged()
    }

    /// Уже не на мне (очередь сменилась, на экране старое) — так и сказать: повтор не поможет.
    private func failGroupMark(_ error: Error) {
        if let api = error as? APIError, api.code == "not_yours" {
            modelLog.notice("group mark: not_yours")
            banner = strings.gr.notYours
            return
        }
        fail(error)
    }

    /// Приглашение пришло, пока приложение загружалось (ключа нет), — разберём после загрузки.
    private var deferredInvite: InviteLink?

    /// Открыли ссылку-приглашение: в группу — экран «Вступить», в друзья — «зовёт в друзья». Код уже проверен
    /// (InviteLink): в путь API ничего постороннего не попадёт.
    func openInvite(_ link: InviteLink) {
        guard phase == .ready else {
            deferredInvite = link
            return
        }
        tab = .groups
        switch link.kind {
        case .join: path = [.join(link.code)]
        case .friend: path = [.friendLink(link.code)]
        }
    }

    // MARK: Экран привычки

    /// История привычки: из памяти сразу, свежая — с сервера. Не загрузилась — экран считает по тому, что есть.
    func loadHistory(_ id: Int) async {
        do {
            histories[id] = try await api.history(taskId: id)
        } catch let error as APIError where error.isSignedOut {
            signOutLocally()
        } catch {
            modelLog.notice("history \(id) failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Отметка за прошлый день (yes == nil — убрать отметку): на экране сразу, потом свежее «Сегодня».
    /// Сегодня — обычная отметка. Не вышло — история как до правки (и перечитывается), ошибка — плашкой.
    func markDay(_ task: TodayTask, day: String, yes: Bool?) async {
        if day == today.day {
            if task.kind == .abstain {
                await log(task, value: nil, status: yes.map { $0 ? .clean : .slip })
            } else {
                await log(task, value: yes == true ? task.target : nil, status: nil)
            }
            return
        }
        let status: AbstainStatus? = task.kind == .abstain ? yes.map { $0 ? .clean : .slip } : nil
        let value: Double? = yes.map { yes in task.kind == .abstain ? (yes ? 1 : 0) : (yes ? task.target : 0) }
        let start = histories[task.id]?.start ?? today.day
        // До приложения после «последнего раза» день и так чистый — «получилось» там просто убирает отметку.
        let implicit = task.kind == .abstain && (task.lastSlipOn.map { day > $0 && day < start } ?? false)
        let keep = yes != nil && !(implicit && yes == true) && (task.kind == .abstain || yes == true)
        let before = histories[task.id]
        var history = before ?? TaskHistory(start: start, goals: [HistoryGoal(effectiveFrom: today.day, target: task.target)], logs: [])
        history.logs = history.logs.filter { $0.day != day }
        if keep { history.logs = (history.logs + [HistoryLog(day: day, value: value ?? 0, status: status)]).sorted { $0.day < $1.day } }
        histories[task.id] = history
        do {
            try await track { try await api.log(taskId: task.id, value: task.kind == .abstain ? nil : (yes == true ? task.target : nil), status: status, day: day) }
        } catch {
            // Экран — как был до правки; связь есть — заодно свежая история с сервера (без связи она тоже не придёт).
            histories[task.id] = before
            await loadHistory(task.id)
            fail(error)
            return
        }
        // Прошлый день меняет счёт и «N дней без этого» на «Сегодня».
        await refresh()
    }

    // MARK: Редактор и «Отложенные»

    /// Сохранить привычку (новую или правку) и перечитать «Сегодня». Цель стала легче — вернёт true: она действует с
    /// завтра, экран скажет об этом. Ошибку бросает дальше — редактор покажет её под формой.
    func saveTask(id: Int?, input: TaskInput) async throws -> Bool {
        var easier = false
        if let id {
            var patch: [String: JSONValue] = [
                "title": .string(input.title),
                "target": .number(input.target),
                "unit": .optional(input.unit),
                "schedule": .string(input.schedule.rawValue),
                "weekdays": .number(Double(input.weekdays)),
                "per_week": .optional(input.perWeek),
                "visibility": .string(input.visibility.rawValue),
            ]
            patch["last_slip_on"] = .optional(input.lastSlipOn)
            let res = try await api.updateTask(id: id, patch)
            easier = (res.goalEffectiveFrom ?? "") > today.day
        } else {
            _ = try await api.createTask(input)
            onboarding = false
        }
        await refresh()
        Haptics.success()
        return easier
    }

    func postponeTask(id: Int) async throws {
        try await api.archiveTask(id: id)
        await refresh()
    }

    /// Удалить насовсем (с историей) — после подтверждения на экране.
    func deleteTaskNow(id: Int) async throws {
        try await api.deleteTask(id: id)
        await refresh()
    }

    func restoreTask(id: Int) async throws {
        try await api.restoreTask(id: id)
        await refresh()
    }

    /// Текст ошибки для экрана: лимит привычек — свой, остальное — «Что-то пошло не так».
    func message(for error: Error) -> String {
        if let api = error as? APIError, api.code == "task_limit" { return strings.limitReached(5) }
        return strings.error
    }

    #if DEBUG
    /// Готовое состояние без сети — для снимков экранов и превью.
    func showForTests(user: UserSettings, today: TodayResponse, onboarding: Bool = false, phase: Phase = .ready) {
        self.user = user
        self.today = today
        self.onboarding = onboarding
        self.phase = phase
    }

    func setHistoryForTests(_ id: Int, _ history: TaskHistory) {
        histories[id] = history
    }

    /// Календарь без сети — для снимков: дни (from, to, дела), подключения, «Потом».
    func setCalendarForTests(ranges: [(String, String, [Todo])] = [], groups: [(String, String, [GroupDayBlock])] = [], accounts: [CalendarAccount]? = nil, later: [Todo]? = nil) {
        for (from, to, todos) in ranges { self.ranges[Self.rangeKey(from, to)] = todos }
        for (from, to, blocks) in groups { rangeGroups[Self.rangeKey(from, to)] = blocks }
        if let accounts { self.accounts = accounts }
        if let later { self.later = later }
    }
    #endif

    // MARK: Ошибки

    /// Не вышло в шторке «Календари»: ключ больше не пускает — на вход; иначе — строка в шторке.
    func fail(_ error: Error, notice: String) {
        if let api = error as? APIError, api.isSignedOut {
            signOutLocally()
            return
        }
        modelLog.error("calendar action failed: \(String(describing: error), privacy: .public)")
        calendarNotice = notice
    }

    /// Действие не вышло: ключ больше не пускает — на вход; иначе — плашка ошибки.
    func fail(_ error: Error) {
        if let api = error as? APIError, api.isSignedOut {
            signOutLocally()
            return
        }
        modelLog.error("action failed: \(String(describing: error), privacy: .public)")
        banner = strings.error
    }
}
