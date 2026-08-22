import MazenmiXTreamCore
import SwiftUI

struct LiveBrowserView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var countryID = "all"
    @State private var categoryID = "all"
    @State private var query = ""
    @State private var selectedItem: MediaItem?
    @State private var browseIndex = ChannelBrowseIndex(items: [])

    private var countryChannels: [MediaItem] {
        model.visibleLive.filter { item in
            countryID == "all" || browseIndex.countryIDByChannelID[item.id] == countryID
        }
    }

    private var availableCategories: [MediaCategory] {
        let categoryIDs = Set(countryChannels.map(\.categoryID))
        return model.catalog.liveCategories.filter { categoryIDs.contains($0.id) }
    }

    private var channels: [MediaItem] {
        countryChannels.filter { item in
            let matchesCategory = categoryID == "all"
                || item.categoryID == categoryID
                || item.group == categoryID
            let searchable = "\(item.name) \(item.group)"
            return matchesCategory && (query.isEmpty || searchable.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        Group {
            if sizeClass == .regular { regularLayout }
            else { compactLayout }
        }
        .background(MXTheme.background)
        .task(id: model.visibleLive.count) {
            let items = model.visibleLive
            browseIndex = await Task.detached(priority: .userInitiated) {
                ChannelBrowseIndex(items: items)
            }.value
            repairSelection()
        }
        .onChange(of: countryID) { _, _ in
            categoryID = "all"
            repairSelection()
        }
        .onChange(of: categoryID) { _, _ in repairSelection() }
        .onChange(of: query) { _, _ in repairSelection() }
        .onAppear { repairSelection() }
    }

    private var compactLayout: some View {
        VStack(spacing: 0) {
            compactFilters
            channelList(playOnTap: true)
        }
    }

    private var compactFilters: some View {
        VStack(spacing: 10) {
            SearchField(text: $query)
            FilterStrip(title: "Countries") {
                FilterChip(title: "All", detail: model.visibleLive.count, selected: countryID == "all") {
                    countryID = "all"
                }
                ForEach(browseIndex.countries) { country in
                    FilterChip(
                        title: "\(country.flag) \(country.name)",
                        detail: country.channelCount,
                        selected: countryID == country.id
                    ) { countryID = country.id }
                }
            }
            FilterStrip(title: "Categories") {
                FilterChip(title: "All", detail: countryChannels.count, selected: categoryID == "all") {
                    categoryID = "all"
                }
                ForEach(availableCategories) { category in
                    FilterChip(title: category.name, selected: categoryID == category.id) {
                        categoryID = category.id
                    }
                }
            }
            HStack {
                Text("\(channels.count) channels")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if countryID != "all" || categoryID != "all" || !query.isEmpty {
                    Button("Clear filters") {
                        countryID = "all"
                        categoryID = "all"
                        query = ""
                    }
                    .font(.caption.weight(.semibold))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(MXTheme.panel.opacity(0.96))
        .overlay(alignment: .bottom) { Divider().opacity(0.45) }
    }

    private var regularLayout: some View {
        HStack(spacing: 0) {
            filterSidebar
            Divider()
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    SearchField(text: $query)
                    Text("\(channels.count)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)
                        .frame(height: 38)
                        .background(MXTheme.panel, in: Capsule())
                }
                .padding(12)
                .background(MXTheme.background)
                Divider().opacity(0.45)
                channelList(playOnTap: false)
            }
            .frame(minWidth: 300, idealWidth: 350, maxWidth: 410)
            Divider()
            if let selectedItem {
                LiveChannelInspector(item: selectedItem, queue: channels)
            } else {
                ContentUnavailableView("No channels found", systemImage: "antenna.radiowaves.left.and.right")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var filterSidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SidebarSection(title: "COUNTRIES") {
                    SidebarFilterRow(title: "All countries", count: model.visibleLive.count, selected: countryID == "all") {
                        countryID = "all"
                    }
                    ForEach(browseIndex.countries) { country in
                        SidebarFilterRow(
                            title: "\(country.flag)  \(country.name)",
                            count: country.channelCount,
                            selected: countryID == country.id
                        ) { countryID = country.id }
                    }
                }
                SidebarSection(title: "CATEGORIES") {
                    SidebarFilterRow(title: "All categories", count: countryChannels.count, selected: categoryID == "all") {
                        categoryID = "all"
                    }
                    ForEach(availableCategories) { category in
                        SidebarFilterRow(title: category.name, selected: categoryID == category.id) {
                            categoryID = category.id
                        }
                    }
                }
            }
            .padding(14)
        }
        .frame(minWidth: 210, idealWidth: 235, maxWidth: 260)
        .background(MXTheme.panel.opacity(0.72))
    }

    private func channelList(playOnTap: Bool) -> some View {
        Group {
            if channels.isEmpty {
                ContentUnavailableView.search(text: query)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(channels) { item in
                    Button {
                        if playOnTap { model.play(item, in: channels) }
                        else { selectedItem = item }
                    } label: {
                        ChannelRow(
                            item: item,
                            favorite: model.isFavorite(item),
                            selected: !playOnTap && selectedItem?.id == item.id
                        )
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                    .listRowBackground(!playOnTap && selectedItem?.id == item.id ? MXTheme.red.opacity(0.13) : Color.clear)
                    .listRowSeparatorTint(.white.opacity(0.08))
                    .swipeActions(edge: .trailing) {
                        Button { model.toggleFavorite(item) } label: {
                            Label(model.isFavorite(item) ? "Remove favorite" : "Favorite", systemImage: model.isFavorite(item) ? "heart.slash" : "heart")
                        }
                        .tint(MXTheme.red)
                    }
                    .contextMenu {
                        Button { model.toggleFavorite(item) } label: {
                            Label(model.isFavorite(item) ? "Remove from Favorites" : "Add to Favorites", systemImage: "heart")
                        }
                        Button { model.play(item, in: channels) } label: { Label("Watch Live", systemImage: "play.fill") }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private func repairSelection() {
        if let selectedItem, channels.contains(where: { $0.id == selectedItem.id }) { return }
        selectedItem = channels.first
    }
}

private struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search channels", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(.white.opacity(0.075), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.07)) }
    }
}

private struct FilterStrip<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.caption2.bold()).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) { content }
            }
        }
    }
}

private struct FilterChip: View {
    let title: String
    var detail: Int?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title).lineLimit(1)
                if let detail { Text("\(detail)").font(.caption2).foregroundStyle(selected ? .white.opacity(0.8) : .secondary) }
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 11)
            .frame(height: 31)
            .foregroundStyle(selected ? .white : .primary)
            .background(selected ? MXTheme.red : .white.opacity(0.07), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct SidebarSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption2.bold()).foregroundStyle(.secondary).padding(.horizontal, 8)
            content
        }
    }
}

