/* Small durable support history. No requests, course text or audio are stored. */
(() => {
  "use strict";
  const KEY = "iknowReaderDiagnosticHistory", MAX = 240;
  const session = crypto.randomUUID(), version = chrome.runtime.getManifest().version;
  const events = [], pending = [], sampled = new Map(), correlations = new Set();
  let dropped = 0, timer = null, writes = Promise.resolve(), writeFailed = false, sequence = 0;
  const word = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : undefined;
  const number = value => Number.isFinite(value) && value >= 0 ? Math.min(10 ** 13, value) : undefined;
  function redact(value) {
    return String(value || "").slice(0, 1200)
      .replace(/\b(?:https?|ftp|file|chrome-extension):\/\/[^\s<>"']+/giu, "[URL]")
      .replace(/\b(?:[a-z]:[\\/]|\\\\)[^\r\n"<>|]*/giu, "[PATH]")
      .replace(/\/(?:Users|home|tmp|var|opt)\/[^\r\n"<>|]*/gu, "[PATH]")
      .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\r\n]*/giu, "[REDACTED]")
      .replace(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+/gu, "[TEXT]");
  }
  function safe(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result = {};
    for (const key of ["component", "event", "status", "stage", "code", "session", "version", "errorType"]) if (word(value[key])) result[key] = value[key];
    for (const key of ["at", "sequence", "completed", "total", "currentIndex", "totalCourses", "failedCourses", "durationMs"]) if (number(value[key]) !== undefined) result[key] = number(value[key]);
    for (const key of ["courseId", "seriesId"]) if (/^[1-9][0-9]{0,8}$/.test(String(value[key]))) result[key] = String(value[key]);
    if (typeof value.message === "string") result.message = redact(value.message);
    if (value.features && typeof value.features === "object") result.features = Object.fromEntries(["german", "colors", "audio"].map(key => [key, value.features[key] === true]));
    if (typeof value.requestKey === "string" && /^[a-f0-9]{20}$/.test(value.requestKey)) result.requestKey = value.requestKey;
    if (Array.isArray(value.frames)) result.frames = value.frames.slice(0, 8).filter(frame => typeof frame === "string" && /^[a-zA-Z0-9_.-]+\.js:[0-9]{1,8}(?::[0-9]{1,8})?$/.test(frame));
    return result.component && result.event && result.at ? result : null;
  }
  const ready = Promise.resolve().then(() => chrome.storage.local.get(KEY)).then(stored => {
    const previous = stored?.[KEY];
    if (previous?.schemaVersion !== 1 || !Array.isArray(previous.events)) return;
    const restored = previous.events.slice(-MAX).map(safe).filter(Boolean);
    events.push(...restored);
    dropped = Math.max(0, Math.min(10000000, Number(previous.dropped) || 0)) + Math.max(0, previous.events.length - MAX);
  }).catch(() => { writeFailed = true; });
  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const task = writes.then(async () => {
      await ready;
      if (!pending.length) return;
      events.push(...pending.splice(0)); events.sort(chronological);
      if (events.length > MAX) { dropped += events.length - MAX; events.splice(0, events.length - MAX); }
      try { await chrome.storage.local.set({ [KEY]: { schemaVersion: 1, events, dropped } }); writeFailed = false; }
      catch { writeFailed = true; }
    });
    writes = task.catch(() => { writeFailed = true; });
    return writes;
  }
  function record(component, event, detail = {}, critical = false) {
    const value = safe({ ...detail, component, event, version, session, at: Date.now(), sequence: ++sequence });
    if (!value) return;
    if (typeof detail.requestId === "string" && detail.requestId.length <= 120) {
      const work = crypto.subtle.digest("SHA-256", new TextEncoder().encode(detail.requestId)).then(hash => {
        value.requestKey = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
        enqueue(value, critical);
      }).catch(() => { enqueue(value, critical); }).finally(() => correlations.delete(work));
      correlations.add(work); return;
    }
    enqueue(value, critical);
  }
  function enqueue(value, critical) {
    pending.push(value);
    if (pending.length > MAX) { pending.shift(); dropped++; }
    if (critical) { void flush(); return; }
    if (timer === null) { timer = setTimeout(() => { timer = null; void flush(); }, 750); timer?.unref?.(); }
  }
  function state(value) {
    const key = String(value.courseId), now = Date.now(), previous = sampled.get(key);
    const changed = !previous || previous.status !== value.status || previous.stage !== value.stage || previous.requestId !== value.requestId;
    const terminal = ["error", "complete", "cancelled"].includes(value.status);
    if (!changed && !terminal && Math.abs((value.completed || 0) - previous.completed) < 5 && now - previous.at < 10000) return;
    if (!changed && terminal && previous.code === value.code && previous.message === value.message) return;
    sampled.set(key, { status: value.status, stage: value.stage, requestId: value.requestId, completed: value.completed || 0, code: value.code, message: value.message, at: now });
    if (sampled.size > 200) sampled.delete(sampled.keys().next().value);
    record("course-preparation", terminal ? value.status : changed ? "transition" : "progress", value, terminal);
  }
  let lastQueue = "";
  function queue(value) {
    if (!value) return;
    const current = value.courses?.[value.currentIndex];
    const signature = [value.id, value.status, value.currentIndex, value.stage, value.failedCourses].join(":");
    if (signature === lastQueue) return;
    lastQueue = signature;
    record("series-queue", "transition", { ...value, courseId: current?.id, message: value.error || value.message }, ["complete", "error", "paused"].includes(value.status));
  }
  function exception(component, error, context = {}) {
    const frames = typeof error?.stack === "string" ? [...error.stack.matchAll(/(?:\/|\\)([a-zA-Z0-9_.-]+\.js:[0-9]+(?::[0-9]+)?)/g)].map(match => match[1]) : [];
    record(component, "exception", { ...context, errorType: word(error?.name) || "Error", message: error?.message || String(error || "Unknown error"), frames }, true);
  }
  const chronological = (a, b) => a.at - b.at || (a.session === b.session ? (a.sequence || 0) - (b.sequence || 0) : 0);
  async function snapshot() {
    await Promise.allSettled([...correlations]);
    await flush();
    return { status: writeFailed ? "storage_unavailable" : "ready", scope: "Bounded persistent project event history across background restarts", session, events: events.slice(-MAX).map(safe).filter(Boolean), truncated: dropped > 0, dropped, limits: { events: MAX, sampledProgressSeconds: 10, sampledProgressSentences: 5 } };
  }
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("error", event => exception("background", event.error || { name: "Error", message: event.message }));
    globalThis.addEventListener("unhandledrejection", event => exception("background", event.reason));
  }
  globalThis.IKnowReaderDiagnosticHistory = Object.freeze({ record, state, queue, exception, snapshot, redact });
})();
