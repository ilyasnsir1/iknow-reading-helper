/* In-memory preview only: no native messaging, persistent storage or network. */
"use strict";
(() => {
  const key = "iknowReaderUpdateState", listeners = [], timers = new Set(), pending = new Set();
  const baseVersion = "1.36.0", exampleVersion = "1.36.1";
  let currentVersion = baseVersion, state = {}, checkTarget = "available";
  const badge = { text: "", color: "#7460AD", textColor: "#FFFFFF", title: "iKnow! Reading Helper – Settings" };
  const delay = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const stop = () => { for (const id of timers) clearTimeout(id); timers.clear(); for (const finish of [...pending]) queueMicrotask(finish); };
  const templates = {
    available: { status: "available", latestVersion: exampleVersion, message: `Version ${exampleVersion} is available.` },
    current: { status: "current", latestVersion: baseVersion, refreshTabs: false, message: "You are up to date." },
    checking: { status: "checking", message: "Checking for updates…" },
    downloading: { status: "downloading", latestVersion: exampleVersion, progress: .44, message: "Downloading and verifying update…" },
    installing: { status: "installing", latestVersion: exampleVersion, progress: .96, message: "Installing the update…" },
    complete: { status: "complete", latestVersion: exampleVersion, refreshTabs: true, message: "Update installed. Reloading Reading Helper…" },
    refreshing: { status: "current", latestVersion: exampleVersion, autoRefreshTarget: exampleVersion, refreshTabs: true, message: "Updated. Refreshing your open iKnow pages…" },
    installed: { status: "current", latestVersion: exampleVersion, autoRefreshTarget: exampleVersion, autoRefreshCompleteVersion: exampleVersion, refreshTabs: false, message: "Your open iKnow pages have been refreshed." },
    error: { status: "error", message: "The update could not be downloaded. Check your connection and try again." }
  };
  function emit(next, additions = {}) {
    if (["refreshing", "installed"].includes(next)) currentVersion = exampleVersion;
    else if (["current", "available"].includes(next)) currentVersion = baseVersion;
    state = { currentVersion, ...templates[next], ...additions };
    const version = document.getElementById("update-version"); if (version) version.textContent = "Version " + currentVersion;
    // The production renderer controls this simulated toolbar, never Brave.
    globalThis.IKnowReaderUpdateDiscovery?.render(state);
    for (const listener of listeners) listener({ [key]: { newValue: { ...state } } }, "local");
    parent.postMessage({ type: "update-preview:rendered", previewState: next, badge: { ...badge }, currentVersion, status: state.status, refreshTabs: state.refreshTabs === true, message: state.message }, location.origin);
    return { ok: state.status !== "error", state: { ...state } };
  }
  function install() {
    stop(); emit("downloading", { progress: 0 });
    for (let i = 1; i <= 12; i++) delay(() => emit("downloading", { progress: i / 12 * .9 }), i * 180);
    delay(() => emit("installing"), 2400); delay(() => emit("complete"), 3300);
    delay(() => emit("refreshing"), 4000); delay(() => emit("installed"), 5200);
    return Promise.resolve({ ok: true, state: { ...state } });
  }
  const action = field => (details, callback) => { badge[field] = details.text ?? details.color ?? details.title; callback?.(); return Promise.resolve(); };
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: currentVersion, action: { default_title: "iKnow! Reading Helper – Settings" } }), sendMessage: async message => {
      const command = message.type.slice("ikr:update:".length);
      if (["status", "auto-check"].includes(command)) return { ok: true, state: { ...state } };
      if (command === "check") {
        stop(); emit("checking");
        return new Promise(resolve => {
          const finish = () => { pending.delete(finish); resolve({ ok: true, state: { ...state } }); };
          pending.add(finish); delay(() => { emit(checkTarget); finish(); }, 850);
        });
      }
      if (command === "install") return install();
      if (command === "refresh") return emit("installed");
      return { ok: false };
    } },
    action: { setBadgeText: action("text"), setBadgeBackgroundColor: action("color"), setBadgeTextColor: action("textColor"), setTitle: action("title") },
    storage: { onChanged: { addListener: listener => listeners.push(listener) } }
  };
  state = { currentVersion, ...templates.available };
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === "update-preview:state" && templates[event.data.value]) { stop(); checkTarget = event.data.value === "current" ? "current" : "available"; emit(event.data.value); }
    if (event.data?.type === "update-preview:play") { stop(); checkTarget = "available"; emit("checking"); delay(() => emit("available"), 850); delay(() => install(), 2100); }
  });
  const settings = document.getElementById("settings");
  if (settings) {
    settings.setAttribute("aria-busy", "false");
    for (const element of settings.querySelectorAll("fieldset,input,select")) element.disabled = false;
    const defaults = globalThis.IKnowReaderCore?.DEFAULTS || {};
    for (const element of settings.querySelectorAll("input,select")) {
      if (element.type === "checkbox") element.checked = element.id === "enabled" || defaults[element.id] === true;
      else if (defaults[element.id] !== undefined) element.value = String(defaults[element.id]);
    }
    const save = document.getElementById("save-status"); if (save) save.textContent = "Preview settings";
  }
  document.querySelectorAll("a").forEach(link => link.addEventListener("click", event => event.preventDefault()));
})();
