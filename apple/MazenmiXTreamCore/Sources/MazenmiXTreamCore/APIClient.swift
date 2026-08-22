import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public actor HTTPClient {
    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 240
        configuration.httpAdditionalHeaders = [
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "MazenmiXTream-iOS/1.0"
        ]
        session = URLSession(configuration: configuration)
    }

    public func data(from url: URL, timeout: TimeInterval = 60, attempts: Int = 2) async throws -> Data {
        var lastError: Error?
        for attempt in 0..<max(1, attempts) {
            do {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
                request.httpMethod = "GET"
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw MazenCoreError.invalidResponse }
                guard (200..<300).contains(http.statusCode) else { throw MazenCoreError.httpStatus(http.statusCode) }
                return data
            } catch {
                lastError = error
                if attempt + 1 < max(1, attempts) {
                    try? await Task.sleep(for: .milliseconds(attempt == 0 ? 500 : 1_400))
                }
            }
        }
        throw lastError ?? MazenCoreError.invalidResponse
    }

    public func json(from url: URL, timeout: TimeInterval = 60, attempts: Int = 2) async throws -> Any {
        let payload = try await data(from: url, timeout: timeout, attempts: attempts)
        do {
            return try JSONSerialization.jsonObject(with: payload)
        } catch {
            throw MazenCoreError.invalidResponse
        }
    }

    public func text(from url: URL, timeout: TimeInterval = 60, attempts: Int = 2) async throws -> String {
        let payload = try await data(from: url, timeout: timeout, attempts: attempts)
        guard let text = String(data: payload, encoding: .utf8) ?? String(data: payload, encoding: .isoLatin1) else {
            throw MazenCoreError.invalidResponse
        }
        return text
    }
}
