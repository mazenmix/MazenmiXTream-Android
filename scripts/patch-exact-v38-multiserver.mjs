#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const decodedRoot = process.argv[2] ? resolve(process.argv[2]) : null;

if (!decodedRoot) {
  throw new Error("Usage: node scripts/patch-exact-v38-multiserver.mjs <apktool-decoded-directory>");
}

const metadataPath = resolve(decodedRoot, "apktool.yml");
const metadata = await readFile(metadataPath, "utf8");

if (!/versionCode:\s*41\b/.test(metadata) || !/versionName:\s*3\.8\b/.test(metadata)) {
  throw new Error("Refusing to patch: expected MX TV versionCode 41 / versionName 3.8");
}

async function replaceExact(relativePath, before, after) {
  const path = resolve(decodedRoot, relativePath);
  const original = await readFile(path, "utf8");

  if (original.includes(after)) {
    return false;
  }

  const first = original.indexOf(before);
  const last = original.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`Expected exactly one unpatched block in ${relativePath}`);
  }

  await writeFile(path, original.replace(before, after), "utf8");
  return true;
}

const playlistFilterPath = "smali/com/mazenmixtream/playlist/PlaylistStore.smali";
const localIdOnlyBlock = `    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getId()Ljava/lang/String;

    move-result-object v6

    if-eqz v6, :cond_2

    const-string v1, "local-"

    invoke-virtual {v6, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v6

    if-eqz v6, :cond_2

`;

const filterPath = resolve(decodedRoot, playlistFilterPath);
const filterSource = await readFile(filterPath, "utf8");
if (filterSource.includes(localIdOnlyBlock)) {
  await writeFile(filterPath, filterSource.replace(localIdOnlyBlock, ""), "utf8");
} else if (filterSource.includes('const-string v1, "local-"')) {
  throw new Error(`Unexpected local-ID filter shape in ${playlistFilterPath}`);
}

const activityPath = "smali/com/shadeed/ibopro/activities/ChangePlaylistActivity.smali";
await replaceExact(
  activityPath,
  `    if-eqz p3, :cond_2

    .line 2`,
  `    if-eqz p3, :cond_2

    # The add row has no UrlModel. This remains reliable when Android TV
    # focus/layout passes make the adapter position temporarily stale.
    if-eqz p1, :cond_add_playlist

    .line 2`,
);

await replaceExact(
  activityPath,
  `    if-ne p3, v0, :cond_0

    const/4 p1, -0x1`,
  `    if-ne p3, v0, :cond_0

    :cond_add_playlist

    const/4 p1, -0x1`,
);

const densityLayouts = ["hdpi", "tvdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
for (const density of densityLayouts) {
  const relativePath = `res/layout-${density}/portal_item_add.xml`;
  const path = resolve(decodedRoot, relativePath);
  let source = await readFile(path, "utf8");
  source = source.replace('android:background="@drawable/portal_item_bg"', 'android:background="@drawable/mazen_add_card"');
  source = source.replaceAll(' android:visibility="gone"', "");
  source = source.replace('android:text=""', 'android:text="@string/mazenmix_add_playlist"');

  if (source.includes('visibility="gone"') || !source.includes("@string/mazenmix_add_playlist")) {
    throw new Error(`Add Playlist visibility invariant failed in ${relativePath}`);
  }

  await writeFile(path, source, "utf8");
}

console.log("MX TV 3.8 multi-server patch applied successfully.");
