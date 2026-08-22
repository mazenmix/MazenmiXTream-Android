import MazenmiXTreamCore
import SwiftUI

enum MXTheme {
    static let background = Color(red: 0.03, green: 0.035, blue: 0.05)
    static let panel = Color(red: 0.075, green: 0.08, blue: 0.11)
    static let red = Color(red: 0.93, green: 0.15, blue: 0.19)
}

struct MXBrand: View {
    var compact = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: compact ? 9 : 12)
                    .fill(MXTheme.red.gradient)
                Text("MX").font(compact ? .caption.bold() : .headline.bold()).foregroundStyle(.white)
            }
            .frame(width: compact ? 34 : 44, height: compact ? 34 : 44)
            Text("Mazenmi") + Text("XTream").foregroundColor(MXTheme.red)
        }
        .font(compact ? .headline.bold() : .title3.bold())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MazenmiXTream")
    }
}

struct RemoteImage: View {
    let url: String
    var cornerRadius: CGFloat = 12

    var body: some View {
        AsyncImage(url: URL(string: url)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            default:
                ZStack {
                    LinearGradient(colors: [MXTheme.panel, .black], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "play.rectangle.fill").font(.title).foregroundStyle(.white.opacity(0.28))
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

struct MediaCardLabel: View {
    let item: MediaItem
    var favorite = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ZStack(alignment: .topTrailing) {
                RemoteImage(url: item.logoURL)
                    .aspectRatio(item.kind == .live ? 16 / 10 : 2 / 3, contentMode: .fit)
                if favorite {
                    Image(systemName: "heart.fill")
                        .font(.caption).padding(7).background(.black.opacity(0.65), in: Circle())
                        .foregroundStyle(MXTheme.red).padding(7)
                }
            }
            Text(item.name).font(.subheadline.weight(.semibold)).lineLimit(2).foregroundStyle(.primary)
            Text(item.group).font(.caption).lineLimit(1).foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }
}

struct LoadingOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.42).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().controlSize(.large)
                Text("Loading your library…").font(.headline)
            }
            .padding(28)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
        }
    }
}
