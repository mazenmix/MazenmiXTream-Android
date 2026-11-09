import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../_worker.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("The placeholder must not contact an upstream"); };
const env = { ASSETS: { fetch() { throw new Error("The old application must not be served"); } } };
try {
  for (const path of ["/", "/api/iptv", "/api/iptv/", "/web.js", "/vendor/hls.min.js", "/old-route"]) {
    for (const method of ["GET", "POST", "HEAD"]) {
      const response = await worker.fetch(new Request("https://deployment.example" + path, { method }), env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-MX-Release"), "mx1-placeholder");
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.equal(await response.text(), method === "HEAD" ? "" : html);
    }
  }
  assert.match(html, /<body>mx1<\/body>/);
  assert.doesNotMatch(html, /<script|<iframe|<video/i);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("mx1 placeholder: all routes and methods replace the previous app without upstream requests.");
