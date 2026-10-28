/* Low-frequency activity signal; no model work, settings reads or keepalive. */
(() => {
  "use strict";
  let timer = null;
  const interval = 15 * 60 * 1000;
  function stop() { clearTimeout(timer); timer = null; }
  function schedule() {
    stop();
    if (document.visibilityState === "visible") timer = setTimeout(signal, interval);
  }
  function signal() {
    if (document.visibilityState !== "visible") { stop(); return; }
    try { chrome.runtime.sendMessage({ type: "ikr:update:presence" })?.catch?.(() => {}); }
    catch { /* A page left open across extension reloads can be refreshed later. */ }
    schedule();
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") signal(); else stop(); });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", () => { if (!timer && document.visibilityState === "visible") signal(); });
  signal();
})();
