# mx1 production deployment

Cloudflare project: `mxtv1`.
Production URL: `https://mxtv1.pages.dev/`.
Production source branch: `web-cloudflare`.

This deployment intentionally replaces the IPTV web application with a black
screen showing only `mx1`. The advanced-mode Worker handles every route,
including former API and asset paths, without invoking the IPTV relay or assets.
The response disables caching and includes `X-MX-Release: mx1-placeholder`.

Run `npm run build:web` to regenerate `_worker.js`, then `npm run check:web`.
The Android application remains on its own branch. Previous web implementation
files are retained for recovery but are not served by this deployment.
