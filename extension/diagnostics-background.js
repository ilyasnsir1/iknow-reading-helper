/* Explicit, local-only diagnostic snapshot. No learning caches or raw requests. */
(() => {
  "use strict";
  const recent = [], HOST = "de.iknow.lesehilfe";
  let exporting = null;
  const code = value => typeof value === "string" && /^[a-z][a-z0-9_:-]{0,79}$/i.test(value) ? value : "unknown_error";
  const identifier = value => /^[1-9][0-9]{0,8}$/.test(String(value)) ? String(value) : null;
  const count = value => Number.isFinite(value) ? Math.max(0, Math.min(1000000, Math.floor(value))) : 0;
  const timestamp = value => Number.isFinite(value) && value > 0 ? value : null;
  function redact(value) {
    return String(value || "").slice(0, 4000)
      .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/giu, "[URL]")
      .replace(/\b(?:[a-z]:[\\/]|\\\\)[^\r\n"<>|]*/giu, "[PATH]")
      .replace(/\/(?:Users|home|tmp|var|opt)\/[^\r\n"<>|]*/gu, "[PATH]")
      .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\r\n]*/giu, "[REDACTED]")
      .replace(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+/gu, "[TEXT]");
  }
  function safeTree(value, depth = 0) {
    if (depth > 7) return "[OMITTED]";
    if (typeof value === "string") return redact(value);
    if (typeof value === "boolean" || value === null) return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 80).map(item => safeTree(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 60)
      .filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(key) && !/^(?:path|source|text|sentence|words|data|request|token|password|secret|authorization|apiKey)$/i.test(key))
      .map(([key, item]) => [key, safeTree(item, depth + 1)]));
    return null;
  }
  function record(component, value, courseId) {
    if (!["course-preparation", "word-audio", "word-preparation", "helper-connection"].includes(component)) return;
    const item = { component, code: code(value), courseId: identifier(courseId), at: Date.now() }, last = recent[recent.length - 1];
    if (last && last.component === item.component && last.code === item.code && last.courseId === item.courseId && item.at - last.at < 2000) return;
    recent.push(item); if (recent.length > 30) recent.shift();
  }
  function state(value) {
    return { courseId: identifier(value.courseId ?? value.id), status: code(value.status || "unknown"), stage: code(value.stage || "unknown"),
      code: value.code ? code(value.code) : null, completed: count(value.completed), total: count(value.total), updatedAt: timestamp(value.updatedAt) };
  }
  function nativeSnapshot() {
    return new Promise(resolve => {
      let port, timer, finished = false;
      const requestId = crypto.randomUUID();
      const done = value => {
        if (finished) return; finished = true; clearTimeout(timer);
        try { port?.disconnect(); } catch { /* Already disconnected. */ }
        resolve(value);
      };
      timer = setTimeout(() => done({ status: "timeout", code: "diagnostics_timeout" }), 12000);
      try {
        port = chrome.runtime.connectNative(HOST);
        port.onMessage.addListener(message => {
          if (message?.type === "error" && message.code === "invalid_request" && (!message.requestId || message.requestId === requestId)) {
            done({ status: "unsupported", code: "diagnostics_unsupported" }); return;
          }
          if (message?.type !== "diagnostics-result" || message.requestId !== requestId) return;
          if (!message.ok || !message.report || message.report.schemaVersion !== 1 || Array.isArray(message.report) ||
              new TextEncoder().encode(JSON.stringify(message.report)).length > 128 * 1024) {
            done({ status: "error", code: "invalid_diagnostics_report" }); return;
          }
          const raw = message.report, selected = {};
          for (const key of ["schemaVersion", "helperVersion", "platform", "capabilities", "setup", "logs", "jobs", "limits", "scope", "reportTruncated", "limitations"]) if (raw[key] !== undefined) selected[key] = raw[key];
          done({ status: "ready", report: safeTree(selected) });
        });
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; done({ status: "missing", code: "helper_unavailable" }); });
        port.postMessage({ type: "diagnostics", requestId });
      } catch { done({ status: "missing", code: "helper_unavailable" }); }
    });
  }
  async function build({ states = [], queue = null, settings = {} } = {}) {
    let platform = null;
    try {
      const info = await chrome.runtime.getPlatformInfo?.();
      if (info) platform = { os: /^[a-z_]{1,30}$/i.test(info.os) ? info.os : "unknown", arch: /^[a-z0-9_-]{1,30}$/i.test(info.arch) ? info.arch : "unknown" };
    } catch { /* The rest of the report still works. */ }
    const chosen = {};
    for (const key of ["enabled", "alignmentMode", "colorMode", "translationLanguage", "groupInfo", "wordAudio", "audioFollow", "wordNeuralVoice", "wordAudioSpeed", "prepareGerman", "prepareColors", "prepareAudio"])
      if (["string", "boolean", "number"].includes(typeof settings[key])) chosen[key] = safeTree(settings[key]);
    const report = { format: "iknow-reader-diagnostics", schemaVersion: 1, createdAt: new Date().toISOString(),
      extension: { name: "iKnow! Reading Helper", version: chrome.runtime.getManifest().version, platform }, settings: chosen,
      preparation: { courses: states.slice(0, 100).map(state), queue: queue ? {
        status: code(queue.status || "unknown"), stage: code(queue.stage || "unknown"), totalCourses: count(queue.totalCourses),
        processedCourses: count(queue.processedCourses), failedCourses: count(queue.failedCourses),
        currentIndex: count(queue.currentIndex), completed: count(queue.completed), total: count(queue.total),
        progressFraction: Number.isFinite(queue.progressFraction) ? Math.min(1, Math.max(0, queue.progressFraction)) : null,
        etaSeconds: Number.isFinite(queue.etaSeconds) && queue.etaSeconds >= 0 ? Math.ceil(queue.etaSeconds) : null,
        etaScope: ["total", "measured"].includes(queue.etaScope) ? queue.etaScope : null,
        etaStages: (Array.isArray(queue.etaStages) ? queue.etaStages : []).filter(stage => ["language", "audio"].includes(stage)),
        unestimatedStages: (Array.isArray(queue.unestimatedStages) ? queue.unestimatedStages : []).filter(stage => ["language", "audio"].includes(stage)),
        timings: Object.fromEntries(Object.entries(queue.timings || {}).filter(([stage]) => ["language", "audio"].includes(stage)).map(([stage, sample]) => [stage, { units: count(sample?.units), milliseconds: Number.isFinite(sample?.milliseconds) ? Math.max(0, Math.min(604800000, Math.round(sample.milliseconds))) : 0 }])),
        courses: (Array.isArray(queue.courses) ? queue.courses : []).slice(0, 100).map(state)
      } : null }, recentErrors: { scope: "current-background-session", items: recent.map(item => ({ ...item })) },
      helper: await nativeSnapshot(),
      limitations: ["This is a snapshot, not a complete browser error history.", "No translation caches, generated audio, model files or browsing history are included.", "Review the report before sharing it."] };
    return { ok: true, report };
  }
  function exportReport(snapshot) {
    if (exporting) return exporting;
    exporting = build(snapshot).finally(() => { exporting = null; });
    return exporting;
  }
  globalThis.IKnowReaderDiagnostics = Object.freeze({ exportReport, record });
})();
