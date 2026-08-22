import Foundation

public struct M3UParser: Sendable {
    public init() {}

    public func parse(_ text: String, sourceURL: URL) throws -> CatalogResponse {
        guard text.contains("#EXTM3U") else { throw MazenCoreError.invalidPlaylist }

        var live: [MediaItem] = []
        var movies: [MediaItem] = []
        var series: [MediaItem] = []
        var pending: Entry?

        for rawLine in text.replacingOccurrences(of: "\r", with: "").split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }

            if line.hasPrefix("#EXTINF") {
                pending = Entry(extinf: line)
                continue
            }
            if line.hasPrefix("#EXTVLCOPT:"), pending != nil {
                let option = String(line.dropFirst(11))
                let parts = option.split(separator: "=", maxSplits: 1).map(String.init)
                guard parts.count == 2 else { continue }
                let key = parts[0].lowercased()
                if key == "http-user-agent" { pending?.headers["User-Agent"] = parts[1] }
                if key == "http-referrer" || key == "http-referer" { pending?.headers["Referer"] = parts[1] }
                if key == "http-origin" { pending?.headers["Origin"] = parts[1] }
                continue
            }
            if line.hasPrefix("#EXTHTTP:"), pending != nil,
               let data = String(line.dropFirst(9)).data(using: .utf8),
               let headers = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                for (key, value) in headers { pending?.headers[key] = String(describing: value) }
                continue
            }
            guard !line.hasPrefix("#"), let entry = pending else { continue }

            let resolvedURL = URL(string: line, relativeTo: sourceURL)?.absoluteURL.absoluteString ?? line
            let group = entry.attributes["group-title"].nonEmpty ?? "Other"
            let name = entry.name.nonEmpty ?? entry.attributes["tvg-name"].nonEmpty ?? "Untitled"
            let hint = "\(entry.attributes["type"] ?? "") \(group) \(line)".lowercased()
            let kind: MediaKind = hint.range(of: "series|episode|season", options: .regularExpression) != nil
                ? .series
                : hint.range(of: "movie|vod|film|cinema", options: .regularExpression) != nil ? .movie : .live
            let item = MediaItem(
                id: "m3u-\(stableHash(resolvedURL))",
                name: name,
                group: group,
                categoryID: group,
                kind: kind,
                logoURL: entry.attributes["tvg-logo"] ?? "",
                playbackURLs: [resolvedURL],
                epgID: entry.attributes["tvg-id"] ?? "",
                isAdult: ContentFilter.isAdult("\(name) \(group)"),
                headers: entry.headers
            )
            switch kind {
            case .live: live.append(item)
            case .movie: movies.append(item)
            case .series, .episode: series.append(item)
            }
            pending = nil
        }

        if live.isEmpty && movies.isEmpty && series.isEmpty {
            live = [MediaItem(
                id: "single-\(stableHash(sourceURL.absoluteString))",
                name: "Live Stream",
                group: "Direct stream",
                categoryID: "Direct stream",
                kind: .live,
                playbackURLs: [sourceURL.absoluteString]
            )]
        }

        return CatalogResponse(catalog: Catalog(
            live: live,
            movies: movies,
            series: series,
            liveCategories: categories(for: live),
            movieCategories: categories(for: movies),
            seriesCategories: categories(for: series)
        ))
    }

    private func categories(for items: [MediaItem]) -> [MediaCategory] {
        Set(items.map(\.group))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            .map { MediaCategory(id: $0, name: $0) }
    }

    private func stableHash(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 36)
    }
}

private struct Entry {
    var attributes: [String: String]
    var headers: [String: String] = [:]
    var name: String

    init(extinf: String) {
        var values: [String: String] = [:]
        if let regex = try? NSRegularExpression(pattern: #"([\w-]+)="([^"]*)""#) {
            let range = NSRange(extinf.startIndex..<extinf.endIndex, in: extinf)
            for match in regex.matches(in: extinf, range: range) {
                guard let keyRange = Range(match.range(at: 1), in: extinf),
                      let valueRange = Range(match.range(at: 2), in: extinf) else { continue }
                values[String(extinf[keyRange]).lowercased()] = String(extinf[valueRange])
            }
        }
        attributes = values
        name = extinf.firstIndex(of: ",").map { String(extinf[extinf.index(after: $0)...]).trimmingCharacters(in: .whitespaces) } ?? ""
    }
}

private extension Optional where Wrapped == String {
    var nonEmpty: String? {
        guard let self, !self.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return self
    }
}
