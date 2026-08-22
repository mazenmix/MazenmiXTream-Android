import fs from "node:fs";
import path from "node:path";

const apple = path.resolve(import.meta.dirname, "..");
const required = [
  "Package.swift",
  "Podfile",
  "project.yml",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/Models.swift",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/APIClient.swift",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/M3UParser.swift",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/ChannelBrowse.swift",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/PlaybackPlanner.swift",
  "MazenmiXTreamCore/Sources/MazenmiXTreamCore/XtreamService.swift",
  "MazenmiXTreamApp/MazenmiXTreamApp.swift",
  "MazenmiXTreamApp/Models/AppModel.swift",
  "MazenmiXTreamApp/Models/PlayerModel.swift",
  "MazenmiXTreamApp/Services/KeychainStore.swift",
  "MazenmiXTreamApp/Views/RootView.swift",
  "MazenmiXTreamApp/Views/LiveBrowserView.swift",
  "MazenmiXTreamApp/Views/PlayerView.swift",
  "MazenmiXTreamApp/Views/VLCPlayerView.swift",
  "MazenmiXTreamApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
];

for (const relative of required) {
  if (!fs.existsSync(path.join(apple, relative))) throw new Error(`Missing Apple source: ${relative}`);
}

for (const relative of walk(apple).filter((file) => file.endsWith(".json"))) {
  JSON.parse(fs.readFileSync(relative, "utf8"));
}

const swift = walk(apple).filter((file) => file.endsWith(".swift")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const marker of [
  "NavigationSplitView", "TabView", "AVPlayerViewController", "allowsPictureInPicturePlayback",
  "KeychainStore", "get_live_streams", "get_vod_streams", "get_series", "get_short_epg",
  "M3UParser", "playbackURLs", "hideAdult", "SeriesDetailView",
  "ChannelBrowseIndex", "Countries", "Categories", "Search channels",
  "loadTracks(withMediaType: .video)", "XtreamPlaybackPlanner", "MobileVLCKit",
  "VLCMediaPlayer", "PlaybackEngine", "activateVLC", "compatibility video engine"
]) {
  if (!swift.includes(marker)) throw new Error(`Apple implementation marker is missing: ${marker}`);
}
if (swift.includes("AVURLAssetHTTPHeaderFieldsKey")) throw new Error("Undocumented AVPlayer HTTP-header injection must not be used.");
if (/UserDefaults[^\n]*(password|credentials)/i.test(swift)) throw new Error("Credentials must not be stored in UserDefaults.");

const icon = fs.readFileSync(path.join(apple, "MazenmiXTreamApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"));
if (icon.readUInt32BE(16) !== 1024 || icon.readUInt32BE(20) !== 1024) throw new Error("Apple AppIcon must be 1024×1024.");

console.log("MazenmiXTream Apple static checks passed.");

function walk(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".build", "dist", "MazenmiXTream.xcodeproj"].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}
