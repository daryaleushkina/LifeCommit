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
    /// Сервер не выполнил удаление — плашка «Что-то пошло не так» поверх любого экрана.
    private(set) var removalFailed = false
    private(set) var removed: Set<String> = []
    /// История привычек для их экранов (GET /tasks/:id/history), подтягивается при открытии.
    private(set) var histories: [Int: TaskHistory] = [:]
    var signInError: String?
    private(set) var signingIn = false

    let api: APIClient
    private let tokens: TokenStore
    /// Номер последнего изменения привычек и дел: перечитка «Сегодня», за время которой он сменился, устарела.
    private var change = 0
    /// Правки, которые ещё идут на сервер (как trackEdit в src/caches.ts), и перечитки, которые их ждут.
    private var editsInFlight = 0
    private var editsSettled: [CheckedContinuation<Void, Never>] = []
    private var loadedAt: Date?
    private var pendingCommit: (() async throws -> Void)?
    private var removalTimer: Task<Void, Never>?

    init(api: APIClient, tokens: TokenStore) {
        self.api = api
        self.tokens = tokens
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

    /// Новое дело появляется сразу (временный отрицательный id), настоящий id приходит с сервера.
    func addTodo(_ title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let temp = Todo(id: -Int(Date().timeIntervalSince1970 * 1000), title: trimmed, day: today.day)
        patchTodos { $0 + [temp] }
        let day = today.day
        do {
            let id = try await track { try await api.createTodo(title: trimmed, day: day) }
            patchTodos { list in list.map { $0.id == temp.id ? Self.with($0, id: id) : $0 } }
        } catch {
            patchTodos { list in list.filter { $0.id != temp.id } }
            fail(error)
        }
    }

    private func patchTodos(_ transform: ([Todo]) -> [Todo]) {
        today.todos = Todos.sorted(transform(today.todos))
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
    func removeWithUndo(key: String, text: String, commit: @escaping () async throws -> Void) {
        flushRemoval()
        removalFailed = false
        removed.insert(key)
        removal = Removal(key: key, text: text)
        pendingCommit = commit
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
        removed.remove(removal.key)
        self.removal = nil
    }

    /// Отправить отложенное удаление сейчас (плашка закрылась, приложение уходит в фон). Задача — для тестов.
    @discardableResult
    func flushRemoval() -> Task<Void, Never>? {
        guard let removal, let commit = pendingCommit else { return nil }
        removalTimer?.cancel()
        pendingCommit = nil
        self.removal = nil
        return Task {
            do {
                try await commit()
            } catch {
                modelLog.error("removal failed: \(String(describing: error), privacy: .public)")
                removalFailed = true
                Task {
                    try? await Task.sleep(for: .seconds(Self.undoSeconds))
                    removalFailed = false
                }
            }
            removed.remove(removal.key)
        }
    }

    func dismissRemovalError() { removalFailed = false }

    /// Удаление уходит на сервер, потом «Сегодня» перечитывается — строка остаётся скрытой, пока не придёт список
    /// без неё (иначе она мигнула бы). Не вышло — перечитываем (строка вернётся) и отдаём ошибку плашке.
    private func commitThenRefresh(_ commit: @escaping () async throws -> Void) -> () async throws -> Void {
        { [weak self] in
            do {
                try await self?.track(commit)
            } catch {
                await self?.refresh()
                throw error
            }
            await self?.refresh()
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
    #endif

    // MARK: Ошибки

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