private struct SidebarFilterRow: View {
    let title: String
    var count: Int?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).font(.subheadline.weight(selected ? .semibold : .regular)).lineLimit(1)
                Spacer(minLength: 4)
                if let count { Text("\(count)").font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 10)
            .frame(height: 38)
            .background(selected ? MXTheme.red.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .leading) {
                if selected { Capsule().fill(MXTheme.red).frame(width: 3, height: 20).padding(.leading, 2) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ChannelRow: View {
    let item: MediaItem
    let favorite: Bool
    let selected: Bool

    var body: some View {
        HStack(spacing: 11) {
            RemoteImage(url: item.logoURL, cornerRadius: 9)
                .frame(width: 54, height: 42)
                .overlay { RoundedRectangle(cornerRadius: 9).stroke(.white.opacity(0.08)) }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(item.group).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if favorite { Image(systemName: "heart.fill").font(.caption).foregroundStyle(MXTheme.red) }
            Image(systemName: selected ? "play.circle.fill" : "play.circle")
                .font(.title3)
                .foregroundStyle(selected ? MXTheme.red : .secondary)
        }
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

private struct LiveChannelInspector: View {
    @EnvironmentObject private var model: AppModel
    let item: MediaItem
    let queue: [MediaItem]
    @State private var program: ProgramInfo?
    @State private var loadingProgram = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                RemoteImage(url: item.logoURL, cornerRadius: 16)
                    .frame(width: 190, height: 120)
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.08)) }
                    .padding(.top, 12)
                VStack(spacing: 5) {
                    Text(item.name).font(.title3.bold()).multilineTextAlignment(.center).lineLimit(2)
                    Text(item.group).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                HStack(spacing: 10) {
                    Button { model.play(item, in: queue) } label: { Label("Watch Live", systemImage: "play.fill") }
                        .buttonStyle(.borderedProminent)
                    Button { model.toggleFavorite(item) } label: {
                        Image(systemName: model.isFavorite(item) ? "heart.fill" : "heart")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(model.isFavorite(item) ? "Remove favorite" : "Add favorite")
                }
                .controlSize(.large)
                VStack(alignment: .leading, spacing: 7) {
                    Text("ON AIR NOW").font(.caption.bold()).foregroundStyle(MXTheme.red)
                    if loadingProgram { ProgressView() }
                    else {
                        Text(program?.title ?? "Program information is not available")
                            .font(.headline)
                        let schedule = [program?.start, program?.end].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " – ")
                        if !schedule.isEmpty { Text(schedule).font(.caption).foregroundStyle(.secondary) }
                        if let description = program?.description, !description.isEmpty {
                            Text(description).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(16)
                .background(MXTheme.panel, in: RoundedRectangle(cornerRadius: 16))
            }
            .frame(maxWidth: .infinity)
            .padding(22)
        }
        .task(id: item.id) {
            loadingProgram = true
            program = await model.currentProgram(for: item)
            loadingProgram = false
        }
    }
}
