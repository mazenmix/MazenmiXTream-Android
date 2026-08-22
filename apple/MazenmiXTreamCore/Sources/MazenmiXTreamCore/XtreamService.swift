import Foundation

public struct PlaylistLoader: Sendable {
    private let client: HTTPClient

    public init(client: HTTPClient = HTTPClient()) {
        self.client = client
    }

    public func load(source: PlaylistSource, credentials: XtreamCredentials? = nil) async throws -> CatalogResponse {
        switch source.kind {
        case .xtream:
            guard let credentials else { throw MazenCoreError.rejectedLogin }
            return try await XtreamService(client: client).load(source: source, credentials: credentials)
        case .m3u:
            guard let url = URL(string: source.m3uURL), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                throw MazenCoreError.invalidURL
            }
            let text = try await client.text(from: url, timeout: 240, attempts: 2)
            return try M3UParser().parse(text, sourceURL: url)
        }
    }
}

public struct XtreamService: Sendable {
    private let client: HTTPClient

    public init(client: HTTPClient = HTTPClient()) {
        self.client = client
    }

    public func endpointURL(
        source: PlaylistSource,
        credentials: XtreamCredentials,
        action: String? = nil,
        extra: [String: String] = [:]
    ) throws -> URL {
        let base = source.baseURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard var components = URLComponents(string: "\(base)/player_api.php"),
              ["http", "https"].contains(components.scheme?.lowercased() ?? "") else {
            throw MazenCoreError.invalidURL
        }
        var items = [
            URLQueryItem(name: "username", value: credentials.username),
            URLQueryItem(name: "password", value: credentials.password)
        ]
        if let action { items.append(URLQueryItem(name: "action", value: action)) }
        items.append(contentsOf: extra.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) })
        components.queryItems = items
        guard let url = components.url else { throw MazenCoreError.invalidURL }
        return url
    }

    public func load(source: PlaylistSource, credentials: XtreamCredentials) async throws -> CatalogResponse {
        let account = try await object(from: endpointURL(source: source, credentials: credentials), timeout: 60, attempts: 3)
        guard let user = account["user_info"] as? [String: Any] else { throw MazenCoreError.rejectedLogin }
        let serverObject = account["server_info"] as? [String: Any] ?? [:]
        let server = makeServerInfo(source: source, user: user, server: serverObject)

        let liveCategoryRows = try await array(source: source, credentials: credentials, action: "get_live_categories", timeout: 75)
        let movieCategoryRows = try await array(source: source, credentials: credentials, action: "get_vod_categories", timeout: 75)
        let seriesCategoryRows = try await array(source: source, credentials: credentials, action: "get_series_categories", timeout: 75)

        let liveNames = categoryNames(liveCategoryRows)
        let movieNames = categoryNames(movieCategoryRows)
        let seriesNames = categoryNames(seriesCategoryRows)

        let liveRows = try await array(source: source, credentials: credentials, action: "get_live_streams", timeout: 240)
        let live = liveRows.compactMap { row -> MediaItem? in
            let streamID = text(row["stream_id"])
            guard !streamID.isEmpty else { return nil }
            let categoryID = text(row["category_id"], fallback: "0")
            let name = text(row["name"], fallback: "Untitled")
            let direct = normalizedStreamURL(text(row["direct_source"]), base: server.streamBaseURL)
            let ext = XtreamPlaybackPlanner.cleanExtension(text(row["container_extension"]), live: true)
            return MediaItem(
                id: "live-\(streamID)", name: name,
                group: liveNames[categoryID] ?? "Live TV", categoryID: categoryID, kind: .live,
                logoURL: text(row["stream_icon"]),
                playbackURLs: XtreamPlaybackPlanner.urls(kind: .live, streamID: streamID, explicitExtension: ext, direct: direct, credentials: credentials, server: server),
                epgID: text(row["epg_channel_id"]), streamID: streamID,
                isAdult: integer(row["is_adult"]) == 1 || ContentFilter.isAdult("\(name) \(liveNames[categoryID] ?? "")")
            )
        }

        let movieRows = try await array(source: source, credentials: credentials, action: "get_vod_streams", timeout: 240)
        let movies = movieRows.compactMap { row -> MediaItem? in
            let streamID = text(row["stream_id"])
            guard !streamID.isEmpty else { return nil }
            let categoryID = text(row["category_id"], fallback: "0")
            let name = text(row["name"], fallback: "Untitled")
            let direct = normalizedStreamURL(text(row["direct_source"]), base: server.streamBaseURL)
            let ext = XtreamPlaybackPlanner.cleanExtension(text(row["container_extension"]), live: false)
            return MediaItem(
                id: "movie-\(streamID)", name: name,
                group: movieNames[categoryID] ?? "Movies", categoryID: categoryID, kind: .movie,
                logoURL: text(row["stream_icon"]),
                playbackURLs: XtreamPlaybackPlanner.urls(kind: .movie, streamID: streamID, explicitExtension: ext, direct: direct, credentials: credentials, server: server),
                streamID: streamID, year: text(row["year"]), rating: text(row["rating"]),
                isAdult: integer(row["is_adult"]) == 1 || ContentFilter.isAdult("\(name) \(movieNames[categoryID] ?? "")")
            )
        }

        let seriesRows = try await array(source: source, credentials: credentials, action: "get_series", timeout: 240)
        let series = seriesRows.compactMap { row -> MediaItem? in
            let seriesID = text(row["series_id"])
            guard !seriesID.isEmpty else { return nil }
            let categoryID = text(row["category_id"], fallback: "0")
            let name = text(row["name"], fallback: "Untitled")
            return MediaItem(
                id: "series-\(seriesID)", name: name,
                group: seriesNames[categoryID] ?? "Series", categoryID: categoryID, kind: .series,
                logoURL: text(row["cover"]), seriesID: seriesID,
                year: text(row["year"]), rating: text(row["rating"]),
                isAdult: integer(row["is_adult"]) == 1 || ContentFilter.isAdult("\(name) \(seriesNames[categoryID] ?? "")")
            )
        }

        guard !(live.isEmpty && movies.isEmpty && series.isEmpty) else { throw MazenCoreError.emptyCatalog }
        let catalog = Catalog(
            live: live,
            movies: movies,
            series: series,
            liveCategories: categories(liveCategoryRows),
            movieCategories: categories(movieCategoryRows),
            seriesCategories: categories(seriesCategoryRows)
        )
        return CatalogResponse(catalog: catalog, server: server)
    }

    public func currentProgram(source: PlaylistSource, credentials: XtreamCredentials, streamID: String) async throws -> ProgramInfo? {
        let url = try endpointURL(source: source, credentials: credentials, action: "get_short_epg", extra: ["stream_id": streamID, "limit": "2"])
        let payload = try await object(from: url, timeout: 45, attempts: 2)
        guard let rows = payload["epg_listings"] as? [[String: Any]], let row = rows.first else { return nil }
        return ProgramInfo(
            title: text(row["title"] ?? row["name"], fallback: "No program information").decodedBase64IfNeeded,
            start: text(row["start"]),
            end: text(row["end"]),
            description: text(row["description"]).decodedBase64IfNeeded
        )
    }

    public func seasons(source: PlaylistSource, credentials: XtreamCredentials, seriesID: String, server: ServerAccountInfo) async throws -> [SeriesSeason] {
        let url = try endpointURL(source: source, credentials: credentials, action: "get_series_info", extra: ["series_id": seriesID])
        let payload = try await object(from: url, timeout: 120, attempts: 2)
        guard let episodesObject = payload["episodes"] as? [String: Any] else { return [] }

        return episodesObject.compactMap { key, value in
            guard let rows = value as? [[String: Any]] else { return nil }
            let number = Int(key) ?? integer(rows.first?["season"])
            let episodes = rows.compactMap { row -> MediaItem? in
                let episodeID = text(row["id"])
                guard !episodeID.isEmpty else { return nil }
                let title = text(row["title"], fallback: "Episode \(text(row["episode_num"], fallback: episodeID))")
                let ext = XtreamPlaybackPlanner.cleanExtension(text(row["container_extension"]), live: false)
                let direct = normalizedStreamURL(text(row["direct_source"]), base: server.streamBaseURL)
                return MediaItem(
                    id: "episode-\(episodeID)", name: title, group: "Season \(number)", categoryID: String(number), kind: .episode,
                    logoURL: text(row["info"] as? [String: Any], key: "movie_image"),
                    playbackURLs: XtreamPlaybackPlanner.urls(kind: .episode, streamID: episodeID, explicitExtension: ext, direct: direct, credentials: credentials, server: server),
                    streamID: episodeID
                )
            }
            return SeriesSeason(number: number, episodes: episodes)
        }.sorted { $0.number < $1.number }
    }

    private func array(source: PlaylistSource, credentials: XtreamCredentials, action: String, timeout: TimeInterval) async throws -> [[String: Any]] {
        let url = try endpointURL(source: source, credentials: credentials, action: action)
        let data = try await client.data(from: url, timeout: timeout, attempts: 2)
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return rows
    }

    private func object(from url: URL, timeout: TimeInterval, attempts: Int) async throws -> [String: Any] {
        let data = try await client.data(from: url, timeout: timeout, attempts: attempts)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MazenCoreError.invalidResponse }
        return object
    }

    private func makeServerInfo(source: PlaylistSource, user: [String: Any], server: [String: Any]) -> ServerAccountInfo {
        let allowed = (user["allowed_output_formats"] as? [Any] ?? []).map { text($0).lowercased() }.filter { !$0.isEmpty }
        return ServerAccountInfo(
            status: text(user["status"]), expiry: text(user["exp_date"]),
            activeConnections: text(user["active_cons"]), maximumConnections: text(user["max_connections"]),
            timezone: text(server["timezone"]), streamBaseURL: streamBase(source: source, server: server),
            allowedOutputFormats: allowed
        )
    }

    private func streamBase(source: PlaylistSource, server: [String: Any]) -> String {
        let fallback = source.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var host = text(server["url"])
        let protocolName = text(server["server_protocol"], fallback: URL(string: fallback)?.scheme ?? "http").replacingOccurrences(of: ":", with: "")
        guard !host.isEmpty else { return fallback }
        if !host.lowercased().hasPrefix("http") { host = "\(protocolName)://\(host)" }
        guard var components = URLComponents(string: host) else { return fallback }
        components.scheme = protocolName
        if components.port == nil {
            let port = protocolName == "https" ? text(server["https_port"] ?? server["port"]) : text(server["port"])
            if let value = Int(port), !((protocolName == "http" && value == 80) || (protocolName == "https" && value == 443)) {
                components.port = value
            }
        }
        return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? fallback
    }

    private func normalizedStreamURL(_ value: String, base: String) -> String {
        guard !value.isEmpty else { return "" }
        if value.hasPrefix("//") { return "\(URL(string: base)?.scheme ?? "http"):\(value)" }
        return URL(string: value, relativeTo: URL(string: base))?.absoluteURL.absoluteString ?? ""
    }

    private func categories(_ rows: [[String: Any]]) -> [MediaCategory] {
        rows.compactMap {
            let id = text($0["category_id"])
            guard !id.isEmpty else { return nil }
            return MediaCategory(id: id, name: text($0["category_name"], fallback: "Other"))
        }
    }

    private func categoryNames(_ rows: [[String: Any]]) -> [String: String] {
        rows.reduce(into: [:]) { output, row in
            let id = text(row["category_id"])
            if !id.isEmpty { output[id] = text(row["category_name"], fallback: "Other") }
        }
    }

    private func text(_ value: Any?, fallback: String = "") -> String {
        guard let value, !(value is NSNull) else { return fallback }
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return fallback
    }

    private func text(_ object: [String: Any]?, key: String) -> String {
        text(object?[key])
    }

    private func integer(_ value: Any?) -> Int {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) ?? 0 }
        return 0
    }
}
