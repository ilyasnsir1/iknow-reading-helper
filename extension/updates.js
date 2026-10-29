/* Explicit application updates through the installed local helper. */
(() => {
  "use strict";
  const KEY = "iknowReaderUpdateState", HOST = "de.iknow.lesehilfe";
  const version = chrome.runtime.getManifest().version;
  const CHECK_INTERVAL = 45 * 1000, ERROR_RETRY_INTERVAL = 60 * 1000, MAX_RETRY_INTERVAL = 60 * 60 * 1000;
  const statuses = new Set(["idle", "current", "available", "checking", "downloading", "installing", "complete", "error", "unconfigured", "busy"]);
  const working = value => ["downloading", "installing"].includes(value?.status);
  const validVersion = value => typeof value === "string" && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value) ? value : null;
  let state = { status: "idle", currentVersion: version, message: "" };
  let claimed = false, installClaimed = false, polling = null, reloadScheduled = false, configPromise = null;
  function discovery(value) {
    return { intervalMs: CHECK_INTERVAL,
      failureCount: Number.isInteger(value?.failureCount) ? Math.min(7, Math.max(0, value.failureCount)) : 0,
      lastCheckMode: ["automatic", "manual"].includes(value?.lastCheckMode) ? value.lastCheckMode : null,
      lastCheckOutcome: ["current", "available", "failed"].includes(value?.lastCheckOutcome) ? value.lastCheckOutcome : null,
      lastCheckFinishedAt: Number.isFinite(value?.lastCheckFinishedAt) && value.lastCheckFinishedAt > 0 ? value.lastCheckFinishedAt : null,
      lastErrorCode: typeof value?.lastErrorCode === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value.lastErrorCode) ? value.lastErrorCode : null,
      lastErrorMessage: typeof value?.lastErrorMessage === "string" ? value.lastErrorMessage.slice(0, 320) : null };
  }
  function retryInterval(value = state.discovery) {
    const failures = discovery(value).failureCount;
    return failures ? Math.min(MAX_RETRY_INTERVAL, ERROR_RETRY_INTERVAL * 2 ** (failures - 1)) : CHECK_INTERVAL;
  }
  function checkResult(previous, automatic, ok, next, finishedAt) {
    return { ...discovery(previous.discovery), failureCount: ok ? 0 : automatic ? (previous.discovery?.failureCount || 0) + 1 : previous.discovery?.failureCount || 0,
      lastCheckMode: automatic ? "automatic" : "manual", lastCheckOutcome: ok ? next.status : "failed", lastCheckFinishedAt: finishedAt,
      lastErrorCode: ok ? null : next.code || "update_check_failed", lastErrorMessage: ok ? null : next.message || "The update check did not finish." };
  }
  const refresher = globalThis.IKnowReaderUpdateRefresh?.create({ chrome, getVersion: () => version, getState: () => state,
    save: value => save(value), getActivity: async () => await globalThis.IKnowReaderUpdateActivity?.() === true });
  function storedRefreshMarkers(value) {
    const markers = {};
    for (const key of ["autoRefreshTarget", "autoRefreshCompleteVersion"]) if (validVersion(value?.[key])) markers[key] = value[key];
    const plan = value?.autoRefreshPlan;
    if (plan && validVersion(plan.version)) markers.autoRefreshPlan = { version: plan.version,
      remaining: Array.isArray(plan.remaining) ? [...new Set(plan.remaining.filter(id => Number.isInteger(id) && id >= 0))].slice(0, 2000) : [],
      claimed: Array.isArray(plan.claimed) ? [...new Set(plan.claimed.filter(id => Number.isInteger(id) && id >= 0))].slice(0, 2000) : [] };
    return markers;
  }
  function trusted(sender) {
    try {
      const own = new URL(chrome.runtime.getURL("popup.html")), url = new URL(sender?.url || "");
      return sender?.id === chrome.runtime.id && url.protocol === own.protocol && url.host === own.host && url.pathname === own.pathname;
    } catch { return false; }
  }
  function normalize(value) {
    if (!value || typeof value !== "object" || !statuses.has(value.status)) throw Error("The helper returned an invalid update status.");
    return { status: value.status, currentVersion: version, latestVersion: validVersion(value.latestVersion),
      message: String(value.message || "").slice(0, 320), code: typeof value.code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value.code) ? value.code : null,
      progress: Number.isFinite(value.progress) ? Math.min(1, Math.max(0, value.progress)) : null,
      checkedAt: Number.isFinite(value.checkedAt) ? value.checkedAt : state.checkedAt || null,
      lastAttemptAt: Number.isFinite(value.lastAttemptAt) && value.lastAttemptAt > 0 ? value.lastAttemptAt : state.lastAttemptAt || null,
      discovery: discovery(value.discovery || state.discovery),
      refreshTabs: value.refreshTabs === true || state.refreshTabs === true,
      installAttempted: value.installAttempted === true || state.installAttempted === true,
      reloadedVersion: validVersion(value.reloadedVersion) || state.reloadedVersion || null };
  }
  async function save(value) {
    const previousStatus = state.status;
    state = { ...state, ...value, currentVersion: version };
    state.discovery = { ...discovery(state.discovery), retryIntervalMs: retryInterval(state.discovery),
      nextCheckAt: state.lastAttemptAt > 0 && Date.now() >= state.lastAttemptAt ? state.lastAttemptAt + retryInterval(state.discovery) : null };
    if (previousStatus !== state.status) globalThis.IKnowReaderDiagnosticHistory?.record("updates", "transition", { status: state.status, code: state.code, message: state.message }, state.status === "error");
    await chrome.storage.local.set({ [KEY]: state });
    globalThis.IKnowReaderUpdateDiscovery?.render(state);
    return state;
  }
  function native(action, timeout = 45000) {
    return new Promise((resolve, reject) => {
      let port, settled = false;
      const requestId = crypto.randomUUID();
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        try { port?.disconnect(); } catch { /* Already closed. */ }
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(Error("The update helper did not respond. Try again when it is available.")), timeout);
      try {
        port = chrome.runtime.connectNative(HOST);
        port.onMessage.addListener(message => {
          if (message?.requestId !== requestId) return;
          if (message.type === "error") { finish(Error("The connected helper does not support updates. Run helper/Setup.cmd from the current application folder, choose 3: Check / repair, then reload Reading Helper and your iKnow pages.")); return; }
          if (message.type !== "update:result") return;
          try {
            const next = normalize(message.state);
            if (message.ok !== true && !["error", "busy", "unconfigured", "downloading", "installing"].includes(next.status)) throw Error("The helper could not verify this update.");
            finish(null, { ok: message.ok === true, state: next });
          }
          catch (error) { finish(error); }
        });
        port.onDisconnect.addListener(() => finish(Error(chrome.runtime.lastError?.message || "The local update helper disconnected.")));
        port.postMessage({ type: "update:" + action, requestId, manual: action !== "status" });
      } catch (error) { finish(error); }
    });
  }
  async function finishInstall(next) {
    const target = next.latestVersion || state.latestVersion;
    if (!validVersion(target)) throw Error("The installed update has no valid version.");
    await save({ ...next, latestVersion: target });
    if (target === version) {
      await save({ status: "current", installAttempted: false, autoRefreshTarget: target,
        refreshTabs: state.autoRefreshCompleteVersion !== target, message: state.autoRefreshCompleteVersion === target ? "Your iKnow pages are up to date." : "Updated. Refreshing your open iKnow pages…" });
      await refresher?.run(); return;
    }
    if (state.reloadedVersion === target) {
      await save({ status: "error", refreshTabs: false, message: "The update files are installed, but Brave is still running the previous version. Reload Reading Helper at brave://extensions, then reopen this popup." }); return;
    }
    if (reloadScheduled) return;
    reloadScheduled = true;
    await save({ status: "complete", reloadedVersion: target, autoRefreshTarget: target, autoRefreshPlan: null,
      refreshTabs: true, message: "Update installed. Reloading Reading Helper…" });
    setTimeout(() => chrome.runtime.reload(), 500);
  }
  async function pollOnce() {
    const reply = await native("status");
    if (reply.state.status === "complete") await finishInstall(reply.state);
    else if (!(working(state) && reply.state.status === "idle")) await save(reply.state);
  }
  function poll() {
    if (polling || !working(state)) return;
    const started = Date.now();
    polling = (async () => {
      let failures = 0;
      while (working(state) && Date.now() - started < 12 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, Math.min(15000, 2000 * 2 ** Math.min(failures, 3))));
        try { await pollOnce(); failures = 0; }
        catch (error) {
          failures++;
          if (Date.now() - started > 11 * 60 * 1000) await save({ status: "error", message: String(error.message || error).slice(0, 320) });
        }
      }
      if (working(state)) await save({ status: "error", message: "The update is taking longer than expected. Check its status again before retrying." });
    })().finally(() => { polling = null; });
  }
  const ready = chrome.storage.local.get(KEY).then(async stored => {
    if (stored[KEY] && statuses.has(stored[KEY].status)) state = { ...state, ...normalize(stored[KEY]), ...storedRefreshMarkers(stored[KEY]) };
    if (state.latestVersion === version && ["complete", "available"].includes(state.status)) {
      // Adopt the successful install marker written by older updater versions
      // too. A same-version developer reload alone carries no such intent.
      const installed = state.status === "complete" || state.installAttempted || state.reloadedVersion === version;
      await save({ status: "current", installAttempted: false,
        ...(installed && state.refreshTabs ? { autoRefreshTarget: version } : {}),
        message: state.refreshTabs ? "Updated. Refreshing your open iKnow pages…" : "You are up to date." });
    } else if (state.status === "checking") await save({ status: "idle", message: "" });
    else if (state.status === "complete") await finishInstall(state);
    await refresher?.run();
    poll();
  }).catch(() => { state = { status: "error", currentVersion: version, message: "Update status could not be loaded." }; });
  async function autoCheck() {
    if (!configPromise) configPromise = fetch(chrome.runtime.getURL("update-config.json")).then(response => response.ok ? response.json() : null).catch(() => null);
    const config = await configPromise;
    const elapsed = Date.now() - (state.lastAttemptAt || 0);
    if (config?.enabled !== true || claimed || working(state) || refresher?.busy ||
      state.lastAttemptAt > 0 && elapsed >= 0 && elapsed < retryInterval()) return { ok: true, state };
    // Metadata verification does not start a model or mutate application files.
    // Preparation only blocks installation, not discovery. A future timestamp
    // (e.g. after correcting the PC clock) must not suppress discovery forever.
    return run("check", true);
  }
  async function run(action, automatic = false) {
    await ready;
    if (action === "status") {
      if (state.installAttempted && !working(state) && !claimed) {
        try { await pollOnce(); } catch { /* Keep the previous actionable status. */ }
      }
      return { ok: true, state };
    }
    if (action === "auto-check") return autoCheck();
    if (action === "refresh") {
      if (refresher) return refresher.run({ manual: true });
      const tabs = await chrome.tabs.query({ url: ["https://iknow.jp/*", "https://en.iknow.jp/*", "https://ja.iknow.jp/*"] });
      await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.reload(tab.id)));
      await save({ refreshTabs: false, message: "Your open iKnow pages have been refreshed." });
      return { ok: true, state };
    }
    if (claimed || working(state) || refresher?.busy) return { ok: false, state, code: "update_busy" };
    claimed = true; installClaimed = action === "install";
    const previous = { ...state }, attemptAt = Date.now();
    try {
      if (action === "install") {
        if (state.status !== "available" || !validVersion(state.latestVersion)) return { ok: false, state, code: "update_check_required" };
        if (await globalThis.IKnowReaderUpdateActivity?.()) return { ok: false, state: { ...state, status: "busy", message: "Pause course and word preparation before installing an update." }, code: "preparation_active" };
      }
      await save({ status: action === "check" ? automatic ? state.status : "checking" : "downloading", installAttempted: action === "install" || state.installAttempted === true,
        ...(action === "check" ? { lastAttemptAt: attemptAt } : {}),
        message: action === "check" ? automatic ? state.message : "Checking for updates…" : "Downloading and verifying update…", progress: null });
      if (action === "install") poll();
      if (action === "check") globalThis.IKnowReaderDiagnosticHistory?.record("updates", "check-started", { status: automatic ? "automatic" : "manual" });
      const reply = await native(action, action === "install" ? 10 * 60 * 1000 : 45000);
      if (action === "check") {
        // Some older helpers return ok:true with an unconfigured status. Only
        // a verified release/current result is a successful metadata check.
        reply.ok = reply.ok && ["current", "available"].includes(reply.state.status);
        if (reply.ok) reply.state.checkedAt = Date.now();
        reply.state.discovery = checkResult(previous, automatic, reply.ok, reply.state, Date.now());
        globalThis.IKnowReaderDiagnosticHistory?.record("updates", "check-finished", { status: reply.ok ? reply.state.status : "failed", code: reply.state.code,
          stage: automatic ? "automatic" : "manual", durationMs: Math.max(0, Date.now() - attemptAt), message: reply.ok ? undefined : reply.state.message });
      }
      // An automatic check never replaced the visible update state. Keep any
      // refresh completed while native verification was pending; restoring an
      // entire old snapshot could otherwise reload those pages a second time.
      if (automatic && !reply.ok) { await save({ lastAttemptAt: attemptAt, discovery: reply.state.discovery }); return { ok: false, state }; }
      if (reply.state.status === "complete") await finishInstall(reply.state);
      else await save(reply.state);
      return { ok: reply.ok, state };
    } catch (error) {
      globalThis.IKnowReaderDiagnosticHistory?.exception("updates", error, { code: "update_operation_failed" });
      if (automatic) { await save({ lastAttemptAt: attemptAt,
        discovery: checkResult(previous, true, false, { code: "update_check_failed", message: String(error.message || error) }, Date.now()) }); return { ok: false, state }; }
      await save({ status: "error", latestVersion: previous.latestVersion, message: String(error.message || error).slice(0, 320),
        ...(action === "check" ? { discovery: checkResult(previous, false, false, { code: "update_check_failed", message: String(error.message || error) }, Date.now()) } : {}) });
      return { ok: false, state };
    } finally { claimed = false; installClaimed = false; poll(); }
  }
  globalThis.IKnowReaderUpdates = Object.freeze({ get busy() { return installClaimed || working(state) || refresher?.busy === true; } });
  function trustedPresence(sender) {
    try {
      const url = new URL(sender?.url || "");
      return sender?.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && (!sender.frameId || sender.frameId === 0) &&
        url.protocol === "https:" && !url.port && ["iknow.jp", "en.iknow.jp", "ja.iknow.jp"].includes(url.hostname) &&
        /^\/(?:courses\/\d+|series\/\d+|content\/japanese\/series\/\d+)\/?$/.test(url.pathname);
    } catch { return false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!String(message?.type || "").startsWith("ikr:update:")) return;
    const action = message.type.slice("ikr:update:".length);
    if (action === "presence") {
      if (!trustedPresence(sender)) { respond({ ok: false, code: "update_forbidden" }); return; }
      void ready.then(async () => {
        await refresher?.run(); await autoCheck();
        const now = Date.now(), due = (state.lastAttemptAt || 0) + retryInterval();
        // One timestamp lets a visible page align its next wake with the shared
        // cooldown. A tab activation just before its timer cannot add another
        // whole interval. No settings or update controls leave the worker.
        return { ok: true, nextCheckAt: !claimed && !working(state) && !refresher?.busy && due > now ? due : now + CHECK_INTERVAL };
      }).then(respond, () => respond({ ok: false }));
      return true;
    }
    if (!trusted(sender) || !["status", "auto-check", "check", "install", "refresh"].includes(action)) { respond({ ok: false, code: "update_forbidden" }); return; }
    void run(action).then(respond, () => respond({ ok: false, state: { ...state, status: "error", message: "Updates are unavailable. Try again." } }));
    return true;
  });
  globalThis.IKnowReaderUpdateDiscovery?.start({ ready, getState: () => state, autoCheck,
    isBusy: () => claimed || working(state) || refresher?.busy === true, onActivity: () => refresher?.run() });
})();
