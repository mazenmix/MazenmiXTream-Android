import MazenmiXTreamCore
import SwiftUI

struct LiveBrowserView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var categoryID = "all"
    @State private var query = ""
    @State private var selectedItem: MediaItem?

    private var channels: [MediaItem] {
        model.visibleLive.filter {
            (categoryID == "all" || $0.categoryID == categoryID || $0.group == categoryID)
                && (query.isEmpty || "\($0.name) \($0.group)".localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        Group {
            if sizeClass == .regular { regularLayout }
            else { compactLayout }
        }
        .background(MXTheme.background)
        .searchable(text: $query, prompt: "Search channels")
        .onChange(of: categoryID) { _, _ in selectedItem = channels.first }
        .onAppear { if selectedItem == nil { selectedItem = channels.first } }
    }

    private var regularLayout: some View {
        HStack(spacing: 0) {
            List {
                categoryButton(id: "all", name: "All Channels")
                ForEach(model.catalog.liveCategories) { category in categoryButton(id: category.id, name: category.name) }
            }
            .listStyle(.sidebar)
            .frame(minWidth: 180, idealWidth: 210, maxWidth: 240)

            List(channels, selection: $selectedItem) { item in
                ChannelRow(item: item, favorite: model.isFavorite(item)).tag(item)
            }
            .listStyle(.plain)
            .frame(minWidth: 280, idealWidth: 330, maxWidth: 390)

            Divider()
            if let selectedItem {
                LiveChannelDetail(item: selectedItem, queue: channels)
            } else {
                ContentUnavailableView("No channels", systemImage: "antenna.radiowaves.left.and.right")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var compactLayout: some View {
        List {
            Section {
                Menu {
                    Button("All Channels") { categoryID = "all" }
                    ForEach(model.catalog.liveCategories) { category in Button(category.name) { categoryID = category.id } }
                } label: {
                    Label(selectedCategoryName, systemImage: "line.3.horizontal.decrease.circle")
                }
            }
            Section {
                ForEach(channels) { item in
                    NavigationLink { LiveChannelDetail(item: item, queue: channels) } label: {
                        ChannelRow(item: item, favorite: model.isFavorite(item))
                    }
                    .swipeActions(edge: .trailing) {
                        Button { model.toggleFavorite(item) } label: { Label("Favorite", systemImage: "heart") }.tint(MXTheme.red)
                    }
                }
            }
        }
        .listStyle(.plain)
    }

    private var selectedCategoryName: String {
        categoryID == "all" ? "All Channels" : model.catalog.liveCategories.first(where: { $0.id == categoryID })?.name ?? "Category"
    }

    private func categoryButton(id: String, name: String) -> some View {
        Button {
            categoryID = id
        } label: {
            HStack {
                Text(name)
                Spacer()
                if categoryID == id { Image(systemName: "checkmark").foregroundStyle(MXTheme.red) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(categoryID == id ? MXTheme.red.opacity(0.16) : Color.clear)
    }
}

private struct ChannelRow: View {
    let item: MediaItem
    let favorite: Bool

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: item.logoURL, cornerRadius: 9).frame(width: 58, height: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(item.group).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if favorite { Image(systemName: "heart.fill").font(.caption).foregroundStyle(MXTheme.red) }
        }
        .padding(.vertical, 3)
    }
}

struct LiveChannelDetail: View {
    @EnvironmentObject private var model: AppModel
    let item: MediaItem
    let queue: [MediaItem]
    @State private var program: ProgramInfo?
    @State private var loadingProgram = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                RemoteImage(url: item.logoURL, cornerRadius: 18)
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .frame(maxWidth: 520)
                VStack(spacing: 7) {
                    Text(item.name).font(.title2.bold()).multilineTextAlignment(.center)
                    Text(item.group).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("ON AIR NOW").font(.caption.bold()).foregroundStyle(MXTheme.red)
                    if loadingProgram { ProgressView() }
                    else {
                        Text(program?.title ?? "Program information is not available").font(.headline)
                        Text([program?.start, program?.end].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " – "))
                            .font(.caption).foregroundStyle(.secondary)
                        if let description = program?.description, !description.isEmpty { Text(description).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(16).background(MXTheme.panel, in: RoundedRectangle(cornerRadius: 16))

                HStack {
                    Button { model.play(item, in: queue) } label: { Label("Watch Live", systemImage: "play.fill") }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    Button { model.toggleFavorite(item) } label: {
                        Label(model.isFavorite(item) ? "Saved" : "Favorite", systemImage: model.isFavorite(item) ? "heart.fill" : "heart")
                    }
                    .buttonStyle(.bordered).controlSize(.large)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(24)
        }
        .navigationTitle(item.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: item.id) {
            loadingProgram = true
            program = await model.currentProgram(for: item)
            loadingProgram = false
        }
    }
}
