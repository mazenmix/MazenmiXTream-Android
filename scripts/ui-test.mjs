import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

window.Hls = { isSupported: () => false };
window.mpegts = { isSupported: () => false };
window.URL.createObjectURL = () => "blob:test";
const requestedUrls = [];
window.MazenNetwork = { proxyUrl: (url) => `https://mx.local/https/${String(url).replace(/^https?:\/\//, "")}` };
const nativePlayRequests = [];
const nativeSeekRequests = [];
let nativeStops = 0;
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => {
    nativePlayRequests.push({ url, generation });
    setTimeout(() => window.MazenNativePlayerEvent("playing", generation, ""), 5);
  },
  stop: () => { nativeStops += 1; },
  pause: () => {}, resume: () => {}, setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {},
  seekBy: (seconds) => nativeSeekRequests.push({ type: "relative", value: seconds }),
  seekToFraction: (fraction) => nativeSeekRequests.push({ type: "fraction", value: fraction }),
  setViewport: () => {}, resetViewport: () => {}
};
window.fetch = async (url) => {
  requestedUrls.push(String(url));
  if (String(url).includes("sample.m3u")) {
    const safeChannels = Array.from({ length: 120 }, (_, i) => `#EXTINF:-1 tvg-name="Mazen News ${i + 1}" group-title="News",Mazen News ${i + 1}\nhttps://stream.test/news-${i + 1}.m3u8`).join("\n");
    return {
      ok: true,
      status: 200,
      text: async () => `#EXTM3U
#EXTINF:-1 tvg-name="Adult XXX" group-title="Adult XXX",Adult XXX
https://stream.test/adult.m3u8
${safeChannels}
#EXTINF:-1 type="movie" tvg-name="Mazen Movie" group-title="Movies",Mazen Movie
https://stream.test/mazen-movie.mp4
`
    };
  }
  return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
};

Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { configurable: true, get() { return this.__paused !== false; } });
const playFailures = [];
let playCalls = 0;
window.HTMLMediaElement.prototype.play = function () {
  playCalls += 1;
  if (playFailures.length) {
    const error = new Error("Media was not ready yet");
    error.name = playFailures.shift();
    return Promise.reject(error);
  }
  this.__paused = false;
  this.dispatchEvent(new window.Event("playing"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; this.dispatchEvent(new window.Event("pause")); };
window.HTMLMediaElement.prototype.load = function () {};

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
assert(!window.document.getElementById("app").classList.contains("hidden"), "App shell did not start");
assert(window.document.querySelector("[data-action='add-playlist']"), "Manage playlists was not the first screen");

window.document.querySelector("[data-action='add-playlist']").click();
window.document.querySelector("[data-playlist-tab='m3u']").click();
window.document.querySelector("input[name='name']").value = "QA Playlist";
window.document.querySelector("input[name='m3uUrl']").value = "https://test.local/sample.m3u";
window.document.getElementById("savePlaylistBtn").click();
await wait(120);
assert(window.document.body.textContent.includes("Mazen News"), "M3U channel did not load");
assert(requestedUrls.some((url) => url.includes("mx.local")), "Native Android network proxy was not used");
assert(!window.document.getElementById("content").textContent.includes("Everything you love"), "Home still rendered the removed welcome hero");
assert(window.document.getElementById("content").textContent.includes("Live Channels"), "Home did not become a channels-only screen");
assert(!window.document.getElementById("content").textContent.includes("Mazen Movie"), "Home mixed movies into the channels-only screen");
assert(window.document.querySelectorAll("[data-item-id]").length <= 36, "Channels-only Home rendered the full large library at once");
const homeChannel = Array.from(window.document.querySelectorAll("[data-item-id]")).find((node) => node.textContent.includes("Mazen News 1"));
assert(homeChannel, "Home live channel did not render");
homeChannel.click();
await wait(10);
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "One Home click opened fullscreen");
homeChannel.click();
await wait(30);
assert(!window.document.getElementById("playerScreen").classList.contains("hidden"), "Home double-click did not open fullscreen");
window.document.getElementById("playerBack").click();
nativePlayRequests.length = 0;
nativeStops = 0;

window.document.querySelector("[data-view='live']").click();
await wait(20);
assert(window.document.body.textContent.includes("Mazen News"), "Live view did not render");
assert(!window.document.getElementById("content").textContent.includes("Adult XXX"), "Adult filter did not hide content by default");
assert(window.document.querySelector(".live-browser-grid"), "Responsive Live TV browser did not render");
assert(window.document.querySelectorAll("[data-live-channel]").length > 0, "Live channel rows did not render");
assert(window.document.querySelectorAll("[data-live-channel]").length <= 50, "Phone rendered the entire large channel list at once");
window.document.querySelector("[data-live-load-more]").click();
assert(window.document.querySelectorAll("[data-live-channel]").length === 100, "Phone did not append the next channel page smoothly");
assert(nativePlayRequests.length === 0, "Phone list paging started an unwanted preview decoder");

window.document.getElementById("settingsBtn").click();
window.document.getElementById("adultToggle").click();
await wait(30);
assert(window.document.getElementById("content").textContent.includes("Adult XXX"), "Adult filter toggle did not unlock the filtered item");

const safeCard = Array.from(window.document.querySelectorAll("[data-live-channel]")).find((node) => node.textContent.includes("Mazen News 1"));
assert(safeCard, "Safe live channel row was not found after filtering");
safeCard.click();
await wait(10);
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "One channel click opened fullscreen instead of selecting preview");
safeCard.click();
await wait(30);
assert(!window.document.getElementById("playerScreen").classList.contains("hidden"), "Player did not open");
const testVideo = window.document.getElementById("video");
assert(nativePlayRequests.length === 1, "Live TV did not use the native Android player");
assert(playCalls === 0, "Live TV incorrectly used a WebView decoding engine");
assert(window.document.documentElement.classList.contains("native-video-active"), "Native video surface was not activated");
assert(window.document.getElementById("playerLoading").classList.contains("hidden"), "Connecting overlay remained after playback started");
assert(window.document.getElementById("playerLoading").children.length === 0, "Removed playback spinner was still rendered");
assert(window.document.getElementById("prevBtn").classList.contains("channel-nav-trigger") && window.document.getElementById("nextBtn").classList.contains("channel-nav-trigger"), "Persistent channel arrows were not removed from the player chrome");
assert(window.document.getElementById("playPauseBtn").textContent === "Ⅱ", "Player showed a manual play prompt after automatic start");
window.document.getElementById("playerLockBtn").click();
assert(window.document.getElementById("playerScreen").classList.contains("controls-locked"), "Player controls did not lock");
window.document.getElementById("playerLockBtn").click();
assert(!window.document.getElementById("playerScreen").classList.contains("controls-locked"), "Player controls did not unlock");
for (let i = 0; i < 25; i += 1) {
  window.document.getElementById("nextBtn").click();
  await wait(8);
}
assert(nativePlayRequests.length === 26, "Rapid channel switching lost a native playback request");
assert(nativeStops === 0, "Rapid channel switching repeatedly tore down the warm Media3 session");
assert(playCalls === 0, "Rapid live-TV switching activated a WebView decoder");
assert(!window.document.getElementById("channelSwitchFeedback").classList.contains("hidden"), "Channel-switch feedback did not appear after switching");
assert(window.document.querySelectorAll("#channelSwitchRail .channel-switch-card").length === 5, "Fullscreen switching did not render the five-channel horizontal strip");
assert(window.document.querySelectorAll("#channelSwitchRail .channel-switch-card.active").length === 1, "Fullscreen channel strip did not identify the selected channel");
await wait(760);
assert(window.document.getElementById("channelSwitchFeedback").classList.contains("hidden"), "Channel strip did not disappear after the new channel rendered");
const nativeRequest = nativePlayRequests.at(-1);
window.MazenNativePlayerEvent("stalled", nativeRequest.generation, "Native test frames stopped");
await wait(20);
assert(window.document.getElementById("playerLoading").classList.contains("hidden"), "Dead stream left the loading spinner running");
assert(!window.document.getElementById("playerError").classList.contains("hidden"), "Dead stream did not end in a bounded error state");
assert(!window.document.getElementById("playerScreen").classList.contains("controls-hidden"), "Stream error hid the exit controls");
window.document.getElementById("playerErrorBack").click();
assert(window.document.getElementById("playerScreen").classList.contains("hidden"), "Player back action did not close cleanly");
assert(!window.document.documentElement.classList.contains("native-video-active"), "Native surface stayed active after closing the player");
assert(nativeStops >= 1, "Native Android player was not released");

