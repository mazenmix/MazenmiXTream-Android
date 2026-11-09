import { onRequest } from "../functions/api/iptv.js";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/iptv" || path === "/api/iptv/") {
      const response = await onRequest({ request, env });
      response.headers.set("X-MX-Release", "2026-11-09-playback-recovery");
      return response;
    }
    return env.ASSETS.fetch(request);
  }
};
