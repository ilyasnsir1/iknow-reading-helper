/* Explicit, local-only diagnostic snapshot. No learning caches or raw requests. */
(() => {
  "use strict";
  const recent = [], HOST = "de.iknow.lesehilfe", LAST_HELPER = "iknowReaderLastHelperDiagnostic";
  let exporting = null;
  const code = value => typeof value === "string" && /^[a-z][a-z0-9_:-]{0,79}$/i.test(value) ? value : "unknown_error";
  const identifier = value => /^[1-9][0-9]{0,8}$/.test(String(value)) ? String(value) : null;
  const count = value => Number.isFinite(value) ? Math.max(0, Math.min(1000000, Math.floor(value))) : 0;
  const timestamp = value => Number.isFinite(value) && value > 0 ? value : null;
  function redact(value) {
    if (globalThis.IKnowReaderDiagnosticHistory) return globalThis.IKnowReaderDiagnosticHistory.redact(value);
    return String(value || "").slice(0, 4000)
      .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/giu, "[URL]")
      .replace(/\b(?:[a-z]:[\\/]|\\\\)[^\r\n"<>|]*/giu, "[PATH]")
      .replace(/\/(?:Users|home|tmp|var|opt)\/[^\r\n"<>|]*/gu, "[PATH]")
      .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\r\n]*/giu, "[REDACTED]")
      .replace(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+/gu, "[TEXT]");
  }
  function safeTree(value, depth = 0) {
    if (depth > 12) return "[OMITTED]";
    if (typeof value === "string") return redact(value);
    if (typeof value === "boolean" || value === null) return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 256).map(item => safeTree(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 60)
      .filter(([key, item]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(key) && (!/^(?:path|source|text|sentence|words|data|request|token|password|secret|authorization|apiKey)$/i.test(key) || key === "source" && ["last_update_check", "retained_update_transaction", "public_github_metadata"].includes(item)))
      .map(([key, item]) => [key, safeTree(item, depth + 1)]));
    return null;
  }
  function record(component, value, courseId) {
    if (!["course-preparation", "word-audio", "word-preparation", "helper-connection"].includes(component)) return;
    const item = { component, code: code(value), courseId: identifier(courseId), at: Date.now() }, last = recent[recent.length - 1];
    if (last && last.component === item.component && last.code === item.code && last.courseId === item.courseId && item.at - last.at < 2000) return;
    recent.push(item); if (recent.length > 30) recent.shift();
    globalThis.IKnowReaderDiagnosticHistory?.record(component, "error", item, true);
  }
  function state(value) {
    return { courseId: identifier(value.courseId ?? value.id), status: code(value.status || "unknown"), stage: code(value.stage || "unknown"),
      code: value.code ? code(value.code) : null, completed: count(value.completed), total: count(value.total), updatedAt: timestamp(value.updatedAt),
      message: typeof value.message === "string" ? redact(value.message) : undefined,
      error: typeof value.error === "string" ? redact(value.error) : undefined,
      features: value.features ? Object.fromEntries(["german", "colors", "audio"].map(key => [key, value.features[key] === true])) : undefined,
      partial: value.partial === true, stageTotals: safeTree(value.stageTotals || {}), stageProgress: safeTree(value.stageProgress || {}), summary: safeTree(value.summary || {}) };
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
      const started = Date.now();
      timer = setTimeout(() => done({ status: "timeout", code: "diagnostics_timeout", durationMs: Date.now() - started }), 45000);
      try {
        port = chrome.runtime.connectNative(HOST);
        port.onMessage.addListener(message => {
          if (message?.type === "error" && message.code === "invalid_request" && (!message.requestId || message.requestId === requestId)) {
            done({ status: "unsupported", code: "diagnostics_unsupported" }); return;
          }
          if (message?.type !== "diagnostics-result" || message.requestId !== requestId) return;
          if (!message.ok || !message.report || message.report.schemaVersion !== 1 || Array.isArray(message.report) ||
              new TextEncoder().encode(JSON.stringify(message.report)).length > 768 * 1024) {
            done({ status: "error", code: "invalid_diagnostics_report" }); return;
          }
          const raw = message.report, selected = {};
          for (const key of ["schemaVersion", "diagnosticFormatVersion", "helperVersion", "platform", "capabilities", "setup", "logs", "jobs", "updates", "localChecks", "events", "checks", "application", "installation", "resources", "runtime", "registration", "integrity", "timeline", "history", "journal", "limits", "scope", "reportTruncated", "limitations", "collection"]) if (raw[key] !== undefined) selected[key] = raw[key];
          done({ status: "ready", durationMs: Date.now() - started, report: safeTree(selected) });
        });
        port.onDisconnect.addListener(() => { const reason = chrome.runtime.lastError?.message; done({ status: "missing", code: "helper_unavailable", message: reason ? redact(reason) : "The local helper disconnected.", durationMs: Date.now() - started }); });
        port.postMessage({ type: "diagnostics", requestId, extended: true });
      } catch (error) { done({ status: "missing", code: "helper_unavailable", message: redact(error?.message || "The local helper could not be started."), durationMs: Date.now() - started }); }
    });
  }
  async function inventory() {
    const result = { status: "ready", validation: "Stored record counts only; source validity is checked during normal preparation", courses: [] };
    try {
      if (chrome.storage.local.getBytesInUse) {
        result.totalBytes = await chrome.storage.local.getBytesInUse(null);
        result.coursePackBytes = await chrome.storage.local.getBytesInUse("iknowReaderCoursePacks");
        if (result.coursePackBytes > 64 * 1024 * 1024) return { ...result, status: "omitted", reason: "course_inventory_over_size_limit" };
      }
      const stored = (await chrome.storage.local.get("iknowReaderCoursePacks")).iknowReaderCoursePacks;
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return result;
      const entries = Object.entries(stored);
      result.totalCourses = entries.length; result.truncated = entries.length > 200;
      for (const [id, pack] of entries.slice(0, 200)) {
        if (!identifier(id) || !pack || typeof pack !== "object") continue;
        const alignments = pack.alignments && typeof pack.alignments === "object" ? Object.values(pack.alignments).slice(0, 10000) : [];
        result.courses.push({ courseId: id, words: count(pack.course?.wordCount), sentences: count(pack.course?.sentenceCount),
          germanWords: count(Object.keys(pack.germanItems || {}).length), germanSentences: alignments.filter(value => value?.german?.text).length,
          colorSentences: alignments.filter(value => value?.colorsReady === true || value?.groups?.length && value.colorsReady !== false).length,
          audioSentences: count(Object.keys(pack.audio || {}).length) });
      }
    } catch (error) { result.status = "unavailable"; result.message = redact(error?.message || "Storage inventory unavailable."); }
    return result;
  }
  async function helperWithFallback() {
    const current = await nativeSnapshot();
    try {
      if (current.status === "ready") {
        await chrome.storage.local.set({ [LAST_HELPER]: { capturedAt: Date.now(), report: current.report } });
      } else {
        const previous = (await chrome.storage.local.get(LAST_HELPER))[LAST_HELPER];
        if (previous?.report?.schemaVersion === 1 && Number.isFinite(previous.capturedAt) && new TextEncoder().encode(JSON.stringify(previous)).length <= 768 * 1024) {
          current.lastKnown = { capturedAt: previous.capturedAt, stale: true, report: safeTree(previous.report) };
        }
      }
    } catch { current.diagnosticCache = "unavailable"; }
    return current;
  }
  async function build({ states = [], queue = null, settings = {} } = {}) {
    const started = Date.now();
    let platform = null;
    try {
      const info = await chrome.runtime.getPlatformInfo?.();
      if (info) platform = { os: /^[a-z_]{1,30}$/i.test(info.os) ? info.os : "unknown", arch: /^[a-z0-9_-]{1,30}$/i.test(info.arch) ? info.arch : "unknown" };
    } catch { /* The rest of the report still works. */ }
    const chosen = {};
    for (const key of ["enabled", "alignmentMode", "colorMode", "translationLanguage", "groupInfo", "wordAudio", "audioFollow", "wordNeuralVoice", "wordAudioSpeed", "prepareGerman", "prepareColors", "prepareAudio"])
      if (["string", "boolean", "number"].includes(typeof settings[key])) chosen[key] = safeTree(settings[key]);
    const [helper, history, storage] = await Promise.all([helperWithFallback(), globalThis.IKnowReaderDiagnosticHistory?.snapshot(), inventory()]);
    const savedUpdate = (await chrome.storage.local.get("iknowReaderUpdateState").catch(() => ({}))).iknowReaderUpdateState;
    const manifest = chrome.runtime.getManifest();
    const report = { format: "iknow-reader-diagnostics", schemaVersion: 1, diagnosticFormatVersion: 2, createdAt: new Date().toISOString(),
      extension: { name: "iKnow! Reading Helper", version: manifest.version, id: chrome.runtime.id, platform,
        permissions: manifest.permissions || [], hostPermissions: manifest.host_permissions || [],
        browser: typeof navigator !== "undefined" ? { userAgent: redact(navigator.userAgent), language: navigator.language, online: navigator.onLine } : null }, settings: chosen,
      preparation: { courses: states.slice(0, 100).map(state), queue: queue ? {
        status: code(queue.status || "unknown"), stage: code(queue.stage || "unknown"), totalCourses: count(queue.totalCourses),
        processedCourses: count(queue.processedCourses), failedCourses: count(queue.failedCourses),
        seriesId: identifier(queue.seriesId), message: redact(queue.message), error: redact(queue.error), features: safeTree(queue.features),
        currentIndex: count(queue.currentIndex), completed: count(queue.completed), total: count(queue.total),
        progressFraction: Number.isFinite(queue.progressFraction) ? Math.min(1, Math.max(0, queue.progressFraction)) : null,
        etaSeconds: Number.isFinite(queue.etaSeconds) && queue.etaSeconds >= 0 ? Math.ceil(queue.etaSeconds) : null,
        etaScope: ["total", "measured"].includes(queue.etaScope) ? queue.etaScope : null,
        etaStages: (Array.isArray(queue.etaStages) ? queue.etaStages : []).filter(stage => ["language", "audio"].includes(stage)),
        unestimatedStages: (Array.isArray(queue.unestimatedStages) ? queue.unestimatedStages : []).filter(stage => ["language", "audio"].includes(stage)),
        timings: Object.fromEntries(Object.entries(queue.timings || {}).filter(([stage]) => ["language", "audio"].includes(stage)).map(([stage, sample]) => [stage, { units: count(sample?.units), milliseconds: Number.isFinite(sample?.milliseconds) ? Math.max(0, Math.min(604800000, Math.round(sample.milliseconds))) : 0 }])),
        courses: (Array.isArray(queue.courses) ? queue.courses : []).slice(0, 100).map(state)
      } : null }, recentErrors: { scope: "current-background-session", items: recent.map(item => ({ ...item })) },
      helper, history: history || { status: "unavailable" }, storage, updates: safeTree(savedUpdate || {}),
      collection: { durationMs: Date.now() - started, extendedRequested: true, helperAvailable: helper.status === "ready", helperExtended: helper.report?.diagnosticFormatVersion >= 2 },
      limitations: ["History begins after installing this diagnostic version; earlier unrecorded errors cannot be reconstructed.", "Missing, unavailable, skipped or truncated sections are marked explicitly.", "No raw translation caches, generated audio, model files or browsing history are included.", "Review the report before sharing it."] };
    if (new TextEncoder().encode(JSON.stringify(report)).length > 950 * 1024 && helper.lastKnown) {
      delete helper.lastKnown; helper.lastKnownOmitted = "combined_report_size_limit";
    }
    return { ok: true, report };
  }
  function exportReport(snapshot) {
    if (exporting) return exporting;
    exporting = build(snapshot).finally(() => { exporting = null; });
    return exporting;
  }
  globalThis.IKnowReaderDiagnostics = Object.freeze({ exportReport, record });
})();
