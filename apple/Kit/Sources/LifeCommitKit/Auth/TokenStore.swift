// Ключ сессии хранится в Keychain (не в UserDefaults): переживает переустановку только если так решит система, и
// недоступен другим приложениям. Только «после первой разблокировки» и только на этом устройстве (не в iCloud).
import Foundation
import Security
import Synchronization

public protocol TokenStore: Sendable {
    func load() throws -> String?
    func save(_ token: String) throws
    func clear() throws
}

public struct KeychainError: Error, Sendable, Equatable {
    public let status: OSStatus
}

public struct KeychainTokenStore: TokenStore {
    public let service: String
    public let account: String

    public init(service: String = "app.lifecommit", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() throws -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = out as? Data else { throw KeychainError(status: status) }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ token: String) throws {
        let data = Data(token.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainError(status: update) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

/// Хранилище в памяти — для тестов и превью.
public final class MemoryTokenStore: TokenStore {
    private let value: Mutex<String?>

    public init(_ token: String? = nil) { value = Mutex(token) }

    public func load() throws -> String? { value.withLock { $0 } }
    public func save(_ token: String) throws { value.withLock { $0 = token } }
    public func clear() throws { value.withLock { $0 = nil } }
}
