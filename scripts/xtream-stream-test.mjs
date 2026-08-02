import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
window.Hls = { isSupported: () => false };
window.mpegts = { isSupported: () => false };
window.HTMLMediaElement.prototype.play = function () { this.__paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; };
window.HTMLMediaElement.prototype.load = function () {};
Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { configurable: true, get() { return this.__paused !== false; } });

const nativePlays = [];
window.MazenPlayer = {
  isAvailable: () => true,
  play: (url, generation) => {
    nativePlays.push({ url, generation });
    setTimeout(() => window.MazenNativePlayerEvent("playing", generation, ""), 5);
  },
  stop: () => {}, pause: () => {}, resume: () => {}, setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {},
  setViewport: () => {}, resetViewport: () => {}, seekBy: () => {}, seekToFraction: () => {}
};

const jsonResponse = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
window.fetch = async (url) => {
  const parsed = new URL(String(url));
  const action = parsed.searchParams.get("action") || "";
  if (!action) return jsonResponse({
    user_info: { status: "Active", exp_date: "1800000000", max_connections: "2", active_cons: "0", allowed_output_formats: ["m3u8"] },
    server_info: { server_protocol: "https", url: "edge.provider.test", https_port: "8443", timezone: "UTC" }
  });
  if (action === "get_live_categories") return jsonResponse([{ category_id: "1", category_name: "News" }]);
  if (action === "get_vod_categories" || action === "get_series_categories") return jsonResponse([]);
  if (action === "get_live_streams") return jsonResponse([
    { stream_id: 10, name: "Direct Token Channel", category_id: "1", direct_source: "https://cdn.provider.test/signed/token-10.m3u8" },
    { stream_id: 20, name: "Generated HLS Channel", category_id: "1", direct_source: "" }
  ]);
  if (action === "get_vod_streams" || action === "get_series") return jsonResponse([]);
  return jsonResponse([]);
};

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
window.document.querySelector("[data-action='add-playlist']").click();
window.document.querySelector("input[name='name']").value = "Xtream URL QA";
window.document.querySelector("input[name='baseUrl']").value = "http://login.provider.test:8080";
window.document.querySelector("input[name='username']").value = "user name";
window.document.querySelector("input[name='password']").value = "p@ss word";
window.document.getElementById("savePlaylistBtn").click();
for (let i = 0; i < 80 && !window.document.body.textContent.includes("Generated HLS Channel"); i += 1) await wait(20);

const saved = JSON.parse(window.localStorage.getItem("mazenmixtream.state.v1"));
const playlist = saved.playlists.find((entry) => entry.id === saved.activePlaylistId);
assert(playlist.serverInfo.stream_base === "https://edge.provider.test:8443", "The stream host reported by Xtream was not saved");
assert(playlist.serverInfo.allowed_output_formats.length === 1 && playlist.serverInfo.allowed_output_formats[0] === "m3u8", "Xtream output formats were not saved");

const cards = Array.from(window.document.querySelectorAll("[data-item-id]"));
const directCard = cards.find((node) => node.textContent.includes("Direct Token Channel"));
const generatedCard = cards.find((node) => node.textContent.includes("Generated HLS Channel"));
assert(directCard && generatedCard, "Xtream channels did not render");
directCard.click(); directCard.click();
await wait(20);
const canonicalDirectRequest = nativePlays.at(-1);
assert(canonicalDirectRequest?.url === "https://edge.provider.test:8443/live/user%20name/p%40ss%20word/10.m3u8", "The fast canonical Xtream URL was not prioritized");
window.MazenNativePlayerEvent("error", canonicalDirectRequest.generation, "ERROR_CODE_IO_BAD_HTTP_STATUS");
await wait(20);
assert(nativePlays.at(-1)?.url === "https://cdn.provider.test/signed/token-10.m3u8", "direct_source was not retained exactly as the verified alternate");
window.document.getElementById("playerBack").click();
await wait(30);
generatedCard.click(); generatedCard.click();
await wait(20);
assert(nativePlays.at(-1)?.url === "https://edge.provider.test:8443/live/user%20name/p%40ss%20word/20.m3u8", "The server-selected HLS URL was not generated safely");
assert(!nativePlays.some((entry) => entry.url.endsWith(".ts")), "The app invented a TS URL that this account did not allow");
assert(window.document.getElementById("playerLoading").children.length === 0, "Playback spinner returned during Xtream playback");

console.log(`MazenmiXTream Xtream stream-resolution test passed (${clientFile}).`);
dom.window.close();
