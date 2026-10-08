// Состояние «Вместе» — как src/screens/Groups.tsx, Group.tsx, Join.tsx, Friends.tsx: группы (список, экран, дела с
// отметками, настройки, приглашения), друзья (список, заявки, экран друга, «Что показать»). Экран меняется сразу,
// сервер догоняет; не вышло — как было и сказано. Ответ, начатый раньше правки, её не затирает. Действия, которые
// человек может «бросить» (закрыл шторку, ушёл назад), идут в задачах модели, а не экрана: так запрос не отменится
// вместе с экраном (так же у Android, /lc-review 06.10).
import Foundation
import LifeCommitKit
import Observation
import os

private let togetherLog = Logger(subsystem: "app.lifecommit", category: "together")

@Observable
@MainActor
final class TogetherModel {
    /// Подсказка после действия на экране группы («Уже кто-то сделал», «Ссылка готова…») — только на экране этой группы.
    struct Note: Equatable {
        let groupId: Int
        let text: String
    }

    /// Список групп; nil — ещё не знаем (на экране — группы из «Сегодня»).
    private(set) var list: [GroupToday]?
    /// Экраны групп, уже открытые (или подтянутые), — открываются сразу.
    private(set) var details: [Int: GroupToday] = [:]
    /// Групп больше нет (удалили, вышла) — экран так и скажет.
    private(set) var missing: Set<Int> = []
    var note: Note?
    /// Настройка группы не сохранилась — строка ошибки и в открытой шторке настроек (подсказку на экране группы она
    /// закрывает).
    private(set) var settingsFailed: Int?

    private(set) var friends: FriendsResponse?
    /// Друзей не удалось загрузить, а показать нечего — ошибка, а не «пока нет друзей».
    private(set) var friendsFailed = false
    private(set) var profiles: [Int: FriendProfile] = [:]
    /// Экрана друга нет (убрали из друзей, заблокировали).
    private(set) var missingFriends: Set<Int> = []
    /// Заявки, на которые уже ответили: на экране их нет, даже если старый ответ сервера ещё с ними.
    private(set) var answered: Set<Int> = []
    /// Номер перечитывания друзей на момент, когда сервер принял ответ на заявку: начатые позже его уже знают.
    private var answeredAt: [Int: Int] = [:]
    /// Ответ на заявку не дошёл — заявка снова на экране, строка ошибки.
    var answerFailed = false
    /// Своя заявка не отменилась.
    var cancelFailed = false
    /// «Что показать друзьям?» не сохранилось — шторка снова с тем, что выбрали, и строкой ошибки.
    private(set) var showFailed: [Int]?
    /// Шторка «Что показать друзьям?» открыта.
    var showOpen = false
    /// Спросили «Что показать» в этот запуск — второй раз не спрашиваем, даже если сервер ещё не узнал.
    private var asked = false

    /// Номер правки: ответ, начатый раньше, правку не затирает.
    private var version = 0
    private var friendsSeq = 0
    /// Номер человека: растёт при выходе — ответы прошлого аккаунта ничего не записывают.
    private var epoch = 0

    let api: APIClient
    weak var app: AppModel?

    init(api: APIClient) {
        self.api = api
    }

    private var me: Int { app?.user?.id ?? 0 }
    private var t: Strings { app?.strings ?? .ru }

    func reset() {
        epoch += 1
        version += 1
        friendsSeq += 1
        list = nil
        details = [:]
        missing = []
        note = nil
        settingsFailed = nil
        friends = nil
        friendsFailed = false
        profiles = [:]
        missingFriends = []
        answered = []
        answeredAt = [:]
        answerFailed = false
        cancelFailed = false
        showFailed = nil
        showOpen = false
        asked = false
        resumeEditWaiters()
    }

    /// Ключ больше не пускает — на вход; остальное — в лог (экран решает сам, что сказать).
    private func handle(_ error: Error, _ what: String) {
        if let api = error as? APIError, api.isSignedOut {
            app?.signOutLocally()
            return
        }
        if error is CancellationError { return }
        togetherLog.notice("\(what, privacy: .public): \(String(describing: error), privacy: .public)")
    }

    private func isSignedOut(_ error: Error) -> Bool { (error as? APIError)?.isSignedOut == true }

    /// Что-то в группах поменялось — «Сегодня» и календарь перечитают себя (блоки групп, счётчики).
    private func changed() async {
        await app?.groupsChanged()
    }

    /// Правки, которые ещё идут на сервер (как trackEdit в мини-аппе и track в AppModel): ответ чтения, пришедший, пока
    /// правка у сервера, её ещё не знает — его не применяем; после правки экран перечитывается заново.
    private var editsInFlight = 0
    @ObservationIgnored private var editWaiters: [UUID: CheckedContinuation<Void, Never>] = [:]

