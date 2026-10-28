/* A dedicated, local pronunciation channel. Never starts a course-preparation job. */
(() => {
  "use strict";
  const pending = new Map(), cache = new Map();
  let port = null, bytes = 0;
  const valid = text => typeof text === "string" && text.length > 0 && text.length <= 80 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30faー]+$/u.test(text);
  function connect() {
    if (port) return port;
    const current = chrome.runtime.connectNative("de.iknow.lesehilfe");
    port = current;
    current.onMessage.addListener(message => {
      if (message?.type !== "word-speech-result") return;
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId); clearTimeout(request.timer);
      if (message.ok && typeof message.data === "string" && message.data.length <= 520000 && [16000, 24000, 48000].includes(message.sampleRate) && Number.isFinite(message.duration) && message.duration > 0 && message.duration <= 8) {
        const value = { ok: true, data: message.data, sampleRate: message.sampleRate, duration: message.duration, voice: String(message.voice || "Mei · Open JTalk").slice(0, 80), cached: message.cached === true };
        cache.set(request.key, value); bytes += value.data.length;
        while (cache.size > 192 || bytes > 12 * 1024 * 1024) { const key = cache.keys().next().value; bytes -= cache.get(key).data.length; cache.delete(key); }
        request.resolve(value);
      } else request.resolve({ ok: false, code: String(message.code || "word_voice_failed"), error: String(message.error || "Could not create word audio.").slice(0, 200) });
    });
    current.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || "Local word voice disconnected.";
      if (port === current) port = null;
      for (const [id, request] of pending) { clearTimeout(request.timer); request.resolve({ ok: false, code: "word_voice_missing", error: reason }); pending.delete(id); }
    });
    return current;
  }
  function trusted(sender) {
    if (sender.id !== chrome.runtime.id) return false;
    try { const url = new URL(sender.url || sender.tab?.url || ""); return url.protocol === "https:" && /^(?:(?:en|ja)\.)?iknow\.jp$/.test(url.hostname) && !url.port && /^\/courses\/\d+(?:\/|$)/.test(url.pathname); } catch { return false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "ikr:word:speech") return;
    if (!trusted(sender) || !valid(message.text) || ![.7, .85, 1].includes(message.speed)) { respond({ ok: false, code: "invalid_word" }); return; }
    const key = `${message.speed}:${message.text}`;
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); respond({ ...value, cached: true }); return; }
    // Dedupe repeated clicks while the same word is being rendered; playback still uses the newest click.
    const existing = [...pending.values()].find(request => request.key === key);
    if (existing) { void existing.work.then(respond); return true; }
    if (pending.size >= 8) { respond({ ok: false, code: "word_voice_busy" }); return; }
    const requestId = crypto.randomUUID();
    let resolve;
    const work = new Promise(done => { resolve = done; });
    const request = { key, work, resolve, timer: setTimeout(() => { pending.delete(requestId); resolve({ ok: false, code: "word_voice_timeout" }); }, 10000) };
    pending.set(requestId, request);
    try { connect().postMessage({ type: "word-speech", requestId, text: message.text, speed: message.speed }); }
    catch { pending.delete(requestId); clearTimeout(request.timer); resolve({ ok: false, code: "word_voice_missing" }); }
    void work.then(respond); return true;
  });
})();
