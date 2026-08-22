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
    private var attemptGeneration = 0
    private var sawAudioOnlyCandidate = false
    private var statusObservation: NSKeyValueObservation?
    private var timeoutTask: Task<Void, Never>?
    private var validationTask: Task<Void, Never>?
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
        sawAudioOnlyCandidate = false
        playCandidate()
    }

    func play(_ item: MediaItem) {
        currentItem = item
        candidateIndex = 0
        sawAudioOnlyCandidate = false
        playCandidate()
    }

    func stop() {
        attemptGeneration += 1
        cancelAttempt()
        isConnecting = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func retry() {
        candidateIndex = 0
        sawAudioOnlyCandidate = false
        playCandidate()
    }

    private func playCandidate() {
        attemptGeneration += 1
        let generation = attemptGeneration
        cancelAttempt()
        errorMessage = nil

        guard currentItem.playbackURLs.indices.contains(candidateIndex),
              let url = URL(string: currentItem.playbackURLs[candidateIndex]),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            finishWithFailure(reason: nil)
            return
        }

        isConnecting = true
        let asset = AVURLAsset(url: url)
        let playerItem = AVPlayerItem(asset: asset)
        playerItem.preferredForwardBufferDuration = currentItem.kind == .live ? 2 : 8
        statusObservation = playerItem.observe(\.status, options: [.initial, .new]) { [weak self, weak playerItem] observedItem, _ in
            Task { @MainActor in
                guard let self, let playerItem, observedItem === playerItem,
                      self.attemptGeneration == generation,
                      self.player.currentItem === playerItem else { return }
                switch observedItem.status {
                case .readyToPlay:
                    self.validateVideoTrack(for: playerItem, generation: generation)
                case .failed:
                    self.fallback(reason: observedItem.error?.localizedDescription, generation: generation)
                case .unknown:
                    break
                @unknown default:
                    break
                }
            }
        }

        player.replaceCurrentItem(with: playerItem)
        player.play()

        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(currentItem.kind == .live ? 14 : 24))
            guard !Task.isCancelled else { return }
            self?.fallback(reason: "Connection timed out", generation: generation)
        }
    }

    private func validateVideoTrack(for playerItem: AVPlayerItem, generation: Int) {
        validationTask?.cancel()
        validationTask = Task { [weak self, weak playerItem] in
            guard let self, let playerItem else { return }
            do {
                let videoTracks = try await playerItem.asset.loadTracks(withMediaType: .video)
                guard !Task.isCancelled, self.attemptGeneration == generation,
                      self.player.currentItem === playerItem else { return }

                if !videoTracks.isEmpty || !self.requiresVideo {
                    self.timeoutTask?.cancel()
                    self.isConnecting = false
                } else {
                    self.sawAudioOnlyCandidate = true
                    self.fallback(reason: "The source returned audio without a video track.", generation: generation)
                }
            } catch {
                guard !Task.isCancelled else { return }
                self.fallback(reason: error.localizedDescription, generation: generation)
            }
        }
    }

    private var requiresVideo: Bool {
        guard currentItem.kind == .live else { return true }
        let value = "\(currentItem.name) \(currentItem.group)".folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: .current
        )
        let radioTerms = ["radio", " fm", "راديو", "اذاعة", "إذاعة"]
        return !radioTerms.contains(where: value.localizedCaseInsensitiveContains)
    }

    private func fallback(reason: String?, generation: Int) {
        guard attemptGeneration == generation else { return }
        candidateIndex += 1
        if currentItem.playbackURLs.indices.contains(candidateIndex) {
            playCandidate()
        } else {
            finishWithFailure(reason: reason)
        }
    }

    private func finishWithFailure(reason: String?) {
        cancelAttempt()
        isConnecting = false
        if sawAudioOnlyCandidate {
            errorMessage = "This channel returned audio only. Its video codec or stream format is not compatible with Apple playback."
        } else {
            errorMessage = reason ?? "This stream did not provide a supported HLS, MP4 or MOV video source."
        }
    }

    private func cancelAttempt() {
        timeoutTask?.cancel()
        validationTask?.cancel()
        timeoutTask = nil
        validationTask = nil
        statusObservation = nil
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
