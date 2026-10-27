#!/usr/bin/env python3
"""
Apply a narrow feature patch to the SAME decompiled original Android APK:
- Keep its package, screens, resources, streaming engine and existing playlists.
- Raise canonical fixed playlist slots from 15 to 50.
- Add a Stalker / MAG entry button on its native playlist manager screen.
- The new separate Android activity performs authorized MAC/portal handshake,
  channel collection and in-app HTTP live-stream playback.
"""
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
playlist = root / "smali/com/mazenmixtream/playlist/PlaylistStore.smali"
activity = root / "smali/com/shadeed/ibopro/activities/ChangePlaylistActivity.smali"
manifest = root / "AndroidManifest.xml"
for path in [playlist, activity, manifest]:
    if not path.exists():
        raise SystemExit("Unexpected APK structure; refusing unverified patch: " + str(path))

source = playlist.read_text()
needle = ":goto_build_slots\n    const/16 v10, 0xf"
if source.count(needle) != 1:
    raise SystemExit("50 playlist fixed slot marker not found exactly once")
source = source.replace(needle, ":goto_build_slots\n    const/16 v10, 0x32")
playlist.write_text(source)

source = activity.read_text()
matcher = re.search(
    r"(?ms)^\.method[^\n]*\bonCreate\(Landroid/os/Bundle;\)V\n.*?^\.end method",
    source
)
if not matcher:
    raise SystemExit("Playlist manager onCreate method not found")
old_method = matcher.group(0)
if "Lcom/mazenmixtream/stalker/StalkerActivity;->attach" in old_method:
    raise SystemExit("Already patched")
hook = (
    "    invoke-static/range {p0 .. p0}, "
    "Lcom/mazenmixtream/stalker/StalkerActivity;->attach(Landroid/app/Activity;)V\n\n"
    "    return-void"
)
patched_method = old_method.replace("    return-void", hook)
if patched_method == old_method:
    raise SystemExit("Playlist manager onCreate has no return-void to attach hook")
activity.write_text(source[:matcher.start()] + patched_method + source[matcher.end():])

source = manifest.read_text()
if "</application>" not in source:
    raise SystemExit("Unexpected AndroidManifest.xml: no application element")
if "com.mazenmixtream.stalker.StalkerActivity" in source:
    raise SystemExit("Already patched")
source = source.replace(
    "</application>",
    '<activity android:name="com.mazenmixtream.stalker.StalkerActivity" '
    'android:exported="false" android:screenOrientation="unspecified" '
    'android:theme="@android:style/Theme.Material.NoActionBar" />'
    "\n    </application>", 1
)
# Stalker portals very often use HTTP. Preserve legacy server support.
match = re.search(r"<application\b[^>]*>", source, flags=re.S)
if not match:
    raise SystemExit("Manifest application opening element missing")
opening = match.group(0)
if "android:usesCleartextTraffic=" not in opening:
    replacement = opening[:-1] + ' android:usesCleartextTraffic="true">'
    source = source.replace(opening, replacement, 1)
elif 'android:usesCleartextTraffic="false"' in opening:
    source = source.replace(
        'android:usesCleartextTraffic="false"',
        'android:usesCleartextTraffic="true"',
        1
    )
manifest.write_text(source)

print("PATCH OK: original app unchanged except 50-slot cap, a Stalker launcher in the original playlist manager and native registered activity")
print("Playlist manager onCreate hook count:", patched_method.count("->attach("))
