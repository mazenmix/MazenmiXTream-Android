# MX TV 3.8 exact-APK multi-server patch

This patch is intentionally isolated from the MazenmiXtream 1.1.6 source tree.
It applies only to the uploaded legacy/native MX TV APK identified below.

## Exact input identity

- File: `MX.TV(2).apk`
- SHA-256: `92124152f10eefbd0964479090cf797a2f8cb3aad28ecca6e6491ec3d2abb796`
- Package: `com.alfahad.shadEed`
- Version name: `3.8`
- Version code: `41`
- Minimum SDK: `21`
- Target SDK: `33`

## Root causes fixed

1. Every density-specific `portal_item_add.xml` except the default layout set the add card, icon, and label to `visibility="gone"`. Android TV selected one of those density resources, so the add action disappeared while it remained visible in BlueStacks.
2. The add/edit decision trusted a RecyclerView adapter position. Android TV focus/layout changes could make that position stale and open the existing server in Update mode. The add row now uses its null `UrlModel` as the authoritative discriminator.
3. Playlist sanitization retained only IDs beginning with `local-`. Existing valid user playlists with another ID were discarded during reload. The patch retains all non-protected, non-legacy user playlists.

## Apply

Decode the exact APK with Apktool 3.x, run the version-locked patcher, then rebuild and sign with the normal release key:

```bash
apktool d -f "MX.TV(2).apk" -o mx-tv-3.8-decoded
node scripts/patch-exact-v38-multiserver.mjs mx-tv-3.8-decoded
apktool b mx-tv-3.8-decoded -o MX.TV.v3.8.MultiServerFix-unsigned.apk
```

The patcher refuses a decoded APK unless `versionCode` is `41` and `versionName` is `3.8`.

## Verification invariants

- The add card is visible in default, hdpi, tvdpi, xhdpi, xxhdpi, and xxxhdpi resources.
- Clicking the add row always opens a new playlist, never Update mode.
- `upsert` appends when the position is invalid/new, then persists to SharedPreferences and the local backup file.
- Existing non-protected user playlists survive activity reload and application restart.
- Live TV, VOD, Series, playback, EPG, and sync code are untouched.
