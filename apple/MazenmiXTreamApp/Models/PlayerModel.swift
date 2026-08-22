import AVFoundation
import Combine
import Foundation
import MazenmiXTreamCore

@MainActor
final class PlayerModel: ObservableObject {
    let player = AVPlayer()
    @Published private(set) var currentItem: MediaItem
    @Published private(set) var isConnecting = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var endedToken = 0

    private var candidateIndex = 0
    private var statusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var timeoutTask: Task<Void, Never>?
    private var endObserver: NSObjectProtocol?

    init(item: MediaItem) {
        currentItem = item
        player.automaticallyWaitsToMinimizeStalling = true
        player.allowsExternalPlayback = true
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self, notification.object as? AVPlayerItem === self.player.currentItem else { return }
            Task { @MainActor in self.endedToken += 1 }
        }
    }

    deinit {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }

    func start() {
        configureAudioSession()
        candidateIndex = 0
        playCandidate()
    }

    func play(_ item: MediaItem) {
        currentItem = item
        candidateIndex = 0
        playCandidate()
    }

    func stop() {
        timeoutTask?.cancel()
        statusObservation = nil
        timeControlObservation = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func retry() {
        candidateIndex = 0
        playCandidate()
    }

    private func playCandidate() {
        timeoutTask?.cancel()
        statusObservation = nil
        timeControlObservation = nil
        errorMessage = nil

        guard currentItem.playbackURLs.indices.contains(candidateIndex),
              let url = URL(string: currentItem.playbackURLs[candidateIndex]),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            errorMessage = "This stream did not provide a format supported by AVPlayer. HLS, MP4 and MOV are recommended."
            isConnecting = false
            return
        }

        isConnecting = true
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = currentItem.kind == .live ? 2 : 8
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor in self?.fallback(reason: item.error?.localizedDescription) }
        }
        timeControlObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            guard player.timeControlStatus == .playing else { return }
            Task { @MainActor in
                self?.timeoutTask?.cancel()
                self?.isConnecting = false
            }
        }
        player.replaceCurrentItem(with: item)
        player.play()

        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(currentItem.kind == .live ? 14 : 24))
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.fallback(reason: "Connection timed out") }
        }
    }

    private func fallback(reason: String?) {
        guard isConnecting else { return }
        candidateIndex += 1
        if currentItem.playbackURLs.indices.contains(candidateIndex) {
            playCandidate()
        } else {
            isConnecting = false
            errorMessage = reason ?? "The stream could not start."
        }
    }

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
