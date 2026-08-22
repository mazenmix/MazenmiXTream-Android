import AVFoundation
import Combine
import Foundation
import MazenmiXTreamCore

enum PlaybackEngine {
    case apple
    case vlc
}

@MainActor
final class PlayerModel: ObservableObject {
    let player = AVPlayer()
    @Published private(set) var currentItem: MediaItem
    @Published private(set) var engine: PlaybackEngine = .apple
    @Published private(set) var vlcURLs: [URL] = []
    @Published private(set) var vlcSessionID = UUID()
    @Published private(set) var vlcShouldPlay = true
    @Published private(set) var isConnecting = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var endedToken = 0

    private var candidateIndex = 0
    private var attemptGeneration = 0
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
        startCurrentItem()
    }

    func play(_ item: MediaItem) {
        currentItem = item
        startCurrentItem()
    }

    func stop() {
        attemptGeneration += 1
        cancelAppleAttempt()
        vlcURLs = []
        vlcSessionID = UUID()
        isConnecting = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func retry() {
        startCurrentItem()
    }

    func toggleVLCPlayback() {
        guard engine == .vlc else { return }
        vlcShouldPlay.toggle()
    }

    func vlcDidStart() {
        guard engine == .vlc else { return }
        isConnecting = false
        errorMessage = nil
        vlcShouldPlay = true
    }

    func vlcDidFail(_ reason: String) {
        guard engine == .vlc else { return }
        isConnecting = false
        errorMessage = reason
    }

    private func startCurrentItem() {
        candidateIndex = 0
        errorMessage = nil
        if currentItem.kind == .live {
            activateVLC()
        } else {
            engine = .apple
            vlcURLs = []
            playAppleCandidate()
        }
    }

    private func activateVLC() {
        attemptGeneration += 1
        cancelAppleAttempt()
        player.pause()
        player.replaceCurrentItem(with: nil)

        let urls = currentItem.playbackURLs.compactMap { value -> URL? in
            guard let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
            return url
        }
        guard !urls.isEmpty else {
            engine = .vlc
            isConnecting = false
            errorMessage = "This channel did not provide a valid stream address."
            return
        }

        engine = .vlc
        vlcURLs = urls
        vlcShouldPlay = true
        vlcSessionID = UUID()
        isConnecting = true
        errorMessage = nil
    }

    private func playAppleCandidate() {
        attemptGeneration += 1
        let generation = attemptGeneration
        cancelAppleAttempt()
        errorMessage = nil

        guard currentItem.playbackURLs.indices.contains(candidateIndex),
              let url = URL(string: currentItem.playbackURLs[candidateIndex]),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            activateVLC()
            return
        }

        isConnecting = true
        let asset = AVURLAsset(url: url)
        let playerItem = AVPlayerItem(asset: asset)
        playerItem.preferredForwardBufferDuration = 8
        statusObservation = playerItem.observe(\.status, options: [.initial, .new]) { [weak self, weak playerItem] observedItem, _ in
            Task { @MainActor in
                guard let self, let playerItem, observedItem === playerItem,
                      self.attemptGeneration == generation,
                      self.player.currentItem === playerItem else { return }
                switch observedItem.status {
                case .readyToPlay:
                    self.validateVideoTrack(for: playerItem, generation: generation)
                case .failed:
                    self.fallbackFromApple(generation: generation)
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
            try? await Task.sleep(for: .seconds(24))
            guard !Task.isCancelled else { return }
            self?.fallbackFromApple(generation: generation)
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
                if videoTracks.isEmpty {
                    self.fallbackFromApple(generation: generation)
                } else {
                    self.timeoutTask?.cancel()
                    self.isConnecting = false
                }
            } catch {
                guard !Task.isCancelled else { return }
                self.fallbackFromApple(generation: generation)
            }
        }
    }

    private func fallbackFromApple(generation: Int) {
        guard attemptGeneration == generation else { return }
        candidateIndex += 1
        if currentItem.playbackURLs.indices.contains(candidateIndex) {
            playAppleCandidate()
        } else {
            activateVLC()
        }
    }

    private func cancelAppleAttempt() {
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
