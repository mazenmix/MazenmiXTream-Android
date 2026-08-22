# MazenmiXTream for iPhone and iPad

This is the native SwiftUI edition of MazenmiXTream for iOS and iPadOS 17 or later. It does not wrap the Android web interface.

## Features

- Responsive iPhone tab navigation and iPad split-view navigation
- Xtream Codes authentication, account details, Live TV, VOD, Series and episodes
- M3U/M3U8 parsing, including relative URLs, group metadata and saved request-header metadata
- Current-program EPG through `get_short_epg`
- Native AVPlayer/AVKit playback, Picture in Picture and AirPlay
- Live next/previous channel controls with ordered URL fallback
- Favorites, search, categories and an adult-content filter enabled by default
- Catalog cache in Application Support
- Xtream username and password stored in Keychain with this-device-only accessibility
- No analytics or advertising SDK

## Generate and open the project

Requirements:

- macOS with a current Xcode release
- XcodeGen (`brew install xcodegen`)

```bash
cd apple
xcodegen generate
open MazenmiXTream.xcodeproj
```

Choose the `MazenmiXTream` scheme and run it on an iPhone or iPad simulator. The app target supports both device families from one source tree.

The pure Foundation core is also a Swift package:

```bash
cd apple
swift test
```

## Build without signing

```bash
cd apple
xcodegen generate
xcodebuild \
  -project MazenmiXTream.xcodeproj \
  -scheme MazenmiXTream \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Physical device, archive and distribution

1. Open the generated project in Xcode.
2. Select the app target, then **Signing & Capabilities**.
3. Choose your Apple Development Team and change `com.mazenmix.xtream.ios` if the Bundle ID is not available to that team.
4. Connect and trust the authorized iPhone or iPad, select it as the run destination and press Run.
5. For distribution, select **Any iOS Device**, then use **Product → Archive** and Organizer's **Distribute App** workflow.

A signed IPA cannot be generated without the intended team's certificate and provisioning profile. Keep automatic signing enabled unless the release workflow specifically requires manual profiles.

## Unsigned IPA for MX Loader or another authorized signer

On macOS, generate an arm64 iPhoneOS IPA that is intentionally left unsigned:

```bash
bash apple/scripts/build-unsigned-ipa.sh
```

The output is `apple/release/MazenmiXTream-iOS-v1.0.0-unsigned.ipa`. Before installation, MX Loader, Xcode or another authorized signing workflow must apply a valid certificate, provisioning profile and matching entitlements for the target device.

## Playback compatibility

AVPlayer is strongest with HLS (`.m3u8`), MP4/M4V and MOV using Apple-supported codecs. The loader prefers an Xtream HLS URL when the account reports it and falls back through the server's reported URLs. Standalone MPEG-TS, MKV, AVI, WebM or unsupported audio/video codecs may fail even when the URL itself is valid.

The M3U parser preserves `#EXTVLCOPT` and `#EXTHTTP` header metadata, but the app intentionally does not use undocumented AVPlayer header-injection keys. Streams that require arbitrary custom playback headers need a separately reviewed, public-API-compatible playback transport.

## HTTP IPTV servers and App Review

Many IPTV servers still use plain HTTP and their hostnames are entered by the user at runtime, so the generated Info.plist enables broad App Transport Security access. This is necessary for compatibility but requires a clear App Review justification. If every supported provider uses HTTPS, remove `NSAllowsArbitraryLoads` from `project.yml` before release.

Only use playlists and streams you are authorized to access.
