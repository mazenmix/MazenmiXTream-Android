import Foundation

public enum PlaylistKind: String, Codable, CaseIterable, Sendable {
    case xtream
    case m3u
}

public struct PlaylistSource: Identifiable, Codable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var kind: PlaylistKind
    public var baseURL: String
    public var m3uURL: String

    public init(id: UUID = UUID(), name: String, kind: PlaylistKind, baseURL: String = "", m3uURL: String = "") {
        self.id = id
        self.name = name
        self.kind = kind
        self.baseURL = baseURL
        self.m3uURL = m3uURL
    }
}

public struct XtreamCredentials: Codable, Hashable, Sendable {
    public var username: String
    public var password: String

    public init(username: String, password: String) {
        self.username = username
        self.password = password
    }
}

public enum MediaKind: String, Codable, CaseIterable, Sendable {
    case live
    case movie
    case series
    case episode
}

public struct MediaItem: Identifiable, Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var group: String
    public var categoryID: String
    public var kind: MediaKind
    public var logoURL: String
    public var playbackURLs: [String]
    public var epgID: String
    public var streamID: String
    public var seriesID: String
    public var year: String
    public var rating: String
    public var isAdult: Bool
    public var headers: [String: String]

    public init(
        id: String,
        name: String,
        group: String = "Other",
        categoryID: String = "0",
        kind: MediaKind,
        logoURL: String = "",
        playbackURLs: [String] = [],
        epgID: String = "",
        streamID: String = "",
        seriesID: String = "",
        year: String = "",
        rating: String = "",
        isAdult: Bool = false,
        headers: [String: String] = [:]
    ) {
        self.id = id
        self.name = name
        self.group = group
        self.categoryID = categoryID
        self.kind = kind
        self.logoURL = logoURL
        self.playbackURLs = playbackURLs
        self.epgID = epgID
        self.streamID = streamID
        self.seriesID = seriesID
        self.year = year
        self.rating = rating
        self.isAdult = isAdult
        self.headers = headers
    }
}

public struct MediaCategory: Identifiable, Codable, Hashable, Sendable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct Catalog: Codable, Hashable, Sendable {
    public var live: [MediaItem]
    public var movies: [MediaItem]
    public var series: [MediaItem]
    public var liveCategories: [MediaCategory]
    public var movieCategories: [MediaCategory]
    public var seriesCategories: [MediaCategory]

    public init(
        live: [MediaItem] = [],
        movies: [MediaItem] = [],
        series: [MediaItem] = [],
        liveCategories: [MediaCategory] = [],
        movieCategories: [MediaCategory] = [],
        seriesCategories: [MediaCategory] = []
    ) {
        self.live = live
        self.movies = movies
        self.series = series
        self.liveCategories = liveCategories
        self.movieCategories = movieCategories
        self.seriesCategories = seriesCategories
    }

    public static let empty = Catalog()
}

public struct ServerAccountInfo: Codable, Hashable, Sendable {
    public var status: String
    public var expiry: String
    public var activeConnections: String
    public var maximumConnections: String
    public var timezone: String
    public var streamBaseURL: String
    public var allowedOutputFormats: [String]

    public init(
        status: String = "",
        expiry: String = "",
        activeConnections: String = "",
        maximumConnections: String = "",
        timezone: String = "",
        streamBaseURL: String = "",
        allowedOutputFormats: [String] = []
    ) {
        self.status = status
        self.expiry = expiry
        self.activeConnections = activeConnections
        self.maximumConnections = maximumConnections
        self.timezone = timezone
        self.streamBaseURL = streamBaseURL
        self.allowedOutputFormats = allowedOutputFormats
    }
}

public struct CatalogResponse: Codable, Hashable, Sendable {
    public var catalog: Catalog
    public var server: ServerAccountInfo?

    public init(catalog: Catalog, server: ServerAccountInfo? = nil) {
        self.catalog = catalog
        self.server = server
    }
}

public struct ProgramInfo: Codable, Hashable, Sendable {
    public var title: String
    public var start: String
    public var end: String
    public var description: String

    public init(title: String, start: String = "", end: String = "", description: String = "") {
        self.title = title
        self.start = start
        self.end = end
        self.description = description
    }
}

public struct SeriesSeason: Identifiable, Codable, Hashable, Sendable {
    public var id: String
    public var number: Int
    public var episodes: [MediaItem]

    public init(number: Int, episodes: [MediaItem]) {
        self.id = String(number)
        self.number = number
        self.episodes = episodes
    }
}

public enum MazenCoreError: LocalizedError, Equatable {
    case invalidURL
    case invalidPlaylist
    case rejectedLogin
    case invalidResponse
    case httpStatus(Int)
    case emptyCatalog

    public var errorDescription: String? {
        switch self {
        case .invalidURL: "Enter a valid HTTP or HTTPS URL."
        case .invalidPlaylist: "The address did not return a valid M3U playlist."
        case .rejectedLogin: "Xtream login was rejected. Check the server, username and password."
        case .invalidResponse: "The server returned invalid data."
        case .httpStatus(let code): "The server returned HTTP \(code)."
        case .emptyCatalog: "The server returned an empty catalog."
        }
    }
}

public enum ContentFilter {
    private static let adultTerms = [
        "adult", "adults", "xxx", "porn", "porno", "erotic", "playboy", "brazzers", "hustler",
        "للكبار", "اباحي", "إباحي", "سكس", "بالغين"
    ]

    public static func isAdult(_ value: String) -> Bool {
        let normalized = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        return adultTerms.contains { normalized.localizedCaseInsensitiveContains($0) }
            || normalized.localizedCaseInsensitiveContains("18+")
    }
}

public extension String {
    var decodedBase64IfNeeded: String {
        guard count.isMultiple(of: 4),
              range(of: "^[A-Za-z0-9+/]+={0,2}$", options: .regularExpression) != nil,
              let data = Data(base64Encoded: self),
              let decoded = String(data: data, encoding: .utf8),
              !decoded.isEmpty else { return self }
        return decoded
    }
}
