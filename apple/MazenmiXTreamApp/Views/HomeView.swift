import MazenmiXTreamCore
import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 26) {
                accountHeader
                ViewThatFits {
                    HStack(spacing: 12) { statCards }
                    VStack(spacing: 12) { statCards }
                }
                if !model.visibleLive.isEmpty {
                    MediaRail(title: "Live now", items: Array(model.visibleLive.prefix(12)))
                }
                if !model.visibleMovies.isEmpty {
                    MediaRail(title: "Movies", items: Array(model.visibleMovies.prefix(12)))
                }
                if !model.visibleSeries.isEmpty {
                    MediaRail(title: "Series", items: Array(model.visibleSeries.prefix(12)))
                }
            }
            .padding()
        }
        .background(MXTheme.background)
    }

    private var accountHeader: some View {
        HStack(spacing: 14) {
            Image(systemName: "checkmark.shield.fill").font(.title2).foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.activeSource?.name ?? "Playlist").font(.title3.bold())
                Text(model.serverInfo?.status.isEmpty == false ? "Account \(model.serverInfo?.status ?? "")" : "M3U playlist ready")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(18).background(MXTheme.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder
    private var statCards: some View {
        StatCard(title: "Live", value: model.visibleLive.count, symbol: "dot.radiowaves.left.and.right")
        StatCard(title: "Movies", value: model.visibleMovies.count, symbol: "play.rectangle.fill")
        StatCard(title: "Series", value: model.visibleSeries.count, symbol: "rectangle.stack.fill")
    }
}

private struct StatCard: View {
    let title: String
    let value: Int
    let symbol: String

    var body: some View {
        HStack {
            Image(systemName: symbol).foregroundStyle(MXTheme.red)
            VStack(alignment: .leading) {
                Text(value.formatted()).font(.title3.bold())
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16).frame(maxWidth: .infinity).background(MXTheme.panel, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct MediaRail: View {
    @EnvironmentObject private var model: AppModel
    let title: String
    let items: [MediaItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(items) { item in
                        Group {
                            if item.kind == .series && !item.seriesID.isEmpty {
                                NavigationLink { SeriesDetailView(series: item) } label: { MediaCardLabel(item: item, favorite: model.isFavorite(item)) }
                            } else {
                                Button { model.play(item, in: items) } label: { MediaCardLabel(item: item, favorite: model.isFavorite(item)) }
                            }
                        }
                        .buttonStyle(.plain)
                        .frame(width: item.kind == .live ? 190 : 132)
                    }
                }
            }
        }
    }
}
