// Cloudflare Pages Function for the browser-only MazenmiXTream build.
// This is intentionally an allowlisted relay, NOT an unrestricted open proxy.
// Configure MX_IPTV_ALLOWED_ORIGINS in Cloudflare Pages > Settings > Variables.
const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 4096;

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function allowedOrigins(env) {
  return new Set(String(env.MX_IPTV_ALLOWED_ORIGINS || "")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((entry) => {
      try {
        const url = new URL(entry.includes("://") ? entry : "http://" + entry);
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
  if (!remote) return errorResponse("Server origin not allowed. Review MX_IPTV_ALLOWED_ORIGINS.", 403);

  let upstream;
  const headers = new Headers({ Accept: "*/*" });
  const range = request.headers.get("Range");
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("Range", range);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      upstream = await fetch(remote.href, {
        method: "GET",
        headers,
        redirect: "manual",
        cache: "no-store",
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get("Location");
      if (!location || redirect === MAX_REDIRECTS) return errorResponse("Upstream redirect failed", 502);
      const next = safeTarget(new URL(location, remote).href, allowed);
      if (!next) return errorResponse("Stream redirected outside allowed origins", 502);
      remote = next;
    }
  } catch {
    return errorResponse("The IPTV server could not be reached from Cloudflare", 502);
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
    return errorResponse("IPTV server returned HTTP " + upstream.status, upstream.status);
  }

  if (/m3u8(?:$|\?)/i.test(remote.pathname + remote.search) ||
      /(?:apple\.mpegurl|x-mpegurl)/i.test(type)) {
    const text = await upstream.text();
    return new Response(rewriteManifest(text, remote, allowed, siteOrigin), {
      status: 200,
      headers: new Headers({ ...Object.fromEntries(responseHeaders), "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" })
    });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
