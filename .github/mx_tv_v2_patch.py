from pathlib import Path
import re, sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "work")
res = root / "res"
patched = []

for f in sorted(res.glob("layout*/activity_*.xml")):
    s = f.read_text(encoding="utf-8")
    if "@id/txt_series" not in s or "@id/divider_series" not in s:
        continue
    m = re.search(r'(?m)^(\s*)<TextView\b[^\n]*android:id="@id/txt_series"[^\n]*/>\s*$', s)
    if not m:
        continue
    indent = m.group(1)
    line = m.group(0).strip("\n")
    mr = re.search(r'android:nextFocusRight="([^"]+)"', line)
    md = re.search(r'android:nextFocusDown="([^"]+)"', line)
    right = mr.group(1) if mr else "@id/et_search"
    down = md.group(1) if md else "@id/recycler_channel"

    new_series = re.sub(r'android:nextFocusRight="[^"]+"', 'android:nextFocusRight="@id/txt_favorites_top"', line, count=1)
    if new_series == line:
        new_series = line.replace("android:nextFocusLeft=", 'android:nextFocusRight="@id/txt_favorites_top" android:nextFocusLeft=', 1)

    divider = (
        f'{indent}<View android:id="@+id/divider_series_favorite" android:background="@color/button_colors" '
        f'android:layout_width="1.5sp" android:layout_height="0.0sp" android:layout_marginStart="@dimen/_10sdp" '
        f'app:layout_constraintBottom_toBottomOf="@id/divider_home" '
        f'app:layout_constraintStart_toEndOf="@id/txt_series" '
        f'app:layout_constraintTop_toTopOf="@id/divider_home" />'
    )
    fav = (
        f'{indent}<TextView android:textSize="@dimen/txt_live_home_font" android:textColor="@color/gray" '
        f'android:id="@+id/txt_favorites_top" android:background="@drawable/txt_button_bg" '
        f'android:focusable="true" android:nextFocusLeft="@id/txt_series" android:nextFocusRight="{right}" '
        f'android:nextFocusUp="@id/txt_favorites_top" android:nextFocusDown="{down}" android:clickable="true" '
        f'android:onClick="openFavorites" android:text="Favorites" android:layout_width="wrap_content" '
        f'android:layout_height="wrap_content" android:layout_marginStart="@dimen/_10sdp" '
        f'app:layout_constraintBottom_toBottomOf="@id/txt_home" '
        f'app:layout_constraintStart_toEndOf="@id/divider_series_favorite" />'
    )

    if "txt_favorites_top" not in s:
        replacement = indent + new_series.strip() + "\n" + divider + "\n\n" + fav
        s = s[:m.start()] + replacement + s[m.end():]

    s = re.sub(
        r'(<View\b[^\n]*android:id="@id/divider_series"[^\n]*app:layout_constraintStart_toEndOf=")@id/txt_series("[^\n]*/>)',
        r'\1@id/txt_favorites_top\2', s)
    s = re.sub(
        r'(<EditText\b[^\n]*android:id="@id/et_search"[^\n]*android:nextFocusLeft=")@id/txt_series("[^\n]*/>)',
        r'\1@id/txt_favorites_top\2', s)

    f.write_text(s, encoding="utf-8")
    patched.append(str(f.relative_to(root)))

man = root / "AndroidManifest.xml"
ms = man.read_text(encoding="utf-8")
ms = re.sub(r'android:versionCode="\d+"', 'android:versionCode="101"', ms, count=1)
man.write_text(ms, encoding="utf-8")

live_method = """
.method public openFavorites(Landroid/view/View;)V
    .locals 2

    iget-object v0, p0, Lcom/shadeed/ibopro/activities/LiveActivity;->preferenceHelper:Lcom/shadeed/ibopro/helper/PreferenceHelper;

    const/4 v1, 0x3

    invoke-virtual {v0, v1}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->setSharedPreferenceCategoryPos(I)V

    invoke-virtual {p0}, Landroid/app/Activity;->recreate()V

    return-void
.end method
"""

def launch_method(target="Lcom/shadeed/ibopro/activities/LiveActivity;"):
    return f"""
.method public openFavorites(Landroid/view/View;)V
    .locals 3

    new-instance v0, Lcom/shadeed/ibopro/helper/PreferenceHelper;

    invoke-direct {{v0, p0}}, Lcom/shadeed/ibopro/helper/PreferenceHelper;-><init>(Landroid/content/Context;)V

    const/4 v1, 0x3

    invoke-virtual {{v0, v1}}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->setSharedPreferenceCategoryPos(I)V

    new-instance v0, Landroid/content/Intent;

    const-class v1, {target}

    invoke-direct {{v0, p0, v1}}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    const/high16 v2, 0x4000000

    invoke-virtual {{v0, v2}}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;

    invoke-virtual {{p0, v0}}, Landroid/app/Activity;->startActivity(Landroid/content/Intent;)V

    return-void
.end method
"""

classes = {
    "smali/com/shadeed/ibopro/activities/LiveActivity.smali": live_method,
    "smali/com/shadeed/ibopro/activities/LiveChannelActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/MovieActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/MovieSecondActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/SeriesActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/SeriesSecondActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/CategoryActivity.smali": launch_method(),
    "smali/com/shadeed/ibopro/activities/mobile/LiveMobileActivity.smali": launch_method("Lcom/shadeed/ibopro/activities/mobile/LiveMobileActivity;"),
    "smali/com/shadeed/ibopro/activities/mobile/LiveChannelMobileActivity.smali": launch_method("Lcom/shadeed/ibopro/activities/mobile/LiveMobileActivity;"),
}

for rel, method in classes.items():
    f = root / rel
    if not f.exists():
        continue
    s = f.read_text(encoding="utf-8")
    if ".method public openFavorites(Landroid/view/View;)V" in s:
        continue
    marker = ".method public onClick(Landroid/view/View;)V"
    idx = s.find(marker)
    if idx < 0:
        idx = len(s)
    s = s[:idx] + method + "\n" + s[idx:]
    f.write_text(s, encoding="utf-8")

print(f"Patched {len(patched)} layout variants")
assert len(patched) >= 30
assert "divider_series_favorite" in (root / "res/layout/activity_live_channel.xml").read_text(encoding="utf-8")
assert 'android:text="Favorites"' in (root / "res/layout/activity_live_channel.xml").read_text(encoding="utf-8")
