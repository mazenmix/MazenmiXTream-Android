// Browser-only adapter. The Android branch does not load this file.
(() => {
  "use strict";
  if (window.MazenNetwork && typeof window.MazenNetwork.proxyUrl === "function") return;

  const apiRoute = "/api/iptv";
  const storageKey = "mazenmixtream.state.v1";
  let lastSavedState = null;
  let hosts = new Set();

  function playlistHosts() {
    let saved = "";
    try { saved = localStorage.getItem(storageKey) || ""; } catch {}
    if (saved !== lastSavedState) {
      lastSavedState = saved;
      hosts = new Set();
      try {
        const state = JSON.parse(saved);
        for (const p of Array.isArray(state?.playlists) ? state.playlists : []) {
          for (const raw of [p.baseUrl, p.m3uUrl, p.serverInfo?.stream_base]) {
            try { hosts.add(new URL(raw).host.toLowerCase()); } catch {}
          }
        }
      } catch {}
    }
    return hosts;
  }

  function proxyUrl(input) {
    const value = String(input || "");
    let target;
    try { target = new URL(value); } catch { return value; }
    if (!["http:", "https:"].includes(target.protocol) || target.origin === location.origin) return value;

    // HTTP is blocked as mixed content. Known Xtream origins also need an
    // HTTPS same-origin route to avoid CORS and incompatible upstream TLS.
    const known = playlistHosts().has(target.host.toLowerCase());
    if (target.protocol !== "http:" && !known && target.port !== "2052") return value;
    return location.origin + apiRoute + "?url=" + encodeURIComponent(value);
  }

  window.MazenNetwork = { proxyUrl, isWebProxy: true };

  // Keep Xtream login credentials out of the relay URL for account/API calls.
  // Video/image URLs are GETs because native media elements require them.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function webIPTVFetch(input, init) {
    try {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.origin);
      if (requestUrl.origin === location.origin &&
          requestUrl.pathname === apiRoute && requestUrl.searchParams.has("url")) {
        const remote = new URL(requestUrl.searchParams.get("url"));
        const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method === "GET" && /\/(?:player_api|panel_api)\.php$/i.test(remote.pathname)) {
          const options = { ...(init || {}) };
          const headers = new Headers(options.headers || {});
          headers.set("Content-Type", "application/json");
          options.method = "POST";
          options.headers = headers;
          options.body = JSON.stringify({ url: remote.href });
          return nativeFetch(apiRoute, options);
        }
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
