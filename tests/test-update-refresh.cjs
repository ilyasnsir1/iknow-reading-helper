/* Persisted post-update tab refresh policy; isolated VM, no browser or install. */
"use strict";
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../extension/update-refresh.js"), "utf8");
const VERSION = "1.35.4";
function fixture(options = {}) {
  let state = structuredClone({ status: "current", autoRefreshTarget: VERSION, refreshTabs: true, ...options.state });
  let stored = structuredClone(state), version = options.version || VERSION, active = false;
  const tabs = new Map((options.tabs || [
    { id: 1, url: "https://iknow.jp/courses/19053" }, { id: 2, url: "https://en.iknow.jp/series/1" }, { id: 3, url: "https://ja.iknow.jp/dashboard" }
  ]).map(tab => [tab.id, { ...tab }]));
  const reloads = [], writes = [], failures = new Set(), lookupFailures = new Set();
  let queryError = false, onReload = null, onGet = null, onSave = null, onActivity = null, saveError = null;
  const chrome = { tabs: {
    query: async filter => { assert.deepEqual(Array.from(filter.url), ["https://iknow.jp/*", "https://en.iknow.jp/*", "https://ja.iknow.jp/*"]); if (queryError) throw Error("query failed"); return [...tabs.values()]; },
    get: async id => { if (onGet) await onGet(id); if (!tabs.has(id) || lookupFailures.has(id)) throw Error("no tab"); return tabs.get(id); },
    reload: async id => { reloads.push(id); if (onReload) await onReload(id); if (failures.has(id)) throw Error("reload failed"); }
  } };
  const context = vm.createContext({ URL, Promise }); vm.runInContext(source, context);
  const make = () => context.IKnowReaderUpdateRefresh.create({ chrome, getVersion: () => version, getState: () => state,
    getActivity: async () => { if (onActivity) await onActivity(); return active; }, save: async patch => {
      if (saveError?.(patch)) throw Error("storage failed");
      state = { ...state, ...structuredClone(patch) }; stored = structuredClone(state); writes.push(structuredClone(patch));
      if (onSave) await onSave(patch);
      return state;
    } });
  let runner = make();
  return { run: value => runner.run(value), reloads, writes, tabs, failures, lookupFailures,
    state: () => structuredClone(state), stored: () => structuredClone(stored), patch: value => { state = { ...state, ...value }; },
    active: value => { active = value; }, version: value => { version = value; }, queryError: value => { queryError = value; },
    onReload: value => { onReload = value; }, onGet: value => { onGet = value; }, onSave: value => { onSave = value; }, saveError: value => { saveError = value; },
    onActivity: value => { onActivity = value; },
    restart() { state = structuredClone(stored); runner = make(); }
  };
}
(async () => {
  const all = fixture();
  const concurrent = await Promise.all([all.run(), all.run(), all.run({ manual: true })]);
  assert.ok(concurrent.every(value => value.ok)); assert.deepEqual(all.reloads, [1, 2, 3]);
  assert.equal(all.state().refreshTabs, false); assert.equal(all.state().autoRefreshCompleteVersion, VERSION);
  all.restart(); await all.run(); assert.deepEqual(all.reloads, [1, 2, 3]);
  console.log("PASS Concurrent startup/popup calls and worker restarts reload each matching tab once for the loaded target");

  for (const state of [
    { autoRefreshTarget: null }, { autoRefreshTarget: "9.0.0" }, { status: "error" },
    { status: "available", latestVersion: "1.36.0", autoRefreshTarget: null },
    { status: "available", latestVersion: "1.36.0", autoRefreshTarget: "1.36.0" },
    { autoRefreshCompleteVersion: VERSION }, { status: "installing" }
  ]) {
    const f = fixture({ state }); await f.run(); assert.deepEqual(f.reloads, []); assert.equal(f.writes.length, 0);
  }
  const older = fixture({ version: "1.35.3" }); await older.run(); assert.deepEqual(older.reloads, []);
  console.log("PASS Old loaded versions, unverified targets, failed/incomplete installs and already completed versions never automatically refresh");

  const nextMessage = "A new version is ready to install.";
  const pending = fixture({ state: { status: "available", latestVersion: "1.36.0", message: nextMessage } });
  pending.active(true); assert.equal((await pending.run()).code, "preparation_active");
  assert.equal(pending.state().message, nextMessage); assert.deepEqual(pending.reloads, []);
  pending.active(false); pending.tabs.get(2).audible = true;
  assert.equal((await pending.run()).code, "iknow_audio_active"); assert.equal(pending.state().message, nextMessage);
  pending.tabs.get(2).audible = false; await pending.run();
  assert.deepEqual(pending.reloads, [1, 2, 3]); assert.equal(pending.state().autoRefreshCompleteVersion, VERSION);
  assert.equal(pending.state().refreshTabs, false); assert.equal(pending.state().status, "available");
  assert.equal(pending.state().latestVersion, "1.36.0"); assert.equal(pending.state().message, nextMessage);
  pending.restart(); await pending.run(); assert.deepEqual(pending.reloads, [1, 2, 3]);
  assert.equal(pending.state().message, nextMessage);
  const discoveredDuring = fixture();
  discoveredDuring.onReload(id => { if (id === 1) discoveredDuring.patch({ status: "available", latestVersion: "1.36.0", message: nextMessage }); });
  await discoveredDuring.run(); assert.deepEqual(discoveredDuring.reloads, [1, 2, 3]);
  assert.equal(discoveredDuring.state().autoRefreshCompleteVersion, VERSION); assert.equal(discoveredDuring.state().message, nextMessage);
  const nextPartial = fixture({ state: { status: "available", latestVersion: "1.36.0", message: nextMessage } });
  nextPartial.failures.add(2); assert.equal((await nextPartial.run()).code, "refresh_incomplete");
  assert.equal(nextPartial.state().message, nextMessage); assert.equal(nextPartial.state().status, "available");
  nextPartial.failures.clear(); await nextPartial.run(); assert.deepEqual(nextPartial.reloads, [1, 2, 3, 2]);
  assert.equal(nextPartial.state().message, nextMessage);
  console.log("PASS A newer available update preserves its notice while the prior verified install finishes a deferred refresh once; missing/wrong targets remain ineligible");

  const filtered = fixture({ tabs: [
    { id: 1, url: "https://iknow.jp/courses/1" }, { id: 2, url: "http://iknow.jp/courses/1" },
    { id: 3, url: "https://assets.iknow.jp/audio.mp3" }, { id: 4, url: "https://iknow.jp.evil.test/" },
    { id: 5, url: "https://example.com/" }, { id: 6, url: "https://iknow.jp:8443/" },
    { id: 7, url: "https://en.iknow.jp/", pendingUrl: "https://example.com/" },
    { id: 8, url: "https://ja.iknow.jp/" }, { url: "https://iknow.jp/" }
  ] });
  await filtered.run(); assert.deepEqual(filtered.reloads, [1, 8]);
  console.log("PASS Only HTTPS pages on the three exact iKnow hosts refresh, including defensive navigation/URL filtering");

  const paused = fixture(); paused.active(true);
  assert.equal((await paused.run()).deferred, true); assert.deepEqual(paused.reloads, []);
  paused.active(false); paused.onReload(id => { if (id === 1) paused.active(true); });
  assert.equal((await paused.run()).deferred, true); assert.deepEqual(paused.reloads, [1]);
  paused.restart(); paused.active(false); paused.onReload(null); await paused.run();
  assert.deepEqual(paused.reloads, [1, 2, 3]); assert.equal(paused.state().refreshTabs, false);
  console.log("PASS Preparation resumed before or during refresh defers remaining tabs; saved work resumes without repeating completed reloads");

  const startsDuringLookup = fixture(); startsDuringLookup.onGet(id => { if (id === 1) startsDuringLookup.active(true); });
  assert.equal((await startsDuringLookup.run()).code, "preparation_active"); assert.deepEqual(startsDuringLookup.reloads, []);
  assert.deepEqual(startsDuringLookup.state().autoRefreshPlan.claimed, []);
  startsDuringLookup.active(false); startsDuringLookup.onGet(null); await startsDuringLookup.run();
  assert.deepEqual(startsDuringLookup.reloads, [1, 2, 3]);
  console.log("PASS Preparation resumed during an awaited tab operation restores the claim before any reload");

  const audio = fixture(); audio.tabs.get(2).audible = true;
  assert.equal((await audio.run()).code, "iknow_audio_active"); assert.deepEqual(audio.reloads, []);
  audio.tabs.get(2).audible = false; audio.onReload(id => { if (id === 1) audio.tabs.get(2).audible = true; });
  assert.equal((await audio.run()).code, "iknow_audio_active"); assert.deepEqual(audio.reloads, [1]);
  await audio.run({ manual: true }); assert.deepEqual(audio.reloads, [1, 2, 3]);
  const manualActive = fixture(); manualActive.active(true);
  assert.equal((await manualActive.run({ manual: true })).code, "preparation_active"); assert.deepEqual(manualActive.reloads, []);
  console.log("PASS Audible iKnow playback defers automatic refresh before or during a batch; explicit refresh overrides audio while preparation remains protected");

  const afterClaimAudio = fixture();
  afterClaimAudio.onSave(patch => { if (patch.autoRefreshPlan?.claimed.includes(1)) afterClaimAudio.tabs.get(2).audible = true; });
  assert.equal((await afterClaimAudio.run()).code, "iknow_audio_active"); assert.deepEqual(afterClaimAudio.reloads, []);
  assert.deepEqual(afterClaimAudio.state().autoRefreshPlan.claimed, []);
  afterClaimAudio.onSave(null); afterClaimAudio.tabs.get(2).audible = false; await afterClaimAudio.run();
  assert.deepEqual(afterClaimAudio.reloads, [1, 2, 3]);
  const duringFinalActivity = fixture();
  duringFinalActivity.onActivity(() => {
    if (duringFinalActivity.state().autoRefreshPlan?.claimed.includes(1)) duringFinalActivity.tabs.get(2).audible = true;
  });
  assert.equal((await duringFinalActivity.run()).code, "iknow_audio_active"); assert.deepEqual(duringFinalActivity.reloads, []);
  assert.deepEqual(duringFinalActivity.state().autoRefreshPlan.claimed, []);
  const afterClaimNavigation = fixture();
  afterClaimNavigation.onSave(patch => {
    if (patch.autoRefreshPlan?.claimed.includes(1)) afterClaimNavigation.tabs.set(1, { id: 1, url: "https://example.com/" });
    if (patch.autoRefreshPlan?.claimed.includes(2)) afterClaimNavigation.tabs.delete(2);
  });
  await afterClaimNavigation.run(); assert.deepEqual(afterClaimNavigation.reloads, [3]);
  assert.equal(afterClaimNavigation.state().refreshTabs, false);
  console.log("PASS Audio, navigation and closed tabs are rechecked after claim persistence before the actual reload");

  const finalQueryFails = fixture();
  finalQueryFails.onSave(patch => { if (patch.autoRefreshPlan?.claimed.includes(1)) finalQueryFails.queryError(true); });
  assert.equal((await finalQueryFails.run()).code, "refresh_failed"); assert.deepEqual(finalQueryFails.reloads, []);
  assert.deepEqual(finalQueryFails.state().autoRefreshPlan.claimed, []);
  assert.deepEqual(finalQueryFails.state().autoRefreshPlan.remaining, [1, 2, 3]);
  finalQueryFails.queryError(false); finalQueryFails.onSave(null); await finalQueryFails.run();
  assert.deepEqual(finalQueryFails.reloads, [1, 2, 3]);
  console.log("PASS Failure of the final tab-state read releases the unused claim for a safe automatic retry");

  const partial = fixture(); partial.failures.add(2); await partial.run();
  assert.deepEqual(partial.reloads, [1, 2, 3]); assert.deepEqual(partial.state().autoRefreshPlan.remaining, [2]);
  assert.equal(partial.state().status, "current"); assert.equal(partial.state().refreshTabs, true);
  partial.restart(); partial.failures.clear(); await partial.run({ manual: true });
  assert.deepEqual(partial.reloads, [1, 2, 3, 2]); assert.equal(partial.state().refreshTabs, false);
  console.log("PASS Partial reload failure retains only failed IDs for explicit retry and preserves successful update status");

  const closed = fixture(); closed.failures.add(2); await closed.run(); closed.tabs.delete(2); closed.restart();
  await closed.run(); assert.deepEqual(closed.reloads, [1, 2, 3]); assert.equal(closed.state().refreshTabs, false);
  const navigated = fixture(); navigated.onGet(id => { if (id === 2) navigated.tabs.set(2, { id: 2, url: "https://example.com/" }); if (id === 3) navigated.tabs.delete(3); });
  await navigated.run(); assert.deepEqual(navigated.reloads, [1]); assert.equal(navigated.state().refreshTabs, false);
  console.log("PASS Closed tabs and tabs navigated to unrelated pages are dropped before a reload or retry");

  const ambiguous = fixture({ state: { autoRefreshPlan: { version: VERSION, remaining: [2, 3], claimed: [1] } } });
  await ambiguous.run(); assert.deepEqual(ambiguous.reloads, [2, 3]); assert.equal(ambiguous.state().refreshTabs, true);
  ambiguous.restart(); await ambiguous.run(); assert.deepEqual(ambiguous.reloads, [2, 3]);
  await ambiguous.run({ manual: true }); assert.deepEqual(ambiguous.reloads, [2, 3, 1]); assert.equal(ambiguous.state().refreshTabs, false);
  console.log("PASS A reload interrupted around worker shutdown is never automatically duplicated and keeps its manual recovery action");

  const crash = fixture(); let interrupted = false;
  crash.onReload(id => { if (id === 1) interrupted = true; });
  crash.saveError(patch => interrupted && patch.autoRefreshPlan);
  assert.equal((await crash.run()).ok, false); assert.deepEqual(crash.stored().autoRefreshPlan.claimed, [1]);
  crash.restart(); crash.saveError(null); await crash.run(); assert.deepEqual(crash.reloads, [1, 2, 3]);
  assert.equal(crash.state().refreshTabs, true);
  console.log("PASS Persist-before-reload survives a storage/worker interruption without automatically reloading the acknowledged tab twice");

  const query = fixture(); query.queryError(true); assert.equal((await query.run()).code, "refresh_failed");
  assert.equal(query.state().status, "current"); assert.equal(query.state().refreshTabs, true); assert.deepEqual(query.reloads, []);
  query.queryError(false); await query.run(); assert.equal(query.state().refreshTabs, false);
  const lookup = fixture(); lookup.lookupFailures.add(2); await lookup.run();
  assert.deepEqual(lookup.reloads, [1, 3]); assert.deepEqual(lookup.state().autoRefreshPlan.remaining, [2]);
  lookup.lookupFailures.clear(); await lookup.run(); assert.deepEqual(lookup.reloads, [1, 3, 2]);
  console.log("PASS Query and temporary tab lookup failures expose retry without changing a successful install into an update error");

  const wrongDuring = fixture(); wrongDuring.onReload(id => { if (id === 1) wrongDuring.version("1.35.3"); });
  assert.equal((await wrongDuring.run()).code, "refresh_target_changed"); assert.deepEqual(wrongDuring.reloads, [1]);
  const empty = fixture({ tabs: [] }); await empty.run(); assert.equal(empty.state().autoRefreshCompleteVersion, VERSION);
  empty.tabs.set(7, { id: 7, url: "https://iknow.jp/" }); empty.restart(); await empty.run(); assert.deepEqual(empty.reloads, []);
  const legacy = fixture({ state: { autoRefreshTarget: null } }); await legacy.run({ manual: true }); assert.deepEqual(legacy.reloads, [1, 2, 3]);
  console.log("PASS Loaded target is rechecked during the batch; no-open-tabs completes once; legacy explicit Refresh remains available");
})().catch(error => { console.error(error); process.exitCode = 1; });
