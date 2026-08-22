import MazenmiXTreamCore
import SwiftUI

struct MediaLibraryView: View {
    @EnvironmentObject private var model: AppModel
    let title: String
    let items: [MediaItem]
    let categories: [MediaCategory]
    @State private var query = ""
    @State private var categoryID = "all"

    private var filteredItems: [MediaItem] {
        items.filter { item in
            (categoryID == "all" || item.categoryID == categoryID || item.group == categoryID)
                && (query.isEmpty || "\(item.name) \(item.group)".localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        ScrollView {
            if filteredItems.isEmpty {
                ContentUnavailableView("No \(title.lowercased())", systemImage: "rectangle.stack.badge.minus", description: Text(query.isEmpty ? "This playlist has no matching content." : "Try another search."))
                    .padding(.top, 80)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132, maximum: 190), spacing: 16)], spacing: 20) {
                    ForEach(filteredItems) { item in
                        Group {
                            if item.kind == .series && !item.seriesID.isEmpty {
                                NavigationLink { SeriesDetailView(series: item) } label: { MediaCardLabel(item: item, favorite: model.isFavorite(item)) }
                            } else {
                                Button { model.play(item, in: filteredItems) } label: { MediaCardLabel(item: item, favorite: model.isFavorite(item)) }
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                model.toggleFavorite(item)
                            } label: {
                                Label(model.isFavorite(item) ? "Remove Favorite" : "Add Favorite", systemImage: model.isFavorite(item) ? "heart.slash" : "heart")
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .background(MXTheme.background)
        .searchable(text: $query, prompt: "Search \(title.lowercased())")
        .toolbar {
            if !categories.isEmpty {
                ToolbarItem(placement: .secondaryAction) {
                    Menu {
                        Button("All categories") { categoryID = "all" }
                        ForEach(categories) { category in Button(category.name) { categoryID = category.id } }
                    } label: {
                        Label(selectedCategoryName, systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
        }
    }

    private var selectedCategoryName: String {
        categoryID == "all" ? "All" : categories.first(where: { $0.id == categoryID })?.name ?? "Category"
    }
}
