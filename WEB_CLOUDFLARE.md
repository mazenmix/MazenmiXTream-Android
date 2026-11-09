# MazenmiXTream Web (Cloudflare Pages)

This branch is dedicated to the **web browser version only**. The Android APK
is built from `main` and is not modified by these changes.

## Cloudflare Pages setup

1. Open the existing Cloudflare Pages project, **mxtv1**.
2. Under **Settings > Builds & deployments > Production branch**, switch
   from `main` to `web-cloudflare`. Keep build output directory `.`.
3. The installation provider in `config/iptv-origins.js` is included automatically.
   To add more provider/CDN origins, update that list or, under
   **Settings > Variables and Secrets**, add a plain-text environment
   variable named `MX_IPTV_ALLOWED_ORIGINS` for **Production** (and Preview
   if preview testing is wanted). Its value is a comma-separated list of
   the server's exact original origins, for example
   `http://your-iptv-provider.example:2052`.
   Add any CDN origins used by the stream or image URLs. Do not include
   your username, password, or playlist URL in this variable.
4. Save and redeploy the latest `web-cloudflare` deployment.
5. In **Manage playlists**, set the provider URL to its actual protocol.
   If the provider runs plain HTTP on 2052, keep `http://` rather than
   forcing `https://`. The website itself stays HTTPS.
6. Clear the playlist cache using the app's Manage Playlists save action,
   then retry.

The browser adapter routes allowed requests to `/api/iptv`, where a
Cloudflare Pages Function fetches from the allowed upstreams. Xtream API
requests use POST to avoid putting their username/password in the relay
request URL. Media requests may still contain the provider credentials in
the encoded URL, because HTML media elements generally use GET; protect
access to the site and the provider account.

## Security and limitations

- Every upstream origin must be explicitly allowlisted, either in the installation
  configuration or in `MX_IPTV_ALLOWED_ORIGINS`. The two lists are combined.
- Only HTTP and HTTPS targets, no localhost/private local destinations.
- Unapproved redirects are blocked.
- Response caching is disabled.
- Workers/Pages limits, upstream anti-proxy policies, licensing constraints,
  heavy MPEG-TS streams, and server-specific authentication can still prevent
  playback. Use this with IPTV content you are authorized to access.
- Never put provider login credentials into the public GitHub repo.
- If the server redirects to a CDN, add that CDN's exact origin to the
  Cloudflare allowlist and redeploy.
- `main` and the existing APK are unchanged.

## Web validation

Run `npm run check:web` after installing the development dependencies. This checks
provider admission, denied targets, HLS segment/key rewriting, Range responses,
automatic reconnection, channel rendering, persistent errors/retry, authentication,
M3U playback URLs, player cleanup and cancellation when switching accounts.

The configured provider URL is also the default media base; `server_info` aliases
are not substituted into playback URLs. Provider `direct_source` URLs still work
when their origins are approved. Live channels appear while other library sections
continue loading. A failed section reports its error without discarding loaded channels.

The tests use fixtures, not subscriber credentials. Real subscription playback
requires checking a valid account in the deployed browser.

## Media request compatibility and recovery

The relay uses the same IPTV User-Agent as the native MX player. A live Xtream
channel keeps its direct source and the generated routes for its advertised
HLS/TS formats. A failed source is stopped before trying the next, once per
source; M3U, movies and episodes are not rewritten to guessed format URLs.

Playback failures show the upstream HTTP status and, for a blocked redirect,
the CDN origin. Use **Copy error** to share this diagnostic; it excludes subscriber
credentials, stream paths and query strings. CDN origins still require approval
in the installation allowlist or `MX_IPTV_ALLOWED_ORIGINS`. **Retry** restarts the
selected channel without reloading the catalog.

## Pages runtime artifact

The checked-in `_worker.js` is the self-contained Pages advanced-mode entry.
It delegates `/api/iptv` to `functions/api/iptv.js` and other paths to `env.ASSETS`.
Run `npm run build:web` after changing the relay or installation origins, then
commit the generated Worker with the source. `npm run check:web` verifies the
artifact is current and tests the same module that Pages will deploy.

An API response from the current deployment includes
`X-MX-Release: 2026-11-09-playback-recovery`. Check this header when distinguishing
a stale deployment from a provider playback error.
