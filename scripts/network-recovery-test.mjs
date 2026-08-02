import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "https://app.local/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
window.Hls = { isSupported: () => false };
window.mpegts = { isSupported: () => false };
window.MazenNetwork = {
  proxyUrl: (url) => `https://mx.local/${String(url).startsWith("http://") ? "http" : "https"}/${String(url).replace(/^https?:\/\//, "")}`
};
window.MazenPlayer = {
  isAvailable: () => true, play: () => {}, stop: () => {}, pause: () => {}, resume: () => {},
  setMuted: () => {}, setVolume: () => {}, setAspect: () => {}, setBrightness: () => {}, setViewport: () => {}, resetViewport: () => {}
};

let activeRequests = 0;
let maxConcurrentRequests = 0;
let interruptedOnce = false;
const calls = [];
const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
  json: async () => data
});

window.fetch = async (url) => {
  const value = String(url);
  calls.push(value);
  activeRequests += 1;
  maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
  try {
    await wait(8);
    const decoded = decodeURIComponent(value);
    const action = new URL(decoded.replace(/^https:\/\/mx\.local\/(?:http|https)\//, "http://")).searchParams.get("action") || "";
    if (action === "get_live_streams" && value.includes("mx.local") && !interruptedOnce) {
      interruptedOnce = true;
      throw new Error("signal is aborted without reason");
    }
    if (!action) return jsonResponse({ user_info: { status: "Active", exp_date: "1800000000", max_connections: "1", active_cons: "0" }, server_info: { timezone: "UTC" } });
    if (action === "get_live_categories") return jsonResponse([{ category_id: "1", category_name: "News" }]);
    if (action === "get_vod_categories") return jsonResponse([{ category_id: "2", category_name: "Movies" }]);
    if (action === "get_series_categories") return jsonResponse([{ category_id: "3", category_name: "Series" }]);
    if (action === "get_live_streams") return jsonResponse([{ stream_id: 11, name: "Recovery News", category_id: "1", stream_icon: "" }]);
    if (action === "get_vod_streams") return jsonResponse([{ stream_id: 22, name: "Recovery Movie", category_id: "2", container_extension: "mp4" }]);
    if (action === "get_series") return jsonResponse([{ series_id: 33, name: "Recovery Series", category_id: "3" }]);
    return jsonResponse([], 404);
  } finally {
    activeRequests -= 1;
  }
};

const clientFile = process.argv[2] || process.env.MX_CLIENT || "main.js";
window.eval(fs.readFileSync(clientFile, "utf8"));
await wait(820);
window.document.querySelector("[data-action='add-playlist']").click();
window.document.querySelector("input[name='name']").value = "Recovery QA";
window.document.querySelector("input[name='baseUrl']").value = "http://slow.test:8080";
window.document.querySelector("input[name='username']").value = "qa-user";
window.document.querySelector("input[name='password']").value = "qa-pass";
window.document.getElementById("savePlaylistBtn").click();

for (let i = 0; i < 80 && !window.document.body.textContent.includes("Recovery News"); i += 1) await wait(20);
assert(interruptedOnce, "The simulated Android abort did not run");
assert(window.document.body.textContent.includes("Recovery News"), "The app did not recover after the native request was aborted");
assert(maxConcurrentRequests === 1, `Xtream endpoints loaded concurrently (${maxConcurrentRequests}) instead of sequentially`);
assert(calls.some((url) => url.includes("mx.local")), "The native Android network route was not tried");
assert(calls.some((url) => url.startsWith("http://slow.test") && url.includes("get_live_streams")), "The direct route did not recover the interrupted native request");

window.document.querySelector("[data-view='movies']").click();
assert(window.document.body.textContent.includes("Recovery Movie"), "Movies were missing after the recovered full-library load");
window.document.querySelector("[data-view='series']").click();
assert(window.document.body.textContent.includes("Recovery Series"), "Series were missing after the recovered full-library load");

console.log(`MazenmiXTream slow-network and abort recovery test passed (${clientFile}).`);
dom.window.close();
