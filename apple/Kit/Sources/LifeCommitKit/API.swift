// Вызовы API по разделам — как src/api.ts мини-аппа. Пути и тела — docs/mobile.md.
import Foundation

public extension APIClient {
    // MARK: Вход и сессия

    /// client_id для oauth.telegram.org (id бота). Без входа.
    func telegramLoginConfig() async throws -> TelegramLoginConfig {
        try await send("GET", "auth/telegram/config")
    }

    /// id_token Telegram → ключ сессии этого устройства. Без входа.
    func signInWithTelegram(idToken: String, device: String, language: String) async throws -> SignedIn {
        try await send("POST", "auth/telegram", json: JSONValue.object(["id_token": .string(idToken), "device": .string(device), "language": .string(language)]))
    }

    /// Первый запрос после входа и при каждом запуске: пояс телефона, пользователь.
    func session(timezone: String) async throws -> SessionResponse {
        try await send("POST", "session", json: JSONValue.object(["timezone": .string(timezone)]))
    }

    func updateSettings(_ patch: [String: JSONValue]) async throws -> UserSettings {
        try await send("PATCH", "settings", json: JSONValue.object(patch))
    }

    func deviceSessions() async throws -> [DeviceSession] {
        try await send("GET", "desktop/sessions")
    }

    /// Выйти на этом устройстве: ключ перестаёт работать.
    func signOutHere() async throws {
        _ = try await send("DELETE", "desktop/session", as: Empty.self)
    }

    func signOutEverywhere() async throws {
        _ = try await send("DELETE", "desktop/sessions", as: Empty.self)
    }

    func deleteAccount() async throws {
        _ = try await send("DELETE", "account", as: Empty.self)
    }

    // MARK: Привычки

    func today() async throws -> TodayResponse {
        try await send("GET", "today")
    }

    func heatmap(days: Int) async throws -> HeatmapResponse {
        try await send("GET", "heatmap", query: [URLQueryItem(name: "days", value: String(days))])
    }

    func createTask(_ input: TaskInput) async throws -> Int {
        try await send("POST", "tasks", json: input, as: Created.self).id
    }

    /// Правка привычки: только изменённые поля (snake_case, как на сервере).
    func updateTask(id: Int, _ patch: [String: JSONValue]) async throws -> TaskUpdated {
        try await send("PATCH", "tasks/\(id)", json: JSONValue.object(patch))
    }

    func archiveTask(id: Int) async throws {
        _ = try await send("POST", "tasks/\(id)/archive", as: Empty.self)
    }

    func restoreTask(id: Int) async throws {
        _ = try await send("POST", "tasks/\(id)/restore", as: Empty.self)
    }

    func deleteTask(id: Int) async throws {
        _ = try await send("DELETE", "tasks/\(id)", as: Empty.self)
    }

    /// Отметка: value — абсолютное (не прибавка); nil вместе с status nil — снять отметку. day — задним числом.
    func log(taskId: Int, value: Double?, status: AbstainStatus?, day: String? = nil) async throws {
        var body: [String: JSONValue] = ["task_id": .number(Double(taskId)), "value": .optional(value), "status": .optional(status?.rawValue)]
        if let day { body["day"] = .string(day) }
        _ = try await send("PUT", "logs", json: JSONValue.object(body), as: Empty.self)
    }

    func history(taskId: Int) async throws -> TaskHistory {
        try await send("GET", "tasks/\(taskId)/history")
    }

    // MARK: Дела

    func createTodo(title: String, day: String?) async throws -> Int {
        try await send("POST", "todos", json: JSONValue.object(["title": .string(title), "day": .optional(day)]), as: Created.self).id
    }

    /// Правка дела: title, day, time (null — весь день), done, on (день у повторяющегося), location, hidden.
    func updateTodo(id: Int, _ patch: [String: JSONValue]) async throws {
        _ = try await send("PATCH", "todos/\(id)", json: JSONValue.object(patch), as: Empty.self)
    }

    func deleteTodo(id: Int) async throws {
        _ = try await send("DELETE", "todos/\(id)", as: Empty.self)
    }

    func laterTodos() async throws -> [Todo] {
        try await send("GET", "todos/later")
    }
}
