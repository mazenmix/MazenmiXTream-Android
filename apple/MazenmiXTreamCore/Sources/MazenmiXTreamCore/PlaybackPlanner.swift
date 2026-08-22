import Foundation

public enum XtreamPlaybackPlanner {
    public static func urls(
        kind: MediaKind,
        streamID: String,
        explicitExtension: String,
        direct: String,
        credentials: XtreamCredentials,
        server: ServerAccountInfo
    ) -> [String] {
        let route = kind == .live ? "live" : kind == .episode ? "series" : "movie"
        let explicit = cleanExtension(explicitExtension, live: kind == .live)
        let allowed = server.allowedOutputFormats
            .map { cleanExtension($0, live: kind == .live) }
            .filter { !$0.isEmpty }

        var output: [String] = []
        func add(_ value: String) {
            guard !value.isEmpty, !output.contains(value) else { return }
            output.append(value)
        }

        if kind == .live {
            if direct.lowercased().contains(".m3u8") { add(direct) }

            // Apple devices handle HLS most reliably. Many Xtream servers expose
            // this endpoint even when the account reports only MPEG-TS output.
            add(generatedURL(route: route, streamID: streamID, extension: "m3u8", credentials: credentials, server: server))

            var fallbackFormats = [explicit] + allowed + ["ts"]
            fallbackFormats.removeAll { $0.isEmpty || $0 == "m3u8" }
            for format in fallbackFormats.prefix(3) {
                add(generatedURL(route: route, streamID: streamID, extension: format, credentials: credentials, server: server))
            }
            if !direct.lowercased().contains(".m3u8") { add(direct) }
        } else {
            add(direct)
            var formats = [explicit] + allowed
            if formats.allSatisfy(\.isEmpty) { formats = ["mp4"] }
            for format in formats.filter({ !$0.isEmpty }).prefix(3) {
                add(generatedURL(route: route, streamID: streamID, extension: format, credentials: credentials, server: server))
            }
        }
        return output
    }

    public static func cleanExtension(_ value: String, live: Bool) -> String {
        let cleaned = value.lowercased().trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let allowed = live ? ["m3u8", "ts"] : ["mp4", "mov", "m4v", "m3u8", "ts", "mkv", "avi"]
        return allowed.contains(cleaned) ? cleaned : ""
    }

    private static func generatedURL(
        route: String,
        streamID: String,
        extension fileExtension: String,
        credentials: XtreamCredentials,
        server: ServerAccountInfo
    ) -> String {
        let safePath = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))
        let username = credentials.username.addingPercentEncoding(withAllowedCharacters: safePath) ?? credentials.username
        let password = credentials.password.addingPercentEncoding(withAllowedCharacters: safePath) ?? credentials.password
        let identifier = streamID.addingPercentEncoding(withAllowedCharacters: safePath) ?? streamID
        return "\(server.streamBaseURL)/\(route)/\(username)/\(password)/\(identifier).\(fileExtension)"
    }
}
