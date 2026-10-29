/* Visible-page update wake; no model work, settings reads or permanent port. */
(() => {
  "use strict";
  let timer = null, pending = false, pageActive = true;
  const interval = 45 * 1000;
  function stop() { clearTimeout(timer); timer = null; }
  function schedule(nextCheckAt) {
    stop();
    const remaining = Number.isFinite(nextCheckAt) ? nextCheckAt - Date.now() : interval;
    const delay = remaining > 0 ? Math.max(1000, Math.min(interval, remaining)) : interval;
    if (pageActive && document.visibilityState === "visible") timer = setTimeout(signal, delay);
  }
  async function signal() {
    stop();
    if (!pageActive || document.visibilityState !== "visible" || pending) return;
    pending = true;
    let nextCheckAt;
    try {
      const reply = await chrome.runtime.sendMessage({ type: "ikr:update:presence" });
      if (reply?.ok === true) nextCheckAt = reply.nextCheckAt;
    }
    catch { /* A page left open across extension reloads can be refreshed later. */ }
    finally { pending = false; schedule(nextCheckAt); }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") signal(); else stop(); });
  window.addEventListener("pagehide", () => { pageActive = false; stop(); });
  window.addEventListener("pageshow", () => { pageActive = true; if (!timer && document.visibilityState === "visible") signal(); });
  signal();
})();
