import assert from "node:assert/strict";
import worker from "../_worker.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({ user_info: { auth: 1 } });
try {
  // Pages Preview and Production both have the installation provider without
  // relying on separate dashboard function builds or preview environment vars.
  const request = new Request("https://deployment.example/api/iptv", {
    method: "POST", headers: { Origin: "https://deployment.example" },
    body: JSON.stringify({ url: "http://link.faltulog.org:2052/player_api.php?username=test&password=test" })
  });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-MX-Release"), "2026-11-09-playback-recovery");
  assert.equal((await response.json()).user_info.auth, 1);

  const assetRequest = new Request("https://deployment.example/web.js");
  const asset = await worker.fetch(assetRequest, { ASSETS: { fetch(request) { assert.equal(request, assetRequest); return new Response("static asset"); } } });
  assert.equal(await asset.text(), "static asset");
} finally { globalThis.fetch = originalFetch; }
console.log("Pages advanced Worker: installation provider, release marker and static asset routing passed.");
