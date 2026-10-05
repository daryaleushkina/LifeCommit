// Подменённая сеть для тестов: у каждого теста своя URLSession со своим обработчиком (тесты идут параллельно).
// Живой сети в тестах нет — незаданный адрес отвечает ошибкой.
import Foundation
import Synchronization
import Testing

final class Stub: Sendable {
    struct Call: Sendable {
        let method: String
        let url: URL
        let headers: [String: String]
        let body: Data
    }

    typealias Handler = @Sendable (Call) throws -> (Int, Data)

    private static let handlers = Mutex<[String: Handler]>([:])
    private let id = UUID().uuidString
    /// Mutex нельзя скопировать в замыкание — держим его в классе.
    private final class Log: Sendable {
        let calls = Mutex<[Call]>([])
    }

    private let log = Log()
    let session: URLSession

    init(_ handler: @escaping Handler) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        config.httpAdditionalHeaders = ["X-Stub": id]
        session = URLSession(configuration: config)
        let id = self.id
        let log = self.log
        Self.handlers.withLock {
            $0[id] = { call in
                log.calls.withLock { $0.append(call) }
                return try handler(call)
            }
        }
    }

    deinit {
        let id = self.id
        Self.handlers.withLock { $0[id] = nil }
    }

    var calls: [Call] { log.calls.withLock { $0 } }

    static func handler(for id: String) -> Handler? { handlers.withLock { $0[id] } }

    static func json(_ status: Int, _ object: Any) -> (Int, Data) {
        (status, try! JSONSerialization.data(withJSONObject: object))
    }
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
    // URLProtocol — класс Foundation с изменяемым состоянием; работает он на своей очереди, нам хватает request.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let id = request.value(forHTTPHeaderField: "X-Stub"), let handler = Stub.handler(for: id) else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        let call = Stub.Call(
            method: request.httpMethod ?? "GET",
            url: request.url!,
            headers: request.allHTTPHeaderFields ?? [:],
            body: body
        )
        do {
            let (status, data) = try handler(call)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

