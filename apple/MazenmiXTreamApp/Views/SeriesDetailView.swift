import MazenmiXTreamCore
import SwiftUI

struct SeriesDetailView: View {
    @EnvironmentObject private var model: AppModel
    let series: MediaItem
    @State private var seasons: [SeriesSeason] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                HStack(alignment: .top, spacing: 16) {
                    RemoteImage(url: series.logoURL).frame(width: 110, height: 165)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(series.name).font(.title3.bold())
                        Text(series.group).foregroundStyle(.secondary)
                        if !series.year.isEmpty { Label(series.year, systemImage: "calendar") }
                        if !series.rating.isEmpty { Label(series.rating, systemImage: "star.fill") }
                    }
                }
                .padding(.vertical, 8)
            }
            if isLoading {
                Section { HStack { Spacer(); ProgressView("Loading episodes…"); Spacer() }.padding() }
            } else if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            } else if seasons.isEmpty {
                Section { Text("No episodes were returned by this server.").foregroundStyle(.secondary) }
            } else {
                ForEach(seasons) { season in
                    Section("Season \(season.number)") {
                        ForEach(season.episodes) { episode in
                            Button { model.play(episode, in: season.episodes) } label: {
                                HStack {
                                    Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(MXTheme.red)
                                    Text(episode.name).foregroundStyle(.primary)
                                    Spacer()
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(series.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: series.id) {
            isLoading = true
            do { seasons = try await model.seasons(for: series) }
            catch { errorMessage = error.localizedDescription }
            isLoading = false
        }
    }
}
