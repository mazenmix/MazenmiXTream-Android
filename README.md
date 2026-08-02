# MazenmiXTream 1.1.6

MazenmiXTream is a lightweight MX IPTV player for Android phones, tablets, Android TV, Google TV, supported TCL/Hisense Android TVs, Xiaomi TV Box and Chromecast with Google TV.

## Compatibility

- Minimum Android version: Android 5.0 / API 21
- Target Android version: Android 14 / API 34
- MX APK: one package for supported Android phones, tablets and Android/Google TV devices
- A persistent Android Media3 ExoPlayer engine keeps high-bitrate HLS/TS work outside the WebView so the interface stays responsive
- Phone, tablet, TV and D-pad responsive layouts
- Touchscreen is optional, so Android TV installation is not blocked
- Both standard Android launcher and Leanback TV launcher are included
- Cleartext HTTP is enabled for legacy IPTV servers
- Native Android networking proxy bypasses device-specific WebView CORS failures
- Interrupted and slow playlist requests retry through native and direct Android routes
- Xtream channels, movies and series download sequentially to avoid low-memory freezes
- Native API downloads allow transparent gzip compression instead of forcing oversized responses
- Complete channel/movie/series library is cached locally in small chunks after the first server load
- Large libraries render incrementally to prevent phone UI hangs
- Xtream playback uses `direct_source`, the stream host and only the output formats reported by the account instead of inventing HLS links
- MPEG-TS compatibility flags handle feeds that omit AUD or IDR frame markers instead of remaining stuck in buffering
- Cross-protocol redirects, custom M3U request headers and bounded internal network retries are handled by the native engine
- Live rebuffering stays inside one playback session instead of destroying the player and opening repeated fallback sessions
- Fast-Zap keeps the Media3 decoder warm while changing channels, uses a short startup buffer and prioritizes the server's native TS route when the account allows it
- Landscape TV mode uses a fast three-pane category, channel and live-preview browser
- The preview window exposes the native video surface correctly, retries one verified alternate URL, and never remains indefinitely on “Opening live preview”
- A playing preview is promoted directly to fullscreen without opening a second server connection
- The Android APK uses one Media3 engine for HLS, MPEG-TS and progressive video; browser engines remain available for desktop development
- M3U VLC/HTTP user-agent, referrer and origin headers are forwarded to native and worker playback
- Home is a channels-only screen without promotional welcome or movie sections
- One channel click selects and previews; a second click opens fullscreen
- Category and channel focus/scroll positions are retained when moving between the left and center panes
- Catalog and logo loading states use visible animated progress indicators

## Included features

- Unlimited Xtream Codes and M3U/M3U8 playlists, limited only by device storage
- Xtream server status, expiry date, connections and timezone
- Live TV, movie, series, season and episode libraries
- Native Media3 HLS, MPEG-TS and progressive playback with low-latency startup buffering
- Glass-style fullscreen controls with play/pause, seek, aspect ratio, favorites, lock and volume
- Channel arrows are hidden during normal viewing and appear only as brief feedback after a switch
- Fullscreen channel changes show a five-channel horizontal strip and hide it as soon as the new channel renders
- Touch gestures: right side for volume, left side for video brightness, horizontal movie seeking and horizontal live-channel switching
- TV Channel Up/Down and media next/previous keys switch channels directly
- Android/TV Back button handling that destroys the old playback session cleanly
- Search, categories and favorites
- Current-program EPG lookup when the Xtream server supplies it
- Adult-content filter enabled by default
- Four-digit parental PIN
- Embedded/sidecar VTT and SRT subtitles
- Optional OpenSubtitles lookup using the user's own API key
- Arabic and English subtitle-language preference
- Dark MazenmiXTream branding with red XTream treatment

## Subtitle behavior

The app displays embedded subtitle tracks, playlist sidecar tracks, manually supplied VTT/SRT URLs, and OpenSubtitles results when an API key is configured. Generating or translating speech from every live channel requires a separate real-time speech-to-text service; the app does not pretend a track exists when the stream supplies none.

## Build from source

Requirements: Node.js 18+ and Java 17+.

```bash
npm install
npm run build
# Optional separately installable HamzaXTream variant
npm run build:hamza
```

The installable APK is created at `dist/app.apk`. `build:hamza` uses the separate `com.hamzaxtream.mx` package and HamzaXTream branding while keeping the same features. The build performs static checks, phone UI-flow tests, landscape TV preview/debounce tests, packaged-bundle tests, Android resource compilation, native Java compilation, DEX generation and APK signing.

## Privacy

Playlist credentials, settings, favorites and parental controls are stored locally on the Android device. No analytics or advertising SDK is included.
