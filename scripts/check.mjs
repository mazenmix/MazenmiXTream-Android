import fs from "node:fs";

const required = ["index.html", "style.css", "main.js", "app.js", "assets/icon.png", "vendor/polyfills.js", "vendor/brand.js", "vendor/hls.min.js", "vendor/mpegts.js", "vendor/client.js"];
const missing = required.filter((file) => !fs.existsSync(file));
if (missing.length) throw new Error(`Missing build assets: ${missing.join(", ")}`);

const html = fs.readFileSync("index.html", "utf8");
for (const id of ["app", "content", "playerScreen", "video", "modalRoot", "toast", "playerFavoriteBtn", "playerLockBtn", "playerErrorBack", "channelSwitchFeedback", "channelSwitchRail"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required DOM node: ${id}`);
}
if (html.includes("Universal")) throw new Error("User-facing build label must be MX, not Universal");

const js = fs.readFileSync("main.js", "utf8");
new Function(js);
new Function(fs.readFileSync("vendor/client.js", "utf8"));
if (js.includes("Everything you love")) throw new Error("Removed welcome hero is still present in Home");
for (const marker of ["takeLivePreviewForFullscreen", "streamUrlCandidates", "directSource", "allowed_output_formats", "stream_base", "PLAYBACK_SCHEMA", "playAndroidStream", "enableWorker: true", "isDoubleLiveClick", "Double-click or double-tap", "requestWithRecovery", "CATALOG_TIMEOUT", "CACHE_CHUNK_SIZE", "showChannelSwitchFeedback", "channelSwitchRailHtml", "keepWarmNativePlayer", "liveScrollContextKey", "rememberLiveBrowserPosition", "channel-thumbnail-loader"]) {
  if (!js.includes(marker)) throw new Error(`Stream recovery implementation is missing: ${marker}`);
}
if (js.includes("safe HLS fallback") || js.includes("Starting safe HLS")) throw new Error("Obsolete visible HLS fallback loop is still present");
if (/replace\(\/\\\.ts[^\n]+m3u8/.test(js)) throw new Error("Xtream TS links must never be blindly rewritten as HLS");
if (/Promise\.all\(\s*\[\s*safeRequest\(xtreamUrl/.test(js)) throw new Error("Large Xtream catalog endpoints must not load concurrently");
const nativeSource = fs.readFileSync("native/com/nicron/webview/MainActivity.java", "utf8");
for (const marker of ["NativePlayerBridge", "TextureView", "ExoPlayer", "HlsMediaSource", "ProgressiveMediaSource", "DefaultLoadControl", "DefaultRenderersFactory", "setEnableDecoderFallback", "setBufferDurationsMs(2500, 18000, 250, 750)", "FLAG_DETECT_ACCESS_UNITS", "FLAG_ALLOW_NON_IDR_KEYFRAMES", "setAllowCrossProtocolRedirects", "startNativeProgressLoop", "playWithHeaders", "seekBy", "seekToFraction", "setViewport", "resetViewport"]) {
  if (!nativeSource.includes(marker)) throw new Error(`Native playback implementation is missing: ${marker}`);
}
if (nativeSource.includes("android.media.MediaPlayer")) throw new Error("Legacy Android MediaPlayer must not remain in the APK playback layer");
if (!nativeSource.includes("VLC/3.0.21 LibVLC/3.0.21")) throw new Error("IPTV-compatible native stream user agent is missing");
if (nativeSource.includes('setRequestProperty("Accept-Encoding", "identity")')) throw new Error("Native API loading must allow transparent gzip compression");
const css = fs.readFileSync("style.css", "utf8");
for (const marker of ["native-video-active", "native-preview-active", "html.native-preview-active .live-browser-grid { background: transparent; }", "live-browser-grid", "live-inspector", "controls-locked", "channel-thumbnail-loader", "live-logo-loading", "preview-breathe", "channel-switch-rail", "channel-switch-card.active"]) {
  if (!css.includes(marker)) throw new Error(`Responsive playback style is missing: ${marker}`);
}
if (html.includes('class="spinner"') || css.includes(".spinner")) throw new Error("The removed playback spinner is still bundled");
if (!html.includes('id="channelSwitchFeedback"') || !css.includes("channel-switch-feedback")) throw new Error("Temporary channel-switch feedback is missing");
console.log("MazenmiXTream static checks passed.");
