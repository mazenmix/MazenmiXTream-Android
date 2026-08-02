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
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
window.HTMLMediaElement.prototype.load = function () {};

const item = {
  id: "live-91", streamId: 91, name: "MX Preview QA", group: "News", categoryId: "news", kind: "live", logo: "",
  directSource: "https://cdn.stream.test/session/preview-91.m3u8", containerExtension: "m3u8",
  url: "https://cdn.stream.test/session/preview-91.m3u8"
};
window.localStorage.setItem("mazenmixtream.state.v1", JSON.stringify({
  playlists: [{
    id: "preview", name: "Preview QA", type: "xtream", baseUrl: "https://stream.test", username: "user", password: "pass",
    serverInfo: { allowed_output_formats: ["m3u8"], stream_base: "https://edge.stream.test:8443" },
    catalog: { live: [item], movies: [], series: [], categories: { live: [{ id: "news", name: "News" }], movies: [], series: [] } }
  }],
  activePlaylistId: "preview",
  favorites: [],
  settings: { hideAdult: true, parentalPin: "", autoplay: true, subtitleLanguage: "ar,en", autoSubtitles: false, opensubtitlesKey: "", aspect: "contain" }
}));

const requests = [];
let stops = 0;
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => {
    requests.push({ url, generation });
    if (requests.length === 1) setTimeout(() => window.MazenNativePlayerEvent("error", generation, "ERROR_CODE_IO_BAD_HTTP_STATUS"), 5);
    else setTimeout(() => {
      window.MazenNativePlayerEvent("prepared", generation, "");
      window.MazenNativePlayerEvent("playing", generation, "");
    }, 5);
  },
  stop: () => { stops += 1; },
  pause: () => {}, resume: () => {}, setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {},
  setViewport: () => {}, resetViewport: () => {}
};
window.fetch = async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) });

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
window.document.querySelector("[data-view='live']").click();
for (let i = 0; i < 60 && !window.document.getElementById("livePreviewFrame")?.classList.contains("preview-playing"); i += 1) await wait(20);

assert(requests.length === 2, "Preview did not perform exactly one bounded alternate attempt");
assert(requests[0].url === "https://edge.stream.test:8443/live/user/pass/91.m3u8", "Preview did not prioritize the canonical Xtream URL");
assert(requests[1].url === item.directSource, "Preview did not retry the server-provided direct source");
assert(stops === 0, "Preview alternate attempt tore down the persistent Media3 player");
assert(window.document.getElementById("livePreviewFrame").classList.contains("preview-playing"), "Recovered preview did not expose the native video surface");
assert(window.document.getElementById("livePreviewStatus").textContent.includes("LIVE PREVIEW"), "Recovered preview remained stuck on Opening live preview");
assert(window.document.documentElement.classList.contains("native-preview-active"), "Recovered preview did not retain its native surface");

console.log(`MazenmiXTream bounded preview recovery test passed (${clientFile}).`);
dom.window.close();
