/* Proactive toolbar discovery with no popup, native process, network or install. */
"use strict";
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../extension/update-discovery.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = () => {
  const listeners = [];
  return { listeners, addListener(listener) { listeners.push(listener); }, emit(...args) { for (const listener of listeners) listener(...args); } };
};
function fixture({ version = "1.35.3", style = "promise", state = { status: "idle" }, ready = Promise.resolve(), busy = false, check } = {}) {
  const calls = [], values = {}, signals = { startup: event(), installed: event(), activated: event(), updated: event() };
  let current = state, active = busy, checks = 0;
  const chrome = { runtime: { getManifest: () => ({ version, action: { default_title: "Reading Helper settings" } }), onStartup: signals.startup, onInstalled: signals.installed },
    action: {}, tabs: { onActivated: signals.activated, onUpdated: signals.updated } };
  for (const method of ["setBadgeText", "setBadgeTextColor", "setBadgeBackgroundColor", "setTitle"]) chrome.action[method] = (details, callback) => {
    calls.push({ method, ...details }); Object.assign(values, details);
    if (style === "throw") throw Error("Extension unloading");
    if (style === "reject") return Promise.reject(Error("Action unavailable"));
    if (style === "callback") { chrome.runtime.lastError = { message: "Ignored callback failure" }; callback(); delete chrome.runtime.lastError; return; }
    return Promise.resolve();
  };
  const context = vm.createContext({ chrome, URL, Promise }); vm.runInContext(source, context);
  const api = context.IKnowReaderUpdateDiscovery;
  const options = { ready, getState: () => current, isBusy: () => active, autoCheck: async () => { checks++; if (check) await check(value => { current = value; }); } };
  return { api, signals, calls, values, options, start: () => api.start(options), count: () => checks, state(value) { current = value; }, busy(value) { active = value; } };
}
(async () => {
  const available = { status: "available", latestVersion: "1.35.4" };
  const f = fixture({ check: async setState => setState(available) });
  await f.start();
  assert.equal(f.count(), 1); assert.equal(f.values.text, "NEW"); assert.match(f.values.title, /1\.35\.4 available/);
  assert.ok(f.calls.some(call => call.method === "setBadgeBackgroundColor" && call.color === "#7460AD"));
  assert.ok(f.calls.some(call => call.method === "setBadgeTextColor" && call.color === "#FFFFFF"));
  const listenerCount = f.signals.startup.listeners.length;
  await f.start(); assert.equal(f.signals.startup.listeners.length, listenerCount); assert.equal(f.count(), 1);
  console.log("PASS Worker discovery checks and displays a verified newer release without opening the popup; repeated start is idempotent");

  let releaseReady; const waitReady = new Promise(resolve => { releaseReady = resolve; });
  const restored = fixture({ state: available, ready: waitReady, busy: true });
  const waiting = restored.start(); restored.signals.startup.emit(); restored.signals.installed.emit({ reason: "update" });
  await tick(); assert.equal(restored.count(), 0); assert.equal(restored.values.text, undefined);
  releaseReady(); await waiting; assert.equal(restored.count(), 0); assert.equal(restored.values.text, "NEW");
  restored.busy(false); restored.signals.startup.emit(); await tick(); assert.equal(restored.count(), 1);
  restored.signals.installed.emit({ reason: "install" }); await tick(); assert.equal(restored.count(), 2);
  console.log("PASS Listeners register before storage is ready; the restored badge remains visible while preparation is busy, then startup/install can check");

  let releaseCheck; const checkPending = new Promise(resolve => { releaseCheck = resolve; });
  const concurrent = fixture({ check: async () => checkPending });
  const first = concurrent.start(); await tick();
  concurrent.signals.startup.emit(); concurrent.signals.installed.emit(); concurrent.signals.activated.emit({ tabId: 5 });
  concurrent.signals.updated.emit(5, { status: "complete" }, { url: "https://iknow.jp/courses/19053" });
  await tick(); assert.equal(concurrent.count(), 1); releaseCheck(); await first;
  concurrent.signals.activated.emit({ tabId: 6 }); await tick(); assert.equal(concurrent.count(), 2);
  console.log("PASS Concurrent startup, install and tab activity share one discovery attempt; later activity delegates to the persisted root throttle");

  const tabs = fixture(); await tabs.start();
  for (const [change, tab] of [
    [{ status: "loading" }, { url: "https://iknow.jp/courses/19053" }],
    [{ status: "complete" }, { url: "https://example.com/" }],
    [{ status: "complete" }, { url: "https://iknow.jp.evil.test/" }],
    [{ status: "complete" }, { url: "http://iknow.jp/" }],
    [{ title: "course" }, { url: "https://iknow.jp/" }]
  ]) { tabs.signals.updated.emit(1, change, tab); await tick(); }
  assert.equal(tabs.count(), 1);
  for (const url of ["https://iknow.jp/courses/19053", "https://en.iknow.jp/", "https://ja.iknow.jp/"]) {
    tabs.signals.updated.emit(1, { status: "complete" }, { url }); await tick();
  }
  assert.equal(tabs.count(), 4);
  tabs.signals.updated.emit(1, { status: "complete", url: "https://iknow.jp/" }, {}); await tick(); assert.equal(tabs.count(), 5);
  tabs.signals.activated.emit({ tabId: 99 }); await tick(); assert.equal(tabs.count(), 6);
  tabs.signals.updated.emit(1, { audible: false }, {}); await tick(); assert.equal(tabs.count(), 7);
  console.log("PASS Only completed trusted iKnow loads trigger navigation checks; tab activation needs no browsing history, tabs permission or URL lookup");

  const ordering = [], activity = fixture({ check: async () => { ordering.push("check"); } });
  activity.options.onActivity = async () => { ordering.push("activity"); };
  await activity.start(); assert.deepEqual(ordering, ["activity", "check"]);
  activity.signals.updated.emit(1, { audible: false }, {}); await tick(); assert.deepEqual(ordering, ["activity", "check", "activity", "check"]);
  activity.busy(true); activity.signals.activated.emit({ tabId: 2 }); await tick(); assert.equal(ordering.at(-1), "activity");
  const activityFailure = fixture(); activityFailure.options.onActivity = async () => { throw Error("Refresh deferred"); };
  await activityFailure.start(); assert.equal(activityFailure.count(), 1);
  console.log("PASS Worker/browser activity and stopped audio offer deferred page refresh before checking; callback errors preserve discovery");

  for (const status of ["checking", "downloading", "installing"]) {
    const working = fixture({ state: { status } }); await working.start(); assert.equal(working.count(), 0);
    working.signals.activated.emit({ tabId: 4 }); await tick(); assert.equal(working.count(), 0);
  }
  const asyncBusy = fixture(); asyncBusy.options.isBusy = async () => true; await asyncBusy.start(); assert.equal(asyncBusy.count(), 0);
  const failed = fixture({ check: async () => { throw Error("Offline helper"); } }); await failed.start();
  failed.signals.startup.emit(); await tick(); assert.equal(failed.count(), 2); assert.equal(failed.values.text, "");
  console.log("PASS Discovery skips active update/preparation work and consumes automatic failures without an error badge");

  const badge = fixture();
  for (const latestVersion of ["1.35.4", "1.36.0", "1.100.0", "2.0"]) {
    badge.api.render({ status: "available", latestVersion }); assert.equal(badge.values.text, "NEW");
  }
  for (const latestVersion of ["1.35.3", "1.35.3.0", "1.35.2", "1.9.9", "1.35.x", "99999.1", null, "<script>"]) {
    badge.api.render({ status: "available", latestVersion }); assert.equal(badge.values.text, ""); assert.equal(badge.values.title, "Reading Helper settings");
  }
  for (const status of ["idle", "current", "checking", "downloading", "installing", "complete", "error", "unconfigured", "busy"]) {
    badge.api.render(available); badge.api.render({ status, latestVersion: "1.35.4" }); assert.equal(badge.values.text, "");
  }
  const upgraded = fixture({ version: "1.35.4", state: available, busy: true }); await upgraded.start(); assert.equal(upgraded.values.text, "");
  console.log("PASS NEW requires a newer numeric version and available status; errors, stale notices and the installed target restore the default action");

  for (const style of ["callback", "promise", "throw", "reject"]) {
    const action = fixture({ style, state: available }); await action.start(); action.api.render({ status: "current" }); await tick();
    assert.equal(action.values.text, "");
  }
  console.log("PASS Toolbar rendering supports callback/promise action APIs and tolerates unavailable action methods without rejecting worker startup");
})().catch(error => { console.error(error); process.exitCode = 1; });
