import fs from "node:fs";
import { JSDOM } from "jsdom";
import { indexedDB } from "fake-indexeddb";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

function createWindow(fetchImpl, savedState = null) {
  const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "indexedDB", { configurable: true, value: indexedDB });
  window.Hls = { isSupported: () => false };
  window.mpegts = { isSupported: () => false };
  window.MazenNetwork = { proxyUrl: (url) => `https://mx.local/https/${String(url).replace(/^https?:\/\//, "")}` };
  window.MazenPlayer = {
    isAvailable: () => true, play: () => {}, stop: () => {}, pause: () => {}, resume: () => {},
    setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {}, setViewport: () => {}, resetViewport: () => {}
  };
  window.fetch = fetchImpl;
  if (savedState) window.localStorage.setItem("mazenmixtream.state.v1", savedState);
  window.eval(fs.readFileSync(clientFile, "utf8"));
  return { dom, window };
}

function getCacheRecord(id) {
  return new Promise((resolve) => {
    const open = indexedDB.open("mazenmixtream.catalogs.v1", 1);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("catalogs", "readonly").objectStore("catalogs").get(id);
      request.onsuccess = () => { const result = request.result || null; db.close(); resolve(result); };
      request.onerror = () => { db.close(); resolve(null); };
    };
  });
}

const m3uRows = Array.from({ length: 8200 }, (_, index) => `#EXTINF:-1 group-title="News",Cached Channel ${index + 1}\nhttps://stream.test/${index + 1}.m3u8`).join("\n");
const first = createWindow(async () => ({ ok: true, status: 200, text: async () => `#EXTM3U\n${m3uRows}` }));
await wait(820);
first.window.document.querySelector("[data-action='add-playlist']").click();
first.window.document.querySelector("[data-playlist-tab='m3u']").click();
first.window.document.querySelector("input[name='name']").value = "Chunk Cache QA";
first.window.document.querySelector("input[name='m3uUrl']").value = "https://cache.test/large.m3u";
first.window.document.getElementById("savePlaylistBtn").click();
for (let i = 0; i < 100 && !first.window.document.body.textContent.includes("Cached Channel 1"); i += 1) await wait(20);
assert(first.window.document.body.textContent.includes("Cached Channel 1"), "Large M3U did not load before cache validation");

const savedState = first.window.localStorage.getItem("mazenmixtream.state.v1");
const playlistId = JSON.parse(savedState).activePlaylistId;
let meta = null;
for (let i = 0; i < 100 && !meta; i += 1) { meta = await getCacheRecord(`${playlistId}:meta`); if (!meta) await wait(20); }
assert(meta?.generation, "Chunked cache metadata was not committed");
assert(meta.playbackSchema === 2, "Playback-link cache schema was not committed");
assert(meta.chunks.live === 3, `Expected three live cache chunks, received ${meta.chunks.live}`);
assert((await getCacheRecord(`${playlistId}:${meta.generation}:live:2`))?.items?.length === 200, "Final live cache chunk was incomplete");
first.dom.window.close();

let restartNetworkCalls = 0;
const second = createWindow(async () => { restartNetworkCalls += 1; throw new Error("Network must not run for a fresh cache"); }, savedState);
for (let i = 0; i < 120 && !second.window.document.body.textContent.includes("Cached Channel 1"); i += 1) await wait(20);
assert(second.window.document.body.textContent.includes("Cached Channel 1"), "Fresh app restart did not restore the chunked library cache");
assert(restartNetworkCalls === 0, "Fresh cached launch made an unnecessary server request");
assert(second.window.document.querySelectorAll("[data-item-id]").length <= 36, "Cached restart rendered the whole large catalog at once");

console.log(`MazenmiXTream chunked cache restart test passed (${clientFile}).`);
second.dom.window.close();
