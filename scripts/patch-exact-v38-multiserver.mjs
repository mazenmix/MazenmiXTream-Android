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

await replaceExact(
  playlistFilterPath,
  `.method public static sanitize(Landroid/content/Context;Lcom/shadeed/ibopro/models/AppInfoModel;)Lcom/shadeed/ibopro/models/AppInfoModel;
    .locals 7`,
  `.method public static sanitize(Landroid/content/Context;Lcom/shadeed/ibopro/models/AppInfoModel;)Lcom/shadeed/ibopro/models/AppInfoModel;
    .locals 8`,
);

await replaceExact(
  playlistFilterPath,
  `    .locals 8

    if-eqz p1, :cond_5

    new-instance v0, Lcom/shadeed/ibopro/helper/PreferenceHelper;`,
  `    .locals 8

    if-nez p1, :cond_input_ready

    new-instance p1, Lcom/shadeed/ibopro/models/AppInfoModel;

    invoke-direct {p1}, Lcom/shadeed/ibopro/models/AppInfoModel;-><init>()V

    :cond_input_ready

    new-instance v0, Lcom/shadeed/ibopro/helper/PreferenceHelper;`,
);

await replaceExact(
  playlistFilterPath,
  `    new-instance v3, Ljava/util/ArrayList;

    invoke-direct {v3}, Ljava/util/ArrayList;-><init>()V

    if-eqz v2, :cond_3`,
  `    new-instance v3, Ljava/util/ArrayList;

    invoke-direct {v3}, Ljava/util/ArrayList;-><init>()V

    const/4 v7, 0x0

    if-eqz v2, :cond_3`,
);

await replaceExact(
  playlistFilterPath,
  `    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getIs_protected()Ljava/lang/String;

    move-result-object v6

    const-string v1, "1"

    invoke-virtual {v6, v1}, Ljava/lang/String;->equalsIgnoreCase(Ljava/lang/String;)Z

    move-result v6

    if-nez v6, :cond_2

    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getName()Ljava/lang/String;

    move-result-object v6

    invoke-static {v6}, Lcom/mazenmixtream/playlist/PlaylistStore;->isLegacyName(Ljava/lang/String;)Z

    move-result v6

    if-nez v6, :cond_2

    invoke-interface {v3, v5}, Ljava/util/List;->add(Ljava/lang/Object;)Z`,
  `    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getName()Ljava/lang/String;

    move-result-object v6

    if-eqz v6, :cond_2

    invoke-virtual {v6}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object v6

    invoke-virtual {v6}, Ljava/lang/String;->toLowerCase()Ljava/lang/String;

    move-result-object v6

    const-string v1, "alfahad"

    invoke-virtual {v6, v1}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z

    move-result v1

    if-nez v1, :cond_2

    const-string v1, "falcon"

    invoke-virtual {v6, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v1

    if-nez v1, :cond_mazenmix_preset

    const-string v1, "mazenmix"

    invoke-virtual {v6, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v1

    if-eqz v1, :cond_check_protected

    if-nez v7, :cond_2

    const/4 v7, 0x1

    const-string v1, "playlist1"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setName(Ljava/lang/String;)V

    goto :cond_add_playlist

    :cond_mazenmix_preset
    if-nez v7, :cond_2

    const/4 v7, 0x1

    const-string v1, "playlist1"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setName(Ljava/lang/String;)V

    const-string v1, "http://cf.business-cdn-8k.com/get.php?username=&password=&output=ts&type=m3u_plus"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setUrl(Ljava/lang/String;)V

    const-string v1, "Xtream Codes"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setType(Ljava/lang/String;)V

    goto :cond_add_playlist

    :cond_check_protected
    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getIs_protected()Ljava/lang/String;

    move-result-object v6

    const-string v1, "1"

    invoke-virtual {v6, v1}, Ljava/lang/String;->equalsIgnoreCase(Ljava/lang/String;)Z

    move-result v6

    if-nez v6, :cond_2

    :cond_legacy_name
    invoke-virtual {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getName()Ljava/lang/String;

    move-result-object v6

    invoke-static {v6}, Lcom/mazenmixtream/playlist/PlaylistStore;->isLegacyName(Ljava/lang/String;)Z

    move-result v6

    if-nez v6, :cond_2

    :cond_add_playlist

    invoke-interface {v3}, Ljava/util/List;->size()I

    move-result v6

    const/16 v1, 0xf

    if-ge v6, v1, :cond_2

    invoke-interface {v3, v5}, Ljava/util/List;->add(Ljava/lang/Object;)Z`,
);

await replaceExact(
  playlistFilterPath,
  `    :cond_3
    invoke-virtual {p1, v3}, Lcom/shadeed/ibopro/models/AppInfoModel;->setResult(Ljava/util/List;)V`,
  `    :cond_3
    invoke-interface {v3}, Ljava/util/List;->size()I

    move-result v6

    :goto_fill_slots
    const/16 v1, 0xf

    if-ge v6, v1, :cond_persist_sanitized

    new-instance v5, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;

    invoke-direct {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;-><init>()V

    add-int/lit8 v4, v6, 0x1

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v2, "local-mx-slot-"

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v4}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v5, v2}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setId(Ljava/lang/String;)V

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v2, "playlist"

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v4}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v5, v2}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setName(Ljava/lang/String;)V

    const-string v1, "http://cf.business-cdn-8k.com/get.php?username=&password=&output=ts&type=m3u_plus"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setUrl(Ljava/lang/String;)V

    const-string v1, "Xtream Codes"

    invoke-virtual {v5, v1}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setType(Ljava/lang/String;)V

    invoke-interface {v3, v5}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    add-int/lit8 v6, v6, 0x1

    goto :goto_fill_slots

    :cond_persist_sanitized
    invoke-virtual {p1, v3}, Lcom/shadeed/ibopro/models/AppInfoModel;->setResult(Ljava/util/List;)V`,
);

const adapterPath = "smali/com/shadeed/ibopro/adapter/PortalRecyclerAdapter.smali";
await replaceExact(
  adapterPath,
  `    invoke-interface {v0}, Ljava/util/List;->size()I

    move-result v0

    add-int/lit8 v0, v0, 0x1

    :goto_0`,
  `    invoke-interface {v0}, Ljava/util/List;->size()I

    move-result v0

    :goto_0`,
);

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
