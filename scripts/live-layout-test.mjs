import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.5 });
window.HTMLElement.prototype.scrollIntoView = function () {};
window.Hls = { isSupported: () => false };
window.mpegts = { isSupported: () => false };
window.URL.createObjectURL = () => "blob:test";
window.HTMLMediaElement.prototype.play = function () { this.__paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; };
window.HTMLMediaElement.prototype.load = function () {};
Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { configurable: true, get() { return this.__paused !== false; } });

const channels = Array.from({ length: 180 }, (_, index) => ({
  id: `live-${index + 1}`,
  name: `MX Channel ${index + 1}`,
  group: index < 90 ? "Sports" : "Entertainment",
  categoryId: index < 90 ? "sports" : "entertainment",
  kind: "live",
  streamId: index + 1,
  logo: "",
  url: `https://stream.test/live/user/pass/${index + 1}.ts`
}));
const catalog = {
  live: channels,
  movies: [],
  series: [],
  categories: {
    live: [{ id: "sports", name: "Sports" }, { id: "entertainment", name: "Entertainment" }],
    movies: [],
    series: []
  }
};
window.localStorage.setItem("mazenmixtream.state.v1", JSON.stringify({
  playlists: [{ id: "tv", name: "MX QA", type: "xtream", baseUrl: "https://stream.test", username: "user", password: "pass", serverInfo: { allowed_output_formats: ["ts", "m3u8"], stream_base: "https://stream.test" }, catalog }],
  activePlaylistId: "tv",
  favorites: [],
  settings: { hideAdult: true, parentalPin: "", autoplay: true, subtitleLanguage: "ar,en", autoSubtitles: false, opensubtitlesKey: "", aspect: "contain" }
}));

const plays = [];
const viewports = [];
let stops = 0;
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => {
    plays.push({ url, generation });
    setTimeout(() => window.MazenNativePlayerEvent("playing", generation, ""), 5);
  },
  stop: () => { stops += 1; },
  pause: () => {}, resume: () => {}, setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {},
  setViewport: (left, top, width, height) => viewports.push({ left, top, width, height }),
  resetViewport: () => {}
};
window.fetch = async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) });

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
window.document.querySelector("[data-view='live']").click();
await wait(500);
for (let i = 0; i < 40 && !window.document.getElementById("livePreviewFrame")?.classList.contains("preview-playing"); i += 1) await wait(20);

assert(window.document.documentElement.classList.contains("live-browser-active"), "TV live-browser mode was not activated");
assert(window.document.querySelector(".live-category-pane"), "TV category pane is missing");
assert(window.document.querySelector(".live-channel-pane"), "TV channel pane is missing");
assert(window.document.querySelector(".live-inspector"), "TV preview and information pane is missing");
assert(window.document.querySelectorAll("[data-live-channel]").length === 140, "TV list was not virtualized to its first fast page");
assert(viewports.length >= 1, "Native preview viewport was not positioned");
assert(plays.filter((entry) => entry.generation < 0).length === 1, "Initial TV preview did not start exactly once");
assert(window.document.documentElement.classList.contains("native-preview-active"), "Native preview surface was not activated");
assert(window.document.getElementById("livePreviewFrame").classList.contains("preview-playing"), "Preview did not reach its first rendered frame");
window.document.querySelector("[data-live-load-more]").click();
assert(window.document.querySelectorAll("[data-live-channel]").length === 180, "TV did not append the remaining channels smoothly");
assert(plays.filter((entry) => entry.generation < 0).length === 1, "Loading more rows unnecessarily restarted the live preview");

const firstRows = Array.from(window.document.querySelectorAll("[data-live-channel]")).slice(1, 31);
for (const row of firstRows) row.dispatchEvent(new window.FocusEvent("focus"));
await wait(620);
assert(plays.filter((entry) => entry.generation < 0).length === 2, "Rapid TV focus movement started more than one debounced preview");
assert(plays.filter((entry) => entry.generation < 0).at(-1).url.endsWith("/31.ts"), "Debounced preview did not settle on the final focused channel");
assert(stops === 0, "Preview zapping tore down the warm Media3 player between focused channels");

const playsBeforeFullscreen = plays.length;
const stopsBeforeFullscreen = stops;
const previewGeneration = plays.at(-1).generation;
firstRows.at(-1).click();
await wait(20);
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "One TV channel click opened fullscreen instead of keeping preview");
assert(plays.length === playsBeforeFullscreen, "One TV channel click restarted the preview stream");
firstRows.at(-1).click();
await wait(30);
assert(!window.document.getElementById("playerScreen").classList.contains("hidden"), "TV fullscreen player did not open");
assert(plays.length === playsBeforeFullscreen, "Fullscreen opened a duplicate server connection instead of reusing the preview");
assert(plays.at(-1).generation === previewGeneration, "Fullscreen did not keep the healthy preview session");
assert(stops === stopsBeforeFullscreen, "Fullscreen stopped the preview before promoting it");
assert(window.document.documentElement.classList.contains("native-video-active"), "Fullscreen native video surface was not activated");
assert(!window.document.documentElement.classList.contains("native-preview-active"), "Preview surface leaked behind fullscreen playback");
assert(window.document.getElementById("playerLoading").classList.contains("hidden"), "Promoted preview showed an unnecessary loading overlay");
window.MazenNativePlayerEvent("error", previewGeneration, "Promoted native stream stopped");
await wait(160);
assert(plays.length === playsBeforeFullscreen + 1, "Promoted stream failure did not advance to one bounded fallback");
assert(plays.at(-1).url.endsWith("/31.m3u8"), "Promoted TS failure did not switch to the Xtream HLS URL");
assert(window.document.getElementById("playerLoading").classList.contains("hidden"), "Promoted-stream fallback left the loading overlay visible");

window.document.getElementById("playerBack").click();
await wait(820);
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "TV player did not close cleanly");
assert(plays.at(-1).generation < 0, "Live preview did not resume after closing fullscreen playback");

const entertainmentCategory = Array.from(window.document.querySelectorAll("[data-live-category]")).find((node) => node.dataset.liveCategory === "entertainment");
entertainmentCategory.click();
await wait(40);
const categoryList = window.document.querySelector(".live-category-list");
const channelList = window.document.querySelector(".live-channel-list");
categoryList.scrollTop = 37;
channelList.scrollTop = 420;
const focusedChannel = window.document.querySelectorAll("[data-live-channel]")[12];
focusedChannel.focus();
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
assert(window.document.activeElement?.dataset.liveCategory === "entertainment", "Returning from channels jumped to All Channels instead of the active category");
assert(categoryList.scrollTop === 37, "Returning to categories reset its scroll position");
assert(channelList.scrollTop === 420, "Returning to categories reset the channel list position");

console.log(`MazenmiXTream responsive TV layout and preview tests passed (${clientFile}).`);
dom.window.close();
