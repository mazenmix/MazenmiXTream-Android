# MX TV Web production deployment

This file was added to trigger a new deployment from the `web-cloudflare` branch after selecting it as the Cloudflare Pages production branch.

Cloudflare project: `mxtv1`.
Production URL: `https://mxtv1.pages.dev/`.

The `main` branch and Android APK are unchanged.

The provider from the reported connection failure is included in `config/iptv-origins.js`. Additional provider/CDN origins can be added there or through the production Pages variable `MX_IPTV_ALLOWED_ORIGINS`, without account credentials.
