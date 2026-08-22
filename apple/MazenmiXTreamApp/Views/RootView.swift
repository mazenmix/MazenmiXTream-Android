import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showAddPlaylist = false
    @State private var showPlaylistManager = false

    var body: some View {
        ZStack {
            MXTheme.background.ignoresSafeArea()
            if model.sources.isEmpty {
                WelcomeView { showAddPlaylist = true }
            } else if sizeClass == .regular {
                RegularRootView(showAddPlaylist: $showAddPlaylist, showPlaylistManager: $showPlaylistManager)
            } else {
                CompactRootView(showAddPlaylist: $showAddPlaylist, showPlaylistManager: $showPlaylistManager)
            }
            if model.isLoading { LoadingOverlay() }
        }
        .tint(MXTheme.red)
        .sheet(isPresented: $showAddPlaylist) { AddPlaylistView() }
        .sheet(isPresented: $showPlaylistManager) { PlaylistManagerView(showAddPlaylist: $showAddPlaylist) }
        .fullScreenCover(item: $model.playerSelection) { selection in
            PlayerScreen(selection: selection).environmentObject(model)
        }
        .alert("MazenmiXTream", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Unknown error")
        }
    }
}

private struct CompactRootView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var showAddPlaylist: Bool
    @Binding var showPlaylistManager: Bool

    var body: some View {
        TabView(selection: $model.selectedSection) {
            ForEach(AppSection.allCases) { section in
                NavigationStack {
                    SectionView(section: section)
                        .navigationTitle(section.rawValue)
                        .toolbar { compactToolbar }
                }
                .tabItem { Label(section.rawValue, systemImage: section.symbol) }
                .tag(section)
            }
        }
    }

    @ToolbarContentBuilder
    private var compactToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { MXBrand(compact: true) }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
            Button { showPlaylistManager = true } label: { Image(systemName: "slider.horizontal.3") }
        }
    }
}

private struct RegularRootView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var showAddPlaylist: Bool
    @Binding var showPlaylistManager: Bool

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                MXBrand().padding(.horizontal).padding(.vertical, 18)
                sourcePicker.padding(.horizontal).padding(.bottom, 10)
                List {
                    ForEach(AppSection.allCases) { section in
                        Button {
                            model.selectedSection = section
                        } label: {
                            Label(section.rawValue, systemImage: section.symbol)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(model.selectedSection == section ? MXTheme.red.opacity(0.18) : Color.clear)
                    }
                }
                .listStyle(.sidebar)
                VStack(spacing: 8) {
                    Button { showAddPlaylist = true } label: { Label("Add playlist", systemImage: "plus") }
                    Button { showPlaylistManager = true } label: { Label("Manage & settings", systemImage: "gearshape") }
                }
                .buttonStyle(.borderless)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .background(MXTheme.panel.opacity(0.7))
            .navigationSplitViewColumnWidth(min: 230, ideal: 260, max: 300)
        } detail: {
            NavigationStack {
                SectionView(section: model.selectedSection)
                    .navigationTitle(model.selectedSection.rawValue)
                    .toolbar {
                        ToolbarItemGroup(placement: .topBarTrailing) {
                            Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                            Button { showPlaylistManager = true } label: { Image(systemName: "slider.horizontal.3") }
                        }
                    }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var sourcePicker: some View {
        Menu {
            ForEach(model.sources) { source in
                Button {
                    model.select(source)
                } label: {
                    if source.id == model.activeSourceID { Label(source.name, systemImage: "checkmark") }
                    else { Text(source.name) }
                }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PLAYLIST").font(.caption2.bold()).foregroundStyle(.secondary)
                    Text(model.activeSource?.name ?? "Choose playlist").font(.subheadline.bold()).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption)
            }
            .padding(12).background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

private struct SectionView: View {
    @EnvironmentObject private var model: AppModel
    let section: AppSection

    var body: some View {
        switch section {
        case .home: HomeView()
        case .live: LiveBrowserView()
        case .movies: MediaLibraryView(title: "Movies", items: model.visibleMovies, categories: model.catalog.movieCategories)
        case .series: MediaLibraryView(title: "Series", items: model.visibleSeries, categories: model.catalog.seriesCategories)
        case .favorites: MediaLibraryView(title: "Favorites", items: model.favoriteItems(), categories: [])
        }
    }
}

private struct WelcomeView: View {
    let add: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            MXBrand()
            Image(systemName: "play.tv.fill")
                .font(.system(size: 64)).foregroundStyle(MXTheme.red.gradient)
            VStack(spacing: 8) {
                Text("Your IPTV library, made for Apple").font(.title2.bold()).multilineTextAlignment(.center)
                Text("Add an Xtream Codes account or an M3U/M3U8 playlist to begin.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Button("Add Playlist", action: add).buttonStyle(.borderedProminent).controlSize(.large)
        }
        .padding(32)
    }
}
