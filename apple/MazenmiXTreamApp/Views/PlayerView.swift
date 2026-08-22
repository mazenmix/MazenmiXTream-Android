import AVKit
import MazenmiXTreamCore
import SwiftUI

struct PlayerScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel
    @StateObject private var playerModel: PlayerModel
    private let queue: [MediaItem]

    init(selection: PlayerSelection) {
        queue = selection.queue
        _playerModel = StateObject(wrappedValue: PlayerModel(item: selection.item))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerController(player: playerModel.player)
                .ignoresSafeArea()

            if playerModel.isConnecting {
                ProgressView("Opening stream…")
                    .padding(18)
                    .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 16))
            }

            if let error = playerModel.errorMessage {
                ContentUnavailableView {
                    Label("Stream could not start", systemImage: "exclamationmark.triangle.fill")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { playerModel.retry() }.buttonStyle(.borderedProminent)
                    Button("Back") { close() }.buttonStyle(.bordered)
                }
                .padding()
                .background(.black.opacity(0.86))
            }
        }
        .safeAreaInset(edge: .top) {
            HStack(spacing: 12) {
                Button(action: close) { Image(systemName: "xmark") }
                    .buttonStyle(PlayerCircleButtonStyle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(playerModel.currentItem.kind == .live ? "LIVE" : playerModel.currentItem.kind.rawValue.uppercased())
                        .font(.caption2.bold()).foregroundStyle(.red)
                    Text(playerModel.currentItem.name).font(.headline).lineLimit(1)
                }
                Spacer()
                if playerModel.currentItem.kind == .live {
                    Button(action: previous) { Image(systemName: "backward.end.fill") }
                        .buttonStyle(PlayerCircleButtonStyle())
                    Button(action: next) { Image(systemName: "forward.end.fill") }
                        .buttonStyle(PlayerCircleButtonStyle())
                }
                Button {
                    appModel.toggleFavorite(playerModel.currentItem)
                } label: {
                    Image(systemName: appModel.isFavorite(playerModel.currentItem) ? "heart.fill" : "heart")
                }
                .buttonStyle(PlayerCircleButtonStyle())
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.black.opacity(0.62))
        }
        .onAppear { playerModel.start() }
        .onDisappear { playerModel.stop() }
        .onChange(of: playerModel.endedToken) { _, _ in
            if playerModel.currentItem.kind != .live { next() }
        }
        .statusBarHidden()
    }

    private func close() {
        playerModel.stop()
        dismiss()
    }

    private func next() { switchChannel(offset: 1) }
    private func previous() { switchChannel(offset: -1) }

    private func switchChannel(offset: Int) {
        guard let index = queue.firstIndex(where: { $0.id == playerModel.currentItem.id }), !queue.isEmpty else { return }
        let nextIndex = (index + offset + queue.count) % queue.count
        let item = queue[nextIndex]
        guard !item.playbackURLs.isEmpty else { return }
        playerModel.play(item)
    }
}

private struct PlayerController: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.showsPlaybackControls = true
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.videoGravity = .resizeAspect
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        controller.player = player
    }
}

private struct PlayerCircleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(width: 38, height: 38)
            .background(.white.opacity(configuration.isPressed ? 0.28 : 0.16), in: Circle())
            .foregroundStyle(.white)
    }
}
