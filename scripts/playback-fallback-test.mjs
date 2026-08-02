import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { configurable: true, get() { return this.__paused !== false; } });
window.HTMLMediaElement.prototype.play = function () {
  this.__paused = false;
  this.dispatchEvent(new window.Event("playing"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; };
window.HTMLMediaElement.prototype.load = function () {};

const hlsSources = [];
const hlsConfigs = [];
class TestHls {
  static Events = { MEDIA_ATTACHED: "mediaAttached", MANIFEST_PARSED: "manifestParsed", ERROR: "error" };
  static ErrorTypes = { MEDIA_ERROR: "mediaError" };
  static isSupported() { return true; }
  constructor(config) { this.config = config; this.handlers = {}; hlsConfigs.push(config); }
  on(event, handler) { this.handlers[event] = handler; }
  attachMedia() { setTimeout(() => this.handlers[TestHls.Events.MEDIA_ATTACHED]?.(), 0); }
  loadSource(url) {
    hlsSources.push(url);
    setTimeout(() => this.handlers[TestHls.Events.MANIFEST_PARSED]?.(), 0);
  }
  recoverMediaError() {}
  destroy() {}
}
window.Hls = TestHls;
window.mpegts = { isSupported: () => false };
window.URL.createObjectURL = () => "blob:test";

const item = {
  id: "live-77", streamId: 77, name: "MX Recovery Channel", group: "Sports", categoryId: "sports",
  kind: "live", logo: "", directSource: "https://cdn.stream.test/session/token-77.m3u8", containerExtension: "m3u8",
  url: "https://cdn.stream.test/session/token-77.m3u8"
};
window.localStorage.setItem("mazenmixtream.state.v1", JSON.stringify({
  playlists: [{
    id: "fallback", name: "Fallback QA", type: "xtream", baseUrl: "https://stream.test", username: "user", password: "pass",
    serverInfo: { allowed_output_formats: ["m3u8"], stream_base: "https://edge.stream.test:8443" },
    catalog: { live: [item], movies: [], series: [], categories: { live: [{ id: "sports", name: "Sports" }], movies: [], series: [] } }
  }],
  activePlaylistId: "fallback",
  favorites: [],
  settings: { hideAdult: true, parentalPin: "", autoplay: true, subtitleLanguage: "ar,en", autoSubtitles: false, opensubtitlesKey: "", aspect: "contain" }
}));

const nativeRequests = [];
let nativeStops = 0;
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => {
    nativeRequests.push({ url, generation });
    setTimeout(() => window.MazenNativePlayerEvent(nativeRequests.length === 1 ? "error" : "playing", generation, nativeRequests.length === 1 ? "ERROR_CODE_IO_BAD_HTTP_STATUS" : ""), 5);
  },
  stop: () => { nativeStops += 1; },
  pause: () => {}, resume: () => {}, setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {},
  setViewport: () => {}, resetViewport: () => {}
};
window.fetch = async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) });

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
window.document.querySelector("[data-view='live']").click();
window.document.querySelector("[data-live-channel]").click();
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "One click opened the fallback-test channel");
window.document.querySelector("[data-live-channel]").click();
await wait(430);

assert(nativeRequests.length === 2, "The two real server-provided HLS URLs were not attempted natively");
assert(nativeRequests[0].url === "https://edge.stream.test:8443/live/user/pass/77.m3u8", "The account-reported canonical stream URL was not attempted first");
assert(nativeRequests[1].url === item.directSource, "The exact direct_source URL was not retained as the bounded alternate");
assert(nativeRequests.every((entry) => !entry.url.endsWith(".ts")), "An unapproved TS URL was invented");
assert(hlsSources.length === 0 && hlsConfigs.length === 0, "Android playback escaped to a second WebView decoder instead of staying in Media3");
assert(nativeStops === 0, "Persistent Media3 recovery tore down the warm player while switching URLs");
assert(window.document.getElementById("playerError").classList.contains("hidden"), "Recovered stream still displayed an error dialog");
assert(window.document.getElementById("playerLoading").classList.contains("hidden"), "Recovered stream left the loading overlay visible");
assert(window.document.documentElement.classList.contains("native-video-active"), "Persistent Media3 surface disappeared during URL recovery");
assert(window.document.getElementById("playPauseBtn").textContent === "Ⅱ", "Recovered stream did not autoplay");

console.log(`MazenmiXTream persistent Media3 URL recovery test passed (${clientFile}).`);
dom.window.close();
