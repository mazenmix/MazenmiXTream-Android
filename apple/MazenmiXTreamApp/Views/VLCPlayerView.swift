import MobileVLCKit
import SwiftUI
import UIKit

struct VLCPlayerView: UIViewRepresentable {
    let urls: [URL]
    let shouldPlay: Bool
    let onStarted: () -> Void
    let onFailed: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(urls: urls, onStarted: onStarted, onFailed: onFailed)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .black
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.setPlaying(shouldPlay)
    }

    static func dismantleUIView(_ view: UIView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class Coordinator: NSObject, VLCMediaPlayerDelegate {
        private let urls: [URL]
        private let mediaPlayer = VLCMediaPlayer()
        private let onStarted: () -> Void
        private let onFailed: (String) -> Void
        private var candidateIndex = 0
        private var timeoutWorkItem: DispatchWorkItem?
        private var hasStarted = false

        init(urls: [URL], onStarted: @escaping () -> Void, onFailed: @escaping (String) -> Void) {
            self.urls = urls
            self.onStarted = onStarted
            self.onFailed = onFailed
            super.init()
            mediaPlayer.delegate = self
        }

        func attach(to view: UIView) {
            mediaPlayer.drawable = view
            playCurrentCandidate()
        }

        func setPlaying(_ shouldPlay: Bool) {
            guard hasStarted else { return }
            if shouldPlay, !mediaPlayer.isPlaying { mediaPlayer.play() }
            if !shouldPlay, mediaPlayer.isPlaying { mediaPlayer.pause() }
        }

        func stop() {
            timeoutWorkItem?.cancel()
            timeoutWorkItem = nil
            mediaPlayer.stop()
            mediaPlayer.delegate = nil
            mediaPlayer.drawable = nil
        }

        func mediaPlayerStateChanged(_ notification: Notification!) {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch self.mediaPlayer.state {
                case .playing:
                    self.hasStarted = true
                    self.timeoutWorkItem?.cancel()
                    self.onStarted()
                case .error, .ended:
                    self.advanceCandidate()
                default:
                    break
                }
            }
        }

        private func playCurrentCandidate() {
            guard urls.indices.contains(candidateIndex) else {
                onFailed("The channel could not start with either the Apple or VLC video engine.")
                return
            }

            hasStarted = false
            let media = VLCMedia(url: urls[candidateIndex])
            media.addOption(":network-caching=1200")
            media.addOption(":http-reconnect=true")
            media.addOption(":clock-jitter=0")
            mediaPlayer.media = media
            mediaPlayer.play()
            scheduleTimeout()
        }

        private func advanceCandidate() {
            timeoutWorkItem?.cancel()
            mediaPlayer.stop()
            hasStarted = false
            candidateIndex += 1
            playCurrentCandidate()
        }

        private func scheduleTimeout() {
            timeoutWorkItem?.cancel()
            let workItem = DispatchWorkItem { [weak self] in
                self?.advanceCandidate()
            }
            timeoutWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 18, execute: workItem)
        }
    }
}
