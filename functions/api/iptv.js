// Cloudflare Pages Function for the browser-only MazenmiXTream build.
// This is intentionally an allowlisted relay, NOT an unrestricted open proxy.
// Configure MX_IPTV_ALLOWED_ORIGINS in Cloudflare Pages > Settings > Variables.
import { IPTV_ORIGINS } from "../../config/iptv-origins.js";
const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 4096;

function errorResponse(message, status, code = "", origin = "") {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-MX-IPTV-Error": code,
      "X-MX-IPTV-Origin": origin
    }
  });
}

function allowedOrigins(env) {
  return new Set([...IPTV_ORIGINS, ...String(env.MX_IPTV_ALLOWED_ORIGINS || "")
    .split(/[\s,;]+/)
    .filter(Boolean)]
    .map((entry) => {
      try {
        const url = new URL(entry.includes("://") ? entry : "http://" + entry);
        if (url.protocol === "https:" && url.port === "2052") url.protocol = "http:";
        return url.origin;
      } catch { return ""; }
    }).filter(Boolean));
}

function safeTarget(value, allowed) {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (/^(localhost|.+\.localhost|.+\.local)$/i.test(url.hostname)) return null;
  // Providers using port 2052 often expose plain HTTP only. Preserve the port.
  if (url.protocol === "https:" && url.port === "2052") url.protocol = "http:";
  if (!allowed.has(url.origin)) return null;
  return url;
}

function proxiedUrl(url, pageOrigin) {
  return pageOrigin + "/api/iptv?url=" + encodeURIComponent(url.href);
}

function rewriteManifest(manifest, baseUrl, allowed, pageOrigin) {
  const rewrite = (value) => {
    try {
      const resolved = safeTarget(new URL(value, baseUrl).href, allowed);
      return resolved ? proxiedUrl(resolved, pageOrigin) : value;
    } catch { return value; }
  };
  return manifest.split(/(\r?\n)/).map((line) => {
    if (!line || /^\r?\n$/.test(line)) return line;
    if (line.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, url) => 'URI="' + rewrite(url) + '"');
    }
    return rewrite(line.trim());
  }).join("");
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "POST") return errorResponse("Method not allowed", 405);
  const siteOrigin = new URL(request.url).origin;
  if (request.headers.get("Origin") && request.headers.get("Origin") !== siteOrigin) {
    return errorResponse("Cross-origin access denied", 403);
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return errorResponse("Cross-site access denied", 403);
  }
  const allowed = allowedOrigins(env);
  if (!allowed.size) return errorResponse("IPTV proxy is not configured. Set MX_IPTV_ALLOWED_ORIGINS in Cloudflare Pages.", 503);

  let incomingUrl;
  try {
    if (request.method === "POST") {
      if (Number(request.headers.get("Content-Length") || 0) > 8192) return errorResponse("Request too large", 413);
      const body = await request.json();
      incomingUrl = body?.url;
    } else {
      incomingUrl = new URL(request.url).searchParams.get("url");
    }
  } catch { return errorResponse("Invalid request", 400); }

  let remote = safeTarget(incomingUrl, allowed);
  if (!remote) {
    let origin = "";
    try { origin = new URL(incomingUrl).origin; } catch {}
    return errorResponse("Server origin not allowed" + (origin ? ": " + origin : "") + ". Add this provider to MX_IPTV_ALLOWED_ORIGINS and redeploy.", 403, "origin_not_allowed", origin);
  }

  let upstream;
  // Match the IPTV client headers already used by the native MX player.
  // Some providers reject generic relay/browser user agents on media routes.
  const headers = new Headers({ Accept: "*/*", "Cache-Control": "no-store", "User-Agent": "VLC/3.0.21 LibVLC/3.0.21 MazenmiXTream/1.1.6" });
  const range = request.headers.get("Range");
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("Range", range);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try { upstream = await fetch(remote.href, {
        method: "GET",
        headers,
        redirect: "manual",
        // Older Pages compatibility dates reject RequestInit.cache before
        // sending a request. Use HTTP headers and cf cache settings instead.
        signal: controller.signal,
        cf: { cacheTtl: 0, cacheEverything: false }
      }); } finally { clearTimeout(timeout); }
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get("Location");
      if (!location || redirect === MAX_REDIRECTS) return errorResponse("Upstream redirect failed", 502);
      const destination = new URL(location, remote);
      const next = safeTarget(destination.href, allowed);
      if (!next) return errorResponse("Stream redirected to an unapproved provider CDN: " + destination.origin + ". Add this origin to MX_IPTV_ALLOWED_ORIGINS and redeploy.", 502, "redirect_origin_not_allowed", destination.origin);
      remote = next;
    }
  } catch (error) {
    // Keep playlist credentials and full stream URLs out of function logs.
    // This only logs connection metadata for troubleshooting.
    console.error("MX_IPTV_UPSTREAM_FAILURE", {
      origin: remote.origin,
      errorType: String(error?.name || "UnknownError"),
      causeType: String(error?.cause?.name || ""),
      causeCode: String(error?.cause?.code || "")
    });
    return errorResponse("The IPTV server could not be reached from Cloudflare", 502, "upstream_unreachable", remote.origin);
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Origin": siteOrigin
  });
  const type = upstream.headers.get("Content-Type") || "application/octet-stream";
  responseHeaders.set("Content-Type", type);
  for (const name of ["Accept-Ranges", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse("IPTV server returned HTTP " + upstream.status, upstream.status, "upstream_http_error", remote.origin);
  }

  if (/m3u8(?:$|\?)/i.test(remote.pathname + remote.search) ||
      /(?:apple\.mpegurl|x-mpegurl)/i.test(type)) {
    const text = await upstream.text();
    if (!text.trimStart().startsWith("#EXTM3U")) {
      return errorResponse("The provider returned an empty or invalid HLS playlist", 502, "invalid_manifest", remote.origin);
    }
    return new Response(rewriteManifest(text, remote, allowed, siteOrigin), {
      status: 200,
      headers: new Headers({ ...Object.fromEntries(responseHeaders), "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" })
    });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
