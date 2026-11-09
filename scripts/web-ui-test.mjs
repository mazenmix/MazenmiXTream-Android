import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
const source = fs.readFileSync("web.js", "utf8");
const provider = "http://link.faltulog.org:2052";
const profile = { id: "test", name: "Test", type: "xtream", baseUrl: provider, username: "test", password: "test" };
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function app(handler, playlists = [profile]) {
  const dom = new JSDOM(html, { url: "https://mxtv1.pages.dev/", runScripts: "outside-only" });
  const { window: w } = dom;
  w.AbortSignal = AbortSignal; w.AbortController = AbortController;
  w.localStorage.setItem("mxtv.web.premium.v1", JSON.stringify({ playlists, activeId: playlists[0]?.id }));
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.fetch = async (_url, options) => handler(new URL(JSON.parse(options.body).url), options);
  w.eval(source);
  await tick();
  return { dom, w, document: w.document, click: selector => w.document.querySelector(selector).click() };
}
const data = url => {
  const action = url.searchParams.get("action");
  if (!action) return Response.json({ user_info: { auth: 1, status: "Active", allowed_output_formats: ["m3u8"] }, server_info: { url: "wrong.example", port: "80" } });
  if (action.endsWith("categories")) return Response.json([{ category_id: "1", category_name: "News" }]);
  if (action === "get_live_streams") return Response.json([{ stream_id: 1, name: "Test channel", category_id: "1" }]);
  return Response.json([]);
};

// A saved account reconnects at startup and displays usable channels immediately.
{
  let requested = 0;
  const a = await app(url => { requested++; return data(url); });
  assert.equal(requested, 7);
  assert.match(a.document.getElementById("connectionStatus").textContent, /Connected/);
  a.click('[data-route="live"]');
  assert.match(a.document.getElementById("main").textContent, /Test channel/);
  assert.doesNotMatch(a.document.getElementById("main").textContent, /Loading your library/);
  a.click('[data-item="live-1"]');
  const target = new URL(a.document.getElementById("video").src).searchParams.get("url");
  assert.equal(target, provider + "/live/test/test/1.m3u8");
  a.dom.window.close();
}

// MPEG-TS blob workers require absolute relay URLs.
{
  const a = await app(url => !url.searchParams.get("action") ? Response.json({ user_info: { auth: 1, allowed_output_formats: ["ts"] } }) : data(url));
  let streamUrl;
  a.w.mpegts = {
    isSupported: () => true, Events: { ERROR: "error" },
    createPlayer: ({ url }) => { streamUrl = url; return { on() {}, attachMediaElement() {}, load() {}, play() { return Promise.resolve(); }, destroy() {} }; }
  };
  a.click('[data-route="live"]'); a.click('[data-item="live-1"]');
  assert.equal(new URL(streamUrl).origin, "https://mxtv1.pages.dev");
  assert.equal(new URL(streamUrl).searchParams.get("url"), provider + "/live/test/test/1.ts");
  a.dom.window.close();
}

// Errors survive navigation, stop loading and can be retried successfully.
{
  let broken = true;
  const a = await app(url => broken ? new Response("Server origin not allowed", { status: 403 }) : data(url));
  a.click('[data-route="live"]');
  assert.match(a.document.getElementById("main").textContent, /Server origin not allowed/);
  assert.doesNotMatch(a.document.getElementById("main").textContent, /Loading your library/);
  broken = false; a.click("[data-refresh]"); await tick();
  assert.ok(a.document.querySelector('[data-item="live-1"]'));
  assert.equal(a.document.querySelector('[role="alert"]'), null);
  a.dom.window.close();
}

// Invalid credentials must stop before catalog requests.
{
  let calls = 0;
  const a = await app(() => { calls++; return Response.json({ user_info: { auth: 0 } }); });
  assert.equal(calls, 1);
  assert.match(a.document.getElementById("main").textContent, /did not accept this login/);
  a.dom.window.close();
}

// A provider section failure keeps successfully loaded live channels usable.
{
  const a = await app(url => url.searchParams.get("action") === "get_series" ? new Response("Series unavailable", { status: 503 }) : data(url));
  a.click('[data-route="live"]');
  assert.ok(a.document.querySelector('[data-item="live-1"]'));
  assert.match(a.document.getElementById("main").textContent, /Series unavailable/);
  assert.match(a.document.getElementById("connectionStatus").textContent, /Connected/);
  a.dom.window.close();
}

// M3U links already rewritten by the backend are not proxied a second time.
{
  const stream = provider + "/live/test/test/1.m3u8?token=test";
  const proxied = "https://mxtv1.pages.dev/api/iptv?url=" + encodeURIComponent(stream);
  const a = await app(() => new Response('#EXTM3U\n#EXTINF:-1 group-title="News",M3U channel\n' + proxied), [{ ...profile, type: "m3u", m3uUrl: provider + "/get.php" }]);
  let created = 0, destroyed = 0, sourceUrl;
  a.w.Hls = class {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
    constructor() { created++; }
    loadSource(url) { sourceUrl = url; }
    attachMedia() {} on() {} destroy() { destroyed++; }
  };
  a.click('[data-route="live"]');
  a.click('[data-item="live-0"]');
  assert.equal(sourceUrl, proxied);
  a.click('[data-item="live-0"]');
  assert.equal(created, 2); assert.equal(destroyed, 1);
  a.click("#closePlayer"); assert.equal(destroyed, 2);
  a.dom.window.close();
}

// A superseded request cannot overwrite the newly selected account.
{
  const second = { ...profile, id: "second", name: "Second", username: "second" };
  let aborted = false;
  const a = await app((url, options) => {
    if (url.searchParams.get("username") === "test") return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }));
    return data(url);
  }, [profile, second]);
  a.click('[data-route="manage"]'); a.click('[data-activate="second"]'); await tick();
  assert.equal(aborted, true);
  assert.match(a.document.getElementById("connectionStatus").textContent, /Connected/);
  assert.equal(a.document.getElementById("accountName").textContent, "Second");
  a.dom.window.close();
}
console.log("Web UI: startup, channels, retry, authentication, M3U/HLS and account switching passed.");
