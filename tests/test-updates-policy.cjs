/* Service-worker policy regression fixtures, no network or native processes. */
"use strict";
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, ".."), app = fs.existsSync(path.join(root, "extension/updates.js")) ? root : path.join(root, "outputs/iknow-lesehilfe");
const source = fs.readFileSync(path.join(app, "extension/updates.js"), "utf8"), KEY = "iknowReaderUpdateState";
function fixture({ enabled = true, initial = {}, version = "1.34.0", mode = "current", ok = true } = {}) {
  const stored = structuredClone(initial), calls = [], handlers = [], clock = { now: Date.now() }, stats = { reloads: 0, configReads: 0, active: 0 };
  let next = { mode, ok }, activity = false;
  const chrome = { runtime: { id: "testextension", getManifest: () => ({ version }), getURL: value => "chrome-extension://testextension/" + value,
    onMessage: { addListener: value => handlers.push(value) }, reload: () => { stats.reloads++; }, connectNative: () => {
      stats.active++; const messages = [], disconnects = []; let active = true;
      return { onMessage: { addListener: value => messages.push(value) }, onDisconnect: { addListener: value => disconnects.push(value) },
        disconnect() { if (!active) return; active = false; stats.active--; for (const callback of disconnects) callback(); },
        postMessage(message) { calls.push(message.type); if (next.mode === "throw") throw Error("Native host unavailable"); setTimeout(() => { if (!active) return; for (const callback of messages) callback({ type: "update:result", requestId: message.requestId, ok: next.ok,
          state: { status: next.mode, latestVersion: "1.35.0", message: "Fixture result" } }); }, 1); } };
    } }, storage: { local: { get: async key => ({ [key]: stored[key] }), set: async value => { Object.assign(stored, structuredClone(value)); } } },
    tabs: { query: async () => [], reload: async () => {} } };
  class Clock extends Date { static now() { return clock.now; } }
  const context = vm.createContext({ chrome, crypto: { randomUUID }, URL, console, Date: Clock, setTimeout, clearTimeout, Promise, fetch: async () => { stats.configReads++; return { ok: true, json: async () => ({ enabled }) }; }, IKnowReaderUpdateActivity: async () => activity });
  vm.runInContext(source, context);
  const own = { id: "testextension", url: "chrome-extension://testextension/popup.html" };
  const send = (action, sender = own) => new Promise(resolve => handlers[0]({ type: "ikr:update:" + action }, sender, value => resolve(structuredClone(value))));
  return { stored, calls, stats, clock, context, send, mode(value, success = true) { next = { mode: value, ok: success }; }, busy(value) { activity = value; } };
}
(async () => {
  for (const sender of [
    { id: "testextension", url: "https://iknow.jp/courses/19053" },
    { id: "anotherextension", url: "chrome-extension://testextension/popup.html" },
    { id: "testextension", url: "chrome-extension://testextension/popup.html.evil" },
    { id: "testextension", url: "chrome-extension://testextension/diagnostics.html" },
    { id: "testextension", url: "chrome-extension://testextension.evil/popup.html" },
    { id: "testextension", url: "" }
  ]) {
    const f = fixture();
    for (const action of ["check", "install", "status", "auto-check", "refresh"]) assert.equal((await f.send(action, sender)).code, "update_forbidden");
    assert.equal(f.calls.length, 0);
  }
  console.log("PASS Content scripts, foreign IDs/hosts, malformed URLs and other extension pages cannot check/install/query/refresh through updater");

  const daily = fixture(); await daily.send("status"); assert.equal(daily.calls.length, 0);
  await Promise.all([daily.send("auto-check"), daily.send("auto-check"), daily.send("auto-check")]);
  assert.deepEqual(daily.calls, ["update:check"]);
  await daily.send("auto-check"); assert.equal(daily.calls.length, 1);
  daily.clock.now += 45000 + 1; await daily.send("auto-check");
  assert.equal(daily.calls.length, 2); assert.equal(daily.stats.configReads, 1);
  const disabled = fixture({ enabled: false }); await disabled.send("auto-check"); await disabled.send("auto-check"); assert.equal(disabled.calls.length, 0);
  console.log("PASS Own-popup automatic checks share a 45-second persisted limit; concurrent/repeated popups and disabled configuration start no extra host");

  const offline = fixture({ mode: "error", ok: false });
  const quiet = await offline.send("auto-check"); assert.equal(quiet.state.status, "idle"); assert.equal(quiet.state.message, "");
  await offline.send("auto-check"); assert.equal(offline.calls.length, 1);
  assert.equal((await offline.send("check")).state.status, "error");
  assert.equal(offline.stored[KEY].discovery.lastCheckMode, "manual");
  assert.equal(offline.stored[KEY].discovery.lastCheckOutcome, "failed");
  console.log("PASS Failed automatic check remains quiet, records its attempt and does not repeat on every popup; explicit check reports errors");

  const exception = fixture({ initial: { [KEY]: { status: "available", latestVersion: "1.35.0" } }, mode: "throw" });
  await exception.send("auto-check");
  assert.equal(exception.stored[KEY].status,"available");assert.equal(exception.stored[KEY].latestVersion,"1.35.0");
  assert.equal(exception.stored[KEY].lastAttemptAt,exception.clock.now);assert.equal(exception.stored[KEY].discovery.failureCount,1);
  await exception.send("auto-check");assert.equal(exception.calls.length,1);
  const exceptionRestart = fixture({ initial: exception.stored, mode:"throw" });await exceptionRestart.send("auto-check");assert.equal(exceptionRestart.calls.length,0);
  await exception.send("check");assert.equal(exception.stored[KEY].discovery.lastCheckMode,"manual");assert.equal(exception.stored[KEY].discovery.lastCheckOutcome,"failed");
  assert.equal(exception.stats.active,0);
  const unconfigured=fixture({mode:"unconfigured"});await unconfigured.send("auto-check");
  assert.equal(unconfigured.stored[KEY].checkedAt,undefined);assert.equal(unconfigured.stored[KEY].discovery.failureCount,1);
  assert.equal(unconfigured.stored[KEY].discovery.lastCheckOutcome,"failed");
  console.log("PASS Native exceptions retain verified availability and the persisted attempt, close their port and expose diagnostic failure details; unconfigured helpers are not counted as successful checks");

  const falseAvailable = fixture({ mode: "available", ok: false });
  assert.equal((await falseAvailable.send("check")).state.status, "error"); assert.equal((await falseAvailable.send("install")).code, "update_check_required");
  const invalid = fixture({ initial: { [KEY]: { status: "unknown", latestVersion: "9.0.0" } } });
  assert.equal((await invalid.send("status")).state.status, "idle");
  const interrupted = fixture({ initial: { [KEY]: { status: "checking" } } });
  assert.equal((await interrupted.send("status")).state.status, "idle");
  console.log("PASS An unsuccessful availability response cannot enable install; unknown saved states and interrupted checks recover to idle");

  const after = fixture({ version: "1.35.0", initial: { [KEY]: { status: "complete", latestVersion: "1.35.0", reloadedVersion: "1.35.0", refreshTabs: true } } });
  const result = await after.send("status"); assert.equal(result.state.status, "current"); assert.equal(result.state.refreshTabs, true);
  await new Promise(done => setTimeout(done, 550)); assert.equal(after.stats.reloads, 0); assert.equal(after.calls.length, 0);
  console.log("PASS A newly loaded target version preserves its refresh-pages action without repeating reloads or native calls");

  const staleReload = fixture({ initial: { [KEY]: { status: "complete", latestVersion: "1.35.0", reloadedVersion: "1.35.0" } } });
  assert.equal((await staleReload.send("status")).state.status, "error");
  assert.match(staleReload.stored[KEY].message, /still running the previous version/);
  assert.equal(staleReload.stats.reloads, 0);
  const lateComplete = fixture({ initial: { [KEY]: { status: "error", latestVersion: "1.35.0", installAttempted: true } }, mode: "complete" });
  assert.equal((await lateComplete.send("status")).state.status, "complete");
  await new Promise(done => setTimeout(done, 550)); assert.equal(lateComplete.stats.reloads, 1);
  console.log("PASS Interrupted reloads report the actually loaded version; opening a failed install reconciles a helper that finished later");
})().catch(error => { console.error(error); process.exitCode = 1; });
