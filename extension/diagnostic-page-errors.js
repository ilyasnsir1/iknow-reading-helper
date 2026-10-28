/* Only extension-owned script failures enter the local diagnostic history. */
(() => {
  "use strict";
  const prefix = chrome.runtime.getURL("");
  const script = value => { try { const url = new URL(value); return value.startsWith(prefix) && /^\/[a-zA-Z0-9_.-]+\.js$/.test(url.pathname) ? url.pathname.slice(1) : null; } catch { return null; } };
  let sent = 0, started = Date.now();
  function send(error, filename, line, column) {
    const module = script(filename);
    const frames = typeof error?.stack === "string" ? [...error.stack.matchAll(/(chrome-extension:\/\/[^\s)]+\.js):([0-9]+):([0-9]+)/g)].map(match => {
      const name = script(match[1]); return name ? `${name}:${match[2]}:${match[3]}` : null;
    }).filter(Boolean).slice(0, 8) : [];
    if (!module && !frames.length) return;
    if (Date.now() - started > 60000) { sent = 0; started = Date.now(); }
    if (sent++ >= 10) return;
    if (module) frames.unshift(`${module}:${Number.isInteger(line) ? line : 0}:${Number.isInteger(column) ? column : 0}`);
    // Arbitrary exception messages may embed learning text. Preserve the error
    // class and exact project frame without copying third-party page content.
    void chrome.runtime.sendMessage({ type: "ikr:diagnostics:page-error", errorType: /^[a-zA-Z0-9_]{1,80}$/.test(error?.name || "") ? error.name : "Error", frames: frames.slice(0, 8) }).catch(() => {});
  }
  window.addEventListener("error", event => send(event.error, event.filename, event.lineno, event.colno));
  window.addEventListener("unhandledrejection", event => send(event.reason));
})();
