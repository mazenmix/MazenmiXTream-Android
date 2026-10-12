# MazenmiXTream Web (Cloudflare Pages)

This branch is dedicated to the **web browser version only**. The Android APK
is built from `main` and is not modified by these changes.

## Cloudflare Pages setup

1. Open the existing Cloudflare Pages project, **mxtv1**.
2. Under **Settings > Builds & deployments > Production branch**, switch
   from `main` to `web-cloudflare`. Keep build output directory `.`.
3. Under **Settings > Variables and Secrets**, add a plain-text environment
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

- No open proxy: every upstream origin must be explicitly allowlisted.
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