window.document.querySelector("[data-view='movies']").click();
await wait(20);
const movieCard = Array.from(window.document.querySelectorAll("[data-item-id]")).find((node) => node.textContent.includes("Mazen Movie"));
assert(movieCard, "Movie test item did not render");
const movieNativeBaseline = nativePlayRequests.length;
movieCard.click();
await wait(20);
assert(nativePlayRequests.length === movieNativeBaseline + 1, "Movie did not start with the native Android decoder");
const movieNativeRequest = nativePlayRequests.at(-1);
assert(movieNativeRequest.url.endsWith("/mazen-movie.mp4"), "Movie native decoder received the wrong URL");
window.MazenNativePlayerEvent("progress", movieNativeRequest.generation, "30000,120000");
assert(window.document.getElementById("currentTime").textContent === "00:30", "Native movie position was not shown");
assert(window.document.getElementById("duration").textContent === "02:00", "Native movie duration was not shown");
window.document.getElementById("rewindBtn").click();
window.document.getElementById("forwardBtn").click();
window.document.getElementById("timeline").value = "50";
window.document.getElementById("timeline").dispatchEvent(new window.Event("input"));
assert(nativeSeekRequests.some((entry) => entry.type === "relative" && entry.value === -30), "Native movie rewind was not wired");
assert(nativeSeekRequests.some((entry) => entry.type === "relative" && entry.value === 30), "Native movie forward was not wired");
assert(nativeSeekRequests.some((entry) => entry.type === "fraction" && entry.value === .5), "Native movie timeline seek was not wired");
window.MazenNativePlayerEvent("error", movieNativeRequest.generation, "Native movie decoder rejected the test stream");
await wait(30);
assert(playCalls === 0, "Movie failure escaped to a competing WebView decoder instead of staying in Media3");
assert(!window.document.getElementById("playerError").classList.contains("hidden"), "Movie stream failure did not end in a bounded error state");

console.log(`MazenmiXTream UI flow tests passed (${clientFile}).`);
dom.window.close();
