import fs from "node:fs";
import { JSDOM } from "jsdom";

const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
window.Hls = { isSupported: () => false };
window.mpegts = { isSupported: () => false };
window.URL.createObjectURL = () => "blob:test";

const recordings = [];
const requestHeaders = [];
window.MazenNetwork = {
  proxyUrl: (url) => url,
  proxyUrlWithHeaders: (url, json) => {
    requestHeaders.push(JSON.parse(json));
    return "https://mx.local/auth?original=" + encodeURIComponent(url);
  }
};
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => { recordings.push({ url, generation }); setTimeout(() => window.MazenNativePlayerEvent("playing", generation, ""), 5); },
  playWithHeaders: (url, generation, headers) => { recordings.push({ url, generation, headers }); setTimeout(() => window.MazenNativePlayerEvent("playing", generation, ""), 5); },
  stop() {}, pause() {}, resume() {}, setMuted() {}, setVolume() {}, setAspect() {}, setBrightness() {},
  setViewport() {}, resetViewport() {}, seekBy() {}, seekToFraction() {}
};
window.fetch = async (value) => {
  const url = String(value);
  const original = url.includes("mx.local/auth?") ? new URL(url).searchParams.get("original") : url;
  const q = new URL(original);
  const action = q.searchParams.get("action");
  const response = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify({ js: value }) });
  if (action === "handshake") return response({ token: "temporary-test-token" });
  if (action === "get_profile") return response({ id: "1", status: "active" });
  if (action === "get_genres") return response([{ id: "1", title: "News" }]);
  if (action === "get_all_channels") return response({ data: [{ id: 1, name: "Demo News", tv_genre_id: "1", cmd: "ffmpeg http://portal.test/ch/1", logo: "" }] });
  if (action === "create_link") return response({ cmd: "ffmpeg http://video.test/channel.ts?token=fake" });
  if (url.includes("example.com/list.m3u")) return { ok: true, status: 200, text: async () => '#EXTM3U\n#EXTINF:-1,Test channel\nhttp://video.test/test.ts' };
  return { ok: false, status: 404, text: async () => "not found" };
};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};

const playlists = Array.from({ length: 49 }, (_, i) => ({ id: "m3u-" + i, type: "m3u", name: "Existing " + (i + 1), m3uUrl: "https://example.com/list.m3u" }));
playlists.unshift({ id: "stalker-test", type: "stalker", name: "Stalker Demo", portalUrl: "http://portal.test/c/", macAddress: "00:1A:79:12:34:56" });
window.localStorage.setItem("mazenmixtream.state.v1", JSON.stringify({ playlists, activePlaylistId: "stalker-test" }));
window.eval(fs.readFileSync(process.argv[2] || "main.js", "utf8"));
await wait(1000);
assert(window.document.getElementById("content").textContent.includes("Demo News"), "Stalker channel did not load");
assert(requestHeaders.some((headers) => headers.Cookie.includes("mac=00%3A1A%3A79%3A12%3A34%3A56")), "MAG Cookie missing from handshake");
assert(requestHeaders.some((headers) => headers.Authorization === "Bearer temporary-test-token"), "Stalker bearer token missing from authorized call");
const item = window.document.querySelector("[data-item-id]");
assert(item, "No Stalker item rendered on Home");
item.click(); item.click();
await wait(80);
assert(recordings.some((entry) => entry.url.includes("video.test/channel.ts?token=fake")), "Stalker create_link was not used before playback");
window.document.getElementById("playerBack").click();
const stored = JSON.parse(window.localStorage.getItem("mazenmixtream.state.v1"));
assert(!JSON.stringify(stored).includes("temporary-test-token"), "Stalker session token leaked to localStorage");
window.document.getElementById("manageBtn").click();
assert(window.document.querySelectorAll(".playlist-card").length === 50, "Existing 50 playlists were lost");
assert(window.document.getElementById("content").textContent.includes("50 saved playlists"), "Playlist count was not shown");
window.document.querySelector("[data-action='add-playlist']").click();
assert(window.document.querySelector("[data-playlist-tab='stalker']"), "Stalker tab not visible");
window.document.querySelector("[data-playlist-tab='m3u']").click();
window.document.querySelector("input[name='name']").value = "Fifty First";
window.document.querySelector("input[name='m3uUrl']").value = "https://example.com/list.m3u";
window.document.getElementById("savePlaylistBtn").click();
await wait(75);
window.document.getElementById("manageBtn").click();
assert(window.document.querySelectorAll(".playlist-card").length === 51, "Adding playlist 51 failed");
console.log("PASS Stalker MAG handshake, catalog, create_link, session privacy, 51 playlist sources");