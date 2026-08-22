(function () {
  "use strict";

  var TV_WIDTH = 1920;
  var TV_HEIGHT = 1080;
  var currentGeneration = 0;
  var currentUrl = "";
  var displayRect = { x: 0, y: 0, width: TV_WIDTH, height: TV_HEIGHT };
  var displayAspect = "contain";
  var playbackAnnounced = false;
  var screenSaverDisabled = false;
  var streamAudioDisabled = false;
  var desiredMuted = false;
  var globalMuteOwned = false;
  var originalGlobalMute = false;

  function avplay() {
    return window.webapis && window.webapis.avplay ? window.webapis.avplay : null;
  }

  function available() {
    var player = avplay();
    return Boolean(player && typeof player.open === "function" && typeof player.prepareAsync === "function");
  }

  function playerState() {
    try { return avplay().getState(); }
    catch (_) { return "NONE"; }
  }

  function describeError(error) {
    if (!error) return "Samsung AVPlay error";
    return String(error.message || error.name || error.code || error);
  }

  function emit(type, detail, generation) {
    var targetGeneration = generation === undefined ? currentGeneration : generation;
    window.setTimeout(function () {
      if (targetGeneration !== currentGeneration || typeof window.MazenNativePlayerEvent !== "function") return;
      window.MazenNativePlayerEvent(type, targetGeneration, detail === undefined ? "" : String(detail));
    }, 0);
  }

  function setScreenSaver(disabled) {
    if (screenSaverDisabled === disabled) return;
    try {
      var appcommon = window.webapis && window.webapis.appcommon;
      if (!appcommon || typeof appcommon.setScreenSaver !== "function") return;
      var states = appcommon.AppCommonScreenSaverState || {};
      var value = disabled ? states.SCREEN_SAVER_OFF : states.SCREEN_SAVER_ON;
      appcommon.setScreenSaver(value === undefined ? (disabled ? 0 : 1) : value);
      screenSaverDisabled = disabled;
    } catch (_) {}
  }

  function restoreGlobalMute() {
    if (!globalMuteOwned) return;
    try { window.tizen.tvaudiocontrol.setMute(originalGlobalMute); }
    catch (_) {}
    globalMuteOwned = false;
  }

  function releasePlayer(restoreAudio) {
    var player = avplay();
    if (!player) return;
    try {
      var state = playerState();
      if (state === "PLAYING" || state === "PAUSED" || state === "READY") player.stop();
    } catch (_) {}
    try { if (playerState() !== "NONE") player.close(); }
    catch (_) {}
    playbackAnnounced = false;
    streamAudioDisabled = false;
    currentUrl = "";
    if (restoreAudio) restoreGlobalMute();
  }

  function displayMode() {
    if (displayAspect === "contain") return "PLAYER_DISPLAY_MODE_LETTER_BOX";
    if (displayAspect === "fill") return "PLAYER_DISPLAY_MODE_FULL_SCREEN";
    return "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO";
  }

  function applyDisplay() {
    var player = avplay();
    if (!player || playerState() === "NONE") return;
    try { player.setDisplayRect(displayRect.x, displayRect.y, displayRect.width, displayRect.height); }
    catch (_) {}
    try { player.setDisplayMethod(displayMode()); }
    catch (_) {}
  }

  function scaleDisplayRect(x, y, width, height) {
    var ratio = Number(window.devicePixelRatio || 1);
    var sourceWidth = Math.max(1, Number(window.innerWidth || TV_WIDTH) * ratio);
    var sourceHeight = Math.max(1, Number(window.innerHeight || TV_HEIGHT) * ratio);
    var left = Math.max(0, Math.min(TV_WIDTH - 1, Math.round(Number(x || 0) * TV_WIDTH / sourceWidth)));
    var top = Math.max(0, Math.min(TV_HEIGHT - 1, Math.round(Number(y || 0) * TV_HEIGHT / sourceHeight)));
    var scaledWidth = Math.max(1, Math.min(TV_WIDTH - left, Math.round(Number(width || sourceWidth) * TV_WIDTH / sourceWidth)));
    var scaledHeight = Math.max(1, Math.min(TV_HEIGHT - top, Math.round(Number(height || sourceHeight) * TV_HEIGHT / sourceHeight)));
    return { x: left, y: top, width: scaledWidth, height: scaledHeight };
  }

  function applyRequestHeaders(headers) {
    var player = avplay();
    if (!player || !headers) return;
    var userAgent = headers["User-Agent"] || headers["user-agent"];
    var cookie = headers.Cookie || headers.cookie;
    if (userAgent) {
      try { player.setStreamingProperty("USER_AGENT", String(userAgent)); }
      catch (_) {
        try { player.setStreamingProperty("USERAGENT", String(userAgent)); }
        catch (_) {}
      }
    }
    if (cookie) {
      try { player.setStreamingProperty("COOKIE", String(cookie)); }
      catch (_) {}
    }
  }

  function applyDesiredAudio() {
    var player = avplay();
    if (!player || typeof player.disableAudioStream !== "function" || typeof player.enableAudioStream !== "function") return false;
    if (playerState() === "NONE") return true;
    try {
      if (desiredMuted) player.disableAudioStream(); else player.enableAudioStream();
      streamAudioDisabled = desiredMuted;
    } catch (_) {}
    return true;
  }

  function announcePlaying(generation) {
    if (generation !== currentGeneration || playbackAnnounced) return;
    playbackAnnounced = true;
    emit("playing", "", generation);
  }

  function listenerFor(generation) {
    return {
      onbufferingstart: function () { emit("bufferingStart", "", generation); },
      onbufferingprogress: function (percent) { emit("bufferingProgress", percent, generation); },
      onbufferingcomplete: function () { emit("bufferingEnd", "", generation); },
      oncurrentplaytime: function (position) {
        if (generation !== currentGeneration) return;
        announcePlaying(generation);
        var duration = 0;
        try { duration = Number(avplay().getDuration() || 0); }
        catch (_) {}
        emit("progress", String(Number(position || 0)) + "," + String(duration), generation);
      },
      onstreamcompleted: function () { emit("ended", "", generation); },
      onevent: function () {},
      onerror: function (error) { emit("error", describeError(error), generation); },
      onerrormsg: function (error, message) { emit("error", message || describeError(error), generation); },
      ondrmevent: function () {},
      onsubtitlechange: function () {},
      onresourceconflicted: function () { emit("error", "Samsung TV video resource is busy", generation); }
    };
  }

  function start(url, generation, headers) {
    var player = avplay();
    if (!available()) throw new Error("Samsung AVPlay is not available on this device");
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("Samsung AVPlay requires an absolute HTTP stream URL");

    currentGeneration = Number(generation || 0);
    currentUrl = String(url);
    playbackAnnounced = false;
    releasePlayer(false);
    currentUrl = String(url);
    setScreenSaver(true);

    try {
      player.open(currentUrl);
      player.setListener(listenerFor(currentGeneration));
      applyDisplay();
      applyRequestHeaders(headers || {});
      applyDesiredAudio();
      emit("bufferingStart");
      var preparedGeneration = currentGeneration;
      player.prepareAsync(function () {
        if (preparedGeneration !== currentGeneration) return;
        try {
          emit("prepared", "", preparedGeneration);
          player.play();
          announcePlaying(preparedGeneration);
        } catch (error) {
          emit("error", describeError(error), preparedGeneration);
        }
      }, function (error) {
        emit("error", describeError(error), preparedGeneration);
      });
    } catch (error) {
      emit("error", describeError(error));
      throw error;
    }
  }

  function parseHeaders(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      var parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) { return {}; }
  }

  function setMuted(muted) {
    var player = avplay();
    desiredMuted = Boolean(muted);
    if (player && typeof player.disableAudioStream === "function" && typeof player.enableAudioStream === "function") {
      applyDesiredAudio();
      return;
    }
    try {
      var audio = window.tizen && window.tizen.tvaudiocontrol;
      if (!audio) return;
      if (!globalMuteOwned) {
        originalGlobalMute = Boolean(audio.isMute());
        globalMuteOwned = true;
      }
      audio.setMute(Boolean(muted));
    } catch (_) {}
  }

  function enableStreamAudio() {
    desiredMuted = false;
    var player = avplay();
    if (!streamAudioDisabled || !player || typeof player.enableAudioStream !== "function") return;
    try { player.enableAudioStream(); streamAudioDisabled = false; }
    catch (_) {}
  }

  function registerRemoteKeys() {
    try {
      if (!window.tizen || !window.tizen.tvinputdevice) return;
      var manager = window.tizen.tvinputdevice;
      var wanted = [
        "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop",
        "MediaTrackNext", "MediaTrackPrevious", "ChannelUp", "ChannelDown",
        "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue"
      ];
      var supported = manager.getSupportedKeys().map(function (key) { return key.name; });
      var keys = wanted.filter(function (key) { return supported.indexOf(key) >= 0; });
      if (!keys.length) return;
      if (typeof manager.registerKeyBatch === "function") {
        manager.registerKeyBatch(keys, function () {}, function () {
          keys.forEach(function (key) { try { manager.registerKey(key); } catch (_) {} });
        });
      } else {
        keys.forEach(function (key) { try { manager.registerKey(key); } catch (_) {} });
      }
    } catch (_) {}
  }

  var bridge = {
    engineName: "Samsung AVPlay",
    supportsMutedPreview: Boolean(avplay() && typeof avplay().disableAudioStream === "function"),
    isAvailable: available,
    play: function (url, generation) { start(url, generation, {}); },
    playWithHeaders: function (url, generation, headers) { start(url, generation, parseHeaders(headers)); },
    stop: function () {
      currentGeneration = 0;
      releasePlayer(true);
      setScreenSaver(false);
    },
    pause: function () {
      try {
        if (playerState() === "PLAYING") avplay().pause();
        emit("paused");
      } catch (_) {}
    },
    resume: function () {
      try {
        if (playerState() === "PAUSED") avplay().play();
        announcePlaying(currentGeneration);
      } catch (_) {}
    },
    seekBy: function (seconds) {
      try {
        var target = Math.max(0, Number(avplay().getCurrentTime() || 0) + Number(seconds || 0) * 1000);
        avplay().seekTo(target);
      } catch (_) {}
    },
    seekToFraction: function (fraction) {
      try {
        var duration = Number(avplay().getDuration() || 0);
        if (duration > 0) avplay().seekTo(Math.max(0, Math.min(duration, duration * Number(fraction || 0))));
      } catch (_) {}
    },
    setViewport: function (x, y, width, height) {
      displayRect = scaleDisplayRect(x, y, width, height);
      applyDisplay();
    },
    resetViewport: function () {
      displayRect = { x: 0, y: 0, width: TV_WIDTH, height: TV_HEIGHT };
      applyDisplay();
    },
    setAspect: function (aspect) {
      displayAspect = ["contain", "cover", "fill"].indexOf(aspect) >= 0 ? aspect : "contain";
      applyDisplay();
    },
    setMuted: setMuted,
    setVolume: function () { enableStreamAudio(); },
    setBrightness: function () {}
  };

  window.MazenPlatform = {
    name: "Samsung Tizen",
    deviceLabel: "TV",
    playerName: "Samsung AVPlay",
    isTelevision: true
  };
  window.MazenPlayer = bridge;
  document.documentElement.classList.add("tizen-tv");
  registerRemoteKeys();

  window.addEventListener("load", function () {
    var version = document.querySelector(".side-version");
    var liveLabel = document.querySelector(".player-live-strip span");
    var liveMeta = document.querySelector(".player-live-strip small");
    if (version) version.textContent = "v1.1.6 • Samsung Tizen AVPlay";
    if (liveLabel) liveLabel.textContent = "MX SAMSUNG AVPLAY";
    if (liveMeta) liveMeta.textContent = "Hardware-accelerated Samsung TV stream engine";
    window.setTimeout(function () {
      var first = document.getElementById("brandBtn") || document.querySelector(".focusable");
      if (first && (!document.activeElement || document.activeElement === document.body)) first.focus();
    }, 950);
  });

  window.addEventListener("beforeunload", function () {
    currentGeneration = 0;
    releasePlayer(true);
    setScreenSaver(false);
  });
})();
