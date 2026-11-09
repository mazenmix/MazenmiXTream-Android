import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/iptv.js";

const site = "https://mxtv1.pages.dev";
const provider = "http://link.faltulog.org:2052";
function relay(url, { env = {}, headers = {}, method = "POST" } = {}) {
  return onRequest({ env, request: new Request(site + "/api/iptv" + (method === "GET" ? "?url=" + encodeURIComponent(url) : ""), {
    method, headers: { Origin: site, ...headers },
    ...(method === "POST" ? { body: JSON.stringify({ url }) } : {})
  }) });
}
function upstream(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

test("the installation provider works without a dashboard variable and keeps its port", async t => {
  upstream(t, async (url, options) => {
    assert.equal(url, provider + "/player_api.php?username=test&password=test");
    assert.equal(options.redirect, "manual");
    assert.equal("cache" in options, false, "Older Pages runtimes reject RequestInit.cache");
    assert.equal(options.headers.get("Cache-Control"), "no-store");
    return Response.json({ user_info: { auth: 1 } });
  });
  const result = await relay(provider + "/player_api.php?username=test&password=test");
  assert.equal(result.status, 200);
  assert.equal((await result.json()).user_info.auth, 1);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
});

test("environment providers extend the installation list", async t => {
  upstream(t, async () => Response.json([]));
  for (const url of [provider, "https://extra.example", "http://other.example:2052"]) {
    assert.equal((await relay(url + "/player_api.php", { env: { MX_IPTV_ALLOWED_ORIGINS: "https://extra.example, https://other.example:2052" } })).status, 200);
  }
});

test("unapproved servers, cross-site requests and non-HTTP schemes never reach upstream", async t => {
  upstream(t, () => assert.fail("blocked request reached upstream"));
  for (const url of ["http://unknown.example/x", "file:///etc/passwd", "http://localhost/x", "http://u:p@link.faltulog.org:2052/x"]) {
    assert.equal((await relay(url)).status, 403);
  }
  assert.equal((await relay(provider, { headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await relay(provider, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
});

test("HLS playlists, relative segments and key URLs remain on the HTTPS relay", async t => {
  upstream(t, async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts\n', { headers: { "Content-Type": "application/vnd.apple.mpegurl" } }));
  const result = await relay(provider + "/live/test/test/index.m3u8", { method: "GET" });
  const text = await result.text();
  for (const file of ["key.bin", "segment.ts"]) assert.ok(text.includes(site + "/api/iptv?url=" + encodeURIComponent(provider + "/live/test/test/" + file)));
});

test("range requests preserve partial media responses", async t => {
  upstream(t, async (_url, options) => {
    assert.equal(options.headers.get("Range"), "bytes=0-3");
    return new Response("abcd", { status: 206, headers: { "Content-Range": "bytes 0-3/100", "Accept-Ranges": "bytes", "Content-Type": "video/mp4" } });
  });
  const result = await relay(provider + "/movie/test/test/1.mp4", { method: "GET", headers: { Range: "bytes=0-3" } });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("Content-Range"), "bytes 0-3/100");
  assert.equal(await result.text(), "abcd");
});

test("redirects are checked on every hop", async t => {
  let calls = 0;
  upstream(t, async () => { calls++; return new Response(null, { status: 302, headers: { Location: "https://unapproved.example/live.ts" } }); });
  assert.equal((await relay(provider + "/live/test/test/1.ts")).status, 502);
  assert.equal(calls, 1);
});
