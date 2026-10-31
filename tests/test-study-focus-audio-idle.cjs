"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise lifecycle events without accessing a microphone, audio device or profile.
const events = new Map(), players = [], recordings = [], revoked = [];
let resolvePermission, stoppedTracks = 0;
const document = { hidden: false, addEventListener: (name, callback) => events.set(name, callback) };
class FakeAudio {
  constructor() { this.paused = true; this.source = null; this.pauses = 0; this.loads = 0; players.push(this); }
  getAttribute() { return this.source; }
  set src(value) { this.source = value; }
  removeAttribute() { this.source = null; }
  pause() { this.paused = true; this.pauses++; }
  load() { this.loads++; }
  play() { this.paused = false; return Promise.resolve(); }
}
class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor() { this.state = "inactive"; this.listeners = {}; recordings.push(this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  start() { this.state = "recording"; }
  stop() {
    assert.equal(this.state, "recording"); this.state = "inactive";
    queueMicrotask(() => { this.listeners.dataavailable({ data: new Blob(["take"]) }); this.listeners.stop(); });
  }
}
const controls = Object.fromEntries(["record", "stop", "take", "original", "discard"].map(name => [name, {
  dataset: { compareAction: name }, disabled: false,
  closest() { return this; },
}]));
let click;
const host = {
  dataset: {}, classList: { add() {} }, setAttribute() {},
  querySelector(selector) { return selector === ".focus-compare-status" ? this.status : controls[/action="([^"]+)/.exec(selector)[1]]; },
  status: {}, contains: value => Object.values(controls).includes(value),
  addEventListener(name, callback) { if (name === "click") click = callback; },
  removeEventListener() {},
};
const context = vm.createContext({
  document, window: { addEventListener() {} }, Audio: FakeAudio, MediaRecorder: FakeRecorder,
  navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) } },
  Blob, URL: { createObjectURL: () => "blob:retained-take", revokeObjectURL: value => revoked.push(value) },
  setTimeout, clearTimeout,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../tools/preview/study-focus-audio.js"), "utf8"), context);
const api = context.IKnowFocusAudio;
const hide = () => { document.hidden = true; events.get("visibilitychange")(); };
const show = () => { document.hidden = false; };
const press = name => click({ target: controls[name] });
const tick = () => new Promise(resolve => setImmediate(resolve));
const stream = () => ({ getTracks: () => [{ stop() { stoppedTracks++; } }] });

(async () => {
  for (let index = 0; index < 30; index++) hide();
  api.mount(host, { key: "test", audioUrl: "https://example.invalid/original.mp3" });
  for (let index = 0; index < 30; index++) hide();
  assert.deepEqual(players.map(value => [value.pauses, value.loads]), [[0, 0], [0, 0]], "idle visibility must not reset dormant players");

  show(); press("original"); await tick(); hide();
  assert.deepEqual(players.map(value => [value.pauses, value.loads]), [[1, 1], [0, 0]], "only the active original is stopped");
  hide(); assert.equal(players[0].loads, 1, "repeated hidden events stay idle");

  show(); press("record"); assert.equal(host.dataset.state, "requesting");
  hide(); resolvePermission(stream()); await tick();
  assert.equal(recordings.length, 0, "a cancelled permission request must not start recording");
  assert.equal(stoppedTracks, 1, "late microphone access is released");

  show(); press("record"); resolvePermission(stream()); await tick();
  assert.equal(host.dataset.state, "recording"); hide(); await tick();
  assert.equal(recordings[0].state, "inactive");
  assert.equal(host.dataset.state, "idle"); assert.equal(controls.take.disabled, false, "hidden capture retains its completed take");
  assert.ok(stoppedTracks >= 2, "active microphone tracks are released");
  assert.equal(revoked.length, 0, "tab switching does not discard the take");

  show(); press("take"); await tick(); hide();
  assert.deepEqual(players.map(value => [value.pauses, value.loads]), [[1, 1], [1, 1]], "take playback still stops normally");
  hide(); assert.equal(players[1].loads, 1);
  api.reset(); assert.deepEqual(revoked, ["blob:retained-take"]);
  console.log("PASS: idle media visibility; original/take cancellation; late microphone release; recorded take retention.");
})().catch(error => { console.error(error); process.exitCode = 1; });
