/* Explicit component management is restricted to our own management page. */
(() => {
  "use strict";
  const KEY = "iknowReaderComponentState", active = new Set(["starting", "running", "downloading", "installing", "verifying", "pausing"]);
  let snapshot = null, pending = null, claiming = false, statusAt = 0, timer = null;
  const own = sender => {
    try { const url = new URL(sender?.url || ""), base = new URL(chrome.runtime.getURL("models.html"));
      return sender?.id === chrome.runtime.id && url.protocol === base.protocol && url.host === base.host && url.pathname === base.pathname && (!sender.frameId || sender.frameId === 0);
    } catch { return false; }
  };
  const busy = () => claiming || active.has(snapshot?.job?.status);
  function request(action, componentId) {
    return new Promise((resolve, reject) => {
      let port, ended = false;
      const requestId = crypto.randomUUID();
      const finish = (error, result) => {
        if (ended) return; ended = true; clearTimeout(timer); try { port?.disconnect(); } catch {}
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(Error("The component manager did not respond. Check the helper connection and retry.")), 45000);
      try {
        port = chrome.runtime.connectNative("de.iknow.lesehilfe");
        port.onDisconnect.addListener(() => finish(Error(chrome.runtime.lastError?.message || "The local helper disconnected.")));
        port.onMessage.addListener(message => {
          if (message?.requestId !== requestId) return;
          if (message.type !== "components:result") { if (message.type === "error") finish(Error("Update the local helper to use model downloads.")); return; }
          const value = message.snapshot;
          if (value && (typeof value !== "object" || !Array.isArray(value.components) || value.components.length > 100 || JSON.stringify(value).length > 250000)) { finish(Error("The helper returned an invalid component catalogue.")); return; }
          finish(null, { ok: message.ok === true, snapshot: value || snapshot, code: String(message.code || "").slice(0, 80), error: String(message.error || message.message || "").slice(0, 320) });
        });
        port.postMessage({ type: "components:" + action, requestId, ...(componentId ? { componentId } : {}), ...(action !== "status" ? { manual: true } : {}) });
      } catch (error) { finish(error); }
    });
  }
  async function run(action, id) {
    if (pending) return action === "status" ? pending : { ok: false, code: "component_request_busy", error: "Wait for the current request to finish." };
    if (["start", "resume"].includes(action)) {
      if (globalThis.IKnowReaderUpdates?.busy || await globalThis.IKnowReaderUpdateActivity?.() === true) return { ok: false, code: "preparation_active", error: "Pause course and word preparation before changing installed models." };
      claiming = true;
    }
    pending = request(action, id).then(async value => {
      if (value.snapshot) { snapshot = value.snapshot; statusAt = Date.now(); await chrome.storage.local.set({ [KEY]: snapshot }); }
      if (!value.ok) globalThis.IKnowReaderDiagnosticHistory?.record("components", "request_failed", { code: value.code, message: value.error }, true);
      return value;
    }).catch(error => ({ ok: false, code: "component_helper_missing", error: String(error.message || error).slice(0, 320), snapshot }))
      .finally(() => { pending = null; claiming = false; clearTimeout(timer); if (active.has(snapshot?.job?.status)) timer = setTimeout(() => void run("status"), 3000); });
    return pending;
  }
  async function reconcile() {
    await ready;
    if (!claiming && active.has(snapshot?.job?.status) && Date.now() - statusAt > 2000) await run("status");
    return busy();
  }
  globalThis.IKnowReaderComponents = Object.freeze({ get busy() { return busy(); }, reconcile });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!String(message?.type || "").startsWith("ikr:components:")) return;
    const action = message.type.slice("ikr:components:".length);
    if (!own(sender) || !["status", "start", "pause", "resume"].includes(action) ||
      (["start", "resume"].includes(action) && (!/^[a-z][a-z0-9-]{0,79}$/.test(message.componentId || "") || message.manual !== true))) {
      respond({ ok: false, code: "component_forbidden", error: "Open Models & voices to manage downloads." }); return;
    }
    void run(action, message.componentId).then(respond); return true;
  });
  // Reconcile only a previously active detached job; ordinary worker startup
  // does not start a native host, check downloads or install anything.
  const ready = chrome.storage.local.get(KEY).then(async stored => {
    if (stored[KEY] && typeof stored[KEY] === "object") snapshot = stored[KEY];
    if (busy()) {
      const result = await run("status");
      if (!result.ok) snapshot = null;
    }
  }).catch(() => {});
})();
