(function () {
  "use strict";

  const STORAGE_KEY = "mazenmixtream.state.v1";
  const CACHE_DB = "mazenmixtream.catalogs.v1";
  const CACHE_STORE = "catalogs";
  const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;
  const CACHE_CHUNK_SIZE = 4000;
  const PLAYBACK_SCHEMA = 2;
  const NETWORK_RETRY_DELAYS = [500, 1400];
  const ACCOUNT_TIMEOUT = 60000;
  const CATEGORY_TIMEOUT = 75000;
  const CATALOG_TIMEOUT = 240000;
  const ADULT_RE = /(?:^|\b)(adult|adults|xxx|porn|porno|18\+|18 plus|erotic|sex|playboy|brazzers|hustler|redlight)(?:\b|$)|\b(للكبار|اباحي|إباحي|سكس|بالغين)\b/i;
  const el = (id) => document.getElementById(id);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const defaults = {
    playlists: [],
    activePlaylistId: null,
    favorites: [],
    settings: {
      hideAdult: true,
      parentalPin: "",
      autoplay: true,
      subtitleLanguage: "ar,en",
      autoSubtitles: false,
      opensubtitlesKey: "",
      aspect: "contain"
    }
  };

  let state = loadState();
  let currentView = "home";
  let activeCategory = "all";
  let catalog = { live: [], movies: [], series: [], categories: { live: [], movies: [], series: [] } };
  let loadingCatalog = false;
  let currentItems = [];
  let currentPlayingIndex = -1;
  let currentItem = null;
  let playbackEngine = null;
  let playbackToken = 0;
  let playbackPlan = [];
  let playbackAttempt = 0;
  let playbackStartTimer = null;
  let playbackStallTimer = null;
  let playbackSpinnerTimer = null;
  let playbackAutoplayTimer = null;
  let playbackHasStarted = false;
  let playbackTemporaryMute = false;
  let playbackNativeGeneration = 0;
  let nativePaused = true;
  let nativeVolume = 1;
  let nativeMuted = false;
  let nativePosition = 0;
  let nativeDuration = 0;
  let renderedItemCount = 0;
  let pagingLock = false;
  let catalogProgress = { percent: 0, label: "Connecting to server…" };
  let controlsTimer = null;
  let toastTimer = null;
  let loadToken = 0;
  let touchStart = null;
  let longPressTimer = null;
  let liveSearchQuery = "";
  let selectedLiveId = "";
  let livePreviewTimer = null;
  let livePreviewTimeout = null;
  let livePreviewGeneration = 0;
  let livePreviewItemId = "";
  let livePreviewSequence = 0;
  let livePreviewPlan = [];
  let livePreviewAttempt = 0;
  let liveSearchTimer = null;
  let playerControlsLocked = false;
  let channelSwitchTimer = null;
  let lastLiveClickId = "";
  let lastLiveClickAt = 0;
  let liveCategoryScrollTop = 0;
  const liveChannelScrollState = Object.create(null);

  window.MazenNativePlayerEvent = handleNativePlayerEvent;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return structuredCloneSafe(defaults);
      return {
        ...structuredCloneSafe(defaults),
        ...saved,
        playlists: Array.isArray(saved.playlists) ? saved.playlists : [],
        favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
        settings: { ...defaults.settings, ...(saved.settings || {}) }
      };
    } catch (_) {
      return structuredCloneSafe(defaults);
    }
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function saveState() {
    const clean = {
      ...state,
      playlists: state.playlists.map(({ catalog: ignored, ...playlist }) => playlist)
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); }
    catch (_) { toast("Storage is full. Remove an unused playlist and try again."); }
  }

  function openCacheDb() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const request = window.indexedDB.open(CACHE_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function readCatalogCache(id) {
    const db = await openCacheDb();
    if (!db) return null;
    try {
      const meta = await cacheGet(db, `${id}:meta`);
      if (meta && meta.generation && meta.chunks) {
        const restored = { live: [], movies: [], series: [], categories: meta.categories || { live: [], movies: [], series: [] }, playbackSchema: Number(meta.playbackSchema || 0) };
        for (const kind of ["live", "movies", "series"]) {
          const count = Number(meta.chunks[kind] || 0);
          for (let index = 0; index < count; index += 1) {
            const record = await cacheGet(db, `${id}:${meta.generation}:${kind}:${index}`);
            if (!record || !Array.isArray(record.items)) return null;
            for (const item of record.items) restored[kind].push(item);
            if (index % 3 === 2) await sleep(0);
          }
        }
        return { id, savedAt: Number(meta.savedAt || 0), catalog: restored };
      }
      return await cacheGet(db, id);
    } catch (_) {
      return null;
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  async function writeCatalogCache(id, value) {
    const db = await openCacheDb();
    if (!db) return false;
    try {
      const previous = await cacheGet(db, `${id}:meta`);
      const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const chunks = { live: 0, movies: 0, series: 0 };
      for (const kind of ["live", "movies", "series"]) {
        const rows = Array.isArray(value[kind]) ? value[kind] : [];
        chunks[kind] = Math.ceil(rows.length / CACHE_CHUNK_SIZE);
        for (let index = 0; index < chunks[kind]; index += 1) {
          const start = index * CACHE_CHUNK_SIZE;
          const ok = await cachePut(db, { id: `${id}:${generation}:${kind}:${index}`, items: rows.slice(start, start + CACHE_CHUNK_SIZE) });
          if (!ok) return false;
          await sleep(0);
        }
      }
      const savedAt = Date.now();
      const committed = await cachePut(db, {
        id: `${id}:meta`, generation, savedAt, chunks,
        categories: value.categories || { live: [], movies: [], series: [] },
        playbackSchema: Number(value.playbackSchema || 0)
      });
      if (!committed) return false;
      await cacheDelete(db, id);
      if (previous?.generation && previous.generation !== generation) {
        await deleteCacheGeneration(db, id, previous.generation, previous.chunks || {});
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  async function deleteCatalogCache(id) {
    const db = await openCacheDb();
    if (!db) return;
    try {
      const meta = await cacheGet(db, `${id}:meta`);
      if (meta?.generation) await deleteCacheGeneration(db, id, meta.generation, meta.chunks || {});
      await cacheDelete(db, `${id}:meta`);
      await cacheDelete(db, id);
    } catch (_) {
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  function cacheGet(db, id) {
    return new Promise((resolve) => {
      try {
        const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  function cachePut(db, value) {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(CACHE_STORE, "readwrite");
        transaction.objectStore(CACHE_STORE).put(value);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  function cacheDelete(db, id) {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(CACHE_STORE, "readwrite");
        transaction.objectStore(CACHE_STORE).delete(id);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function deleteCacheGeneration(db, id, generation, chunks) {
    for (const kind of ["live", "movies", "series"]) {
      const count = Number(chunks[kind] || 0);
      for (let index = 0; index < count; index += 1) {
        await cacheDelete(db, `${id}:${generation}:${kind}:${index}`);
        if (index % 6 === 5) await sleep(0);
      }
    }
  }

  function pageSize() {
    return innerWidth <= 540 ? 36 : innerWidth <= 1000 ? 60 : 96;
  }

  function resetRenderingWindow() {
    renderedItemCount = pageSize();
  }

  function setCatalogProgress(percent, label) {
    catalogProgress = { percent, label };
    const bar = el("catalogProgressBar");
    const textNode = el("catalogProgressText");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (textNode) textNode.textContent = label;
  }

  function toast(message, duration = 2600) {
    clearTimeout(toastTimer);
    el("toast").textContent = message;
    el("toast").classList.remove("hidden");
    toastTimer = setTimeout(() => el("toast").classList.add("hidden"), duration);
  }

  function activePlaylist() {
    return state.playlists.find((p) => p.id === state.activePlaylistId) || null;
  }

  function setActivePlaylist(id) {
    state.activePlaylistId = id;
    saveState();
    catalog = { live: [], movies: [], series: [], categories: { live: [], movies: [], series: [] } };
    resetRenderingWindow();
    updateServerChip();
    loadActiveCatalog();
  }

  function formatExpiry(timestamp) {
    if (!timestamp || timestamp === "0") return "No expiry";
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime())) return "Expiry unknown";
    return `Expires ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
  }

  function updateServerChip() {
    const p = activePlaylist();
    const chip = el("serverChip");
    if (!p) return chip.classList.add("hidden");
    chip.classList.remove("hidden");
    el("serverTitle").textContent = p.name;
    const info = p.serverInfo || {};
    const active = !info.status || String(info.status).toLowerCase() === "active";
    el("serverMeta").textContent = p.type === "xtream" ? `${active ? "Active" : "Inactive"} • ${formatExpiry(info.exp_date)}` : "M3U playlist";
    q(".status-dot", chip).classList.toggle("inactive", !active);
  }

  function showServerInformation() {
    const p = activePlaylist();
    if (!p) return;
    const info = p.serverInfo || {};
    const active = !info.status || String(info.status).toLowerCase() === "active";
    showModal(`<div class="modal-head"><div><h2>${escapeHtml(p.name)}</h2><p>Playlist and account information</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body">
      <div class="setting-row"><div class="setting-copy"><strong>Status</strong><span>Current server account state</span></div><span style="color:${active ? "var(--green)" : "var(--red-2)"};font-size:11px;font-weight:800">${active ? "ACTIVE" : escapeHtml(info.status || "INACTIVE")}</span></div>
      <div class="setting-row"><div class="setting-copy"><strong>Expiry</strong><span>Subscription expiry date</span></div><span style="color:#dfe2e8;font-size:11px">${escapeHtml(p.type === "xtream" ? formatExpiry(info.exp_date) : "Not supplied by M3U")}</span></div>
      <div class="setting-row"><div class="setting-copy"><strong>Connections</strong><span>Active and maximum connections</span></div><span style="color:#dfe2e8;font-size:11px">${escapeHtml(info.active_cons || "0")} / ${escapeHtml(info.max_connections || "—")}</span></div>
      <div class="setting-row"><div class="setting-copy"><strong>Server timezone</strong><span>Reported by the playlist server</span></div><span style="color:#dfe2e8;font-size:11px">${escapeHtml(info.timezone || "Not supplied")}</span></div>
      </div><div class="modal-actions"><button class="primary-button focusable modal-close">DONE</button></div>`);
  }

  function normalizeBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function networkUrl(url) {
    const value = String(url || "");
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      if (window.MazenNetwork && typeof window.MazenNetwork.proxyUrl === "function") return String(window.MazenNetwork.proxyUrl(value) || value);
    } catch (_) {}
    return value;
  }

  function hasNativeNetworkProxy() {
    try { return Boolean(window.MazenNetwork && typeof window.MazenNetwork.proxyUrl === "function"); }
    catch (_) { return false; }
  }

  function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504 || status >= 520;
  }

  function normalizedNetworkError(error, timeout) {
    const message = String(error?.message || error || "Network request failed");
    if (/signal.*abort|abort.*signal|aborted without reason|aborterror/i.test(message) || error?.name === "AbortError") {
      return new Error(`Network request timed out after ${Math.round(timeout / 1000)} seconds`);
    }
    return error instanceof Error ? error : new Error(message);
  }

  async function requestAttempt(requestUrl, options, timeout, bodyReader) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const requestOptions = { cache: "no-store", ...options, ...(controller ? { signal: controller.signal } : {}) };
      const response = await fetch(requestUrl, requestOptions);
      const body = bodyReader ? await bodyReader(response) : null;
      return { response, body };
    } catch (error) {
      if (controller?.signal.aborted) throw new Error(`Network request timed out after ${Math.round(timeout / 1000)} seconds`);
      throw normalizedNetworkError(error, timeout);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function requestWithRecovery(url, options = {}, timeout = 60000, attempts = 2, bodyReader = null) {
    const method = String(options.method || "GET").toUpperCase();
    const canProxy = (method === "GET" || method === "HEAD") && hasNativeNetworkProxy();
    const routes = canProxy ? [networkUrl(url), url] : [url];
    let lastError = null;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        try {
          const result = await requestAttempt(routes[routeIndex], options, timeout, bodyReader);
          if (retryableStatus(result.response.status)) {
            lastError = new Error(`Server returned HTTP ${result.response.status}`);
            continue;
          }
          return result;
        } catch (error) {
          lastError = normalizedNetworkError(error, timeout);
        }
      }
      if (attempt < attempts - 1) await sleep(NETWORK_RETRY_DELAYS[Math.min(attempt, NETWORK_RETRY_DELAYS.length - 1)] || 500);
    }
    throw lastError || new Error("Network request failed");
  }

  async function fetchWithTimeout(url, options = {}, timeout = 60000, attempts = 2) {
    return (await requestWithRecovery(url, options, timeout, attempts)).response;
  }

  async function fetchText(url, options = {}, timeout = 60000, attempts = 2) {
    return requestWithRecovery(url, options, timeout, attempts, (response) => response.text());
  }

  async function fetchJson(url, settings = {}) {
    const timeout = Number(settings.timeout || ACCOUNT_TIMEOUT);
    const attempts = Number(settings.attempts || 2);
    const { response, body: text } = await fetchText(url, settings.options || {}, timeout, attempts);
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
    try { return JSON.parse(text); }
    catch (_) { throw new Error("Server returned invalid data"); }
  }

  function xtreamUrl(p, params = {}) {
    const query = new URLSearchParams({ username: p.username, password: p.password, ...params });
    return `${normalizeBase(p.baseUrl)}/player_api.php?${query.toString()}`;
  }

  function cleanStreamExtension(value, kind = "live") {
    const extension = String(value || "").trim().toLowerCase().replace(/^\.+/, "").replace(/[^a-z0-9]/g, "");
    const allowed = kind === "live" ? ["m3u8", "ts"] : ["mp4", "mkv", "avi", "mov", "webm", "m3u8", "ts"];
    return allowed.includes(extension) ? extension : "";
  }

  function normalizeStreamUrl(value, base = "") {
    const url = String(value || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return `${/^https:/i.test(base) ? "https" : "http"}:${url}`;
    if (url.startsWith("/") && /^https?:\/\//i.test(base)) {
      try { return new URL(url, base).href; } catch (_) {}
    }
    return "";
  }

  function deriveXtreamStreamBase(playlist, serverInfo = {}) {
    const fallback = normalizeBase(playlist.baseUrl);
    let host = String(serverInfo.url || "").trim();
    const protocol = String(serverInfo.server_protocol || "").replace(/:.*$/, "").toLowerCase() || (/^https:/i.test(host) ? "https" : /^http:/i.test(host) ? "http" : /^https:/i.test(fallback) ? "https" : "http");
    if (!host) return fallback;
    if (!/^https?:\/\//i.test(host)) host = `${protocol}://${host}`;
    try {
      const parsed = new URL(host);
      const port = protocol === "https" ? serverInfo.https_port || serverInfo.port : serverInfo.port;
      parsed.protocol = `${protocol}:`;
      if (!parsed.port && port && !((protocol === "http" && String(port) === "80") || (protocol === "https" && String(port) === "443"))) parsed.port = String(port);
      return normalizeBase(parsed.href);
    } catch (_) {
      return fallback;
    }
  }

  function xtreamOutputFormats(playlist, kind = "live") {
    const values = Array.isArray(playlist?.serverInfo?.allowed_output_formats) ? playlist.serverInfo.allowed_output_formats : [];
    return values.map((value) => cleanStreamExtension(value, kind)).filter((value, index, all) => value && all.indexOf(value) === index);
  }

  function preferredXtreamExtension(playlist, kind, explicit) {
    const supplied = cleanStreamExtension(explicit, kind);
    if (supplied) return supplied;
    const formats = xtreamOutputFormats(playlist, kind);
    if (formats.length) return formats[0];
    return kind === "live" ? "ts" : "mp4";
  }

  function buildXtreamStreamUrl(playlist, kind, streamId, extension) {
    if (!playlist || playlist.type !== "xtream" || streamId === undefined || streamId === null || streamId === "") return "";
    const route = kind === "live" ? "live" : kind === "episode" ? "series" : "movie";
    const streamBase = normalizeBase(playlist.serverInfo?.stream_base || playlist.baseUrl);
    const suffix = cleanStreamExtension(extension, kind === "live" ? "live" : "movie");
    return `${streamBase}/${route}/${encodeURIComponent(playlist.username)}/${encodeURIComponent(playlist.password)}/${encodeURIComponent(streamId)}${suffix ? `.${suffix}` : ""}`;
  }

  function isAdult(item) {
    return Boolean(item.adult || ADULT_RE.test(`${item.name || ""} ${item.group || ""}`));
  }

  function visibleItems(items) {
    return state.settings.hideAdult ? items.filter((item) => !isAdult(item)) : items;
  }

  async function loadActiveCatalog(force = false) {
    const playlist = activePlaylist();
    if (!playlist || loadingCatalog) {
      renderCurrentView();
      return;
    }
    if (!force && playlist.catalog) {
      catalog = playlist.catalog;
      resetRenderingWindow();
      renderCurrentView();
      return;
    }
    const token = ++loadToken;
    loadingCatalog = true;
    setCatalogProgress(3, "Opening playlist…");
    renderCurrentView();
    let cached = null;
    try {
      if (!force) {
        setCatalogProgress(7, "Checking saved channel library…");
        cached = await readCatalogCache(playlist.id);
        if (cached && cached.catalog && Number(cached.catalog.playbackSchema || 0) === PLAYBACK_SCHEMA) {
          catalog = cached.catalog;
          playlist.catalog = cached.catalog;
          playlist.lastLoaded = cached.savedAt || Date.now();
          loadingCatalog = false;
          resetRenderingWindow();
          updateServerChip();
          renderCurrentView();
          if (Date.now() - Number(cached.savedAt || 0) > CACHE_MAX_AGE) refreshCatalogInBackground(playlist, token);
          return;
        }
        if (cached?.catalog) setCatalogProgress(9, "Upgrading saved stream links once…");
      }
      setCatalogProgress(10, "Signing in and loading everything…");
      const loaded = playlist.type === "xtream" ? await loadXtream(playlist) : await loadM3u(playlist);
      if (token !== loadToken) return;
      catalog = loaded;
      playlist.catalog = loaded;
      playlist.lastLoaded = Date.now();
      saveState();
      writeCatalogCache(playlist.id, loaded).catch(() => {});
      updateServerChip();
      loadingCatalog = false;
      resetRenderingWindow();
      renderCurrentView();
    } catch (error) {
      if (token !== loadToken) return;
      const fallback = cached || await readCatalogCache(playlist.id);
      if (fallback && fallback.catalog) {
        catalog = fallback.catalog;
        playlist.catalog = fallback.catalog;
        loadingCatalog = false;
        resetRenderingWindow();
        renderCurrentView();
        toast("Server is unavailable — showing the saved library", 4000);
        return;
      }
      catalog = { live: [], movies: [], series: [], categories: { live: [], movies: [], series: [] } };
      loadingCatalog = false;
      renderLoadError(friendlyNetworkError(error));
    } finally {
      loadingCatalog = false;
    }
  }

  async function refreshCatalogInBackground(playlist, parentToken) {
    if (loadingCatalog) return;
    try {
      const fresh = playlist.type === "xtream" ? await loadXtream(playlist, true) : await loadM3u(playlist, true);
      if (parentToken !== loadToken || activePlaylist()?.id !== playlist.id) return;
      catalog = fresh;
      playlist.catalog = fresh;
      playlist.lastLoaded = Date.now();
      saveState();
      writeCatalogCache(playlist.id, fresh).catch(() => {});
      resetRenderingWindow();
      renderCurrentView();
      toast("Playlist library updated");
    } catch (_) {}
  }

  function friendlyNetworkError(error) {
    const message = String(error?.message || error || "Could not load playlist");
    if (/failed to fetch|networkerror|aborterror|signal.*abort|abort.*signal|aborted without reason|timed?\s*out|http (408|425|429|5\d\d)/i.test(message)) return "The IPTV server response was interrupted. The app retried using both Android native and direct connections; check that this phone can reach the server, then try again.";
    return message;
  }

  async function loadXtream(p, background = false) {
    if (!background) setCatalogProgress(12, "Checking Xtream account…");
    const account = await fetchJson(xtreamUrl(p), { timeout: ACCOUNT_TIMEOUT, attempts: 3 });
    if (!account || !account.user_info) throw new Error("Xtream login was rejected. Check server, username and password.");
    p.serverInfo = {
      status: account.user_info.status,
      exp_date: account.user_info.exp_date,
      max_connections: account.user_info.max_connections,
      active_cons: account.user_info.active_cons,
      timezone: account.server_info && account.server_info.timezone,
      allowed_output_formats: Array.isArray(account.user_info.allowed_output_formats) ? account.user_info.allowed_output_formats.map((value) => String(value || "").toLowerCase()) : [],
      stream_base: deriveXtreamStreamBase(p, account.server_info || {})
    };
    if (!background) setCatalogProgress(20, "Downloading playlist categories…");
    const contentErrors = [];
    const safeRequest = async (url, settings, important = false) => {
      try {
        const result = await fetchJson(url, settings);
        return Array.isArray(result) ? result : [];
      } catch (error) {
        if (important) contentErrors.push(error);
        return [];
      }
    };
    const liveCats = await safeRequest(xtreamUrl(p, { action: "get_live_categories" }), { timeout: CATEGORY_TIMEOUT, attempts: 2 });
    const movieCats = await safeRequest(xtreamUrl(p, { action: "get_vod_categories" }), { timeout: CATEGORY_TIMEOUT, attempts: 2 });
    const seriesCats = await safeRequest(xtreamUrl(p, { action: "get_series_categories" }), { timeout: CATEGORY_TIMEOUT, attempts: 2 });
    const categoryNames = (rows) => Object.fromEntries((Array.isArray(rows) ? rows : []).map((c) => [String(c.category_id), c.category_name]));
    const lc = categoryNames(liveCats), mc = categoryNames(movieCats), sc = categoryNames(seriesCats);
    if (!background) setCatalogProgress(31, "Downloading live channels…");
    let live = await safeRequest(xtreamUrl(p, { action: "get_live_streams" }), { timeout: CATALOG_TIMEOUT, attempts: 2 }, true);
    const mappedLive = await mapInChunks(live, (x) => {
      const directSource = normalizeStreamUrl(x.direct_source, p.serverInfo.stream_base);
      const containerExtension = preferredXtreamExtension(p, "live", x.container_extension);
      return mediaItem({
        id: `live-${x.stream_id}`, streamId: x.stream_id, name: x.name, logo: x.stream_icon, group: lc[String(x.category_id)] || "Live TV",
        categoryId: String(x.category_id || "0"), kind: "live", directSource, containerExtension,
        url: directSource || buildXtreamStreamUrl(p, "live", x.stream_id, containerExtension), epgId: x.epg_channel_id, adult: Number(x.is_adult) === 1
      });
    });
    live = null;
    await sleep(0);
    if (!background) setCatalogProgress(51, "Downloading movies…");
    let movies = await safeRequest(xtreamUrl(p, { action: "get_vod_streams" }), { timeout: CATALOG_TIMEOUT, attempts: 2 }, true);
    const mappedMovies = await mapInChunks(movies, (x) => {
      const directSource = normalizeStreamUrl(x.direct_source, p.serverInfo.stream_base);
      const containerExtension = preferredXtreamExtension(p, "movie", x.container_extension);
      return mediaItem({
        id: `movie-${x.stream_id}`, streamId: x.stream_id, name: x.name, logo: x.stream_icon, group: mc[String(x.category_id)] || "Movies",
        categoryId: String(x.category_id || "0"), kind: "movie", year: x.year || "", rating: x.rating || "", directSource, containerExtension,
        url: directSource || buildXtreamStreamUrl(p, "movie", x.stream_id, containerExtension), adult: Number(x.is_adult) === 1
      });
    });
    movies = null;
    await sleep(0);
    if (!background) setCatalogProgress(72, "Downloading series…");
    let series = await safeRequest(xtreamUrl(p, { action: "get_series" }), { timeout: CATALOG_TIMEOUT, attempts: 2 }, true);
    const mappedSeries = await mapInChunks(series, (x) => mediaItem({
        id: `series-${x.series_id}`, seriesId: x.series_id, name: x.name, logo: x.cover, group: sc[String(x.category_id)] || "Series",
        categoryId: String(x.category_id || "0"), kind: "series", year: x.year || "", rating: x.rating || "", adult: Number(x.is_adult) === 1
      }));
    series = null;
    if (!(mappedLive.length || mappedMovies.length || mappedSeries.length) && contentErrors.length) throw contentErrors[0];
    if (!background) setCatalogProgress(92, "Preparing the complete offline library…");
    if (!background) setCatalogProgress(100, "Everything is ready");
    return {
      live: mappedLive,
      movies: mappedMovies,
      series: mappedSeries,
      categories: {
        live: normalizeCategories(liveCats), movies: normalizeCategories(movieCats), series: normalizeCategories(seriesCats)
      },
      playbackSchema: PLAYBACK_SCHEMA
    };
  }

  async function mapInChunks(rows, mapper) {
    const output = new Array(rows.length);
    const chunk = 700;
    for (let start = 0; start < rows.length; start += chunk) {
      const end = Math.min(rows.length, start + chunk);
      for (let i = start; i < end; i++) output[i] = mapper(rows[i], i);
      if (end < rows.length) await sleep(0);
    }
    return output;
  }

  function normalizeCategories(rows) {
    return (Array.isArray(rows) ? rows : []).map((c) => ({ id: String(c.category_id), name: c.category_name || "Other" }));
  }

  function mediaItem(item) {
    return { group: "Other", categoryId: "0", adult: false, ...item };
  }

  async function loadM3u(p, background = false) {
    if (!background) setCatalogProgress(25, "Downloading M3U playlist…");
    const { response, body: text } = await fetchText(p.m3uUrl, {}, CATALOG_TIMEOUT, 2);
    if (!response.ok) throw new Error(`Playlist returned HTTP ${response.status}`);
    if (!text.includes("#EXTM3U")) throw new Error("This URL did not return a valid M3U/M3U8 playlist.");
    if (!background) setCatalogProgress(70, "Indexing all playlist items…");
    const parsed = await parseM3u(text, p.m3uUrl);
    const makeCats = (items) => Array.from(new Set(items.map((x) => x.group))).sort().map((name) => ({ id: name, name }));
    if (!background) setCatalogProgress(100, "Everything is ready");
    return { ...parsed, categories: { live: makeCats(parsed.live), movies: makeCats(parsed.movies), series: makeCats(parsed.series) }, playbackSchema: PLAYBACK_SCHEMA };
  }

  async function parseM3u(text, sourceUrl) {
    const lines = text.replace(/\r/g, "").split("\n");
    const output = { live: [], movies: [], series: [] };
    let info = null;
    let mediaCount = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const raw = lines[lineIndex];
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF")) {
        const attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => { attrs[key] = value; return _; });
        const comma = line.indexOf(",");
        info = { attrs, headers: {}, name: comma >= 0 ? line.slice(comma + 1).trim() : attrs["tvg-name"] || "Untitled" };
      } else if (line.startsWith("#EXTVLCOPT:") && info) {
        const option = line.slice(11);
        const split = option.indexOf("=");
        const key = split >= 0 ? option.slice(0, split).trim().toLowerCase() : "";
        const value = split >= 0 ? option.slice(split + 1).trim() : "";
        if (key === "http-user-agent" && value) info.headers["User-Agent"] = value;
        else if ((key === "http-referrer" || key === "http-referer") && value) info.headers.Referer = value;
        else if (key === "http-origin" && value) info.headers.Origin = value;
      } else if (line.startsWith("#EXTHTTP:") && info) {
        try {
          const headers = JSON.parse(line.slice(9));
          if (headers && typeof headers === "object" && !Array.isArray(headers)) Object.assign(info.headers, headers);
        } catch (_) {}
      } else if (!line.startsWith("#") && info) {
        const attrs = info.attrs;
        const group = attrs["group-title"] || "Other";
        const name = info.name || attrs["tvg-name"] || "Untitled";
        const hint = `${attrs.type || ""} ${group} ${line}`.toLowerCase();
        const kind = /series|episode|season/.test(hint) ? "series" : /movie|vod|film|cinema/.test(hint) ? "movie" : "live";
        const item = mediaItem({
          id: `m3u-${mediaCount++}-${hashString(line)}`,
          name, group, categoryId: group, kind, url: resolveMediaUrl(line, sourceUrl), logo: attrs["tvg-logo"] || "",
          epgId: attrs["tvg-id"] || "", subtitleUrl: attrs["sub-file"] || attrs["tvg-subtitle"] || "", headers: info.headers,
          adult: ADULT_RE.test(`${name} ${group}`)
        });
        output[kind === "movie" ? "movies" : kind === "series" ? "series" : "live"].push(item);
        info = null;
      }
      if (lineIndex > 0 && lineIndex % 3000 === 0) await sleep(0);
    }
    if (!mediaCount) {
      output.live.push(mediaItem({ id: `single-${hashString(sourceUrl)}`, name: "Live Stream", group: "Direct stream", kind: "live", url: sourceUrl }));
    }
    return output;
  }

  function resolveMediaUrl(url, sourceUrl) {
    try { return new URL(url, sourceUrl).href; } catch (_) { return url; }
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
  }

  function setView(view) {
    if (currentView === "live" && view !== "live") stopLivePreview();
    currentView = view;
    activeCategory = "all";
    if (view !== "live") liveSearchQuery = "";
    resetRenderingWindow();
    qa(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    closeSidebar();
    renderCurrentView();
    el("content").scrollTop = 0;
  }

  function renderCurrentView() {
    setLiveBrowserMode(currentView === "live" && Boolean(activePlaylist()));
    if (currentView === "manage") return renderManage();
    if (!activePlaylist()) return renderWelcome();
    if (loadingCatalog) return renderLoading();
    if (currentView === "home") return renderHome();
    if (currentView === "favorites") return renderFavorites();
    renderLibrary(currentView);
  }

  function renderWelcome() {
    el("content").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">＋</div>
        <h2>Start with your playlist</h2>
        <p>Add an Xtream Codes account or an M3U/M3U8 playlist. You can add as many playlists as your device storage allows.</p>
        <button class="primary-button focusable" data-action="add-playlist">ADD PLAYLIST</button>
      </div>`;
    bindContentActions();
  }

  function renderLoading() {
    el("content").innerHTML = `
      <div class="view-head"><div><div class="eyebrow">ONE-TIME LIBRARY LOAD</div><h1>${escapeHtml(activePlaylist().name)}</h1><p id="catalogProgressText">${escapeHtml(catalogProgress.label)}</p></div></div>
      <div class="catalog-progress"><i id="catalogProgressBar" style="width:${catalogProgress.percent}%"></i></div>
      <div class="media-grid channel-grid loading-channel-grid">${Array.from({ length: 10 }, (_, index) => `<div class="skeleton-card loading-channel-card" style="--loading-index:${index}"><div class="poster"><div class="channel-thumbnail-loader"><span><i></i></span><strong>Loading</strong><small>CHANNELS</small></div></div><div class="card-meta"><strong>Preparing channel library</strong><span>Loading names, logos and categories…</span></div></div>`).join("")}</div>`;
  }

  function renderLoadError(message) {
    el("content").innerHTML = `
      <div class="empty-state"><div class="empty-icon">!</div><h2>Playlist did not load</h2><p>${escapeHtml(message)}</p>
      <div class="hero-actions"><button class="primary-button focusable" data-action="reload">TRY AGAIN</button><button class="secondary-button focusable" data-action="manage">MANAGE PLAYLISTS</button></div></div>`;
    bindContentActions();
  }

  function renderHome(preserveScroll = false) {
    stopLivePreview();
    setLiveBrowserMode(false);
    const oldScroll = el("content").scrollTop;
    const live = visibleItems(catalog.live);
    currentItems = live;
    renderedItemCount = Math.max(renderedItemCount || 0, pageSize());
    const shown = live.slice(0, Math.min(live.length, renderedItemCount));
    el("content").innerHTML = `
      <div class="view-head"><div><div class="eyebrow">ON AIR</div><h1>Live Channels</h1><p>${live.length.toLocaleString()} channels • Double-click or double-tap to watch fullscreen</p></div><div class="view-actions"><button class="secondary-button focusable" data-action="refresh">↻ REFRESH</button></div></div>
      ${live.length ? mediaGridHtml(shown, true) : emptyContentHtml("No live channels available")}
      ${shown.length < live.length ? `<div class="load-more-wrap"><button class="secondary-button focusable" data-load-more>LOAD MORE <span>${shown.length.toLocaleString()} / ${live.length.toLocaleString()}</span></button></div>` : ""}`;
    bindContentActions();
    if (preserveScroll) requestAnimationFrame(() => { el("content").scrollTop = oldScroll; pagingLock = false; });
  }

  function sectionHtml(title, subtitle, items, view) {
    if (!items.length) return "";
    return `<section class="section"><div class="section-head"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(subtitle)}</span><button class="text-button focusable" data-view-jump="${view}">VIEW ALL</button></div>${mediaGridHtml(items, view === "live")}</section>`;
  }

  function renderLibrary(kind, preserveScroll = false) {
    if (kind === "live") return renderLiveLibrary(preserveScroll);
    stopLivePreview();
    setLiveBrowserMode(false);
    const oldScroll = el("content").scrollTop;
    const source = kind === "live" ? catalog.live : kind === "movies" ? catalog.movies : catalog.series;
    const categories = catalog.categories[kind] || [];
    let items = visibleItems(source);
    if (activeCategory !== "all") items = items.filter((item) => item.categoryId === activeCategory || item.group === activeCategory);
    currentItems = items;
    const shown = items.slice(0, Math.min(items.length, renderedItemCount || pageSize()));
    const title = kind === "live" ? "Live TV" : kind === "movies" ? "Movies" : "Series";
    el("content").innerHTML = `
      <div class="view-head"><div><div class="eyebrow">${kind === "live" ? "ON AIR" : "LIBRARY"}</div><h1>${title}</h1><p>${items.length.toLocaleString()} available</p></div><div class="view-actions"><button class="secondary-button focusable" data-action="refresh">↻ REFRESH</button></div></div>
      ${categoryHtml(categories)}
      ${items.length ? mediaGridHtml(shown, kind === "live") : emptyContentHtml("No content in this category")}
      ${shown.length < items.length ? `<div class="load-more-wrap"><button class="secondary-button focusable" data-load-more>LOAD MORE <span>${shown.length.toLocaleString()} / ${items.length.toLocaleString()}</span></button></div>` : ""}`;
    bindContentActions();
    if (preserveScroll) requestAnimationFrame(() => { el("content").scrollTop = oldScroll; pagingLock = false; });
  }

  function liveScrollContextKey(category = activeCategory, query = liveSearchQuery) {
    return `${state.activePlaylistId || "none"}|${category || "all"}|${String(query || "").trim().toLowerCase()}`;
  }

  function rememberLiveBrowserPosition() {
    const categoryList = q(".live-category-list", el("content"));
    const channelList = q(".live-channel-list", el("content"));
    if (categoryList) liveCategoryScrollTop = categoryList.scrollTop;
    if (channelList?.dataset.liveScrollKey) liveChannelScrollState[channelList.dataset.liveScrollKey] = channelList.scrollTop;
  }

  function renderLiveLibrary(preserveScroll = false) {
    rememberLiveBrowserPosition();
    const scrollKey = liveScrollContextKey();
    const oldListScroll = Number(liveChannelScrollState[scrollKey] || 0);
    stopLivePreview();
    setLiveBrowserMode(true);
    const playlist = activePlaylist();
    const serverInfo = playlist?.serverInfo || {};
    const serverActive = !serverInfo.status || String(serverInfo.status).toLowerCase() === "active";
    const serverMeta = playlist?.type === "xtream"
      ? `${serverActive ? "Active" : "Inactive"} • ${formatExpiry(serverInfo.exp_date)}`
      : "Ready • M3U playlist";
    const source = visibleItems(catalog.live);
    const categories = (catalog.categories.live || []).filter((c) => !state.settings.hideAdult || !ADULT_RE.test(c.name));
    const categoryCounts = new Map();
    for (const item of source) {
      categoryCounts.set(item.categoryId, (categoryCounts.get(item.categoryId) || 0) + 1);
      if (item.group && item.group !== item.categoryId) categoryCounts.set(item.group, (categoryCounts.get(item.group) || 0) + 1);
    }
    let items = activeCategory === "favorites" ? source.filter((item) => state.favorites.includes(item.id)) : source;
    if (activeCategory !== "all" && activeCategory !== "favorites") items = items.filter((item) => item.categoryId === activeCategory || item.group === activeCategory);
    const query = liveSearchQuery.trim().toLowerCase();
    if (query) items = items.filter((item) => `${item.name} ${item.group}`.toLowerCase().includes(query));
    currentItems = items;
    renderedItemCount = Math.max(renderedItemCount || 0, livePageSize());
    const shown = items.slice(0, Math.min(items.length, renderedItemCount));
    let selected = items.find((item) => item.id === selectedLiveId) || items[0] || null;
    selectedLiveId = selected?.id || "";
    const favoriteCount = source.reduce((count, item) => count + (state.favorites.includes(item.id) ? 1 : 0), 0);
    el("content").innerHTML = `
      <section class="live-tv-shell">
        <header class="live-browser-head">
          <button class="live-back focusable" data-live-back aria-label="Back">‹</button>
          <div class="live-browser-title"><div class="eyebrow">MX • ${escapeHtml(playlist?.name || "PLAYLIST")}</div><h1>Live Channels</h1><small><i class="${serverActive ? "" : "inactive"}"></i>${escapeHtml(serverMeta)}</small></div>
          <button class="live-head-tool focusable" data-action="refresh" aria-label="Refresh">↻</button>
          <label class="live-search"><span>⌕</span><input id="liveSearchInput" value="${escapeHtml(liveSearchQuery)}" placeholder="Search channels…" autocomplete="off"></label>
        </header>
        <div class="live-browser-grid">
          <aside class="live-category-pane">
            <div class="live-pane-label">CATEGORIES</div>
            <div class="live-category-list" data-live-category-scroll>
              <button class="live-category focusable ${activeCategory === "all" ? "active" : ""}" data-live-category="all"><span>All Channels</span><b>${source.length.toLocaleString()}</b></button>
              <button class="live-category focusable ${activeCategory === "favorites" ? "active" : ""}" data-live-category="favorites"><span>Favorite Channels</span><b>${favoriteCount.toLocaleString()}</b></button>
              ${categories.map((category) => `<button class="live-category focusable ${activeCategory === category.id ? "active" : ""}" data-live-category="${escapeHtml(category.id)}"><span>${escapeHtml(category.name)}</span><b>${(categoryCounts.get(category.id) || categoryCounts.get(category.name) || 0).toLocaleString()}</b></button>`).join("")}
            </div>
          </aside>
          <section class="live-channel-pane">
            <div class="live-pane-title"><span>${escapeHtml(activeCategory === "all" ? "All Channels" : activeCategory === "favorites" ? "Favorites" : categories.find((c) => c.id === activeCategory)?.name || "Channels")}</span><b>${items.length.toLocaleString()}</b></div>
            <div class="live-channel-list" data-live-scroll-key="${escapeHtml(scrollKey)}" role="listbox">${shown.map((item, index) => liveChannelRowHtml(item, index, item.id === selectedLiveId)).join("")}
              ${shown.length < items.length ? `<button class="live-load-more focusable" data-live-load-more>LOAD MORE CHANNELS <span>${shown.length.toLocaleString()} / ${items.length.toLocaleString()}</span></button>` : ""}
            </div>
          </section>
          <aside id="liveInspector" class="live-inspector">${liveInspectorHtml(selected)}</aside>
        </div>
      </section>`;
    bindContentActions();
    bindLiveBrowserActions(selected);
    requestAnimationFrame(() => {
      const categoriesList = q(".live-category-list", el("content"));
      const list = q(".live-channel-list", el("content"));
      if (categoriesList) categoriesList.scrollTop = liveCategoryScrollTop;
      if (list) list.scrollTop = oldListScroll;
      pagingLock = false;
    });
  }

  function livePageSize() {
    return innerWidth <= 540 ? 50 : innerWidth <= 1100 ? 80 : 140;
  }

  function liveChannelRowHtml(item, index, selected) {
    const fallback = escapeHtml((item.name || "MX").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase());
    return `<button class="live-channel-row focusable ${selected ? "selected" : ""}" data-live-channel="${escapeHtml(item.id)}" role="option" aria-selected="${selected}">
      <span class="live-channel-number">${index + 1}</span>
      <span class="live-channel-logo ${item.logo ? "is-loading" : ""}">${item.logo ? `<span class="live-logo-loading"><i></i><small>Loading</small></span><img loading="lazy" decoding="async" src="${escapeHtml(networkUrl(item.logo))}" alt="" onload="this.parentElement.classList.remove('is-loading')" onerror="this.style.display='none';this.parentElement.classList.remove('is-loading');this.nextElementSibling.style.display='grid'"><em class="live-logo-fallback" style="display:none">${fallback}</em>` : `<em class="live-logo-fallback">${fallback}</em>`}</span>
      <span class="live-channel-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.group || "Live TV")}</small></span>
      ${state.favorites.includes(item.id) ? '<span class="live-row-favorite">★</span>' : '<span class="live-row-signal">●</span>'}
    </button>`;
  }

  function liveInspectorHtml(item) {
    if (!item) return `<div class="live-inspector-empty"><span>MX</span><strong>No channels found</strong><small>Try another category or search.</small></div>`;
    const fallback = escapeHtml((item.name || "MX").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase());
    return `<div id="livePreviewFrame" class="live-preview-frame">
        <div class="live-preview-placeholder">${item.logo ? `<img src="${escapeHtml(networkUrl(item.logo))}" alt="">` : `<b>${fallback}</b>`}<span>MX LIVE PREVIEW</span><small id="livePreviewStatus">Preparing preview…</small></div>
      </div>
      <div class="live-inspector-card">
        <div class="live-selected-channel"><span class="live-selected-logo">${item.logo ? `<img loading="lazy" decoding="async" src="${escapeHtml(networkUrl(item.logo))}" alt="">` : fallback}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.group || "Live TV")}</small></div></div>
        <div class="live-inspector-actions"><button class="focusable ${state.favorites.includes(item.id) ? "active" : ""}" data-live-favorite="${escapeHtml(item.id)}" aria-label="Favorite">☆</button><button class="focusable" data-live-info aria-label="Program information">☷</button></div>
        <div class="live-program"><span>NOW PLAYING</span><strong id="liveProgramTitle">Loading information…</strong><small id="liveProgramTime">Electronic program guide</small><i><b></b></i></div>
        <button class="live-watch-button focusable" data-live-play="${escapeHtml(item.id)}">WATCH FULLSCREEN <span>▶</span></button>
      </div>`;
  }

  function categoryHtml(categories) {
    const safe = state.settings.hideAdult ? categories.filter((c) => !ADULT_RE.test(c.name)) : categories;
    return `<div class="category-row"><button class="category-pill focusable ${activeCategory === "all" ? "active" : ""}" data-category="all">All</button>${safe.map((c) => `<button class="category-pill focusable ${activeCategory === c.id ? "active" : ""}" data-category="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join("")}</div>`;
  }

  function mediaGridHtml(items, channels = false) {
    return `<div class="media-grid ${channels ? "channel-grid" : ""}">${items.map((item, index) => mediaCardHtml(item, index)).join("")}</div>`;
  }

  function mediaCardHtml(item, index) {
    const favorite = state.favorites.includes(item.id);
    const fallback = escapeHtml((item.name || "MX").split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase());
    return `<button class="media-card focusable" data-play-index="${index}" data-item-id="${escapeHtml(item.id)}">
      <div class="poster">${item.logo ? `<img loading="lazy" src="${escapeHtml(networkUrl(item.logo))}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span class="poster-fallback" style="display:none">${fallback}</span>` : `<span class="poster-fallback">${fallback}</span>`}
      ${item.kind === "live" ? '<span class="live-badge">LIVE</span>' : ""}${isAdult(item) ? '<span class="adult-badge">18+</span>' : ""}<span class="card-play">▶</span>
      <span class="favorite-button ${favorite ? "active" : ""}" data-favorite-id="${escapeHtml(item.id)}">♥</span></div>
      <span class="card-meta"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.group)}${item.year ? ` • ${escapeHtml(item.year)}` : ""}</span></span>
    </button>`;
  }

  function emptyContentHtml(message) {
    return `<div class="empty-state"><div class="empty-icon">∅</div><h2>${escapeHtml(message)}</h2><p>Try another category or refresh the playlist.</p></div>`;
  }

  function renderFavorites() {
    const all = [...catalog.live, ...catalog.movies, ...catalog.series];
    const items = visibleItems(all.filter((item) => state.favorites.includes(item.id)));
    currentItems = items;
    el("content").innerHTML = `<div class="view-head"><div><div class="eyebrow">YOUR PICKS</div><h1>Favorites</h1><p>${items.length} saved</p></div></div>${items.length ? mediaGridHtml(items) : emptyContentHtml("No favorites yet")}`;
    bindContentActions();
  }

  function renderManage() {
    stopLivePreview();
    setLiveBrowserMode(false);
    currentView = "manage";
    el("content").innerHTML = `
      <div class="view-head"><div><div class="eyebrow">UNLIMITED SOURCES</div><h1>Manage playlists</h1><p>Add, switch, edit or remove your streaming sources</p></div><div class="view-actions"><button class="primary-button focusable" data-action="add-playlist">＋ ADD PLAYLIST</button></div></div>
      <div class="playlist-grid">
        ${state.playlists.map((p) => playlistCardHtml(p)).join("")}
        <button class="add-playlist-card focusable" data-action="add-playlist"><b>＋</b><span>Add Xtream or M3U playlist</span></button>
      </div>`;
    bindContentActions();
  }

  function playlistCardHtml(p) {
    const active = p.id === state.activePlaylistId;
    const status = p.serverInfo && p.serverInfo.status ? p.serverInfo.status : active ? "Active" : "Ready";
    return `<article class="playlist-card"><span class="playlist-type">${p.type === "xtream" ? "XTREAM CODES" : "M3U / M3U8"}</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.type === "xtream" ? normalizeBase(p.baseUrl).replace(/^https?:\/\//, "") : "Playlist URL saved")}</p>
      <span class="playlist-status"><i class="status-dot ${String(status).toLowerCase() === "active" ? "" : "inactive"}"></i>${escapeHtml(status)}${p.serverInfo ? ` • ${escapeHtml(formatExpiry(p.serverInfo.exp_date))}` : ""}</span>
      <div class="playlist-card-actions"><button class="focusable" data-open-playlist="${p.id}">${active ? "OPEN" : "CONNECT"}</button><button class="focusable" data-edit-playlist="${p.id}">EDIT</button><button class="focusable" data-delete-playlist="${p.id}">DELETE</button></div></article>`;
  }

  function bindContentActions() {
    qa("[data-action='add-playlist']", el("content")).forEach((b) => b.onclick = () => showPlaylistModal());
    qa("[data-action='manage']", el("content")).forEach((b) => b.onclick = renderManage);
    qa("[data-action='reload']", el("content")).forEach((b) => b.onclick = () => loadActiveCatalog(true));
    qa("[data-action='refresh']", el("content")).forEach((b) => b.onclick = () => loadActiveCatalog(true));
    qa("[data-view-jump]", el("content")).forEach((b) => b.onclick = () => setView(b.dataset.viewJump));
    qa("[data-category]", el("content")).forEach((b) => b.onclick = () => { activeCategory = b.dataset.category; resetRenderingWindow(); renderLibrary(currentView); });
    qa("[data-load-more]", el("content")).forEach((b) => b.onclick = () => {
      renderedItemCount += pageSize();
      if (currentView === "home") renderHome(true); else renderLibrary(currentView, true);
    });
    qa("[data-open-playlist]", el("content")).forEach((b) => b.onclick = () => { setActivePlaylist(b.dataset.openPlaylist); setView("home"); });
    qa("[data-edit-playlist]", el("content")).forEach((b) => b.onclick = () => showPlaylistModal(state.playlists.find((p) => p.id === b.dataset.editPlaylist)));
    qa("[data-delete-playlist]", el("content")).forEach((b) => b.onclick = () => confirmDeletePlaylist(b.dataset.deletePlaylist));
    qa("[data-play-index]", el("content")).forEach((card) => card.onclick = (event) => {
      const favorite = event.target.closest("[data-favorite-id]");
      if (favorite) { event.preventDefault(); event.stopPropagation(); return toggleFavorite(favorite.dataset.favoriteId); }
      const items = currentView === "home" ? findItemListForId(card.dataset.itemId) : currentItems;
      const index = items.findIndex((x) => x.id === card.dataset.itemId);
      const item = items[index];
      if (!item) return;
      if (item.kind === "live") {
        qa(".media-card.selected", el("content")).forEach((node) => node.classList.remove("selected"));
        card.classList.add("selected");
        if (isDoubleLiveClick(item.id)) selectMedia(item, items, index);
        return;
      }
      selectMedia(item, items, index);
    });
  }

  function isDoubleLiveClick(id) {
    const now = Date.now();
    const doubleClick = lastLiveClickId === id && now - lastLiveClickAt <= 550;
    lastLiveClickId = doubleClick ? "" : id;
    lastLiveClickAt = doubleClick ? 0 : now;
    return doubleClick;
  }

  function bindLiveBrowserActions(initialItem) {
    q("[data-live-back]", el("content"))?.addEventListener("click", () => setView("home"));
    const search = el("liveSearchInput");
    if (search) search.oninput = () => {
      rememberLiveBrowserPosition();
      liveSearchQuery = search.value;
      clearTimeout(liveSearchTimer);
      liveSearchTimer = setTimeout(() => {
        liveChannelScrollState[liveScrollContextKey()] = 0;
        resetRenderingWindow();
        renderLiveLibrary();
        requestAnimationFrame(() => {
          const next = el("liveSearchInput");
          if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
        });
      }, 120);
    };
    qa("[data-live-category]", el("content")).forEach((button) => button.onclick = () => {
      rememberLiveBrowserPosition();
      activeCategory = button.dataset.liveCategory;
      selectedLiveId = "";
      liveChannelScrollState[liveScrollContextKey()] = 0;
      resetRenderingWindow();
      renderLiveLibrary();
    });
    bindLiveChannelRows();
    const loadMore = q("[data-live-load-more]", el("content"));
    if (loadMore) loadMore.onclick = revealMoreLiveChannels;
    const list = q(".live-channel-list", el("content"));
    if (list) list.onscroll = () => {
      if (list.dataset.liveScrollKey) liveChannelScrollState[list.dataset.liveScrollKey] = list.scrollTop;
      if (pagingLock || renderedItemCount >= currentItems.length || list.scrollTop + list.clientHeight < list.scrollHeight - 360) return;
      revealMoreLiveChannels();
    };
    const categoryList = q(".live-category-list", el("content"));
    if (categoryList) categoryList.onscroll = () => { liveCategoryScrollTop = categoryList.scrollTop; };
    bindLiveInspectorActions(initialItem);
    if (initialItem) {
      loadLiveProgram(initialItem).catch(() => {});
      scheduleLivePreview(initialItem, 420);
    }
  }

  function bindLiveChannelRows(root = el("content")) {
    qa("[data-live-channel]:not([data-live-bound])", root).forEach((row) => {
      const item = currentItems.find((entry) => entry.id === row.dataset.liveChannel);
      if (!item) return;
      row.dataset.liveBound = "1";
      row.onfocus = () => selectLiveChannel(item);
      row.onmouseenter = () => {
        if (!window.matchMedia || window.matchMedia("(hover:hover)").matches) selectLiveChannel(item);
      };
      row.onclick = () => {
        selectLiveChannel(item);
        if (isDoubleLiveClick(item.id)) selectMedia(item, currentItems, currentItems.findIndex((entry) => entry.id === item.id));
      };
    });
  }

  function revealMoreLiveChannels() {
    const list = q(".live-channel-list", el("content"));
    if (!list || pagingLock || renderedItemCount >= currentItems.length) return;
    pagingLock = true;
    const start = Math.min(renderedItemCount, currentItems.length);
    const end = Math.min(currentItems.length, start + livePageSize());
    q("[data-live-load-more]", list)?.remove();
    list.insertAdjacentHTML("beforeend", currentItems.slice(start, end).map((item, offset) => liveChannelRowHtml(item, start + offset, item.id === selectedLiveId)).join(""));
    renderedItemCount = end;
    if (end < currentItems.length) {
      list.insertAdjacentHTML("beforeend", `<button class="live-load-more focusable" data-live-load-more>LOAD MORE CHANNELS <span>${end.toLocaleString()} / ${currentItems.length.toLocaleString()}</span></button>`);
      q("[data-live-load-more]", list).onclick = revealMoreLiveChannels;
    }
    bindLiveChannelRows(list);
    pagingLock = false;
  }

  function selectLiveChannel(item) {
    if (!item || selectedLiveId === item.id && q("[data-live-channel].selected", el("content"))?.dataset.liveChannel === item.id) return;
    selectedLiveId = item.id;
    qa("[data-live-channel]", el("content")).forEach((row) => {
      const selected = row.dataset.liveChannel === item.id;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
    const inspector = el("liveInspector");
    if (inspector) inspector.innerHTML = liveInspectorHtml(item);
    bindLiveInspectorActions(item);
    loadLiveProgram(item).catch(() => {});
    scheduleLivePreview(item);
  }

  function bindLiveInspectorActions(item) {
    if (!item) return;
    q("[data-live-play]", el("content"))?.addEventListener("click", () => selectMedia(item, currentItems, currentItems.findIndex((entry) => entry.id === item.id)));
    q("[data-live-favorite]", el("content"))?.addEventListener("click", () => toggleFavorite(item.id));
    q("[data-live-info]", el("content"))?.addEventListener("click", () => loadLiveProgram(item, true));
  }

  async function loadLiveProgram(item, announce = false) {
    const titleNode = el("liveProgramTitle");
    const timeNode = el("liveProgramTime");
    if (!titleNode || !timeNode || selectedLiveId !== item.id) return;
    const playlist = activePlaylist();
    if (!playlist || playlist.type !== "xtream" || !item.streamId) {
      titleNode.textContent = "No program information";
      timeNode.textContent = item.group || "Live channel";
      if (announce) toast("This playlist does not provide an EPG for this channel");
      return;
    }
    try {
      const epg = await fetchJson(xtreamUrl(playlist, { action: "get_short_epg", stream_id: item.streamId, limit: "2" }));
      if (selectedLiveId !== item.id) return;
      const now = Array.isArray(epg?.epg_listings) ? epg.epg_listings[0] : null;
      if (!now) throw new Error("No EPG");
      titleNode.textContent = decodeMaybeBase64(now.title || now.name || "No program information");
      timeNode.textContent = [now.start, now.end].filter(Boolean).join(" – ") || item.group || "On air now";
      q(".live-program", el("content"))?.classList.add("has-info");
      if (announce) toast("Program information updated");
    } catch (_) {
      if (selectedLiveId !== item.id) return;
      titleNode.textContent = "No program information";
      timeNode.textContent = item.group || "Live channel";
      if (announce) toast("No EPG information is available");
    }
  }

  function setLiveBrowserMode(active) {
    document.documentElement.classList.toggle("live-browser-active", Boolean(active));
    if (!active) {
      clearTimeout(liveSearchTimer);
      stopLivePreview();
    }
  }

  function livePreviewSupported() {
    return innerWidth >= 900 && innerWidth > innerHeight && androidPlayerAvailable() && typeof window.MazenPlayer.setViewport === "function";
  }

  function scheduleLivePreview(item, delay = 300) {
    clearTimeout(livePreviewTimer);
    if (!item || !livePreviewSupported() || !el("playerScreen").classList.contains("hidden")) {
      const status = el("livePreviewStatus");
      if (status && !livePreviewSupported()) status.textContent = "Preview available on landscape screens";
      return;
    }
    livePreviewTimer = setTimeout(() => startLivePreview(item), delay);
  }

  function startLivePreview(item) {
    if (!item || selectedLiveId !== item.id || !livePreviewSupported() || !el("playerScreen").classList.contains("hidden")) return;
    clearTimeout(livePreviewTimeout);
    livePreviewTimeout = null;
    livePreviewPlan = streamUrlCandidates(item).slice(0, 2);
    if (!livePreviewPlan.length) return setLivePreviewStatus("Preview unavailable");
    livePreviewAttempt = 0;
    startLivePreviewCandidate(item);
  }

  function startLivePreviewCandidate(item) {
    const frame = el("livePreviewFrame");
    const url = livePreviewPlan[livePreviewAttempt];
    if (!frame || !url || selectedLiveId !== item.id) return;
    clearTimeout(livePreviewTimeout);
    livePreviewGeneration = -1000000 - (++livePreviewSequence);
    livePreviewItemId = item.id;
    document.documentElement.classList.add("native-preview-active");
    frame.classList.remove("preview-playing", "preview-error");
    frame.classList.add("preview-connecting");
    setLivePreviewStatus(livePreviewAttempt ? "Opening alternate preview…" : "Opening live preview…");
    positionLivePreviewViewport(frame);
    try {
      window.MazenPlayer.setAspect("cover");
      window.MazenPlayer.setMuted(true);
      playAndroidStream(url, livePreviewGeneration, item);
    } catch (_) { return advanceLivePreview(item, "Preview engine unavailable"); }
    livePreviewTimeout = setTimeout(() => advanceLivePreview(item), livePreviewAttempt ? 7000 : 5200);
  }

  function positionLivePreviewViewport(frame = el("livePreviewFrame")) {
    if (!frame || !livePreviewSupported()) return;
    const rect = frame.getBoundingClientRect();
    const scale = Number(window.devicePixelRatio || 1);
    try { window.MazenPlayer.setViewport(Math.round(rect.left * scale), Math.round(rect.top * scale), Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale))); } catch (_) {}
  }

  function handleLivePreviewEvent(type, generation, detail) {
    if (Number(generation) !== livePreviewGeneration || !selectedLiveId) return false;
    if (selectedLiveId !== livePreviewItemId) return true;
    const item = currentItems.find((entry) => entry.id === selectedLiveId);
    const frame = el("livePreviewFrame");
    if (!item || !frame) { stopLivePreview(); return true; }
    if (type === "playing") {
      clearTimeout(livePreviewTimeout);
      frame.classList.remove("preview-connecting", "preview-error");
      frame.classList.add("preview-playing");
      setLivePreviewStatus("LIVE PREVIEW • MUTED");
    } else if (type === "prepared") {
      frame.classList.remove("preview-connecting", "preview-error");
      frame.classList.add("preview-playing");
      setLivePreviewStatus("LIVE PREVIEW • MUTED");
    } else if (type === "bufferingStart") {
      setLivePreviewStatus("Opening live preview…");
    } else if (type === "bufferingEnd" && frame.classList.contains("preview-playing")) {
      setLivePreviewStatus("LIVE PREVIEW • MUTED");
    } else if (type === "error" || type === "stalled") {
      advanceLivePreview(item);
    }
    return true;
  }

  function advanceLivePreview(item, reason) {
    clearTimeout(livePreviewTimeout);
    livePreviewTimeout = null;
    if (selectedLiveId === item?.id && livePreviewAttempt + 1 < livePreviewPlan.length) {
      livePreviewAttempt += 1;
      startLivePreviewCandidate(item);
      return;
    }
    try { window.MazenPlayer.stop(); window.MazenPlayer.resetViewport(); } catch (_) {}
    livePreviewGeneration = 0;
    livePreviewItemId = "";
    livePreviewPlan = [];
    livePreviewAttempt = 0;
    document.documentElement.classList.remove("native-preview-active");
    const frame = el("livePreviewFrame");
    if (frame) { frame.classList.remove("preview-playing", "preview-connecting"); frame.classList.add("preview-error"); }
    setLivePreviewStatus("Preview unavailable — open channel to watch");
  }

  function setLivePreviewStatus(message) {
    const status = el("livePreviewStatus");
    if (status) status.textContent = message;
  }

  function stopLivePreview() {
    clearTimeout(livePreviewTimer);
    clearTimeout(livePreviewTimeout);
    livePreviewTimer = livePreviewTimeout = null;
    if (livePreviewGeneration) {
      try { window.MazenPlayer.stop(); window.MazenPlayer.resetViewport(); } catch (_) {}
    }
    livePreviewGeneration = 0;
    livePreviewItemId = "";
    livePreviewPlan = [];
    livePreviewAttempt = 0;
    document.documentElement.classList.remove("native-preview-active");
  }

  function findItemListForId(id) {
    if (catalog.live.some((x) => x.id === id)) return visibleItems(catalog.live);
    if (catalog.movies.some((x) => x.id === id)) return visibleItems(catalog.movies);
    return visibleItems(catalog.series);
  }

  function toggleFavorite(id) {
    const index = state.favorites.indexOf(id);
    if (index >= 0) state.favorites.splice(index, 1); else state.favorites.push(id);
    saveState();
    renderCurrentView();
    toast(index >= 0 ? "Removed from favorites" : "Added to favorites");
  }

  function showModal(content, wide = false) {
    const root = el("modalRoot");
    root.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${content}</div>`;
    root.classList.remove("hidden");
    qa(".modal-close", root).forEach((button) => button.addEventListener("click", closeModal));
    setTimeout(() => q(".modal .focusable", root)?.focus(), 30);
  }

  function closeModal() {
    el("modalRoot").classList.add("hidden");
    el("modalRoot").innerHTML = "";
  }

  function showPlaylistModal(existing = null) {
    const model = existing || { id: uid(), name: "", type: "xtream", baseUrl: "", username: "", password: "", m3uUrl: "" };
    showModal(`
      <div class="modal-head"><div><h2>${existing ? "Edit playlist" : "Add a playlist"}</h2><p>Credentials stay on this device</p></div><button class="modal-close focusable">✕</button></div>
      <div class="modal-body"><div class="tabs"><button class="tab focusable ${model.type === "xtream" ? "active" : ""}" data-playlist-tab="xtream">XTREAM CODES</button><button class="tab focusable ${model.type === "m3u" ? "active" : ""}" data-playlist-tab="m3u">M3U / M3U8</button></div>
      <form id="playlistForm" class="form-grid">
        <div class="field full"><label>PLAYLIST NAME</label><input class="focusable" name="name" maxlength="60" value="${escapeHtml(model.name)}" placeholder="Example: Home TV" required></div>
        <div id="xtreamFields" class="field full ${model.type !== "xtream" ? "hidden" : ""}"><div class="form-grid">
          <div class="field full"><label>SERVER URL</label><input class="focusable" name="baseUrl" inputmode="url" value="${escapeHtml(model.baseUrl)}" placeholder="http://example.com:8080"></div>
          <div class="field"><label>USERNAME</label><input class="focusable" name="username" autocomplete="off" value="${escapeHtml(model.username)}"></div>
          <div class="field"><label>PASSWORD</label><input class="focusable" name="password" type="password" autocomplete="off" value="${escapeHtml(model.password)}"></div>
        </div></div>
        <div id="m3uFields" class="field full ${model.type !== "m3u" ? "hidden" : ""}"><label>M3U / M3U8 URL</label><input class="focusable" name="m3uUrl" inputmode="url" value="${escapeHtml(model.m3uUrl)}" placeholder="https://example.com/playlist.m3u"><small>Direct HLS playlist URLs are supported too.</small></div>
      </form></div>
      <div class="modal-actions"><button class="secondary-button focusable modal-close">CANCEL</button><button id="savePlaylistBtn" class="primary-button focusable">${existing ? "SAVE CHANGES" : "ADD & CONNECT"}</button></div>`);
    let selectedType = model.type;
    qa("[data-playlist-tab]", el("modalRoot")).forEach((tab) => tab.onclick = () => {
      selectedType = tab.dataset.playlistTab;
      qa("[data-playlist-tab]", el("modalRoot")).forEach((x) => x.classList.toggle("active", x === tab));
      el("xtreamFields").classList.toggle("hidden", selectedType !== "xtream");
      el("m3uFields").classList.toggle("hidden", selectedType !== "m3u");
    });
    el("savePlaylistBtn").onclick = async () => {
      const data = new FormData(el("playlistForm"));
      const updated = {
        ...model, name: String(data.get("name") || "").trim(), type: selectedType,
        baseUrl: normalizeBase(data.get("baseUrl")), username: String(data.get("username") || "").trim(), password: String(data.get("password") || "").trim(), m3uUrl: String(data.get("m3uUrl") || "").trim()
      };
      if (!updated.name) return toast("Enter a playlist name");
      if (selectedType === "xtream" && (!/^https?:\/\//i.test(updated.baseUrl) || !updated.username || !updated.password)) return toast("Enter a valid server URL, username and password");
      if (selectedType === "m3u" && !/^https?:\/\//i.test(updated.m3uUrl)) return toast("Enter a valid M3U or M3U8 URL");
      updated.catalog = undefined;
      const i = state.playlists.findIndex((p) => p.id === updated.id);
      if (i >= 0) await deleteCatalogCache(updated.id);
      if (i >= 0) state.playlists[i] = updated; else state.playlists.push(updated);
      state.activePlaylistId = updated.id;
      saveState(); closeModal(); updateServerChip(); setView("home");
      await loadActiveCatalog(true);
    };
  }

  function confirmDeletePlaylist(id) {
    const p = state.playlists.find((x) => x.id === id);
    if (!p) return;
    showModal(`<div class="modal-head"><div><h2>Delete playlist?</h2><p>${escapeHtml(p.name)}</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body"><p style="color:var(--muted);font-size:12px;line-height:1.6">This removes the saved server details from this device. Your streaming account is not changed.</p></div><div class="modal-actions"><button class="secondary-button focusable modal-close">CANCEL</button><button id="confirmDelete" class="danger-button focusable">DELETE</button></div>`);
    el("confirmDelete").onclick = () => {
      state.playlists = state.playlists.filter((x) => x.id !== id);
      deleteCatalogCache(id).catch(() => {});
      if (state.activePlaylistId === id) state.activePlaylistId = state.playlists[0]?.id || null;
      saveState(); closeModal(); updateServerChip(); catalog = { live: [], movies: [], series: [], categories: { live: [], movies: [], series: [] } }; renderManage();
    };
  }

  async function selectMedia(item, items, index) {
    if (item.kind === "series" && item.seriesId) return showSeries(item);
    if (item.kind === "series" && !item.url) return toast("This M3U series entry has no playable episode URL");
    openPlayer(item, items, index);
  }

  async function showSeries(series) {
    const p = activePlaylist();
    showModal(`<div class="modal-head"><div><h2>${escapeHtml(series.name)}</h2><p>Loading episodes…</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body"><div class="episode-loading">Preparing the episode list…</div></div>`, true);
    try {
      const info = await fetchJson(xtreamUrl(p, { action: "get_series_info", series_id: series.seriesId }));
      const seasons = info.episodes || {};
      const episodes = Object.keys(seasons).sort((a, b) => Number(a) - Number(b)).flatMap((season) => (seasons[season] || []).map((ep) => {
        const directSource = normalizeStreamUrl(ep.direct_source, p.serverInfo?.stream_base || p.baseUrl);
        const containerExtension = preferredXtreamExtension(p, "movie", ep.container_extension);
        return mediaItem({
          id: `episode-${ep.id}`, streamId: ep.id, name: ep.title || `${series.name} S${season}E${ep.episode_num}`, group: `Season ${season}`,
          kind: "episode", seriesName: series.name, episode: ep.episode_num, season, logo: series.logo, directSource, containerExtension,
          url: directSource || buildXtreamStreamUrl(p, "episode", ep.id, containerExtension)
        });
      }));
      if (!episodes.length) throw new Error("No episodes were returned by this server");
      q(".modal-body", el("modalRoot")).innerHTML = `<div class="category-row">${Object.keys(seasons).sort((a,b)=>Number(a)-Number(b)).map((s, i) => `<button class="category-pill focusable ${i === 0 ? "active" : ""}" data-season="${escapeHtml(s)}">Season ${escapeHtml(s)}</button>`).join("")}</div><div id="episodeList" class="media-grid"></div>`;
      const renderSeason = (season) => {
        const list = episodes.filter((x) => String(x.season) === String(season));
        el("episodeList").innerHTML = mediaGridHtml(list);
        qa("[data-play-index]", el("episodeList")).forEach((card) => card.onclick = () => { const i = list.findIndex((x) => x.id === card.dataset.itemId); closeModal(); openPlayer(list[i], list, i); });
      };
      qa("[data-season]", el("modalRoot")).forEach((b) => b.onclick = () => { qa("[data-season]", el("modalRoot")).forEach((x) => x.classList.toggle("active", x === b)); renderSeason(b.dataset.season); });
      renderSeason(Object.keys(seasons).sort((a,b)=>Number(a)-Number(b))[0]);
    } catch (error) {
      q(".modal-body", el("modalRoot")).innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h2>Episodes unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function openPlayer(item, items, index) {
    closeModal();
    const previewHandoff = takeLivePreviewForFullscreen(item);
    if (!previewHandoff) stopLivePreview();
    currentItem = item;
    currentItems = items || [item];
    currentPlayingIndex = Number.isInteger(index) ? index : currentItems.findIndex((x) => x.id === item.id);
    el("playerScreen").classList.remove("hidden", "controls-hidden");
    el("playingType").textContent = item.kind === "live" ? "LIVE" : item.kind === "episode" ? "EPISODE" : "MOVIE";
    el("playingName").textContent = item.seriesName || item.name;
    el("playingGroup").textContent = item.kind === "episode" ? `${item.group} • Episode ${item.episode}` : item.group || "";
    el("rewindBtn").classList.toggle("hidden", item.kind === "live");
    el("forwardBtn").classList.toggle("hidden", item.kind === "live");
    el("timelineWrap").classList.toggle("hidden", item.kind === "live");
    el("duration").textContent = item.kind === "live" ? "LIVE" : "00:00";
    playerControlsLocked = false;
    el("playerScreen").classList.remove("controls-locked");
    el("playerFavoriteBtn").classList.toggle("active", state.favorites.includes(item.id));
    q("span", el("playerFavoriteBtn")).textContent = state.favorites.includes(item.id) ? "♥" : "♡";
    try { history.pushState({ mazenPlayer: true }, ""); } catch (_) {}
    if (previewHandoff) adoptLivePreview(item, previewHandoff);
    else startPlayback(item);
    if (item.kind === "live") loadCurrentProgram(item);
    showControls();
  }

  function takeLivePreviewForFullscreen(item) {
    if (!item || item.kind !== "live" || !livePreviewGeneration || livePreviewItemId !== item.id || playbackEngine) return null;
    const frame = el("livePreviewFrame");
    const handoff = {
      generation: livePreviewGeneration,
      attempt: livePreviewAttempt,
      url: livePreviewPlan[livePreviewAttempt] || "",
      started: Boolean(frame?.classList.contains("preview-playing"))
    };
    clearTimeout(livePreviewTimer);
    clearTimeout(livePreviewTimeout);
    livePreviewTimer = livePreviewTimeout = null;
    livePreviewGeneration = 0;
    livePreviewItemId = "";
    livePreviewPlan = [];
    livePreviewAttempt = 0;
    document.documentElement.classList.remove("native-preview-active");
    return handoff;
  }

  function adoptLivePreview(item, handoff) {
    const token = ++playbackToken;
    clearPlaybackTimers();
    hidePlayerError();
    playbackPlan = buildPlaybackPlan(item);
    const adoptedAttempt = playbackPlan.findIndex((candidate) => candidate.engine === "android" && candidate.url === handoff.url);
    playbackAttempt = adoptedAttempt >= 0 ? adoptedAttempt : 0;
    playbackNativeGeneration = handoff.generation;
    playbackEngine = { type: "android", instance: null };
    playbackHasStarted = Boolean(handoff.started);
    nativePaused = false;
    const video = el("video");
    video.poster = item.logo ? networkUrl(item.logo) : "";
    video.autoplay = true;
    video.preload = "auto";
    document.documentElement.classList.add("native-video-active");
    try {
      window.MazenPlayer.resetViewport();
      window.MazenPlayer.setAspect(state.settings.aspect || "contain");
      if (nativeMuted) window.MazenPlayer.setMuted(true);
      else window.MazenPlayer.setVolume(nativeVolume);
      window.MazenPlayer.setBrightness(Math.min(1, Number(el("playerScreen").dataset.brightness || 1)));
    } catch (_) {}
    if (playbackHasStarted) {
      markPlaybackStarted();
      return;
    }
    el("playerScreen").classList.add("is-connecting");
    el("playPauseBtn").textContent = "Ⅱ";
    setPlayerLoading("Finishing the existing stream connection…", 450);
    const timeout = playbackPlan[playbackAttempt]?.timeout || 10000;
    playbackStartTimer = setTimeout(() => fallbackPlayback(token, playbackAttempt, "Stream connection timed out"), timeout);
  }

  async function loadCurrentProgram(item) {
    const p = activePlaylist();
    if (!p || p.type !== "xtream" || !item.streamId) return;
    try {
      const epg = await fetchJson(xtreamUrl(p, { action: "get_short_epg", stream_id: item.streamId, limit: "2" }));
      const now = Array.isArray(epg?.epg_listings) ? epg.epg_listings[0] : null;
      if (!now || currentItem?.id !== item.id) return;
      const title = decodeMaybeBase64(now.title || now.name || "");
      const times = [now.start, now.end].filter(Boolean).join(" – ");
      el("playingGroup").textContent = [title, times].filter(Boolean).join(" • ") || item.group || "";
    } catch (_) {}
  }

  function decodeMaybeBase64(value) {
    const text = String(value || "");
    try {
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0) return decodeURIComponent(Array.prototype.map.call(atob(text), (c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join(""));
    } catch (_) {}
    return text;
  }

  function startPlayback(item) {
    const token = ++playbackToken;
    clearPlaybackTimers();
    hidePlayerError();
    playbackHasStarted = false;
    nativePosition = 0;
    nativeDuration = 0;
    playbackAttempt = 0;
    playbackPlan = buildPlaybackPlan(item);
    const video = el("video");
    video.poster = item.logo ? networkUrl(item.logo) : "";
    video.autoplay = true;
    video.preload = "auto";
    video.volume = Math.max(0, Math.min(1, video.volume || 1));
    el("playerScreen").classList.add("is-connecting");
    el("playPauseBtn").textContent = "Ⅱ";
    if (!playbackPlan.length) return showPlayerError("The server did not provide a usable stream URL");
    tryPlaybackCandidate(token);
    if (item.subtitleUrl) loadSubtitleUrl(item.subtitleUrl, "Playlist subtitles").catch(() => {});
    if (state.settings.autoSubtitles && item.kind !== "live") autoFindSubtitles(item).catch(() => {});
  }

  function buildPlaybackPlan(item) {
    const plan = [];
    const add = (engine, url, timeout = 12000) => {
      if (!url || plan.some((entry) => entry.engine === engine && entry.url === url)) return;
      plan.push({ engine, url, timeout });
    };
    const hlsAvailable = Boolean(window.Hls && window.Hls.isSupported());
    const mpegAvailable = Boolean(window.mpegts && window.mpegts.isSupported());
    const nativeHlsAvailable = Boolean(el("video").canPlayType("application/vnd.apple.mpegurl") || el("video").canPlayType("application/x-mpegURL"));
    const androidAvailable = androidPlayerAvailable();
    const urls = streamUrlCandidates(item);
    if (androidAvailable) {
      for (const url of urls) add("android", url, item.kind === "live" ? 9500 : 22000);
      return plan;
    }
    for (const url of urls) {
      const type = streamUrlType(url);
      if (type === "hls") {
        if (hlsAvailable) add("hls", url, 12000);
        else if (nativeHlsAvailable || !androidAvailable) add("native", url, 12000);
      } else if (type === "ts") {
        if (mpegAvailable) add("mpegts", url, 12000);
        else if (!androidAvailable) add("native", url, 12000);
      } else {
        add("native", url, item.kind === "live" ? 12000 : 16000);
      }
    }
    return plan;
  }

  function streamUrlType(url) {
    const path = String(url || "").toLowerCase().split(/[?#]/)[0];
    if (path.endsWith(".m3u8") || path.includes("/hls/")) return "hls";
    if (path.endsWith(".ts")) return "ts";
    return "progressive";
  }

  function streamUrlCandidates(item) {
    const urls = [];
    const add = (value) => {
      const url = normalizeStreamUrl(value);
      if (url && !urls.includes(url)) urls.push(url);
    };
    const playlist = activePlaylist();
    if (playlist?.type === "xtream" && item?.streamId !== undefined && item?.streamId !== null) {
      const kind = item.kind === "episode" ? "episode" : item.kind === "live" ? "live" : "movie";
      const extensionKind = kind === "live" ? "live" : "movie";
      const formats = [];
      const explicit = cleanStreamExtension(item.containerExtension, extensionKind);
      const allowedFormats = kind === "live" ? xtreamOutputFormats(playlist, extensionKind) : [];
      if (kind === "live" && allowedFormats.includes("ts")) formats.push("ts");
      if (explicit && !formats.includes(explicit)) formats.push(explicit);
      for (const format of allowedFormats) if (!formats.includes(format)) formats.push(format);
      if (!formats.length) {
        const legacyMatch = String(item.url || "").match(/\.([a-z0-9]+)(?:[?#]|$)/i);
        formats.push(cleanStreamExtension(legacyMatch?.[1], extensionKind) || (kind === "live" ? "ts" : "mp4"));
      }
      if (kind !== "live") add(item?.directSource);
      for (const format of formats.slice(0, 3)) add(buildXtreamStreamUrl(playlist, kind, item.streamId, format));
      if (kind === "live") add(item?.directSource);
      add(item.url);
    } else {
      add(item?.directSource);
      add(item?.url);
    }
    return urls;
  }

  function streamRequestHeaders(item) {
    const output = {};
    const headers = item?.headers && typeof item.headers === "object" && !Array.isArray(item.headers) ? item.headers : {};
    for (const [key, value] of Object.entries(headers)) {
      const name = String(key || "").trim();
      const text = String(value || "").trim();
      if (name && text && !/^(host|content-length|connection)$/i.test(name)) output[name] = text;
    }
    return output;
  }

  function playAndroidStream(url, generation, item = currentItem) {
    const headers = streamRequestHeaders(item);
    if (typeof window.MazenPlayer.playWithHeaders === "function") window.MazenPlayer.playWithHeaders(url, generation, JSON.stringify(headers));
    else window.MazenPlayer.play(url, generation);
  }

  async function tryPlaybackCandidate(token) {
    if (token !== playbackToken || !currentItem) return;
    clearPlaybackTimers();
    const candidate = playbackPlan[playbackAttempt];
    if (!candidate) return showPlayerError("This stream did not respond in any compatible mode");
    const keepWarmNativePlayer = candidate.engine === "android" && usingAndroidPlayer();
    destroyPlayback(keepWarmNativePlayer);
    hidePlayerError();
    const attempt = playbackAttempt;
    const video = el("video");
    el("playerScreen").classList.add("is-connecting");
    el("playPauseBtn").textContent = "Ⅱ";
    playbackStartTimer = setTimeout(() => fallbackPlayback(token, attempt, "Stream connection timed out"), candidate.timeout);
    try {
      if (candidate.engine === "android") {
        playbackEngine = { type: "android", instance: null };
        playbackNativeGeneration = token * 16 + attempt;
        nativePaused = false;
        document.documentElement.classList.add("native-video-active");
        try { window.MazenPlayer.resetViewport(); } catch (_) {}
        window.MazenPlayer.setAspect(state.settings.aspect || "contain");
        if (nativeMuted) window.MazenPlayer.setMuted(true);
        else window.MazenPlayer.setVolume(nativeVolume);
        window.MazenPlayer.setBrightness(Math.min(1, Number(el("playerScreen").dataset.brightness || 1)));
        playAndroidStream(candidate.url, playbackNativeGeneration);
      } else if (candidate.engine === "hls") {
        const requestHeaders = streamRequestHeaders(currentItem);
        const hls = new window.Hls({
          enableWorker: true, lowLatencyMode: true, backBufferLength: 20, maxBufferLength: 24,
          fragLoadingTimeOut: 8000, manifestLoadingTimeOut: 8000, levelLoadingTimeOut: 8000,
          maxBufferHole: .7, maxFragLookUpTolerance: .25,
          xhrSetup(xhr, requestUrl) {
            xhr.open("GET", networkUrl(requestUrl), true);
            for (const [key, value] of Object.entries(requestHeaders)) xhr.setRequestHeader(key, value);
          },
          fetchSetup(context, initParams) {
            const headers = new Headers(initParams?.headers || {});
            for (const [key, value] of Object.entries(requestHeaders)) headers.set(key, value);
            return new Request(networkUrl(context.url), { ...initParams, headers });
          }
        });
        playbackEngine = { type: "hls", instance: hls };
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MEDIA_ATTACHED, () => { if (token === playbackToken && attempt === playbackAttempt) hls.loadSource(networkUrl(candidate.url)); });
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => { if (token === playbackToken && attempt === playbackAttempt) armAutoplay(token, attempt); });
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (!data.fatal || token !== playbackToken || attempt !== playbackAttempt) return;
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !hls._mxRecovered) { hls._mxRecovered = true; hls.recoverMediaError(); return; }
          fallbackPlayback(token, attempt, data.details || "HLS stream failed");
        });
      } else if (candidate.engine === "mpegts") {
        const player = window.mpegts.createPlayer({ type: "mpegts", isLive: currentItem.kind === "live", url: networkUrl(candidate.url) }, {
          enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 4,
          liveBufferLatencyMinRemain: .8, stashInitialSize: 64 * 1024, autoCleanupSourceBuffer: true, headers: streamRequestHeaders(currentItem)
        });
        playbackEngine = { type: "mpegts", instance: player };
        player.attachMediaElement(video);
        player.load();
        if (window.mpegts.Events) player.on(window.mpegts.Events.ERROR, (_, detail) => fallbackPlayback(token, attempt, detail || "MPEG-TS stream failed"));
        armAutoplay(token, attempt);
      } else {
        playbackEngine = { type: "native", instance: null };
        video.src = networkUrl(candidate.url);
        video.load();
        armAutoplay(token, attempt);
      }
    } catch (error) {
      fallbackPlayback(token, attempt, error.message || "Playback engine failed");
    }
  }

  function fallbackPlayback(token, attempt, reason) {
    if (token !== playbackToken || attempt !== playbackAttempt || el("playerScreen").classList.contains("hidden")) return;
    clearPlaybackTimers();
    playbackAttempt += 1;
    playbackHasStarted = false;
    if (playbackAttempt < playbackPlan.length) {
      setTimeout(() => tryPlaybackCandidate(token), 0);
    } else {
      showPlayerError(`${friendlyPlaybackFailure(reason)}. All valid server playback paths were tried`);
    }
  }

  function friendlyPlaybackFailure(reason) {
    const message = String(reason || "Stream unavailable");
    if (/HttpStatusCodeInvalid|network_status_code_invalid|ERROR_CODE_IO_BAD_HTTP_STATUS|HTTP\s*(401|403|404|405|410|451|5\d\d)/i.test(message)) return "The IPTV server rejected this channel URL";
    if (/timeout|timed out/i.test(message)) return "The IPTV server did not answer in time";
    if (/ERROR_CODE_DECOD|codec|format|unsupported|malformed|UnrecognizedInputFormat/i.test(message)) return "This device could not decode the stream returned by the server";
    if (/ERROR_CODE_IO_NETWORK_CONNECTION_FAILED|UnknownHost|ConnectException/i.test(message)) return "The IPTV server could not be reached from this network";
    return message;
  }

  function setPlayerLoading(message, delay = 0) {
    clearTimeout(playbackSpinnerTimer);
    playbackSpinnerTimer = null;
    el("playerLoading").classList.add("hidden");
  }

  function clearPlaybackTimers() {
    clearTimeout(playbackStartTimer);
    clearTimeout(playbackStallTimer);
    clearTimeout(playbackSpinnerTimer);
    clearTimeout(playbackAutoplayTimer);
    playbackStartTimer = playbackStallTimer = playbackSpinnerTimer = playbackAutoplayTimer = null;
  }

  function armAutoplay(token = playbackToken, attempt = playbackAttempt, delay = 0) {
    clearTimeout(playbackAutoplayTimer);
    playbackAutoplayTimer = setTimeout(() => requestAutoplay(token, attempt), delay);
  }

  async function requestAutoplay(token, attempt) {
    if (token !== playbackToken || attempt !== playbackAttempt || playbackHasStarted || !currentItem || el("playerScreen").classList.contains("hidden")) return;
    const video = el("video");
    try {
      await video.play();
    } catch (error) {
      if (error?.name === "NotAllowedError" && !video.muted) {
        playbackTemporaryMute = true;
        video.muted = true;
        try { await video.play(); } catch (_) {}
      }
    }
    if (token === playbackToken && attempt === playbackAttempt && !playbackHasStarted) {
      armAutoplay(token, attempt, video.readyState >= 2 ? 180 : 420);
    }
  }

  async function tryPlay() {
    const video = el("video");
    if (!playbackHasStarted) return armAutoplay(playbackToken, playbackAttempt);
    try { await video.play(); }
    catch (_) {
      playbackHasStarted = false;
      el("playerScreen").classList.add("is-connecting");
      armAutoplay(playbackToken, playbackAttempt);
    }
  }

  function markPlaybackStarted() {
    if (!currentItem || el("playerScreen").classList.contains("hidden")) return;
    const channelWasSwitching = currentItem.kind === "live" && !el("channelSwitchFeedback").classList.contains("hidden");
    playbackHasStarted = true;
    clearPlaybackTimers();
    el("playerLoading").classList.add("hidden");
    el("playerScreen").classList.remove("is-connecting");
    el("playPauseBtn").textContent = "Ⅱ";
    if (playbackTemporaryMute) {
      playbackTemporaryMute = false;
      setTimeout(() => {
        if (currentItem && !el("playerScreen").classList.contains("hidden")) el("video").muted = false;
      }, 80);
    }
    if (channelWasSwitching) {
      hideChannelSwitchFeedback(220);
      clearTimeout(controlsTimer);
      controlsTimer = setTimeout(() => el("playerScreen").classList.add("controls-hidden"), 420);
    } else {
      showControls();
    }
  }

  function androidPlayerAvailable() {
    try { return Boolean(window.MazenPlayer && window.MazenPlayer.isAvailable()); }
    catch (_) { return false; }
  }

  function usingAndroidPlayer() {
    return playbackEngine?.type === "android";
  }

  function playerIsPaused() {
    return usingAndroidPlayer() ? nativePaused : el("video").paused;
  }

  function handleNativePlayerEvent(type, generation, detail) {
    if (handleLivePreviewEvent(type, generation, detail)) return;
    if (Number(generation) !== playbackNativeGeneration || !usingAndroidPlayer() || !currentItem || el("playerScreen").classList.contains("hidden")) return;
    const token = playbackToken;
    const attempt = playbackAttempt;
    if (type === "playing") {
      nativePaused = false;
      markPlaybackStarted();
    } else if (type === "prepared") {
      nativePaused = false;
    } else if (type === "paused") {
      nativePaused = true;
      el("playPauseBtn").textContent = "▶";
      showControls();
    } else if (type === "progress") {
      const values = String(detail || "").split(",").map(Number);
      if (Number.isFinite(values[0]) && Number.isFinite(values[1]) && values[1] > 0) {
        nativePosition = values[0];
        nativeDuration = values[1];
        el("currentTime").textContent = formatTime(nativePosition / 1000);
        el("duration").textContent = formatTime(nativeDuration / 1000);
        el("timeline").value = String(nativePosition / nativeDuration * 100);
      }
    } else if (type === "bufferingStart") {
      el("playerLoading").classList.add("hidden");
    } else if (type === "bufferingEnd") {
      clearTimeout(playbackSpinnerTimer);
      playbackSpinnerTimer = null;
      if (playbackHasStarted) el("playerLoading").classList.add("hidden");
    } else if (type === "ended") {
      if (currentItem.kind !== "live") playNeighbor(1);
    } else if (type === "error" || type === "stalled") {
      fallbackPlayback(token, attempt, detail || "Android native playback failed");
    }
  }

  function destroyPlayback(keepWarmNativePlayer = false) {
    const video = el("video");
    const wasAndroid = usingAndroidPlayer();
    if (wasAndroid && !keepWarmNativePlayer) {
      try { window.MazenPlayer.stop(); window.MazenPlayer.resetViewport(); } catch (_) {}
    }
    if (!keepWarmNativePlayer) document.documentElement.classList.remove("native-video-active");
    nativePaused = true;
    if (playbackEngine && playbackEngine.instance) {
      try { playbackEngine.instance.destroy(); } catch (_) {}
    }
    playbackEngine = null;
    if (keepWarmNativePlayer) return;
    try {
      video.pause();
      if (playbackTemporaryMute) video.muted = false;
      playbackTemporaryMute = false;
      video.removeAttribute("src");
      qa("track", video).forEach((t) => t.remove());
      video.load();
    } catch (_) {}
  }

  function closePlayer(fromHistory = false) {
    if (el("playerScreen").classList.contains("hidden")) return;
    clearTimeout(controlsTimer);
    clearTimeout(channelSwitchTimer);
    channelSwitchTimer = null;
    el("channelSwitchFeedback").classList.add("hidden");
    ++playbackToken;
    clearPlaybackTimers();
    destroyPlayback();
    el("playerScreen").classList.add("hidden");
    el("playerScreen").classList.remove("is-connecting");
    el("playerScreen").classList.remove("controls-locked");
    playerControlsLocked = false;
    currentItem = null;
    if (currentView === "live") {
      const selected = currentItems.find((item) => item.id === selectedLiveId);
      if (selected) scheduleLivePreview(selected, 750);
    }
    if (!fromHistory && history.state && history.state.mazenPlayer) history.back();
  }

  function showPlayerError(message) {
    clearPlaybackTimers();
    destroyPlayback();
    el("playerLoading").classList.add("hidden");
    el("playerScreen").classList.remove("is-connecting");
    el("playerErrorText").textContent = `${message}. Check the stream and server connection, then retry.`;
    el("playerError").classList.remove("hidden");
    el("playerScreen").classList.remove("controls-hidden");
    showControls();
  }

  function hidePlayerError() {
    el("playerError").classList.add("hidden");
  }

  function showControls() {
    el("playerScreen").classList.remove("controls-hidden");
    clearTimeout(controlsTimer);
    if (!playerControlsLocked && !playerIsPaused() && el("playerError").classList.contains("hidden")) controlsTimer = setTimeout(() => el("playerScreen").classList.add("controls-hidden"), 4200);
  }

  function playNeighbor(direction) {
    if (!currentItems.length) return;
    let index = currentPlayingIndex + direction;
    if (index < 0) index = currentItems.length - 1;
    if (index >= currentItems.length) index = 0;
    const item = currentItems[index];
    if (!item || item.kind === "series") return;
    currentPlayingIndex = index; currentItem = item;
    el("playingName").textContent = item.seriesName || item.name;
    el("playingGroup").textContent = item.group || "";
    el("playingType").textContent = item.kind === "live" ? "LIVE" : item.kind === "episode" ? "EPISODE" : "MOVIE";
    if (item.kind === "live") showChannelSwitchFeedback(direction, item);
    startPlayback(item);
  }

  function showChannelSwitchFeedback(direction, item) {
    clearTimeout(channelSwitchTimer);
    el("channelSwitchArrow").textContent = direction < 0 ? "◀┃" : "┃▶";
    el("channelSwitchDirection").textContent = direction < 0 ? "PREVIOUS CHANNEL" : "NEXT CHANNEL";
    el("channelSwitchName").textContent = item?.name || "Live channel";
    el("channelSwitchRail").innerHTML = channelSwitchRailHtml(currentPlayingIndex);
    el("channelSwitchFeedback").classList.remove("hidden");
    hideChannelSwitchFeedback(2600);
  }

  function hideChannelSwitchFeedback(delay = 0) {
    clearTimeout(channelSwitchTimer);
    channelSwitchTimer = setTimeout(() => {
      el("channelSwitchFeedback").classList.add("hidden");
      channelSwitchTimer = null;
    }, delay);
  }

  function channelSwitchRailHtml(activeIndex) {
    if (!currentItems.length || activeIndex < 0) return "";
    const indexes = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const index = (activeIndex + offset + currentItems.length) % currentItems.length;
      if (!indexes.includes(index)) indexes.push(index);
    }
    return indexes.map((index) => {
      const channel = currentItems[index];
      const fallback = escapeHtml((channel?.name || "MX").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase());
      const logo = channel?.logo ? `<img src="${escapeHtml(networkUrl(channel.logo))}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><i style="display:none">${fallback}</i>` : `<i>${fallback}</i>`;
      return `<div class="channel-switch-card ${index === activeIndex ? "active" : ""}">
        <span class="channel-switch-logo">${logo}</span>
        <span class="channel-switch-copy"><b>CH ${index + 1}</b><strong>${escapeHtml(channel?.name || "Live channel")}</strong><small>${escapeHtml(channel?.group || "Live TV")}</small></span>
      </div>`;
    }).join("");
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function toggleFullscreen() {
    if (usingAndroidPlayer()) return showControls();
    const target = el("playerScreen");
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (target.requestFullscreen) target.requestFullscreen();
      else if (el("video").webkitEnterFullscreen) el("video").webkitEnterFullscreen();
    } catch (_) { toast("Fullscreen is controlled by this device"); }
  }

  function cycleAspect() {
    const values = ["contain", "cover", "fill"];
    const video = el("video");
    const next = values[(values.indexOf(video.style.objectFit || state.settings.aspect) + 1) % values.length];
    video.style.objectFit = next; state.settings.aspect = next; saveState();
    if (usingAndroidPlayer()) try { window.MazenPlayer.setAspect(next); } catch (_) {}
    q("span", el("aspectBtn")).textContent = next === "contain" ? "FIT" : next === "cover" ? "FILL" : "STR";
  }

  async function loadSubtitleUrl(url, label = "Subtitle") {
    const response = await fetchWithTimeout(url, {}, 18000);
    if (!response.ok) throw new Error("Subtitle download failed");
    let text = await response.text();
    if (!/^WEBVTT/i.test(text.trim())) text = srtToVtt(text);
    const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles"; track.label = label; track.srclang = state.settings.subtitleLanguage.split(",")[0] || "ar"; track.src = blobUrl; track.default = true;
    el("video").appendChild(track);
    track.addEventListener("load", () => { if (track.track) track.track.mode = "showing"; toast("Subtitles loaded"); });
  }

  function srtToVtt(text) {
    return `WEBVTT\n\n${text.replace(/^\uFEFF/, "").replace(/\r+/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
  }

  async function autoFindSubtitles(item) {
    const key = state.settings.opensubtitlesKey.trim();
    if (!key) return;
    const title = encodeURIComponent((item.seriesName || item.name).replace(/\b(19|20)\d{2}\b/g, "").trim());
    const langs = encodeURIComponent(state.settings.subtitleLanguage || "ar,en");
    const searchResponse = await fetchWithTimeout(`https://api.opensubtitles.com/api/v1/subtitles?query=${title}&languages=${langs}`, { headers: { "Api-Key": key, "User-Agent": "MazenmiXTream v1.1.6" } });
    if (!searchResponse.ok) return;
    const result = await searchResponse.json();
    const fileId = result?.data?.[0]?.attributes?.files?.[0]?.file_id;
    if (!fileId) return;
    const response = await fetchWithTimeout("https://api.opensubtitles.com/api/v1/download", { method: "POST", headers: { "Api-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId }) });
    if (!response.ok) return;
    const download = await response.json();
    if (download.link) await loadSubtitleUrl(download.link, "OpenSubtitles");
  }

  function showSubtitleMenu() {
    const tracks = Array.from(el("video").textTracks || []);
    showModal(`<div class="modal-head"><div><h2>Subtitles</h2><p>Embedded, sidecar or OpenSubtitles</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body">
      <div class="setting-row"><div class="setting-copy"><strong>Off</strong><span>Hide all subtitle tracks</span></div><button class="secondary-button focusable" data-sub-off>SELECT</button></div>
      ${tracks.map((t, i) => `<div class="setting-row"><div class="setting-copy"><strong>${escapeHtml(t.label || `Track ${i + 1}`)}</strong><span>${escapeHtml(t.language || "Embedded")}</span></div><button class="secondary-button focusable" data-sub-track="${i}">SELECT</button></div>`).join("")}
      <div class="field" style="margin-top:18px"><label>SUBTITLE URL (.VTT OR .SRT)</label><input id="subtitleUrlInput" class="focusable" inputmode="url" placeholder="https://…/subtitle.srt"></div>
      </div><div class="modal-actions"><button class="secondary-button focusable modal-close">CANCEL</button><button id="loadSubtitleBtn" class="primary-button focusable">LOAD URL</button></div>`);
    q("[data-sub-off]", el("modalRoot")).onclick = () => { tracks.forEach((t) => t.mode = "disabled"); closeModal(); };
    qa("[data-sub-track]", el("modalRoot")).forEach((b) => b.onclick = () => { tracks.forEach((t, i) => t.mode = i === Number(b.dataset.subTrack) ? "showing" : "disabled"); closeModal(); });
    el("loadSubtitleBtn").onclick = async () => { const url = el("subtitleUrlInput").value.trim(); if (!/^https?:\/\//i.test(url)) return toast("Enter a valid subtitle URL"); closeModal(); try { await loadSubtitleUrl(url); } catch (e) { toast(e.message); } };
  }

  function showSettings() {
    showModal(`<div class="modal-head"><div><h2>Settings</h2><p>Playback, privacy and parental controls</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body">
      <div class="setting-row"><div class="setting-copy"><strong>Hide adult content</strong><span>Filters adult channels, movies, series and categories</span></div><button id="adultToggle" class="toggle focusable ${state.settings.hideAdult ? "on" : ""}" aria-label="Hide adult content"></button></div>
      <div class="setting-row"><div class="setting-copy"><strong>Parental control PIN</strong><span>${state.settings.parentalPin ? "PIN is enabled" : "No PIN set"}</span></div><button id="pinBtn" class="secondary-button focusable">${state.settings.parentalPin ? "CHANGE" : "SET PIN"}</button></div>
      <div class="setting-row"><div class="setting-copy"><strong>Automatic movie subtitles</strong><span>Uses embedded tracks first, then OpenSubtitles when an API key is set</span></div><button id="autoSubToggle" class="toggle focusable ${state.settings.autoSubtitles ? "on" : ""}"></button></div>
      <div class="field" style="margin-top:18px"><label>OPENSUBTITLES API KEY (OPTIONAL)</label><input id="osKey" class="focusable" type="password" value="${escapeHtml(state.settings.opensubtitlesKey)}" placeholder="Required for online subtitle search"><small>Live speech translation requires a separate speech-to-text service and is not faked by this setting.</small></div>
      <div class="field" style="margin-top:15px"><label>PREFERRED SUBTITLE LANGUAGES</label><input id="subLang" class="focusable" value="${escapeHtml(state.settings.subtitleLanguage)}" placeholder="ar,en"><small>Comma-separated ISO language codes.</small></div>
      </div><div class="modal-actions"><button class="primary-button focusable modal-close">DONE</button></div>`);
    el("adultToggle").onclick = async () => {
      if (state.settings.hideAdult) {
        const ok = state.settings.parentalPin ? await requestPin("Unlock adult content") : true;
        if (!ok) return;
      }
      state.settings.hideAdult = !state.settings.hideAdult; saveState();
      closeModal(); renderCurrentView(); toast(state.settings.hideAdult ? "Adult content hidden" : "Adult content visible");
    };
    el("autoSubToggle").onclick = () => { state.settings.autoSubtitles = !state.settings.autoSubtitles; el("autoSubToggle").classList.toggle("on", state.settings.autoSubtitles); saveState(); };
    el("pinBtn").onclick = () => requestPin(state.settings.parentalPin ? "Enter current PIN" : "Create a 4-digit PIN", true);
    el("osKey").onchange = () => { state.settings.opensubtitlesKey = el("osKey").value.trim(); saveState(); };
    el("subLang").onchange = () => { state.settings.subtitleLanguage = el("subLang").value.trim() || "ar,en"; saveState(); };
  }

  function requestPin(title, changeMode = false) {
    return new Promise((resolve) => {
      let value = "";
      const expected = state.settings.parentalPin;
      const creating = changeMode && !expected;
      const paint = () => qa(".pin-dots i", el("modalRoot")).forEach((dot, i) => dot.classList.toggle("filled", i < value.length));
      showModal(`<div class="modal-head"><div><h2>${escapeHtml(title)}</h2><p>${creating ? "Choose a PIN you will remember" : "Parental control"}</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body"><div class="pin-dots"><i></i><i></i><i></i><i></i></div><div class="pin-pad">${[1,2,3,4,5,6,7,8,9,"⌫",0,"✓"].map((x) => `<button class="pin-key focusable" data-pin-key="${x}">${x}</button>`).join("")}</div></div>`);
      const cancel = q(".modal-close", el("modalRoot"));
      cancel.onclick = () => { closeModal(); resolve(false); };
      qa("[data-pin-key]", el("modalRoot")).forEach((key) => key.onclick = () => {
        const k = key.dataset.pinKey;
        if (k === "⌫") value = value.slice(0, -1);
        else if (k === "✓") submit();
        else if (value.length < 4) value += k;
        paint();
        if (value.length === 4 && k !== "⌫") setTimeout(submit, 120);
      });
      function submit() {
        if (value.length !== 4) return toast("Enter 4 digits");
        if (creating) { state.settings.parentalPin = value; saveState(); closeModal(); toast("Parental PIN enabled"); resolve(true); }
        else if (value === expected) {
          if (changeMode) { closeModal(); setTimeout(() => { state.settings.parentalPin = ""; requestPin("Create a new 4-digit PIN", true).then(resolve); }, 100); }
          else { closeModal(); resolve(true); }
        } else { value = ""; paint(); toast("Incorrect PIN"); }
      }
    });
  }

  function showSearch() {
    if (!activePlaylist()) return toast("Add a playlist first");
    showModal(`<div class="modal-head"><div><h2>Search everything</h2><p>Channels, movies and series</p></div><button class="modal-close focusable">✕</button></div><div class="modal-body"><div class="search-panel"><span>⌕</span><input id="globalSearch" class="focusable" placeholder="Type a title or channel…" autocomplete="off"></div><div id="searchResults"></div></div>`, true);
    const input = el("globalSearch"), results = el("searchResults");
    input.oninput = () => {
      const term = input.value.trim().toLowerCase();
      if (term.length < 2) return results.innerHTML = "";
      const items = visibleItems([...catalog.live, ...catalog.movies, ...catalog.series]).filter((x) => `${x.name} ${x.group}`.toLowerCase().includes(term)).slice(0, 30);
      results.innerHTML = items.length ? mediaGridHtml(items) : emptyContentHtml("No matching content");
      qa("[data-play-index]", results).forEach((card) => card.onclick = () => { const i = items.findIndex((x) => x.id === card.dataset.itemId); closeModal(); selectMedia(items[i], items, i); });
    };
    setTimeout(() => input.focus(), 80);
  }

  function openSidebar() { el("sidebar").classList.add("open"); el("scrim").classList.add("open"); }
  function closeSidebar() { el("sidebar").classList.remove("open"); el("scrim").classList.remove("open"); }

  function bindGlobalEvents() {
    el("menuBtn").onclick = openSidebar;
    el("scrim").onclick = closeSidebar;
    el("brandBtn").onclick = () => setView("home");
    el("serverChip").onclick = showServerInformation;
    el("serverChip").onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") showServerInformation(); };
    el("manageBtn").onclick = renderManage;
    el("settingsBtn").onclick = showSettings;
    el("sideSettingsBtn").onclick = showSettings;
    el("searchBtn").onclick = showSearch;
    qa(".nav-item[data-view]").forEach((button) => button.onclick = () => setView(button.dataset.view));
    el("playerBack").onclick = () => closePlayer();
    el("playerErrorBack").onclick = () => closePlayer();
    el("retryBtn").onclick = () => currentItem && startPlayback(currentItem);
    el("prevBtn").onclick = () => playNeighbor(-1);
    el("nextBtn").onclick = () => playNeighbor(1);
    el("rewindBtn").onclick = () => {
      if (usingAndroidPlayer() && typeof window.MazenPlayer.seekBy === "function") window.MazenPlayer.seekBy(-30);
      else el("video").currentTime = Math.max(0, el("video").currentTime - 30);
      showControls();
    };
    el("forwardBtn").onclick = () => {
      if (usingAndroidPlayer() && typeof window.MazenPlayer.seekBy === "function") window.MazenPlayer.seekBy(30);
      else el("video").currentTime = Math.min(el("video").duration || Infinity, el("video").currentTime + 30);
      showControls();
    };
    el("playPauseBtn").onclick = () => {
      if (usingAndroidPlayer()) {
        try {
          if (nativePaused) { nativePaused = false; window.MazenPlayer.resume(); el("playPauseBtn").textContent = "Ⅱ"; }
          else { nativePaused = true; window.MazenPlayer.pause(); el("playPauseBtn").textContent = "▶"; }
        } catch (_) {}
        return showControls();
      }
      return el("video").paused ? tryPlay() : el("video").pause();
    };
    el("muteBtn").onclick = () => {
      if (usingAndroidPlayer()) {
        nativeMuted = !nativeMuted;
        try { window.MazenPlayer.setMuted(nativeMuted); } catch (_) {}
      } else {
        const v = el("video"); v.muted = !v.muted;
      }
      updateVolumeLabel(); showControls();
    };
    el("fullscreenBtn").onclick = toggleFullscreen;
    el("aspectBtn").onclick = cycleAspect;
    el("subtitleBtn").onclick = showSubtitleMenu;
    el("playerMore").onclick = showSubtitleMenu;
    el("playerFavoriteBtn").onclick = () => {
      if (!currentItem) return;
      const index = state.favorites.indexOf(currentItem.id);
      if (index >= 0) state.favorites.splice(index, 1); else state.favorites.push(currentItem.id);
      saveState();
      const active = index < 0;
      el("playerFavoriteBtn").classList.toggle("active", active);
      q("span", el("playerFavoriteBtn")).textContent = active ? "♥" : "♡";
      toast(active ? "Added to favorites" : "Removed from favorites");
    };
    el("playerLockBtn").onclick = () => {
      playerControlsLocked = !playerControlsLocked;
      el("playerScreen").classList.toggle("controls-locked", playerControlsLocked);
      el("playerLockBtn").classList.toggle("active", playerControlsLocked);
      q("span", el("playerLockBtn")).textContent = playerControlsLocked ? "🔐" : "🔒";
      showControls();
    };
    el("timeline").oninput = () => {
      const fraction = Number(el("timeline").value) / 100;
      if (usingAndroidPlayer() && nativeDuration > 0 && typeof window.MazenPlayer.seekToFraction === "function") window.MazenPlayer.seekToFraction(fraction);
      else { const v = el("video"); if (Number.isFinite(v.duration)) v.currentTime = fraction * v.duration; }
    };
    el("content").addEventListener("scroll", () => {
      if (pagingLock || !["home", "movies", "series"].includes(currentView) || renderedItemCount >= currentItems.length) return;
      const content = el("content");
      if (content.scrollTop + content.clientHeight < content.scrollHeight - 650) return;
      pagingLock = true;
      renderedItemCount += pageSize();
      if (currentView === "home") renderHome(true); else renderLibrary(currentView, true);
    }, { passive: true });

    const video = el("video");
    video.addEventListener("playing", markPlaybackStarted);
    for (const eventName of ["loadeddata", "canplay", "canplaythrough", "progress"]) {
      video.addEventListener(eventName, () => {
        if (!currentItem || playbackHasStarted || !video.paused) return;
        armAutoplay(playbackToken, playbackAttempt);
      });
    }
    video.addEventListener("waiting", () => {
      if (video.paused || !playbackHasStarted || !currentItem) return;
      const token = playbackToken, attempt = playbackAttempt;
      setPlayerLoading("Reconnecting stream…", 700);
      clearTimeout(playbackStallTimer);
      playbackStallTimer = setTimeout(() => fallbackPlayback(token, attempt, "Stream stopped responding"), 10000);
    });
    video.addEventListener("canplay", () => {
      if (!video.paused) markPlaybackStarted();
    });
    video.addEventListener("pause", () => {
      if (!playbackHasStarted) return;
      el("playPauseBtn").textContent = "▶";
      showControls();
    });
    video.addEventListener("ended", () => { if (currentItem && currentItem.kind !== "live") playNeighbor(1); });
    video.addEventListener("timeupdate", () => {
      if (!playbackHasStarted && video.currentTime > 0) markPlaybackStarted();
      el("currentTime").textContent = formatTime(video.currentTime);
      if (Number.isFinite(video.duration) && video.duration > 0) { el("duration").textContent = formatTime(video.duration); el("timeline").value = String(video.currentTime / video.duration * 100); }
    });
    video.addEventListener("volumechange", updateVolumeLabel);
    video.addEventListener("error", () => {
      if (!playbackEngine || playbackEngine.type !== "native" || !currentItem) return;
      const code = video.error?.code;
      fallbackPlayback(playbackToken, playbackAttempt, code === 4 ? "Stream format is not supported by this mode" : "Android playback failed");
    });

    el("playerScreen").addEventListener("click", (event) => {
      if (event.target.closest("button,input,.player-error")) return;
      if (playerControlsLocked) return showControls();
      if (el("playerScreen").classList.contains("controls-hidden")) showControls(); else el("playerScreen").classList.add("controls-hidden");
    });
    el("playerScreen").addEventListener("dblclick", (event) => { if (!event.target.closest("button,input")) toggleFullscreen(); });
    el("playerScreen").addEventListener("touchstart", handleTouchStart, { passive: true });
    el("playerScreen").addEventListener("touchmove", handleTouchMove, { passive: false });
    el("playerScreen").addEventListener("touchend", handleTouchEnd, { passive: true });

    window.addEventListener("popstate", () => {
      if (!el("playerScreen").classList.contains("hidden")) closePlayer(true);
      else if (!el("modalRoot").classList.contains("hidden")) closeModal();
    });
    window.addEventListener("resize", () => {
      if (!livePreviewGeneration) return;
      if (!livePreviewSupported()) return stopLivePreview();
      requestAnimationFrame(() => positionLivePreviewViewport());
    }, { passive: true });
    document.addEventListener("keydown", handleKeys);
    window.addEventListener("error", (event) => { if (!event.message?.includes("ResizeObserver")) console.warn("MazenmiXTream recovered:", event.message); });
  }

  function updateVolumeLabel() {
    if (usingAndroidPlayer()) {
      q("b", el("muteBtn")).textContent = nativeMuted ? "0" : String(Math.round(nativeVolume * 100));
      return;
    }
    const video = el("video");
    q("b", el("muteBtn")).textContent = video.muted ? "0" : String(Math.round(video.volume * 100));
  }

  function handleTouchStart(event) {
    if (event.touches.length !== 1 || event.target.closest("button,input")) return;
    const t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, lastX: t.clientX, lastY: t.clientY, volume: usingAndroidPlayer() ? nativeVolume : el("video").volume, brightness: Number(el("playerScreen").dataset.brightness || 1), time: el("video").currentTime, mode: null };
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => { if (currentItem && currentItem.kind !== "live") { el("video").playbackRate = 2; showGesture("Speed", "2×"); } }, 650);
  }

  function handleTouchMove(event) {
    if (!touchStart || event.touches.length !== 1) return;
    const t = event.touches[0], dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart.lastX = t.clientX;
    touchStart.lastY = t.clientY;
    if (!touchStart.mode && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
      clearTimeout(longPressTimer);
      touchStart.mode = Math.abs(dx) > Math.abs(dy) ? (currentItem?.kind === "live" ? "channel" : "seek") : touchStart.x > innerWidth / 2 ? "volume" : "brightness";
    }
    if (!touchStart.mode) return;
    event.preventDefault();
    if (touchStart.mode === "volume") {
      const value = Math.max(0, Math.min(1, touchStart.volume - dy / innerHeight * 1.6));
      if (usingAndroidPlayer()) {
        nativeVolume = value; nativeMuted = false;
        try { window.MazenPlayer.setVolume(value); } catch (_) {}
        updateVolumeLabel();
      } else {
        el("video").volume = value; el("video").muted = false;
      }
      showGesture("Volume", `${Math.round(value * 100)}%`);
    } else if (touchStart.mode === "brightness") {
      const value = Math.max(.25, Math.min(1.35, touchStart.brightness - dy / innerHeight * 1.6));
      el("playerScreen").dataset.brightness = String(value); el("playerScreen").style.setProperty("--video-brightness", value);
      if (androidPlayerAvailable()) try { window.MazenPlayer.setBrightness(Math.min(1, value)); } catch (_) {}
      showGesture("Brightness", `${Math.round(value / 1.35 * 100)}%`);
    } else if (touchStart.mode === "seek" && Number.isFinite(el("video").duration)) {
      const target = Math.max(0, Math.min(el("video").duration, touchStart.time + dx / innerWidth * 180)); el("video").currentTime = target; showGesture(dx >= 0 ? "Forward" : "Rewind", formatTime(target));
    }
  }

  function handleTouchEnd() {
    clearTimeout(longPressTimer);
    if (el("video").playbackRate !== 1) el("video").playbackRate = 1;
    if (touchStart?.mode === "channel") {
      const dx = Number(touchStart.lastX || touchStart.x) - touchStart.x;
      if (Math.abs(dx) >= Math.max(58, innerWidth * .08)) playNeighbor(dx < 0 ? 1 : -1);
    }
    touchStart = null;
    setTimeout(() => el("gestureIndicator").classList.add("hidden"), 550);
  }

  function showGesture(label, value) {
    q("span", el("gestureIndicator")).textContent = label;
    q("b", el("gestureIndicator")).textContent = value;
    el("gestureIndicator").classList.remove("hidden");
  }

  function handleKeys(event) {
    if (event.key === "Escape" || event.key === "Backspace" || event.keyCode === 4) {
      if (!el("modalRoot").classList.contains("hidden")) { event.preventDefault(); closeModal(); return; }
      if (!el("playerScreen").classList.contains("hidden")) { event.preventDefault(); closePlayer(); return; }
      if (el("sidebar").classList.contains("open")) { event.preventDefault(); closeSidebar(); return; }
    }
    if (!el("playerScreen").classList.contains("hidden")) {
      if (event.key === "MediaPlayPause" || event.key === " ") { event.preventDefault(); el("playPauseBtn").click(); }
      if (currentItem?.kind === "live" && !isControlFocused() && ["ArrowLeft", "ChannelDown", "MediaTrackPrevious", "PageDown"].includes(event.key)) { event.preventDefault(); playNeighbor(-1); return; }
      if (currentItem?.kind === "live" && !isControlFocused() && ["ArrowRight", "ChannelUp", "MediaTrackNext", "PageUp"].includes(event.key)) { event.preventDefault(); playNeighbor(1); return; }
      if (event.key === "ArrowLeft" && currentItem?.kind !== "live" && !isControlFocused()) { event.preventDefault(); el("rewindBtn").click(); }
      if (event.key === "ArrowRight" && currentItem?.kind !== "live" && !isControlFocused()) { event.preventDefault(); el("forwardBtn").click(); }
      showControls();
    }
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key) && !isTextInput(document.activeElement)) moveFocus(event);
  }

  function isControlFocused() { return Boolean(document.activeElement?.closest(".player-chrome")); }
  function isTextInput(node) { return node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA"); }

  function focusLiveBrowserNeighbor(event, current) {
    if (currentView !== "live" || !current?.closest?.(".live-browser-grid")) return false;
    const direction = event.key;
    const category = current.closest("[data-live-category]");
    const channel = current.closest("[data-live-channel]");
    if (channel && direction === "ArrowLeft") {
      rememberLiveBrowserPosition();
      const target = qa("[data-live-category]", el("content")).find((node) => node.dataset.liveCategory === activeCategory) || q("[data-live-category]", el("content"));
      if (!target) return false;
      event.preventDefault();
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    }
    if (category && direction === "ArrowRight") {
      rememberLiveBrowserPosition();
      const rows = qa("[data-live-channel]", el("content"));
      const target = rows.find((node) => node.dataset.liveChannel === selectedLiveId) || rows[0];
      if (!target) return false;
      event.preventDefault();
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    }
    const group = channel ? qa("[data-live-channel]", el("content")) : category ? qa("[data-live-category]", el("content")) : [];
    if (group.length && (direction === "ArrowUp" || direction === "ArrowDown")) {
      const index = group.indexOf(channel || category);
      const target = group[index + (direction === "ArrowDown" ? 1 : -1)];
      if (!target) return false;
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    }
    return false;
  }

  function moveFocus(event) {
    const visibleRoot = !el("modalRoot").classList.contains("hidden") ? el("modalRoot") : !el("playerScreen").classList.contains("hidden") ? el("playerScreen") : document;
    const current = document.activeElement;
    if (focusLiveBrowserNeighbor(event, current)) return;
    const candidates = qa("button:not([disabled]),[tabindex='0'],.focusable", visibleRoot).filter((node, i, all) => all.indexOf(node) === i && node.offsetParent !== null);
    if (!candidates.length) return;
    if (!candidates.includes(current)) { candidates[0].focus(); event.preventDefault(); return; }
    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    const direction = event.key;
    let best = null, bestScore = Infinity;
    for (const node of candidates) {
      if (node === current) continue;
      const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - fx, dy = y - fy;
      if ((direction === "ArrowRight" && dx <= 3) || (direction === "ArrowLeft" && dx >= -3) || (direction === "ArrowDown" && dy <= 3) || (direction === "ArrowUp" && dy >= -3)) continue;
      const primary = direction === "ArrowRight" || direction === "ArrowLeft" ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === "ArrowRight" || direction === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    if (best) { event.preventDefault(); best.focus(); best.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }

  async function init() {
    bindGlobalEvents();
    el("video").style.objectFit = state.settings.aspect || "contain";
    updateServerChip();
    await sleep(750);
    el("boot").classList.add("hidden");
    el("app").classList.remove("hidden");
    if (!state.playlists.length) renderManage();
    else { renderCurrentView(); loadActiveCatalog(); }
  }

  init().catch((error) => {
    el("boot").classList.add("hidden"); el("app").classList.remove("hidden");
    renderLoadError(error.message || "Startup failed");
  });
})();
