/* Restore a verified update notice and check during ordinary browser activity. */
(() => {
  "use strict";
  let started = false, pending = null, initial = null, presentation = null;
  const working = state => ["checking", "downloading", "installing"].includes(state?.status);
  function versionParts(value) {
    if (typeof value !== "string" || !/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value)) return null;
    const parts = value.split(".").map(Number);
    return parts.every(part => part <= 65535) ? parts : null;
  }
  function isNewer(latest, current) {
    const next = versionParts(latest), loaded = versionParts(current);
    if (!next || !loaded) return false;
    for (let index = 0; index < Math.max(next.length, loaded.length); index++) {
      if ((next[index] || 0) !== (loaded[index] || 0)) return (next[index] || 0) > (loaded[index] || 0);
    }
    return false;
  }
  function action(method, details) {
    try {
      // Chrome supports both callbacks and promises. Consume errors in either
      // form so a missing action surface can never interrupt the updater.
      const result = chrome.action?.[method]?.(details, () => { void chrome.runtime.lastError; });
      result?.catch?.(() => {});
    } catch { /* The extension may be unloading or the optional method absent. */ }
  }
  function render(state) {
    const manifest = chrome.runtime.getManifest();
    const available = state?.status === "available" && isNewer(state.latestVersion, manifest.version);
    const title = available ? `iKnow! Reading Helper – Update ${state.latestVersion} available` : manifest.action?.default_title || "iKnow! Reading Helper – Settings";
    const text = available ? "NEW" : "";
    const next = JSON.stringify([text, title]);
    if (presentation === next) return;
    presentation = next;
    if (available) {
      action("setBadgeBackgroundColor", { color: "#7460AD" });
      action("setBadgeTextColor", { color: "#FFFFFF" });
    }
    action("setBadgeText", { text });
    action("setTitle", { title });
  }
  function isIKnow(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ["iknow.jp", "en.iknow.jp", "ja.iknow.jp"].includes(url.hostname);
    } catch { return false; }
  }
  function start({ ready, getState, autoCheck, isBusy, onActivity }) {
    if (started) return initial;
    started = true;
    function check() {
      if (pending) return pending;
      pending = Promise.resolve(ready).then(async () => {
        render(getState());
        try { await onActivity?.(); } catch { /* A deferred page refresh can retry on the next activity. */ }
        if (working(getState()) || await isBusy?.()) return;
        // autoCheck owns the persisted attempt time, retry policy and native
        // connection. These events never bypass that shared throttle.
        await autoCheck();
        render(getState());
      }).catch(() => { /* Automatic discovery stays quiet until another event. */ }).finally(() => { pending = null; });
      return pending;
    }
    const wake = () => { void check(); };
    chrome.runtime.onStartup?.addListener(wake);
    chrome.runtime.onInstalled?.addListener(wake);
    // A tab activation is just a wake signal: no URL or browsing history is read.
    chrome.tabs?.onActivated?.addListener(wake);
    chrome.tabs?.onUpdated?.addListener((_id, change, tab) => {
      if (change?.audible === false || change?.status === "complete" && isIKnow(tab?.url || change?.url)) wake();
    });
    // MV3 workers have no reliable interval timer. Every worker load restores
    // the badge; only an expired persisted throttle can launch an actual check.
    initial = check();
    return initial;
  }
  globalThis.IKnowReaderUpdateDiscovery = Object.freeze({ start, render });
})();
