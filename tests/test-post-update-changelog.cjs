/* Production updater + refresh controller; bounded local fixtures, no install. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.join(__dirname, "../extension"), KEY = "iknowReaderUpdateState", VERSION = "1.41.1";
async function fixture({ initial, version = VERSION, notes, denied = false, active = false } = {}) {
  const stored = structuredClone(initial || {}), opened = [], reloads = [], requests = [];
  const handlers = [], timers = [];
  let refuses = denied;
  const chrome = {
    runtime: { id: "notesfixture", getManifest: () => ({ version }), getURL: file => "chrome-extension://notesfixture/" + file,
      onMessage: { addListener: callback => handlers.push(callback) }, reload: () => { throw Error("Unexpected extension reload"); },
      connectNative: () => { throw Error("Unexpected native request"); } },
    storage: { local: { get: async key => ({ [key]: structuredClone(stored[key]) }), set: async patch => Object.assign(stored, structuredClone(patch)) } },
    tabs: { query: async () => [{ id: 7, url: "https://iknow.jp/courses/19053" }], get: async id => ({ id, url: "https://iknow.jp/courses/19053" }),
      reload: async id => reloads.push(id), create: async options => { if (refuses) throw Error("Browser refused"); opened.push(structuredClone(options)); return { id: 9 }; } }
  };
  const context = vm.createContext({ chrome, URL, Promise, console, Date, setTimeout: (fn, ms) => timers.push([fn, ms]), clearTimeout: () => {},
    IKnowReaderUpdateActivity: async () => active,
    fetch: async url => {
      requests.push(String(url));
      assert.equal(String(url), "chrome-extension://notesfixture/changelog.json");
      return { ok: true, json: async () => notes || { schemaVersion: 1, entries: [
        { id: "future", status: "unreleased", version: "1.50.0" },
        { id: "this-release", status: "released", version: VERSION },
        { id: "older-release", status: "released", version: "1.41.0" }
      ] } };
    } });
  for (const file of ["update-refresh.js", "updates.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  const status = () => new Promise(resolve => handlers[0]({ type: "ikr:update:status" }, { id: "notesfixture", url: "chrome-extension://notesfixture/popup.html" }, value => resolve(structuredClone(value))));
  await status();
  return { stored, opened, reloads, requests, status, refuses: value => { refuses = value; } };
}
(async () => {
  const installed = { status: "complete", latestVersion: VERSION, reloadedVersion: VERSION, refreshTabs: true };
  const first = await fixture({ initial: { [KEY]: installed } });
  assert.equal(first.stored[KEY].status, "current"); assert.deepEqual(first.reloads, [7]);
  assert.deepEqual(first.opened, [{ url: "chrome-extension://notesfixture/changelog.html#this-release", active: true }]);
  assert.equal(first.stored[KEY].changelogTarget, VERSION); assert.equal(first.stored[KEY].changelogOpenedVersion, VERSION);
  await first.status(); const restart = await fixture({ initial: first.stored });
  assert.deepEqual(restart.opened, []); assert.deepEqual(restart.reloads, []); assert.deepEqual(restart.requests, []);
  console.log("PASS A successful popup install made by an older updater is adopted by the new version; exact bundled release opens once and persists across restarts");

  const dev = await fixture({ initial: { [KEY]: { status: "current", latestVersion: VERSION, autoRefreshTarget: VERSION, autoRefreshCompleteVersion: VERSION, refreshTabs: false } } });
  assert.deepEqual(dev.opened, []); assert.deepEqual(dev.requests, []);
  const failed = await fixture({ initial: { [KEY]: { status: "error", latestVersion: VERSION } } }); assert.deepEqual(failed.opened, []);
  const deferred = await fixture({ initial: { [KEY]: installed }, active: true }); assert.deepEqual(deferred.opened, []); assert.equal(deferred.stored[KEY].refreshTabs, true);
  console.log("PASS A same-version developer reload, an unsuccessful install and active preparation never open release notes or bypass page-refresh protection");

  const refusal = await fixture({ initial: { [KEY]: installed }, denied: true });
  assert.equal(refusal.stored[KEY].status, "current"); assert.equal(refusal.stored[KEY].refreshTabs, false);
  const retry = await fixture({ initial: refusal.stored }); assert.equal(retry.opened.length, 1); assert.deepEqual(retry.reloads, []);
  for (const entries of [[], [{ id: "draft", status: "unreleased", version: VERSION }], [{ id: "wrong", status: "released", version: "1.41.0" }], [{ id: "../popup", status: "released", version: VERSION }]]) {
    const invalid = await fixture({ initial: { [KEY]: installed }, notes: { schemaVersion: 1, entries } }); assert.deepEqual(invalid.opened, []);
    assert.equal(invalid.stored[KEY].status, "current");
  }
  console.log("PASS A refused tab can recover on restart; missing, unreleased, mismatched or unsafe entries never navigate elsewhere or turn installation into failure");
})().catch(error => { console.error(error); process.exitCode = 1; });
