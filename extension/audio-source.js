/* Fetch original recordings for local waveform inspection. No model or service. */
(() => {
  "use strict";
  const allowed = value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.port && /^assets[0-3]?\.iknow\.jp$/i.test(url.hostname) && url.pathname.startsWith("/assets/") && /\.mp3$/i.test(url.pathname) && !url.username && !url.password && !url.hash && url.href.length < 4000;
    } catch { return false; }
  };
  const inFlight = new Map(), cache = new Map();
  let cacheBytes = 0;
  async function recording(src) {
    if (!allowed(src)) throw Error("Unsupported recording.");
    if (cache.has(src)) { const hit = cache.get(src); cache.delete(src); cache.set(src, hit); return hit; }
    if (inFlight.has(src)) return inFlight.get(src);
    if (inFlight.size >= 4) throw Error("Recording inspection is busy.");
    const task = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(src, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok || !allowed(response.url || src) || Number(response.headers.get("content-length")) > 2 * 1024 * 1024) { controller.abort(); throw Error("Recording unavailable."); }
        const reader = response.body.getReader(), chunks = []; let length = 0;
        for (;;) {
          const result = await reader.read(); if (result.done) break;
          length += result.value.length;
          if (length > 2 * 1024 * 1024) { await reader.cancel(); throw Error("Recording too large."); }
          chunks.push(result.value);
        }
        if (length < 100) throw Error("Recording unavailable.");
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let binary = "";
        for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        const value = { ok: true, data: btoa(binary), bytes: length };
        cache.set(src, value); cacheBytes += length;
        while (cache.size > 32 || cacheBytes > 8 * 1024 * 1024) { const key = cache.keys().next().value; cacheBytes -= cache.get(key).bytes; cache.delete(key); }
        return value;
      } finally { clearTimeout(timeout); }
    })().finally(() => inFlight.delete(src));
    inFlight.set(src, task); return task;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "ikr:audio:source") return;
    const source = sender?.url || sender?.tab?.url || "";
    let trusted = false;
    try { const url = new URL(source); trusted = sender.id === chrome.runtime.id && url.protocol === "https:" && !url.port && /^(?:(?:en|ja)\.)?iknow\.jp$/.test(url.hostname) && /^\/courses\/\d+(?:\/|$)/.test(url.pathname); } catch { /* Reject other surfaces. */ }
    if (!trusted || typeof message.src !== "string" || !allowed(message.src)) { respond({ ok: false }); return; }
    void recording(message.src).then(respond, () => respond({ ok: false })); return true;
  });
})();
