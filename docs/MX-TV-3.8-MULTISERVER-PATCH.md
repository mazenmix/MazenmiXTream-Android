# MX TV 3.8 exact-APK multi-server patch

This patch is intentionally isolated from the MazenmiXTream 1.1.6 source tree.
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
4. The legacy payload could repopulate `AlFahad` and `Falcon` cards from cached or server-provided app info. Sanitization now permanently drops every `AlFahad` variant, keeps only one `Falcon`/`MazenmiX` preset, and normalizes it to:
   - Name: `MazenmiX`
   - Server: `http://cf.business-cdn-8k.com`
   - Username: empty
   - Password: empty
   - Type: `Xtream Codes`
5. The first preset cleanup treated an already-renamed `MazenmiX` entry like a fresh `Falcon` on every reload. That reset newly entered Xtream credentials to blanks and could leave the manager empty when the stored model was unavailable. The migration now runs only for `Falcon`; an existing `MazenmiX` entry is preserved byte-for-byte, including its credential-bearing URL. A missing/corrupt playlist model is recovered with one editable `MazenmiX` placeholder instead of an empty manager.
6. The manager now uses a fixed bank of 15 editable slots, named `playlist1` through `playlist15`. Existing `MazenmiX` credentials migrate into `playlist1`; missing slots are generated locally with the requested server domain and blank credentials. The adapter reports exactly the playlist count, so the Add Playlist row is not rendered and a sixteenth slot cannot be created from the manager.
7. Update previously trusted the RecyclerView position passed into the edit dialog. If that position became stale, the edited record could be appended as item 16 and then removed by the 15-slot cap. Update now resolves the target by its stable playlist ID before replacing it. The save path immediately sanitizes the just-written model, and fixed-slot entries are no longer dropped because of `is_protected` or legacy-name filters.

## Apply

Decode the exact APK with Apktool 3.x, run the version-locked patcher, then rebuild and sign with the normal release key:

```bash
apktool d -f "MX.TV(2).apk" -o mx-tv-3.8-decoded
node scripts/patch-exact-v38-multiserver.mjs mx-tv-3.8-decoded
apktool b mx-tv-3.8-decoded -o MX.TV.v3.8.MultiServerFix-unsigned.apk
```

The patcher refuses a decoded APK unless `versionCode` is `41` and `versionName` is `3.8`.

## Verification invariants

- The manager renders exactly 15 editable playlist cards and no Add Playlist card.
- The adapter never exposes a sixteenth row.
- `upsert` replaces the selected slot and persists it to SharedPreferences and the local backup file.
- `upsert` resolves the selected slot by stable ID; a stale adapter position cannot append-and-drop the update.
- Existing non-protected user playlists survive activity reload and application restart.
- `AlFahad` cannot return; `Falcon`/`MazenmiX` migrates once into `playlist1` without losing its credential-bearing URL.
- Editing any of the 15 slots preserves the exact saved server URL, username, and password across dialog dismissal, activity refresh, and application restart.
- Custom slot names are preserved and are not removed by protected/legacy-name filtering.
- Null or empty stored playlist state self-recovers to `playlist1` through `playlist15`.
- Live TV, VOD, Series, playback, EPG, and sync code are untouched.
