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

  // The canonical fixed-slot sanitizer replaces the earlier incremental
  // PlaylistStore patch shape. On repeat runs, every PlaylistStore invariant
  // is already present and the old intermediate blocks no longer exist.
  if (
    relativePath === "smali/com/mazenmixtream/playlist/PlaylistStore.smali" &&
    original.includes(":goto_build_slots")
  ) {
    return false;
  }

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

async function replaceMethod(relativePath, methodStart, desiredMethod) {
  const path = resolve(decodedRoot, relativePath);
  const original = await readFile(path, "utf8");
  const start = original.indexOf(methodStart);

  if (start < 0 || start !== original.lastIndexOf(methodStart)) {
    throw new Error(`Expected exactly one method ${methodStart} in ${relativePath}`);
  }

  const endMarker = ".end method";
  const end = original.indexOf(endMarker, start);
  if (end < 0) {
    throw new Error(`Missing end marker for ${methodStart} in ${relativePath}`);
  }

  const afterEnd = end + endMarker.length;
  const currentMethod = original.slice(start, afterEnd);
  if (currentMethod === desiredMethod) {
    return false;
  }

  await writeFile(
    path,
    original.slice(0, start) + desiredMethod + original.slice(afterEnd),
    "utf8",
  );
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
    goto :cond_add_playlist

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

await replaceExact(
  playlistFilterPath,
  `    :cond_1
    new-instance v1, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;`,
  `    :cond_1
    if-eqz p2, :cond_slot_id_resolved

    invoke-virtual {p2}, Ljava/lang/String;->isEmpty()Z

    move-result v2

    if-nez v2, :cond_slot_id_resolved

    const/4 v2, 0x0

    invoke-interface {v0}, Ljava/util/List;->size()I

    move-result v3

    :goto_find_slot_id
    if-ge v2, v3, :cond_slot_id_resolved

    invoke-interface {v0, v2}, Ljava/util/List;->get(I)Ljava/lang/Object;

    move-result-object v4

    check-cast v4, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;

    invoke-virtual {v4}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getId()Ljava/lang/String;

    move-result-object v4

    if-eqz v4, :cond_next_slot_id

    invoke-virtual {v4, p2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v4

    if-eqz v4, :cond_next_slot_id

    move p5, v2

    goto :cond_slot_id_resolved

    :cond_next_slot_id
    add-int/lit8 v2, v2, 0x1

    goto :goto_find_slot_id

    :cond_slot_id_resolved
    new-instance v1, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;`,
);

await replaceExact(
  playlistFilterPath,
  `    invoke-static {p1}, Lcom/shadeed/ibopro/utils/Utils;->saveToFile(Lcom/shadeed/ibopro/models/AppInfoModel;)V

    return-object p1
.end method`,
  `    invoke-static {p1}, Lcom/shadeed/ibopro/utils/Utils;->saveToFile(Lcom/shadeed/ibopro/models/AppInfoModel;)V

    invoke-static {p0, p1}, Lcom/mazenmixtream/playlist/PlaylistStore;->sanitize(Landroid/content/Context;Lcom/shadeed/ibopro/models/AppInfoModel;)Lcom/shadeed/ibopro/models/AppInfoModel;

    move-result-object p1

    return-object p1
.end method`,
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

await replaceMethod(
  playlistFilterPath,
  ".method public static sanitize(Landroid/content/Context;Lcom/shadeed/ibopro/models/AppInfoModel;)Lcom/shadeed/ibopro/models/AppInfoModel;",
  `.method public static sanitize(Landroid/content/Context;Lcom/shadeed/ibopro/models/AppInfoModel;)Lcom/shadeed/ibopro/models/AppInfoModel;
    .locals 11

    if-nez p1, :cond_input_ready

    new-instance p1, Lcom/shadeed/ibopro/models/AppInfoModel;

    invoke-direct {p1}, Lcom/shadeed/ibopro/models/AppInfoModel;-><init>()V

    :cond_input_ready

    new-instance v0, Lcom/shadeed/ibopro/helper/PreferenceHelper;

    invoke-direct {v0, p0}, Lcom/shadeed/ibopro/helper/PreferenceHelper;-><init>(Landroid/content/Context;)V

    invoke-virtual {v0}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->getSharedPreferenceAppInfo()Lcom/shadeed/ibopro/models/AppInfoModel;

    move-result-object v1

    const/4 v2, 0x0

    if-eqz v1, :cond_0

    invoke-virtual {v1}, Lcom/shadeed/ibopro/models/AppInfoModel;->getResult()Ljava/util/List;

    move-result-object v2

    if-nez v2, :cond_1

    :cond_0
    invoke-virtual {p1}, Lcom/shadeed/ibopro/models/AppInfoModel;->getResult()Ljava/util/List;

    move-result-object v2

    :cond_1
    new-instance v3, Ljava/util/ArrayList;

    invoke-direct {v3}, Ljava/util/ArrayList;-><init>()V

    const/4 v4, 0x1

    :goto_build_slots
    const/16 v10, 0xf

    if-gt v4, v10, :cond_persist_sanitized

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v6, "local-mx-slot-"

    invoke-virtual {v1, v6}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v4}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v6

    const/4 v5, 0x0

    if-eqz v2, :cond_create_slot

    invoke-interface {v2}, Ljava/util/List;->iterator()Ljava/util/Iterator;

    move-result-object v7

    :goto_find_slot
    invoke-interface {v7}, Ljava/util/Iterator;->hasNext()Z

    move-result v10

    if-eqz v10, :cond_create_slot

    invoke-interface {v7}, Ljava/util/Iterator;->next()Ljava/lang/Object;

    move-result-object v8

    check-cast v8, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;

    invoke-virtual {v8}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->getId()Ljava/lang/String;

    move-result-object v9

    if-eqz v9, :goto_find_slot

    invoke-virtual {v6, v9}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v10

    if-eqz v10, :goto_find_slot

    move-object v5, v8

    goto :cond_add_fixed_slot

    :cond_create_slot
    new-instance v5, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;

    invoke-direct {v5}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;-><init>()V

    invoke-virtual {v5, v6}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setId(Ljava/lang/String;)V

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v6, "playlist"

    invoke-virtual {v1, v6}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v4}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v6

    invoke-virtual {v5, v6}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setName(Ljava/lang/String;)V

    const-string v6, "http://cf.business-cdn-8k.com/get.php?username=&password=&output=ts&type=m3u_plus"

    invoke-virtual {v5, v6}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setUrl(Ljava/lang/String;)V

    const-string v6, "Xtream Codes"

    invoke-virtual {v5, v6}, Lcom/shadeed/ibopro/models/AppInfoModel$UrlModel;->setType(Ljava/lang/String;)V

    :cond_add_fixed_slot
    invoke-interface {v3, v5}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    add-int/lit8 v4, v4, 0x1

    goto :goto_build_slots

    :cond_persist_sanitized
    invoke-virtual {p1, v3}, Lcom/shadeed/ibopro/models/AppInfoModel;->setResult(Ljava/util/List;)V

    invoke-virtual {v0, p1}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->setSharedPreferenceAppInfo(Lcom/shadeed/ibopro/models/AppInfoModel;)V

    invoke-static {p1}, Lcom/shadeed/ibopro/utils/Utils;->saveToFile(Lcom/shadeed/ibopro/models/AppInfoModel;)V

    invoke-interface {v3}, Ljava/util/List;->size()I

    move-result v1

    invoke-virtual {v0}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->getSharedPreferencePlaylistPosition()I

    move-result v2

    if-eqz v1, :cond_4

    if-ge v2, v1, :cond_4

    goto :goto_1

    :cond_4
    const/4 v1, 0x0

    invoke-virtual {v0, v1}, Lcom/shadeed/ibopro/helper/PreferenceHelper;->setSharedPreferencePlaylistPosition(I)V

    :cond_5
    :goto_1
    return-object p1
.end method`,
);

const sharedInfoPath = "smali/com/shadeed/ibopro/helper/GetSharedInfo.smali";
await replaceMethod(
  sharedInfoPath,
  ".method public static getPasswordFromUrl(Ljava/lang/String;)Ljava/lang/String;",
  `.method public static getPasswordFromUrl(Ljava/lang/String;)Ljava/lang/String;
    .locals 3

    const-string v0, ""

    if-eqz p0, :cond_password_empty

    :try_start_0
    invoke-static {p0}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object v1

    const-string v2, "password"

    invoke-virtual {v1, v2}, Landroid/net/Uri;->getQueryParameter(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p0

    if-eqz p0, :cond_password_empty

    return-object p0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_password

    :catch_password
    :cond_password_empty
    return-object v0
.end method`,
);

await replaceMethod(
  sharedInfoPath,
  ".method public static getPlaylistUrl(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
  `.method public static getPlaylistUrl(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .locals 3

    invoke-virtual {p0}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object p0

    invoke-static {p0}, Lcom/shadeed/ibopro/helper/GetSharedInfo;->getDomainFromUrl(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/String;->isEmpty()Z

    move-result v1

    if-nez v1, :cond_domain_ready

    move-object p0, v0

    :cond_domain_ready
    const-string v0, "/"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_encode_credentials

    const/4 v0, 0x0

    invoke-virtual {p0}, Ljava/lang/String;->length()I

    move-result v1

    add-int/lit8 v1, v1, -0x1

    invoke-virtual {p0, v0, v1}, Ljava/lang/String;->substring(II)Ljava/lang/String;

    move-result-object p0

    :cond_encode_credentials
    invoke-static {p1}, Landroid/net/Uri;->encode(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1

    invoke-static {p2}, Landroid/net/Uri;->encode(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p2

    new-instance v0, Ljava/lang/StringBuilder;

    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V

    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p0, "/get.php?username="

    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p0, "&password="

    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p0, "&output=ts&type=m3u_plus"

    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p0

    return-object p0
.end method`,
);

await replaceMethod(
  sharedInfoPath,
  ".method public static getUsernameFromUrl(Ljava/lang/String;)Ljava/lang/String;",
  `.method public static getUsernameFromUrl(Ljava/lang/String;)Ljava/lang/String;
    .locals 3

    const-string v0, ""

    if-eqz p0, :cond_username_empty

    :try_start_0
    invoke-static {p0}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object v1

    const-string v2, "username"

    invoke-virtual {v1, v2}, Landroid/net/Uri;->getQueryParameter(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p0

    if-eqz p0, :cond_username_empty

    return-object p0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_username

    :catch_username
    :cond_username_empty
    return-object v0
.end method`,
);

const baseActivityPath = "smali/com/shadeed/ibopro/apps/BaseActivity.smali";
await replaceExact(
  baseActivityPath,
  `    .line 7
    invoke-virtual {v2}, Ljava/net/URL;->getQuery()Ljava/lang/String;

    move-result-object v2

    const-string v3, "&"

    invoke-virtual {v2, v3}, Ljava/lang/String;->split(Ljava/lang/String;)[Ljava/lang/String;

    move-result-object v2

    .line 8
    aget-object v3, v2, v1

    invoke-virtual {v3, v0}, Ljava/lang/String;->split(Ljava/lang/String;)[Ljava/lang/String;

    move-result-object v3

    const/4 v4, 0x1

    aget-object v3, v3, v4

    iput-object v3, p0, Lcom/shadeed/ibopro/apps/BaseActivity;->user:Ljava/lang/String;

    .line 9
    aget-object v2, v2, v4

    invoke-virtual {v2, v0}, Ljava/lang/String;->split(Ljava/lang/String;)[Ljava/lang/String;

    move-result-object v0

    aget-object v0, v0, v4

    iput-object v0, p0, Lcom/shadeed/ibopro/apps/BaseActivity;->password:Ljava/lang/String;`,
  `    .line 7
    invoke-static {p1}, Lcom/shadeed/ibopro/helper/GetSharedInfo;->getUsernameFromUrl(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v2

    iput-object v2, p0, Lcom/shadeed/ibopro/apps/BaseActivity;->user:Ljava/lang/String;

    .line 8
    invoke-static {p1}, Lcom/shadeed/ibopro/helper/GetSharedInfo;->getPasswordFromUrl(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v2

    iput-object v2, p0, Lcom/shadeed/ibopro/apps/BaseActivity;->password:Ljava/lang/String;`,
);

const baseActivitySource = await readFile(resolve(decodedRoot, baseActivityPath), "utf8");
const loginStart = baseActivitySource.indexOf(
  ".method public goToLogin(Ljava/lang/String;Lcom/shadeed/ibopro/models/WordModels;)V",
);
const loginEnd = baseActivitySource.indexOf(".end method", loginStart);
const loginMethod = baseActivitySource.slice(loginStart, loginEnd);
if (loginMethod.includes('    const-string v0, "="\n\n')) {
  await writeFile(
    resolve(decodedRoot, baseActivityPath),
    baseActivitySource.slice(0, loginStart) +
      loginMethod.replace('    const-string v0, "="\n\n', "") +
      baseActivitySource.slice(loginEnd),
    "utf8",
  );
}

console.log("MX TV 3.8 multi-server patch applied successfully.");
