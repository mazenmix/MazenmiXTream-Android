import Foundation
import Combine
import MazenmiXTreamCore

enum AppSection: String, CaseIterable, Identifiable {
    case home = "Home"
    case live = "Live TV"
    case movies = "Movies"
    case series = "Series"
    case favorites = "Favorites"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .live: "dot.radiowaves.left.and.right"
        case .movies: "play.rectangle.fill"
        case .series: "rectangle.stack.fill"
        case .favorites: "heart.fill"
        }
    }
}

struct PlayerSelection: Identifiable {
    var id = UUID()
    var item: MediaItem
    var queue: [MediaItem]
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var sources: [PlaylistSource] = []
    @Published var activeSourceID: UUID?
    @Published private(set) var catalog = Catalog.empty
    @Published private(set) var serverInfo: ServerAccountInfo?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published var selectedSection: AppSection = .home
    @Published var playerSelection: PlayerSelection?
    @Published private(set) var hideAdult = true
    @Published private(set) var favorites: Set<String> = []

    private let loader = PlaylistLoader()
    private let xtream = XtreamService()
    private let cache = CatalogCache()
    private let defaults = UserDefaults.standard
    private let stateKey = "mazenmixtream.ios.state.v1"

    init() {
        restoreState()
        if activeSourceID == nil { activeSourceID = sources.first?.id }
        if activeSourceID != nil {
            Task { await restoreActiveSource() }
        }
    }

    var activeSource: PlaylistSource? {
        sources.first { $0.id == activeSourceID }
    }

    var visibleLive: [MediaItem] { visible(catalog.live) }
    var visibleMovies: [MediaItem] { visible(catalog.movies) }
    var visibleSeries: [MediaItem] { visible(catalog.series) }

    func add(source: PlaylistSource, credentials: XtreamCredentials?) async throws {
        isLoading = true
        defer { isLoading = false }
        let response = try await loader.load(source: source, credentials: credentials)
        if let credentials { try KeychainStore.save(credentials, for: source.id) }
        sources.append(source)
        activeSourceID = source.id
        catalog = response.catalog
        serverInfo = response.server
        try? await cache.save(response, id: source.id)
        persistState()
    }

    func delete(_ source: PlaylistSource) {
        sources.removeAll { $0.id == source.id }
        KeychainStore.delete(for: source.id)
        Task { await cache.delete(id: source.id) }
        if activeSourceID == source.id {
            activeSourceID = sources.first?.id
            catalog = .empty
            serverInfo = nil
            if activeSourceID != nil { Task { await restoreActiveSource() } }
        }
        persistState()
    }

    func select(_ source: PlaylistSource) {
        guard activeSourceID != source.id else { return }
        activeSourceID = source.id
        catalog = .empty
        serverInfo = nil
        persistState()
        Task { await restoreActiveSource() }
    }

    func reload() async {
        guard let source = activeSource else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await loader.load(source: source, credentials: try credentials(for: source))
            catalog = response.catalog
            serverInfo = response.server
            try? await cache.save(response, id: source.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func play(_ item: MediaItem, in queue: [MediaItem]) {
        guard !item.playbackURLs.isEmpty else { return }
        playerSelection = PlayerSelection(item: item, queue: queue)
    }

    func isFavorite(_ item: MediaItem) -> Bool {
        favorites.contains(favoriteKey(item))
    }

    func toggleFavorite(_ item: MediaItem) {
        let key = favoriteKey(item)
        if favorites.contains(key) { favorites.remove(key) } else { favorites.insert(key) }
        persistState()
    }

    func setHideAdult(_ value: Bool) {
        hideAdult = value
        persistState()
    }

    func favoriteItems() -> [MediaItem] {
        visible(catalog.live + catalog.movies + catalog.series).filter(isFavorite)
    }

    func currentProgram(for item: MediaItem) async -> ProgramInfo? {
        guard let source = activeSource, source.kind == .xtream, !item.streamID.isEmpty,
              let credentials = try? credentials(for: source) else { return nil }
        return try? await xtream.currentProgram(source: source, credentials: credentials, streamID: item.streamID)
    }

    func seasons(for series: MediaItem) async throws -> [SeriesSeason] {
        guard let source = activeSource, source.kind == .xtream,
              let serverInfo, let credentials = try credentials(for: source) else { return [] }
        return try await xtream.seasons(source: source, credentials: credentials, seriesID: series.seriesID, server: serverInfo)
    }

    private func restoreActiveSource() async {
        guard let source = activeSource else { return }
        if let saved = await cache.load(id: source.id) {
            catalog = saved.catalog
            serverInfo = saved.server
        }
        await reload()
    }

    private func credentials(for source: PlaylistSource) throws -> XtreamCredentials? {
        source.kind == .xtream ? try KeychainStore.load(for: source.id) : nil
    }

    private func visible(_ items: [MediaItem]) -> [MediaItem] {
        hideAdult ? items.filter { !$0.isAdult } : items
    }

    private func favoriteKey(_ item: MediaItem) -> String {
        "\(activeSourceID?.uuidString ?? "none")|\(item.id)"
    }

    private struct SavedState: Codable {
        var sources: [PlaylistSource]
        var activeSourceID: UUID?
        var hideAdult: Bool
        var favorites: Set<String>
    }

    private func restoreState() {
        guard let data = defaults.data(forKey: stateKey), let saved = try? JSONDecoder().decode(SavedState.self, from: data) else { return }
        sources = saved.sources
        activeSourceID = saved.activeSourceID
        hideAdult = saved.hideAdult
        favorites = saved.favorites
    }

    private func persistState() {
        let state = SavedState(sources: sources, activeSourceID: activeSourceID, hideAdult: hideAdult, favorites: favorites)
        if let data = try? JSONEncoder().encode(state) { defaults.set(data, forKey: stateKey) }
    }
}