    private func resumeEditWaiters() {
        let waiting = editWaiters.values
        editWaiters = [:]
        waiting.forEach { $0.resume() }
    }

    /// Открытый экран ждёт все правки; закрытый экран и прошлый аккаунт ждать больше не должны.
    private func settleEdits() async {
        guard editsInFlight > 0 else { return }
        let id = UUID()
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if Task.isCancelled || editsInFlight == 0 {
                    continuation.resume()
                } else {
                    editWaiters[id] = continuation
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.editWaiters.removeValue(forKey: id)?.resume()
            }
        }
    }

    private func track<T>(_ edit: () async throws -> T) async throws -> T {
        version += 1
        editsInFlight += 1
        defer {
            editsInFlight -= 1
            version += 1
            if editsInFlight == 0 { resumeEditWaiters() }
        }
        return try await edit()
    }

    /// Ответ чтения, начатого при номере seq, ещё верен: за это время ничего не правили и ничего не идёт на сервер.
    private func fresh(_ seq: Int, _ session: Int) -> Bool { seq == version && editsInFlight == 0 && session == epoch }

    /// После правки: «Сегодня» с календарём и экран группы — с сервера, одновременно.
    private func reload(_ groupId: Int) async {
        async let today: Void = changed()
        await loadGroup(groupId, quiet: true)
        await today
    }

    // MARK: Группы

    func loadList() async {
        let seq = version, session = epoch
        do {
            let fresh = try await api.groups()
            if self.fresh(seq, session) { list = fresh }
        } catch {
            // Не вышло — остаётся то, что было (на экране — группы из «Сегодня»), а не «нет групп».
            if session == epoch { handle(error, "groups") }
        }
    }

    /// quiet — чтение в фоне (после отметки на «Сегодня», после удаления): «группа не найдена» — только если сервер так и
    /// сказал (404), а не когда моргнула сеть, а экран группы ещё ни разу не открывали.
    func loadGroup(_ id: Int, quiet: Bool = false) async {
        let session = epoch
        for _ in 0..<4 {
            guard session == epoch, !Task.isCancelled else { return }
            let seq = version
            do {
                let g = try await api.group(id: id)
                guard session == epoch, !Task.isCancelled else { return }
                if fresh(seq, session) {
                    details[id] = g
                    missing.remove(id)
                    return
                }
                // Ответ ещё не знает правок: сначала сервер примет их все, потом спросим заново.
                await settleEdits()
            } catch {
                guard session == epoch, !Task.isCancelled, !(error is CancellationError) else { return }
                // «Не найдено» — только когда группы правда нет (404) или показать нечего; моргнула сеть — экран как был.
                if (error as? APIError)?.status == 404 || (!quiet && details[id] == nil) { missing.insert(id) }
                handle(error, "group \(id)")
                return
            }
        }
        guard session == epoch, !Task.isCancelled else { return }
        togetherLog.notice("group \(id): no fresh response after 4 attempts")
    }

    /// Новая группа: только название. Экран новой группы — сразу целиком, и в списке она уже есть.
    func create(title: String) async throws -> Int {
        let id = try await track { try await api.createGroup(title: title.trimmingCharacters(in: .whitespacesAndNewlines)) }
        await loadGroup(id)
        if let g = details[id] { list = (list ?? app?.today.groups ?? []).filter { $0.id != id } + [g] }
        return id
    }

    /// Отметка на экране группы: галочка сразу; не вышло — назад и подсказка. Потом «Сегодня» и экран — с сервера.
    func mark(groupId: Int, _ item: GroupDayItem) async {
        let done = !item.done
        patchItem(groupId) { $0.id == item.id ? GroupLogic.marked($0, done: done, me: me) : $0 }
        if done { Haptics.success() }
        do {
            let res = try await track { try await api.markGroupItem(groupId: groupId, itemId: item.id, done: done) }
            if res.taken { note = Note(groupId: groupId, text: t.gr.taken) }
        } catch {
            patchItem(groupId) { $0.id == item.id ? item : $0 }
            if isSignedOut(error) { return handle(error, "mark") }
            togetherLog.notice("group mark: \(String(describing: error), privacy: .public)")
            note = Note(groupId: groupId, text: (error as? APIError)?.code == "not_yours" ? t.gr.notYours : t.error)
        }
        await reload(groupId)
    }

    private func patchItem(_ groupId: Int, _ f: (GroupDayItem) -> GroupDayItem) {
        guard var g = details[groupId] else { return }
        g.items = g.items.map(f)
        details[groupId] = g
    }

    /// Новое дело или правка. Ошибку бросает — шторка покажет её и останется открытой.
    func saveItem(groupId: Int, itemId: Int?, _ input: GroupItemInput) async throws {
        try await track {
            if let itemId {
                try await api.updateGroupItem(groupId: groupId, itemId: itemId, input)
            } else {
                _ = try await api.createGroupItem(groupId: groupId, input)
            }
        }
        Haptics.success()
        // Шторка уже закрывается — перечитка идёт в задаче модели.
        Task { await reload(groupId) }
    }

    /// Удалить дело свайпом (или «Удалить дело» в шторке): строка пропадает сразу, «Вернуть» 5 секунд. Повторяющееся
    /// «только сегодня» — skipDay (прячется только этот день). В группе, где правят только админы, сервер откажет — так
    /// и сказать. Строка остаётся скрытой, пока экраны не перечитаны без неё (иначе мелькнула бы обратно).
    func removeItem(groupId: Int, _ item: GroupDayItem, skipDay: String?) {
        guard let app else { return }
        let text = skipDay == nil ? app.strings.swipe.removed(item.title) : app.strings.together.skipped(item.title)
        let notAllowed = app.strings.together.notAllowed
        let key = skipDay.map { Self.removalKey(groupId, item.id, day: $0) } ?? Self.removalKey(groupId, item.id)
        app.removeWithUndo(key: key, text: text, failure: { error in
            (error as? APIError)?.code == "admins_only" ? notAllowed : nil
        }, commit: { [weak self, api] in
            do {
                try await self?.track {
                    if let skipDay {
                        try await api.skipGroupItem(groupId: groupId, itemId: item.id, day: skipDay)
                    } else {
                        try await api.deleteGroupItem(groupId: groupId, itemId: item.id)
                    }
                }
            } catch {
                // Не удалилось — строка вернётся с перечитанным экраном.
                await self?.reload(groupId)
                throw error
            }
            await self?.reload(groupId)
        })
    }

    static func removalKey(_ groupId: Int, _ itemId: Int) -> String { "gi:\(groupId):\(itemId)" }
    static func removalKey(_ groupId: Int, _ itemId: Int, day: String) -> String { "gi:\(groupId):\(itemId):\(day)" }

    /// Строка дела в этот день скрыта: удалили дело целиком или убрали только этот день.
    static func isRemoved(_ app: AppModel, _ groupId: Int, _ itemId: Int, day: String) -> Bool {
        app.isRemoved(removalKey(groupId, itemId)) || app.isRemoved(removalKey(groupId, itemId, day: day))
    }

    /// Вклад в общую цель. Не вышло — подсказка на экране группы.
    func put(groupId: Int, itemId: Int, amount: Double) async {
        do {
            try await track { try await api.addGoalEntry(groupId: groupId, itemId: itemId, amount: amount) }
            Haptics.success()
        } catch {
            if isSignedOut(error) { return handle(error, "put") }
            togetherLog.notice("goal entry: \(String(describing: error), privacy: .public)")
            note = Note(groupId: groupId, text: t.error)
        }
        await reload(groupId)
    }

    /// Ссылка-приглашение в группу (для «Позвать в группу» и подключения чата).
    func inviteLink(groupId: Int) async throws -> String {
        try await api.invite(groupId: groupId).link
    }

    /// Настройка не сохранилась: подсказка на экране группы и строка в шторке настроек, если она ещё открыта.
    private func settingFailed(_ groupId: Int, _ error: Error, _ what: String) {
        togetherLog.notice("\(what, privacy: .public) \(groupId): \(String(describing: error), privacy: .public)")
        note = Note(groupId: groupId, text: t.error)
        settingsFailed = groupId
    }

    /// Шторку настроек открыли заново — прошлой ошибки в ней нет.
    func clearSettingsFailed() { settingsFailed = nil }

    /// Новое название: на экране сразу; не вышло — старое и подсказка.
    func rename(groupId: Int, title: String) {
        let next = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let before = details[groupId]?.title, !next.isEmpty, next != before else { return }
        setTitle(groupId, next)
        let session = epoch
        Task {
            do {
                try await track { try await api.updateGroup(id: groupId, ["title": .string(next)]) }
                if session == epoch { await changed() }
            } catch {
                guard session == epoch else { return }
                if isSignedOut(error) { return handle(error, "rename") }
                // Назад — только название этой группы: остальное в списке за это время могло поменяться.
                setTitle(groupId, before)
                settingFailed(groupId, error, "rename group")
            }
        }
    }

    private func setTitle(_ groupId: Int, _ title: String) {
        details[groupId]?.title = title
        list = list?.map { g in
            var next = g
            if g.id == groupId { next.title = title }
            return next
        }
    }

    /// «Дела заводят только админы»: сразу; не вышло — назад и подсказка.
    func setAdminsOnly(groupId: Int, _ on: Bool) {
        setSettings(groupId) { $0.adminsOnlyEdit = on }
        let session = epoch
        Task {
            do {
                try await track { try await api.updateGroup(id: groupId, ["admins_only_edit": .bool(on)]) }
            } catch {
                guard session == epoch else { return }
                if isSignedOut(error) { return handle(error, "admins only") }
                setSettings(groupId) { $0.adminsOnlyEdit = !on }
                settingFailed(groupId, error, "admins only")
            }
        }
    }

    private func setSettings(_ groupId: Int, _ f: (inout GroupSettings) -> Void) {
        guard var g = details[groupId] else { return }
        var s = g.settings ?? GroupSettings()
        f(&s)
        g.settings = s
        details[groupId] = g
    }

    /// Чат ещё жив? Удалённый в Telegram пропадает из настроек сразу. Не вышло — остаётся, как было (это проверка, а
    /// не действие человека). Ответ, начатый до «Отключить» или «Другой чат», его не отменяет.
    func checkChat(groupId: Int) async {
        let seq = version, session = epoch
        do {
            let title = try await api.checkGroupChat(groupId: groupId)
            if fresh(seq, session) { setSettings(groupId) { $0.tgChatTitle = title } }
        } catch {
            if session == epoch { handle(error, "chat check") }
        }
    }

    /// «Отключить» чат: на экране сразу «Подключить»; не вышло — чат обратно и подсказка.
    func disconnectChat(groupId: Int) async {
        let before = details[groupId]?.settings?.tgChatTitle
        setSettings(groupId) { $0.tgChatTitle = nil }
        do {
            try await track { try await api.disconnectGroupChat(groupId: groupId) }
        } catch {
            if isSignedOut(error) { return handle(error, "chat off") }
            setSettings(groupId) { $0.tgChatTitle = before }
            settingFailed(groupId, error, "chat off")
        }
    }

    /// Выйти или удалить группу. false — сервер не выпустил: остаёмся на экране группы с подсказкой.
    func leave(groupId: Int, remove: Bool) async -> Bool {
        do {
            try await track {
                if remove { try await api.deleteGroup(id: groupId) } else { try await api.leaveGroup(id: groupId) }
            }
        } catch {
            if isSignedOut(error) {
                handle(error, "leave")
                return false
            }
            togetherLog.notice("leave \(groupId): \(String(describing: error), privacy: .public)")
            note = Note(groupId: groupId, text: t.error)
            return false
        }
        details[groupId] = nil
        list = list?.filter { $0.id != groupId }
        Task { await changed() }
        return true
    }

    // MARK: Приглашение в группу

    func invitation(code: String) async throws -> Invitation {
        try await api.invitation(code: code)
    }

    /// Вступить: экран группы открывается сразу целиком. Первый экран «Чего я хочу?» больше не нужен — у человека есть
    /// группа (как onJoined в мини-аппе).
    func join(code: String) async throws -> Int {
        let id = try await track { try await api.join(code: code) }
        app?.endOnboarding()
        await loadGroup(id)
        Task {
            await changed()
            await loadList()
        }
        return id
    }

    // MARK: Друзья

    /// Перечитать друзей: всегда новым запросом (уже идущий мог уйти до правки), ответ старше последнего — не применяем.
    func reloadFriends() async {
        friendsSeq += 1
        let seq = friendsSeq, session = epoch
        do {
            let d = try await api.friends()
            guard seq == friendsSeq, session == epoch else { return }
            friends = d
            friendsFailed = false
            // Ответ начат после того, как сервер принял ответ на заявку: он уже без неё. Если в нём снова заявка от
            // этого человека — она новая (позвал ещё раз), её показываем.
            answered = answered.filter { (answeredAt[$0] ?? .max) >= seq }
            answeredAt = answeredAt.filter { answered.contains($0.key) }
        } catch {
            guard session == epoch else { return }
            handle(error, "friends")
            if seq == friendsSeq, friends == nil, !(error is CancellationError) { friendsFailed = true }
        }
    }

    /// Первый друг появился — один раз за запуск спрашиваем, что ему показать (только в списке друзей).
    func promptIfNeeded() {
        guard friends?.prompt == true, !asked else { return }
        asked = true
        showOpen = true
    }

    /// Заявки ко мне, на которые ещё не ответили.
    var incoming: [FriendRequest] { (friends?.incoming ?? []).filter { !answered.contains($0.id) } }

    /// Принять или отклонить: заявка уходит с экрана сразу; не вышло — возвращается, строка ошибки.
    func answer(_ id: Int, accept: Bool) {
        answerFailed = false
        answered.insert(id)
        answeredAt[id] = nil
        let session = epoch
        Task {
            do {
                if accept { try await api.acceptFriend(id: id) } else { try await api.dropFriendRequest(id: id) }
                if session == epoch { answeredAt[id] = friendsSeq }
            } catch {
                guard session == epoch else { return }
                if isSignedOut(error) { return handle(error, "answer") }
                togetherLog.notice("answer request \(id): \(String(describing: error), privacy: .public)")
                answered.remove(id)
                answerFailed = true
            }
            if session == epoch { await reloadFriends() }
        }
    }

    /// Отменить свою заявку; не вышло — она остаётся, строка ошибки.
    func cancelRequest(_ id: Int) {
        cancelFailed = false
        let session = epoch
        Task {
            do {
                try await api.dropFriendRequest(id: id)
            } catch {
                guard session == epoch else { return }
                if isSignedOut(error) { return handle(error, "cancel request") }
                togetherLog.notice("cancel request \(id): \(String(describing: error), privacy: .public)")
                cancelFailed = true
            }
            if session == epoch { await reloadFriends() }
        }
    }

    /// Шторку «Что показать» закрыли: ids — выбранные привычки; nil — «Назад» (служебное «уже спросили»).
    func saveShown(_ ids: [Int]?) {
        showOpen = false
        showFailed = nil
        let session = epoch
        Task {
            if let ids {
                do {
                    try await api.setShown(taskIds: ids)
                } catch {
                    guard session == epoch else { return }
                    if isSignedOut(error) { return handle(error, "shown") }
                    togetherLog.notice("shown: \(String(describing: error), privacy: .public)")
                    showFailed = ids
                    showOpen = true
                    return
                }
                // Видимость привычек поменялась — «Сегодня» перечитает себя.
                if session == epoch { await changed() }
            } else {
                // Служебная отметка: не дошла — спросим в другой раз, ошибку не показываем.
                do {
                    try await api.promptSeen()
                } catch {
                    if session == epoch { handle(error, "prompt seen") }
                }
            }
            if session == epoch { await reloadFriends() }
        }
    }

    /// Открыть «Что показать друзьям?» самой (из списка друзей).
    func openShow() {
        showFailed = nil
        showOpen = true
    }

    func loadFriend(_ id: Int) async {
        let session = epoch
        do {
            let p = try await api.friend(id: id)
            guard session == epoch else { return }
            profiles[id] = p
            missingFriends.remove(id)
        } catch {
            guard session == epoch, !(error is CancellationError) else { return }
            // Убрали из друзей (или заблокировали) — экрана нет; моргнула сеть — остаётся как был.
            if (error as? APIError)?.status == 404 || profiles[id] == nil {
                profiles[id] = nil
                missingFriends.insert(id)
            }
            handle(error, "friend \(id)")
        }
    }

    /// Убрать из друзей или заблокировать. false — не вышло: экран остаётся, строка ошибки.
    func leaveFriend(_ id: Int, block: Bool) async -> Bool {
        do {
            if block { try await api.block(id: id) } else { try await api.removeFriend(id: id) }
        } catch {
            handle(error, block ? "block" : "remove friend")
            return false
        }
        profiles[id] = nil
        await reloadFriends()
        return true
    }

    func findPerson(_ username: String) async throws -> FoundPerson {
        try await api.findPerson(username: username)
    }

    /// Позвать найденного по @username: ответ — sent или friends (встречная заявка).
    func request(username: String) async throws -> PersonStatus {
        let status = try await api.requestFriend(username: username)
        await reloadFriends()
        return status
    }

    func friendLink(code: String) async throws -> FoundPerson {
        try await api.friendLink(code: code)
    }

    func request(code: String) async throws -> PersonStatus {
        let status = try await api.requestFriend(code: code)
        await reloadFriends()
        return status
    }

    #if DEBUG
    /// Готовое состояние без сети — для снимков экранов.
    func setForTests(list: [GroupToday]? = nil, details: [GroupToday] = [], friends: FriendsResponse? = nil, profiles: [FriendProfile] = [], note: Note? = nil, showFailed: [Int]? = nil) {
        if let list { self.list = list }
        for g in details { self.details[g.id] = g }
        if let friends { self.friends = friends }
        for p in profiles { self.profiles[p.person.id] = p }
        self.note = note
        self.showFailed = showFailed
    }
    #endif
}
