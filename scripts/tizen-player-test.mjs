import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../tizen/platform.js", import.meta.url), "utf8");
const calls = [];
const events = [];
const windowListeners = {};
let state = "NONE";
let listener = null;
let position = 5000;
let duration = 100000;

const avplay = {
  open(url) { calls.push(["open", url]); state = "IDLE"; },
  close() { calls.push(["close"]); state = "NONE"; },
  stop() { calls.push(["stop"]); state = "IDLE"; },
  getState() { return state; },
  setListener(value) { listener = value; calls.push(["listener"]); },
  setDisplayRect(x, y, width, height) { calls.push(["rect", x, y, width, height]); },
  setDisplayMethod(mode) { calls.push(["aspect", mode]); },
  setStreamingProperty(key, value) { calls.push(["header", key, value]); },
  prepareAsync(success) { calls.push(["prepare"]); state = "READY"; success(); },
  play() { calls.push(["play"]); state = "PLAYING"; },
  pause() { calls.push(["pause"]); state = "PAUSED"; },
  getCurrentTime() { return position; },
  getDuration() { return duration; },
  seekTo(value) { calls.push(["seek", value]); position = value; },
  disableAudioStream() { calls.push(["audio", "off"]); },
  enableAudioStream() { calls.push(["audio", "on"]); }
};

const document = {
  activeElement: null,
  body: {},
  documentElement: { classList: { add(value) { calls.push(["class", value]); } } },
  querySelector() { return null; },
  getElementById() { return null; }
};

const window = {
  webapis: {
    avplay,
    appcommon: {
      AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
      setScreenSaver(value) { calls.push(["screensaver", value]); }
    }
  },
  tizen: {
    tvinputdevice: {
      getSupportedKeys() { return ["MediaPlayPause", "ChannelUp", "ChannelDown"].map((name) => ({ name })); },
      registerKeyBatch(keys, success) { calls.push(["keys", ...keys]); success(); }
    },
    tvaudiocontrol: {
      isMute() { return false; },
      setMute(value) { calls.push(["global-mute", value]); }
    }
  },
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 1,
  setTimeout(callback) { callback(); return 1; },
  addEventListener(name, callback) { windowListeners[name] = callback; }
};

vm.runInNewContext(source, { window, document, console, JSON, Math, Number, String, Boolean, Array, Object, RegExp, Error });
window.MazenNativePlayerEvent = (type, generation, detail) => events.push([type, generation, detail]);

assert.equal(window.MazenPlatform.name, "Samsung Tizen");
assert.equal(window.MazenPlayer.isAvailable(), true);
assert.equal(window.MazenPlayer.supportsMutedPreview, true);
assert.ok(calls.some((entry) => entry[0] === "keys" && entry.includes("ChannelUp")));

window.MazenPlayer.setViewport(960, 540, 960, 540);
window.MazenPlayer.setMuted(true);
assert.equal(calls.some((entry) => entry[0] === "global-mute"), false, "preview muting must not mute the entire TV");
window.MazenPlayer.playWithHeaders("http://example.test/live/1.ts", 42, JSON.stringify({ "User-Agent": "MX-Test", Cookie: "a=1" }));

assert.ok(calls.some((entry) => entry[0] === "open"));
assert.ok(calls.some((entry) => entry.join("|") === "rect|960|540|960|540"));
assert.ok(calls.some((entry) => entry.join("|") === "header|USER_AGENT|MX-Test"));
assert.ok(calls.some((entry) => entry.join("|") === "header|COOKIE|a=1"));
assert.ok(calls.some((entry) => entry.join("|") === "audio|off"));
assert.ok(events.some((entry) => entry[0] === "prepared" && entry[1] === 42));
assert.ok(events.some((entry) => entry[0] === "playing" && entry[1] === 42));

listener.oncurrentplaytime(5000);
assert.ok(events.some((entry) => entry[0] === "progress" && entry[2] === "5000,100000"));
window.MazenPlayer.setVolume(0.5);
assert.ok(calls.some((entry) => entry.join("|") === "audio|on"));
window.MazenPlayer.pause();
window.MazenPlayer.resume();
window.MazenPlayer.seekBy(30);
assert.ok(calls.some((entry) => entry[0] === "seek" && entry[1] === 35000));
window.MazenPlayer.seekToFraction(0.5);
assert.ok(calls.some((entry) => entry[0] === "seek" && entry[1] === 50000));
window.MazenPlayer.stop();
assert.equal(state, "NONE");
assert.ok(calls.some((entry) => entry.join("|") === "screensaver|0"));
assert.ok(calls.some((entry) => entry.join("|") === "screensaver|1"));

console.log("Samsung AVPlay bridge tests passed.");
