/* Local preparation bridge. Executable code and models never come from a course pack. */
"use strict";
importScripts("core.js", "course-packs.js", "data.js", "audio-data.js", "audio-source.js", "word-speech-source.js", "diagnostic-history.js", "diagnostics-background.js", "neural-speech-source.js", "word-voice-source.js", "components-source.js", "study-store.js", "changelog-background.js");
globalThis.IKnowReaderStudyStore?.listenBackground();

const AutoCore = globalThis.IKnowReaderCore;
const AutoPacks = globalThis.IKnowReaderPacks;
const HOST = "de.iknow.lesehilfe";
const MODEL_SERVICE_FAILURES = new Set(["model_not_installed", "model_start_failed", "model_start_timeout", "model_request_timeout", "model_connection_failed"]);
const states = new Map();
const clients = new Set();
const transfers = new Map();
const discardedTransfers = new Map();
const pendingAuto = new Map();
const QUEUE_KEY = "iknowReaderQueue";
let nativePort = null;
let nativeIdleTimer = null;
const nativeStopping = new Set();
let saveQueue = Promise.resolve();
let receiveQueue = Promise.resolve();
let seriesQueue = null, queueWrites = Promise.resolve(), queueControl = Promise.resolve();
let pumping = false, pumpGeneration = 0, sourceAbort = null, pumpingAutos = false;
const SOURCE_CACHE_KEY = "iknowReaderAvailabilitySources", SOURCE_TTL = 60 * 60 * 1000;
const SOURCE_CACHE_LIMIT = 4 * 1024 * 1024, SOURCE_CACHE_COURSES = 30;
const availabilitySources = new Map(), sourceRequests = new Map(), sourceWaiters = [];
let sourceActive = 0, sourceWrites = Promise.resolve();
const features = value => AutoCore.normalizeFeatures(value, false);
const selected = value => Object.values(features(value)).some(Boolean);
const ownPage = sender => sender?.id === chrome.runtime.id && (sender.url || "").startsWith(chrome.runtime.getURL(""));
function seriesIdFromUrl(value) {
  return AutoCore.courseListIdFromUrl(value);
}
function trustedQueue(sender, id = seriesQueue?.seriesId) {
  const actual = seriesIdFromUrl(sender?.url || sender?.tab?.url || "");
  return ownPage(sender) || (sender?.id === chrome.runtime.id && !!actual && (!id || actual === String(id)));
}

function courseId(value) { return /^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? String(value) : null; }
function trusted(sender, id) {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url || sender.tab?.url || "";
  if (url.startsWith(chrome.runtime.getURL(""))) return true;
  return AutoCore.courseIdFromUrl(url) === id;
}
function publicState(state) {
  const { source, sourceKey, expected, lastProgress, ...safe } = state || {};
  return { ...safe, features: features(safe.features) };
}
function publish(id, values) {
  const state = { ...(states.get(id) || {}), courseId: id, ...values, updatedAt: Date.now() };
  state.features = features(state.features);
  states.set(id, state);
  globalThis.IKnowReaderDiagnosticHistory?.state(state);
  if (values.status === "error") globalThis.IKnowReaderDiagnostics?.record("course-preparation", state.code || "preparation_failed", id);
  for (const client of clients) if (client.courseId === id) {
    try { client.port.postMessage({ type: "state", state: publicState(state) }); } catch { /* A closed tab is removed on disconnect. */ }
  }
  refreshNativeIdle();
  return state;
}
function refreshNativeIdle() {
  clearTimeout(nativeIdleTimer); nativeIdleTimer = null;
  if (!nativePort || seriesQueue?.status === "running" || pendingAuto.size || transfers.size ||
    [...states.values()].some(state => ["running", "connecting"].includes(state.status))) return;
  const port = nativePort;
  // A normal terminal leaves enough time for the host to write its status and
  // release its lock. Pause waits for the checkpoint/cleanup acknowledgement;
  // a stuck cancelled host still has a bounded lifetime after all work stops.
  nativeIdleTimer = setTimeout(() => {
    nativeIdleTimer = null;
    if (nativePort !== port || seriesQueue?.status === "running" || pendingAuto.size ||
      [...states.values()].some(state => ["running", "connecting"].includes(state.status))) return;
    nativePort = null; nativeStopping.clear(); transfers.clear(); discardedTransfers.clear();
    try { port.disconnect?.(); } catch { /* Already closed. */ }
  }, nativeStopping.size ? 10000 : 1000);
}
function cancelNative(id, requestId) {
  if (!nativePort) return;
  nativeStopping.add(requestId);
  try { nativePort.postMessage({ type: "cancel", courseId: id, requestId }); }
  catch { nativeStopping.delete(requestId); }
}
function preparationKey(source, mask) {
  return AutoCore.fingerprint(JSON.stringify((source.goal_items || []).map(entry => ({
    id: entry.item?.id, cue: entry.item?.cue, response: entry.item?.response, sound: entry.sound,
    sentences: (entry.sentences || []).map(sentence => ({ cue: sentence.cue, response: sentence.response, sound: sentence.sound }))
  })))) + ":" + AutoCore.featuresKey(features(mask));
}
function validSource(source, id) {
  return source && String(source.id) === id && source.cue_language?.split("-")[0] === "ja" &&
    Array.isArray(source.goal_items) && source.goal_items.length > 0 && source.goal_items.length <= 10000 &&
    new TextEncoder().encode(JSON.stringify(source)).length < 16 * 1024 * 1024;
}
function disconnectError(message) {
  const missing = /not found|not registered|forbidden|access.*denied|native messaging.*permission/i.test(message);
  for (const [id, state] of states) if (["running", "connecting"].includes(state.status)) publish(id, {
    status: "error", code: missing ? "helper_missing" : "helper_disconnected",
    message: missing ? "Set up the local helper once." : "Preparation was interrupted. You can resume it."
  });
}
function connectNative() {
  clearTimeout(nativeIdleTimer); nativeIdleTimer = null;
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(HOST);
  nativePort = port;
  port.onMessage.addListener(message => {
    if (nativePort !== port) return;
    // Validation failures belong to this request, never to the next course.
    // A bad checkpoint may be followed by a usable final result. It must not
    // advance the series while its native worker is still preparing the course.
    receiveQueue = receiveQueue.then(async () => {
      const transfer = transfers.get(message?.transferId);
      const interim = message?.interim === true || transfer?.interim === true;
      try { await receiveNative(message); }
      catch (error) {
        globalThis.IKnowReaderDiagnosticHistory?.exception("course-preparation", error, { courseId: courseId(message?.courseId), code: "native_result_rejected" });
        const id = courseId(message?.courseId);
        const state = states.get(id);
        if (message?.transferId) {
          transfers.delete(message.transferId);
          if (interim && message.type !== "result-end") {
            if (discardedTransfers.size >= 100) discardedTransfers.delete(discardedTransfers.keys().next().value);
            discardedTransfers.set(message.transferId, message.requestId);
          }
        }
        if (id && message.requestId === state?.requestId && !["error", "complete", "cancelled"].includes(state.status)) {
          if (interim && error?.code !== "storage_failed") {
            globalThis.IKnowReaderDiagnostics?.record("course-preparation", "invalid_checkpoint", id);
            return;
          }
          cancelNative(id, state.requestId);
          const storageFailed = error?.code === "storage_failed";
          publish(id, { status: "error", code: storageFailed ? "storage_failed" : "invalid_result", message: storageFailed ? "Local storage could not be updated. Check free space and retry. Completed helper data is kept." : "Course data could not be saved. Completed sentences remain available." });
          if (storageFailed && seriesQueue?.status === "running") await pauseQueue(states.get(id).message, true);
          else await failQueueCourse(id, states.get(id).message);
          void pumpAutos();
        }
      }
    }).catch(() => { /* A failed storage write must not poison subsequent native messages. */ });
  });
  port.onDisconnect.addListener(() => {
    if (nativePort !== port) return;
    const reason = chrome.runtime.lastError?.message || "Native helper disconnected";
    globalThis.IKnowReaderDiagnosticHistory?.record("helper-connection", "disconnected", { code: "helper_disconnected", message: reason }, true);
    nativePort = null; nativeStopping.clear(); clearTimeout(nativeIdleTimer); nativeIdleTimer = null;
    transfers.clear(); discardedTransfers.clear();
    disconnectError(reason);
    if (seriesQueue?.status === "running") void pauseQueue(reason, true);
  });
  return port;
}
function validExpected(expected, source) {
  if (!expected?.items || !expected?.sentences) return false;
  const items = new Set(source.goal_items.map(entry => String(entry.item?.id)));
  const sentences = new Set(source.goal_items.flatMap(entry => (entry.sentences || []).map(sentence => String(sentence.cue?.id))));
  if (Object.keys(expected.items).length !== items.size || Object.keys(expected.sentences).length !== sentences.size) return false;
  for (const id of items) if (!/^[a-f0-9]{8}$/.test(expected.items[id] || "")) return false;
  for (const id of sentences) {
    const entry = expected.sentences[id];
    if (!entry || !/^[a-f0-9]{8}$/.test(entry.signature || "") || !Number.isInteger(entry.jaLength) || !Number.isInteger(entry.enLength) || !Number.isInteger(entry.tokens) || entry.tokens < 0) return false;
  }
  return true;
}
function checkExpected(pack, expected, allowSubset = false, mask = features()) {
  if (pack.course.wordCount !== Object.keys(expected.items).length || pack.course.sentenceCount !== Object.keys(expected.sentences).length) throw new Error("Unexpected course size");
  if (mask.german && !allowSubset && (Object.keys(pack.germanItems).length !== Object.keys(expected.items).length || Object.values(pack.alignments).filter(value => value.german?.text).length !== Object.keys(expected.sentences).length)) throw new Error("Incomplete translations");
  for (const [id, value] of Object.entries(pack.germanItems)) if (value.signature !== expected.items[id]) throw new Error("Stale word");
  for (const [id, value] of Object.entries(pack.alignments)) {
    const entry = expected.sentences[id];
    if (!entry || value.signature !== entry.signature || !AutoCore.validGroupRanges(value.groups, { ja: entry.jaLength, en: entry.enLength }, entry.tokens)) throw new Error("Stale sentence");
    // A sentence can be shared by several vocabulary entries. Its translation
    // is independently valid even before those separate word meanings arrive.
  }
  if (mask.german && !allowSubset && expected.orphans?.some(id => !pack.germanItems[id])) throw new Error("Missing word");
  for (const [id, value] of Object.entries(pack.audio)) {
    const entry = expected.sentences[id];
    if (!entry || value.signature !== entry.signature || value.audioPath !== entry.audioPath || value.tokens.some(token => (token.indices || [token.index]).some(index => index >= entry.tokens) || token.ja.some(([a, b]) => b > entry.jaLength))) throw new Error("Stale audio");
  }
}
function resultSummary(summary, pack, mask = features(), source) {
  const measured = source ? AutoCore.completeness({ alignments: pack.alignments, germanItems: pack.germanItems }, { sentences: pack.audio }, source, mask) : null;
  const counts = { sentences: pack.course.sentenceCount, translated: Object.values(pack.alignments).filter(value => value.german).length,
    features: features(mask), translationExcluded: mask.german ? measured?.missing.german ?? pack.course.sentenceCount - Object.values(pack.alignments).filter(value => value.german).length : 0,
    wordExcluded: mask.german ? measured?.missing.words ?? pack.course.wordCount - Object.keys(pack.germanItems).length : 0,
    audioAccepted: Object.keys(pack.audio).length, audioExcluded: mask.audio ? measured?.missing.audio ?? Math.max(0, pack.course.sentenceCount - Object.keys(pack.audio).length) : 0,
    groupsExcluded: mask.colors ? measured?.missing.colors ?? Object.values(pack.alignments).filter(value => value.colorsReady === false || (mask.german && value.germanColorsReady === false)).length : 0 };
  return counts;
}
function combineCourse(previous, incoming, expected) {
  if (!previous || !expected) return incoming;
  const germanItems = Object.fromEntries(Object.entries(previous.germanItems).filter(([id, value]) => expected.items[id] === value.signature));
  Object.assign(germanItems, incoming.germanItems);
  const alignments = Object.fromEntries(Object.entries(previous.alignments).filter(([id, value]) => {
    const target = expected.sentences[id];
    return target && target.signature === value.signature && AutoCore.validGroupRanges(value.groups, { ja: target.jaLength, en: target.enLength }, target.tokens);
  }));
  for (const [id, record] of Object.entries(incoming.alignments)) alignments[id] = AutoPacks.mergeAlignment(alignments[id], record);
  const audio = Object.fromEntries(Object.entries(previous.audio).filter(([id, value]) => {
    const target = expected.sentences[id];
    return target && value.signature === target.signature && value.audioPath === target.audioPath && value.tokens.every(token => (token.indices || [token.index]).every(index => index < target.tokens) && token.ja.every(([a, b]) => b <= target.jaLength));
  }));
  Object.assign(audio, incoming.audio);
  return AutoPacks.validate({ ...incoming, germanItems, alignments, audio });
}
async function saveResult(id, candidate, { expected, requestId, summary, interim = false } = {}) {
  const mask = features(states.get(id)?.features), source = states.get(id)?.source;
  let pack = AutoPacks.validate(candidate);
  if (String(pack.course.id) !== id) throw new Error("Wrong course");
  const missing = pack.course.sentenceCount - Object.values(pack.alignments).filter(value => value.german?.text).length;
  const missingWords = pack.course.wordCount - Object.keys(pack.germanItems).length;
  const incompleteFinal = !interim && mask.german && (missing > 0 || missingWords > 0) && summary?.translationExcluded === missing && summary?.wordExcluded === missingWords;
  if (expected) checkExpected(pack, expected, interim || incompleteFinal, mask);
  const task = saveQueue.then(async () => {
    if (requestId && states.get(id)?.requestId !== requestId) return;
    if (requestId && ["error", "complete"].includes(states.get(id)?.status)) return;
    const storageFailure = () => { const error = new Error("Local course storage could not be updated."); error.code = "storage_failed"; throw error; };
    const stored = await chrome.storage.local.get(AutoPacks.STORAGE_KEY).catch(storageFailure);
    const raw = stored[AutoPacks.STORAGE_KEY];
    const existing = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    let previous;
    try { if (existing[id]) previous = AutoPacks.validate(existing[id]); } catch { /* Replace this course's invalid old data only. */ }
    pack = combineCourse(previous, pack, expected);
    if (expected) checkExpected(pack, expected, true, mask);
    const next = { ...existing, [id]: pack };
    // Do not revalidate every other saved course or broadcast unchanged data
    // for a repeated checkpoint. Readers validate the courses they consume.
    if (JSON.stringify(existing[id]) !== JSON.stringify(pack)) await chrome.storage.local.set({ [AutoPacks.STORAGE_KEY]: next }).catch(storageFailure);
  });
  saveQueue = task.catch(() => {});
  await task;
  if (requestId && states.get(id)?.requestId !== requestId) return;
  if (requestId && ["error", "complete"].includes(states.get(id)?.status)) return;
  if (interim || states.get(id)?.status === "cancelled") {
    // Paused/error states retain their status while already finished data saves.
    publish(id, { summary: resultSummary(summary, pack, mask, source) });
    await updateQueueFromState(id);
    return;
  }
  if (requestId) nativeStopping.add(requestId);
  publish(id, { status: "complete", stage: "done", completed: pack.course.sentenceCount,
    total: pack.course.sentenceCount, summary: resultSummary(summary, pack, mask, source), code: "", message: "Preparation saved." });
  await finishQueueCourse(id, states.get(id).summary);
  void pumpAutos();
}
async function receiveNative(message) {
  const id = courseId(message?.courseId);
  if (!id || !states.has(id)) return;
  const current = states.get(id);
  if (message.type === "error" || message.type === "progress" && ["cancelled", "complete", "error"].includes(message.status)) {
    nativeStopping.delete(message.requestId); refreshNativeIdle();
  }
  if (typeof message.requestId !== "string" || message.requestId !== current.requestId) return;
  if (discardedTransfers.get(message.transferId) === current.requestId) {
    if (message.type === "result-end") discardedTransfers.delete(message.transferId);
    return;
  }
  // A rejected or finished request is a tombstone. Late progress/results from
  // it cannot resurrect a job after the series has moved to another course.
  if (["error", "complete"].includes(current.status)) return;
  if (current.status === "cancelled" && !(message.type === "result" && message.interim === true) && !message.type.startsWith("result-")) return;
  if (message.type === "progress") {
    // A late native completion must never replace the already saved result.
    if (message.status === "complete") return;
    const status = ["running", "cancelled", "error", "complete"].includes(message.status) ? message.status : "running";
    if (states.get(id)?.status === "cancelled" && status === "running") return;
    // Completion is confirmed only after the validated pack has been saved.
    publish(id, { status: status === "complete" ? "running" : status,
      stage: String(message.stage || "language").slice(0, 32),
      completed: Number.isFinite(message.completed) ? Math.max(0, message.completed) : 0,
      total: Number.isFinite(message.total) ? Math.max(0, message.total) : 0,
      message: typeof message.message === "string" ? message.message.slice(0, 500) : "", code: status === "error" ? String(message.code || "preparation_failed").slice(0, 100) : status === "cancelled" && message.code === "network_unavailable" ? "network_unavailable" : "" });
    await updateQueueFromState(id);
    if (status === "cancelled") {
      if (seriesQueue?.status === "running" && seriesQueue.courses[seriesQueue.currentIndex]?.id === id && current.fromQueue) await pauseQueue(message.code === "network_unavailable" ? states.get(id).message : undefined);
      void pumpAutos();
    } else if (status === "error") {
      await handleQueueFailure(id); void pumpAutos();
    }
  } else if (message.type === "result") await saveResult(id, message.pack, { expected: current.expected, requestId: current.requestId, summary: message.summary, interim: message.interim === true || current.status === "cancelled" });
  else if (message.type === "error") {
    publish(id, { status: "error", code: String(message.code || "preparation_failed").slice(0, 100), message: String(message.message || "Preparation could not be completed.").slice(0, 500) });
    await updateQueueFromState(id);
    await handleQueueFailure(id);
    void pumpAutos();
  }
  else if (message.type === "result-start") {
    if (typeof message.transferId !== "string" || !Number.isInteger(message.totalChunks) || message.totalChunks < 1 || message.totalChunks > 100 || !Number.isInteger(message.bytes) || message.bytes < 1 || message.bytes > AutoPacks.MAX_BYTES) throw new Error("Invalid transfer");
    transfers.set(message.transferId, { courseId: id, requestId: current.requestId, summary: message.summary, interim: message.interim === true, bytes: message.bytes, chunks: Array(message.totalChunks).fill(undefined), received: 0 });
  } else if (message.type === "result-chunk") {
    const transfer = transfers.get(message.transferId);
    if (!transfer || transfer.courseId !== id || !Number.isInteger(message.index) || message.index < 0 || message.index >= transfer.chunks.length || typeof message.data !== "string" || message.data.length > 800000 || transfer.chunks[message.index] !== undefined) throw new Error("Invalid chunk");
    transfer.received += new TextEncoder().encode(message.data).length;
    if (transfer.received > AutoPacks.MAX_BYTES) { transfers.delete(message.transferId); throw new Error("Transfer too large"); }
    transfer.chunks[message.index] = message.data;
  } else if (message.type === "result-end") {
    const transfer = transfers.get(message.transferId); transfers.delete(message.transferId);
    if (!transfer || transfer.courseId !== id || Array.from(transfer.chunks).some(chunk => chunk === undefined)) throw new Error("Incomplete transfer");
    const json = transfer.chunks.join("");
    if (new TextEncoder().encode(json).length !== transfer.bytes) throw new Error("Wrong transfer length");
    await saveResult(id, JSON.parse(json), { expected: current.expected, requestId: current.requestId, summary: message.summary || transfer.summary, interim: transfer.interim || current.status === "cancelled" });
  }
}
async function command(message, sender) {
  const id = courseId(message?.courseId);
  if (!id || !trusted(sender, id)) throw new Error("Unsupported page");
  if (message.type === "ikr:auto:setup") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("helper-setup.html") });
    return { ok: true };
  }
  if (message.type === "ikr:auto:import") {
    if (!(sender.url || "").startsWith(chrome.runtime.getURL(""))) throw new Error("Import requires extension page");
    await saveResult(id, message.pack);
    return { ok: true };
  }
  if (message.type === "ikr:auto:status") return { ok: true, state: publicState(states.get(id) || { courseId: id, status: "idle" }) };
  if (message.type === "ikr:auto:cancel") {
    const current = states.get(id);
    if (current && ["running", "connecting"].includes(current.status)) {
      cancelNative(id, current.requestId);
      publish(id, { status: "cancelled", message: "Preparation paused." });
      if (seriesQueue?.status === "running" && seriesQueue.courses[seriesQueue.currentIndex]?.id === id) await pauseQueue();
    }
    if (pendingAuto.delete(id)) publish(id, { status: "cancelled", message: "Queued preparation cancelled." });
    void pumpAutos();
    return { ok: true };
  }
  if (message.type !== "ikr:auto:start" || !validSource(message.source, id) || !validExpected(message.expected, message.source)) throw new Error("Invalid course");
  // A stale content script from an earlier release must not start a job merely
  // because its course was opened. Only the explicit course action sends this.
  if (message.manual !== true) throw new Error("Choose additions and start preparation on the course page.");
  if (globalThis.IKnowReaderUpdates?.busy || globalThis.IKnowReaderComponents?.busy) throw new Error("An update or model installation is in progress. Try again when it finishes.");
  const mask = features(message.features);
  if (!selected(mask)) return { ok: true, state: publicState(states.get(id) || publish(id, { status: "idle", features: mask, summary: null, message: "Romaji is available immediately." })) };
  const key = preparationKey(message.source, mask), previous = states.get(id);
  if (previous?.sourceKey === key && (["running", "connecting"].includes(previous.status) || (previous.status === "complete" && !message.force))) return { ok: true, state: publicState(previous) };
  if (seriesQueue?.status === "running" || [...states.values()].some(state => ["running", "connecting"].includes(state.status))) {
    pendingAuto.set(id, { source: message.source, features: mask, force: message.force === true });
    if (previous?.fromQueue && ["running", "connecting"].includes(previous.status)) return { ok: true, state: { courseId: id, status: "queued", code: "queue_active", features: mask, message: "Your selection will run after the series preparation." } };
    const state = publish(id, { status: "queued", code: "queue_active", features: mask, message: "Your preparation is queued." });
    return { ok: true, state: publicState(state) };
  }
  startNative(id, message.source, mask, message.force === true);
  return { ok: true, state: publicState(states.get(id)) };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const type = String(message?.type || "");
  if (type === "ikr:diagnostics:page-error") {
    const url = sender?.url || sender?.tab?.url || "", id = AutoCore.courseIdFromUrl(url), seriesId = AutoCore.courseListIdFromUrl(url);
    if (sender?.id !== chrome.runtime.id || !(ownPage(sender) || id || seriesId)) { respond({ ok: false }); return; }
    globalThis.IKnowReaderDiagnosticHistory?.record("extension-page", "exception", {
      courseId: id, seriesId, errorType: message.errorType, frames: message.frames,
      code: "uncaught_project_error", message: "An extension-owned script raised an unhandled error. See the project frames."
    }, true);
    respond({ ok: true }); return;
  }
  if (type === "ikr:diagnostics:export") {
    let allowed = false;
    try { allowed = ownPage(sender) && new URL(sender.url).pathname === "/diagnostics.html"; } catch { /* Invalid sender URL. */ }
    if (!allowed) { respond({ ok: false, code: "diagnostics_forbidden" }); return; }
    void chrome.storage.local.get(AutoCore.STORAGE_KEY).then(stored => globalThis.IKnowReaderDiagnostics.exportReport({
      states: [...states.values()], queue: seriesQueue, settings: AutoCore.normalizeSettings(stored[AutoCore.STORAGE_KEY])
    })).then(respond, () => respond({ ok: false, code: "diagnostics_failed" }));
    return true;
  }
  if (!type.startsWith("ikr:auto:") && !type.startsWith("ikr:queue:")) return;
  const operation = queueReady.then(() => {
    if (!type.startsWith("ikr:queue:")) return command(message, sender);
    if (type === "ikr:queue:availability") return availabilityCommand(message, sender);
    const task = queueControl.then(() => queueCommand(message, sender));
    queueControl = task.catch(() => {}); return task;
  });
  void operation.then(respond, error => respond({ ok: false, error: String(error?.message || "Preparation is not available on this page.").slice(0, 300) }));
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "ikr:auto") return;
  const client = { port, courseId: null }; clients.add(client);
  port.onMessage.addListener(message => {
    const id = courseId(message?.courseId);
    if (message?.type !== "subscribe" || !id || !trusted(port.sender, id)) return;
    client.courseId = id;
    port.postMessage({ type: "state", state: publicState(states.get(id) || { courseId: id, status: "idle" }) });
  });
  port.onDisconnect.addListener(() => clients.delete(client));
});

function startNative(id, source, mask, force = false, fromQueue = false) {
  const requestId = crypto.randomUUID(), expected = AutoCore.expectedSource(source);
  publish(id, { status: "connecting", stage: "model", completed: 0, total: 0, code: "", summary: null, features: mask,
    source, sourceKey: preparationKey(source, mask), expected, requestId, fromQueue, lastProgress: null, message: "Starting preparation…" });
  try { connectNative().postMessage({ type: "prepare", courseId: id, requestId, source, features: mask, force }); }
  catch {
    publish(id, { status: "error", code: "helper_missing", message: "Set up the local helper once." });
    if (fromQueue) void pauseQueue("Set up the local helper once.", true);
  }
}
function publicQueue() { return seriesQueue ? structuredClone(seriesQueue) : null; }
function persistQueue() {
  globalThis.IKnowReaderDiagnosticHistory?.queue(seriesQueue);
  if (!seriesQueue) return Promise.resolve();
  seriesQueue.updatedAt = Date.now();
  const snapshot = publicQueue();
  const task = queueWrites.then(() => chrome.storage.local.set({ [QUEUE_KEY]: snapshot }));
  queueWrites = task.catch(() => {});
  return task;
}
function queueStages(queue = seriesQueue) {
  return [...(queue?.features.german || queue?.features.colors ? ["language"] : []), ...(queue?.features.audio ? ["audio"] : [])];
}
function queueStageTotal(course, stage, queue = seriesQueue) {
  const exact = course.stageTotals?.[stage];
  if (Number.isFinite(exact) && exact >= 0) return exact;
  return course.sentenceCount || queue?.typicalSize || null;
}
function queueStageCompleted(course, stage, queue = seriesQueue) {
  const total = queueStageTotal(course, stage, queue);
  if (total === null) return 0;
  if (["complete", "skipped", "error"].includes(course.status)) return total;
  const record = course.stageProgress?.[stage];
  return Math.max(0, Math.min(total, Number.isFinite(record?.completed) ? record.completed : 0));
}
function recalculateQueue() {
  if (!seriesQueue) return;
  const q = seriesQueue;
  q.totalCourses = q.courses.length;
  q.processedCourses = q.courses.filter(course => ["complete", "skipped", "error"].includes(course.status)).length;
  q.skippedCourses = q.courses.filter(course => course.status === "skipped").length;
  q.failedCourses = q.courses.filter(course => course.status === "error" || course.partial).length;
  q.completedCourses = q.courses.filter(course => ["complete", "skipped"].includes(course.status)).length;
  const stages = queueStages(q);
  // Each selected course/phase contributes one share. Sentence events advance
  // the current share immediately; a course need not finish before the bar moves.
  // Errors are processed work, not successful saves (failedCourses stays separate).
  q.progressFraction = q.courses.reduce((sum, course) => {
    if (["complete", "skipped", "error"].includes(course.status)) return sum + 1;
    const fraction = stages.reduce((done, stage) => {
      const total = queueStageTotal(course, stage, q);
      return done + (total === 0 ? 1 : total ? queueStageCompleted(course, stage, q) / total : 0);
    }, 0) / Math.max(1, stages.length);
    return sum + fraction;
  }, 0) / Math.max(1, q.courses.length);
  q.progressFraction = Math.max(0, Math.min(1, q.progressFraction));
  q.etaSeconds = null; q.etaScope = null; q.etaStages = []; q.unestimatedStages = [];
  if (q.status !== "running") return;
  let milliseconds = 0;
  const remaining = Object.fromEntries(stages.map(stage => [stage, 0]));
  const unknown = new Set();
  for (let index = q.currentIndex; index < q.courses.length; index++) {
    const course = q.courses[index];
    if (["complete", "skipped", "error"].includes(course.status)) continue;
    for (const stage of stages) {
      const total = queueStageTotal(course, stage, q);
      if (total === null) { unknown.add(stage); continue; }
      remaining[stage] += Math.max(0, total - queueStageCompleted(course, stage, q));
    }
  }
  for (const stage of stages) {
    if (!remaining[stage] && !unknown.has(stage)) continue;
    const sample = q.timings?.[stage];
    if (unknown.has(stage) || !Number.isFinite(sample?.units) || sample.units < 3 || !Number.isFinite(sample?.milliseconds) || sample.milliseconds <= 0) {
      q.unestimatedStages.push(stage); continue;
    }
    q.etaStages.push(stage);
    milliseconds += remaining[stage] * sample.milliseconds / sample.units;
  }
  // An unsampled future audio phase does not erase the useful measured language
  // estimate. The UI labels this as a partial estimate until all rates are known.
  if (q.etaStages.length) {
    q.etaSeconds = Math.ceil(milliseconds / 1000);
    q.etaScope = q.unestimatedStages.length ? "measured" : "total";
  }
}
async function updateQueueFromState(id) {
  const q = seriesQueue, state = states.get(id);
  if (!q || q.status !== "running" || q.courses[q.currentIndex]?.id !== id || !state?.fromQueue) return;
  const course = q.courses[q.currentIndex];
  const now = Date.now(), previous = state.lastProgress;
  if (["language", "audio"].includes(state.stage)) {
    if (previous?.stage === state.stage && state.completed > previous.completed) {
      const duration = now - previous.at, delta = state.completed - previous.completed;
      // Large jumps are restored checkpoints, not a measured processing rate.
      if (duration >= 150 && duration <= 300000 && delta <= 4) {
        const sample = q.timings[state.stage] || { milliseconds: 0, units: 0 };
        sample.milliseconds += duration; sample.units += delta; q.timings[state.stage] = sample;
      }
    }
    if (!previous || previous.stage !== state.stage || state.completed !== previous.completed) state.lastProgress = { stage: state.stage, completed: state.completed, at: now };
    course.stageProgress ||= {};
    course.stageTotals ||= {};
    course.stageTotals[state.stage] = state.total || queueStageTotal(course, state.stage, q);
    course.stageProgress[state.stage] = { completed: Math.max(course.stageProgress[state.stage]?.completed || 0, state.completed || 0), total: state.total || 0 };
    if (state.stage === "audio" && queueStages(q).includes("language")) {
      const total = queueStageTotal(course, "language", q);
      if (total !== null) course.stageProgress.language = { completed: total, total };
    }
  }
  Object.assign(course, { stage: state.stage, completed: state.completed || 0, total: state.total || 0,
    updatedAt: now, code: state.code || "", message: state.message });
  Object.assign(q, { stage: state.stage, completed: state.completed || 0, total: state.total || 0, message: state.message, summary: state.summary });
  recalculateQueue(); await persistQueue();
}
async function finishQueueCourse(id, summary) {
  const q = seriesQueue;
  if (!q || q.status !== "running" || q.courses[q.currentIndex]?.id !== id || !states.get(id)?.fromQueue) return;
  const course = q.courses[q.currentIndex];
  course.status = "complete"; course.summary = summary;
  Object.assign(course, { stage: "done", completed: course.sentenceCount || q.total || 0,
    total: course.sentenceCount || q.total || 0, updatedAt: Date.now() });
  course.partial = ["translationExcluded", "wordExcluded", "audioExcluded", "groupsExcluded"].some(key => summary?.[key] > 0);
  q.currentIndex++; q.stage = "model"; q.completed = 0; q.total = 0;
  recalculateQueue(); await persistQueue(); void pumpQueue();
}
async function failQueueCourse(id, message) {
  if (seriesQueue?.status !== "running" || seriesQueue.courses[seriesQueue.currentIndex]?.id !== id || !states.get(id)?.fromQueue) return;
  seriesQueue.courses[seriesQueue.currentIndex].status = "error";
  seriesQueue.courses[seriesQueue.currentIndex].error = String(message).slice(0, 300);
  Object.assign(seriesQueue.courses[seriesQueue.currentIndex], { code: states.get(id)?.code || "preparation_failed", updatedAt: Date.now() });
  seriesQueue.currentIndex++; recalculateQueue(); await persistQueue(); void pumpQueue();
}
async function handleQueueFailure(id) {
  const state = states.get(id);
  if (MODEL_SERVICE_FAILURES.has(state?.code) && state?.fromQueue && seriesQueue?.status === "running" && seriesQueue.courses[seriesQueue.currentIndex]?.id === id) {
    // A failed shared model is not a defect in every remaining course. Keep
    // this course and its checkpoint in place for an explicit resume.
    await pauseQueue(state.message, true);
    return;
  }
  await failQueueCourse(id, state?.message);
}
async function pauseQueue(message = "Preparation paused. Completed data is kept.", error = false) {
  const q = seriesQueue;
  if (!q || q.status !== "running") return;
  pumpGeneration++; sourceAbort?.abort(); sourceAbort = null;
  const id = q.courses[q.currentIndex]?.id, state = states.get(id);
  q.status = error ? "error" : "paused"; q.error = error ? String(message).slice(0, 300) : ""; q.message = message;
  if (id && state?.fromQueue && ["running", "connecting"].includes(state.status)) {
    cancelNative(id, state.requestId);
    publish(id, { status: "cancelled", message: "Preparation paused." });
  }
  if (q.courses[q.currentIndex]?.status === "running") q.courses[q.currentIndex].status = "pending";
  recalculateQueue(); await persistQueue();
}
async function fetchSource(id, signal) {
  let response;
  try { response = await fetch(`https://iknow.jp/api/v2/goals/${id}`, { signal, credentials: "include" }); }
  catch {
    const error = new Error("Course data could not be downloaded. Check your internet connection, then resume preparation. Saved additions are kept.");
    error.code = "source_network_unavailable";
    throw error;
  }
  if (!response.ok) throw new Error(`Course data is unavailable (${response.status}).`);
  if (Number(response.headers.get("content-length")) > 16 * 1024 * 1024) throw new Error("Course data is too large.");
  let text;
  try { text = await response.text(); }
  catch {
    const error = new Error("The course download was interrupted. Check your internet connection, then resume preparation. Saved additions are kept.");
    error.code = "source_network_unavailable";
    throw error;
  }
  if (new TextEncoder().encode(text).length > 16 * 1024 * 1024) throw new Error("Course data is too large.");
  const source = JSON.parse(text);
  if (!validSource(source, id)) throw new Error("This course does not contain supported Japanese data.");
  return source;
}
function compactAvailabilitySource(source) {
  return {
    id: source.id, cue_language: source.cue_language, response_language: source.response_language,
    title: String(source.title || "").slice(0, 1000),
    goal_items: source.goal_items.map(entry => ({
      item: { id: entry.item?.id, cue: { text: entry.item?.cue?.text }, response: { text: entry.item?.response?.text } },
      sentences: (entry.sentences || []).map(sentence => ({
        cue: { id: sentence.cue?.id, text: sentence.cue?.text, transliterations: { Hrkt: sentence.cue?.transliterations?.Hrkt, Latn: sentence.cue?.transliterations?.Latn } },
        response: { text: sentence.response?.text }, sound: sentence.sound
      }))
    }))
  };
}
function pruneSourceCache() {
  let bytes = 0, count = 0;
  for (const [id, entry] of [...availabilitySources].sort((a, b) => b[1].at - a[1].at)) {
    const size = new TextEncoder().encode(JSON.stringify(entry)).length;
    if (count >= SOURCE_CACHE_COURSES || bytes + size > SOURCE_CACHE_LIMIT) availabilitySources.delete(id);
    else { bytes += size; count++; }
  }
}
const sourceCacheReady = chrome.storage.local.get(SOURCE_CACHE_KEY).then(stored => {
  const cache = stored[SOURCE_CACHE_KEY];
  if (cache?.schemaVersion !== 1 || !cache.entries || typeof cache.entries !== "object" || Array.isArray(cache.entries)) return;
  for (const [id, entry] of Object.entries(cache.entries).slice(0, SOURCE_CACHE_COURSES)) {
    if (courseId(id) && Number.isFinite(entry?.at) && entry.at > 0 && entry.at <= Date.now() + 60000 && validSource(entry.source, id)) availabilitySources.set(id, { at: entry.at, source: compactAvailabilitySource(entry.source) });
  }
  pruneSourceCache();
}).catch(() => {});
function persistSourceCache() {
  const task = sourceWrites.then(() => {
    pruneSourceCache();
    return chrome.storage.local.set({ [SOURCE_CACHE_KEY]: { schemaVersion: 1, entries: Object.fromEntries(availabilitySources) } });
  });
  sourceWrites = task.catch(() => {});
  return task;
}
async function sourceSlot(operation) {
  if (sourceActive >= 3) await new Promise(resolve => sourceWaiters.push(resolve));
  else sourceActive++;
  try { return await operation(); }
  finally { const next = sourceWaiters.shift(); if (next) next(); else sourceActive--; }
}
async function availabilitySource(id, refresh = false) {
  await sourceCacheReady;
  const cached = availabilitySources.get(id);
  if (sourceRequests.has(id)) return sourceRequests.get(id);
  if (!refresh && cached && Date.now() - cached.at < SOURCE_TTL) return { ...cached, cached: true, stale: false };
  const request = sourceSlot(async () => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const source = compactAvailabilitySource(await fetchSource(id, controller.signal));
      const result = { source, at: Date.now() };
      availabilitySources.set(id, result);
      // A storage error must not turn a successful source check into "not saved".
      await persistSourceCache().catch(() => {});
      return { ...result, cached: false, stale: false };
    } catch (error) {
      if (cached) return { ...cached, cached: true, stale: true, warning: "Using the last checked course data while iKnow is unavailable." };
      throw new Error(error?.name === "AbortError" ? "Course data check timed out. Try again." : String(error?.message || "Course data could not be checked."));
    } finally { clearTimeout(timeout); }
  });
  sourceRequests.set(id, request);
  try { return await request; } finally { if (sourceRequests.get(id) === request) sourceRequests.delete(id); }
}
async function availabilityCommand(message, sender) {
  const senderUrl = sender?.url || sender?.tab?.url || "";
  if (!ownPage(sender) && !(sender?.id === chrome.runtime.id && (seriesIdFromUrl(senderUrl) || AutoCore.courseIdFromUrl(senderUrl)))) throw new Error("Saved course data can only be checked from iKnow or this extension.");
  if (!Array.isArray(message.courses) || !message.courses.length || message.courses.length > 100) throw new Error("Choose up to 100 courses to check.");
  const ids = [...new Set(message.courses.map(course => courseId(course?.id)))];
  if (ids.includes(null)) throw new Error("Invalid course ID.");
  const canReport = typeof message.requestId === "string" && /^saved-check-[a-z0-9-]{1,80}$/.test(message.requestId) &&
    Number.isInteger(sender?.tab?.id) && sender.tab.id >= 0 && typeof chrome.tabs?.sendMessage === "function";
  const target = typeof sender?.documentId === "string" && sender.documentId ? { documentId: sender.documentId } :
    Number.isInteger(sender?.frameId) && sender.frameId >= 0 ? { frameId: sender.frameId } : undefined;
  let progressSnapshot;
  const resultFor = (merged, entry) => ({ ...AutoCore.courseAvailability(merged.data, merged.audio, entry.source),
    checkedAt: entry.at, cached: entry.cached, stale: entry.stale, ...(entry.warning ? { warning: entry.warning } : {}) });
  async function reportProgress(id, entry) {
    if (!canReport) return;
    try {
      let availability = null;
      if (!entry.error) {
        // A whole saved-pack merge is shared by this check's progress events.
        // The final response below still reads current packs after all sources.
        progressSnapshot ||= chrome.storage.local.get(AutoPacks.STORAGE_KEY).then(stored =>
          AutoPacks.merge(globalThis.IKnowReaderData, globalThis.IKnowReaderAudioData, stored[AutoPacks.STORAGE_KEY]));
        availability = resultFor(await progressSnapshot, entry);
      }
      const update = { type: "ikr:queue:availability:progress", requestId: message.requestId, courseId: id,
        availability, error: entry.error || "" };
      // A closed/navigated document or slow listener must not delay the check.
      void Promise.resolve(chrome.tabs.sendMessage(sender.tab.id, update, target)).catch(() => {});
    } catch { /* Progress is optional; final checked results remain authoritative. */ }
  }
  const sources = await Promise.all(ids.map(async id => {
    let entry;
    try { entry = await availabilitySource(id, message.refresh === true); }
    catch (error) { entry = { error: String(error?.message || "Saved data could not be checked.").slice(0, 300) }; }
    await reportProgress(id, entry);
    return [id, entry];
  }));
  // Re-read packs after source checks so results include the latest partial saves.
  const stored = await chrome.storage.local.get(AutoPacks.STORAGE_KEY);
  const merged = AutoPacks.merge(globalThis.IKnowReaderData, globalThis.IKnowReaderAudioData, stored[AutoPacks.STORAGE_KEY]);
  const availability = {}, errors = {};
  for (const [id, entry] of sources) {
    if (entry.error) { errors[id] = entry.error; continue; }
    availability[id] = resultFor(merged, entry);
  }
  return { ok: true, availability, errors };
}
async function pumpQueue() {
  if (pumping || seriesQueue?.status !== "running") return;
  pumping = true; const generation = pumpGeneration;
  try {
    while (seriesQueue?.status === "running" && generation === pumpGeneration) {
      const q = seriesQueue;
      if (q.currentIndex >= q.courses.length) {
        q.status = "complete"; q.stage = "done"; recalculateQueue();
        q.message = q.failedCourses ? "Preparation finished. Some additions need another attempt." : "Your series is saved.";
        await persistQueue(); void pumpAutos(); return;
      }
      const course = q.courses[q.currentIndex], active = states.get(course.id);
      if (active?.fromQueue && ["running", "connecting"].includes(active.status)) return;
      // Resuming a paused series while an individually requested course is
      // running must wait for that request; never create a second worker.
      if ([...states.values()].some(state => ["running", "connecting"].includes(state.status))) return;
      course.status = "running"; q.stage = "model"; q.completed = 0; q.total = 0; q.message = "Loading course data…"; await persistQueue();
      const controller = new AbortController(); sourceAbort = controller;
      let source;
      const timeout = setTimeout(() => controller.abort(), 30000);
      try { source = await fetchSource(course.id, controller.signal); }
      catch (error) {
        if (generation !== pumpGeneration || q.status !== "running") return;
        if (error?.code === "source_network_unavailable") {
          await pauseQueue(error.message, true);
          return;
        }
        course.status = "error"; course.error = String(error.message).slice(0, 300); q.currentIndex++; recalculateQueue(); await persistQueue(); continue;
      } finally { clearTimeout(timeout); }
      if (generation !== pumpGeneration || q.status !== "running") return;
      const expected = AutoCore.expectedSource(source), sourceSignature = AutoCore.fingerprint(JSON.stringify(expected));
      const previousProgress = course.sourceSignature === sourceSignature || !course.sourceSignature && course.sentenceCount === Object.keys(expected.sentences).length ? course.stageProgress : null;
      course.sourceSignature = sourceSignature;
      course.sentenceCount = Object.keys(expected.sentences).length; q.typicalSize = course.sentenceCount;
      course.stageTotals = { language: course.sentenceCount, audio: Object.values(expected.sentences).filter(value => value.audioPath).length };
      const stored = await chrome.storage.local.get(AutoPacks.STORAGE_KEY);
      if (generation !== pumpGeneration || q.status !== "running") return;
      const merged = AutoPacks.merge(globalThis.IKnowReaderData, globalThis.IKnowReaderAudioData, stored[AutoPacks.STORAGE_KEY]);
      // Restore saved work before the model starts. Per-phase totals retain
      // audio-only courses and sentences without a recording accurately.
      const availability = AutoCore.courseAvailability(merged.data, merged.audio, source);
      course.stageProgress = Object.fromEntries(queueStages(q).map(stage => {
        const progress = AutoCore.preparationProgress({ stage }, availability, q.features);
        const total = queueStageTotal(course, stage, q) || 0;
        return [stage, { completed: Math.min(total, Math.max(progress?.ready || 0, previousProgress?.[stage]?.completed || 0)), total }];
      }));
      if (AutoCore.completeness(merged.data, merged.audio, source, q.features).complete) {
        course.status = "skipped"; q.currentIndex++; recalculateQueue(); await persistQueue(); continue;
      }
      // An explicit per-course selection made while the series runs may ask
      // for different additions. Keep it queued until the series has finished.
      startNative(course.id, source, q.features, false, true);
      recalculateQueue(); await persistQueue(); return;
    }
  } finally {
    pumping = false; sourceAbort = null;
    refreshNativeIdle();
    // A result can arrive while the final storage write above is pending.
    if (seriesQueue?.status === "running") {
      const state = states.get(seriesQueue.courses[seriesQueue.currentIndex]?.id);
      if ((!state?.fromQueue || !["running", "connecting"].includes(state.status)) && ![...states.values()].some(value => ["running", "connecting"].includes(value.status))) setTimeout(() => { void pumpQueue(); }, 0);
    }
  }
}
async function pumpAutos() {
  if (seriesQueue?.status === "running") { void pumpQueue(); return; }
  if (pumpingAutos || [...states.values()].some(state => ["running", "connecting"].includes(state.status))) return;
  pumpingAutos = true;
  try {
    const next = pendingAuto.entries().next().value;
    if (next) { const [id, request] = next; pendingAuto.delete(id); startNative(id, request.source, request.features, request.force); }
  } finally { pumpingAutos = false; }
}
async function queueCommand(message, sender) {
  const action = message.type.slice("ikr:queue:".length);
  if (["start", "resume"].includes(action) && (globalThis.IKnowReaderUpdates?.busy || globalThis.IKnowReaderComponents?.busy)) throw new Error("An update or model installation is in progress. Try again when it finishes.");
  const senderUrl = sender?.url || sender?.tab?.url || "";
  const readOnly = ["open", "status"].includes(action) && sender?.id === chrome.runtime.id && (seriesIdFromUrl(senderUrl) || AutoCore.courseIdFromUrl(senderUrl));
  if (!readOnly && !trustedQueue(sender, action === "start" ? message.seriesId : undefined)) throw new Error("Series preparation is only available on a series page.");
  if (action === "open") { await chrome.tabs.create({ url: chrome.runtime.getURL("queue.html") }); return { ok: true, queue: publicQueue() }; }
  if (action === "status") return { ok: true, queue: publicQueue() };
  if (action === "pause") { await pauseQueue(); return { ok: true, queue: publicQueue() }; }
  if (action === "resume") {
    if (!seriesQueue) throw new Error("There is no series preparation yet.");
    if (seriesQueue.status === "complete") {
      for (const course of seriesQueue.courses) if (course.partial || course.status === "error") {
        course.status = "pending";
        delete course.error; delete course.partial; delete course.stageProgress;
      }
      seriesQueue.currentIndex = seriesQueue.courses.findIndex(course => course.status === "pending");
      if (seriesQueue.currentIndex < 0) return { ok: true, queue: publicQueue() };
      seriesQueue.stage = "model"; seriesQueue.completed = 0; seriesQueue.total = 0;
    }
    seriesQueue.status = "running"; seriesQueue.error = ""; pumpGeneration++; recalculateQueue(); await persistQueue(); void pumpQueue(); return { ok: true, queue: publicQueue() };
  }
  if (action !== "start" || !/^\d{1,9}$/.test(String(message.seriesId)) || !Array.isArray(message.courses) || !message.courses.length || message.courses.length > 100) throw new Error("No supported course list was found.");
  const mask = features(message.features);
  if (!selected(mask)) throw new Error("Select German, meaning colors, or audio timings.");
  if (seriesQueue?.status === "running") throw new Error("A series is already being prepared. Pause it first.");
  const seen = new Set(), courses = [];
  for (const input of message.courses) {
    const id = courseId(input?.id); if (!id || seen.has(id)) continue; seen.add(id);
    courses.push({ id, title: String(input.title || `Course ${id}`).slice(0, 500), sentenceCount: Number.isInteger(input.sentenceCount) && input.sentenceCount > 0 && input.sentenceCount <= 10000 ? input.sentenceCount : null, status: "pending" });
  }
  if (!courses.length) throw new Error("No supported courses were found.");
  for (const [id, state] of states) if (["running", "connecting"].includes(state.status)) {
    cancelNative(id, state.requestId); publish(id, { status: "cancelled", message: "Series preparation started." });
  }
  seriesQueue = { schemaVersion: 1, id: crypto.randomUUID(), seriesId: String(message.seriesId), title: String(message.title || "Your series").slice(0, 500), courses, features: mask,
    status: "running", currentIndex: 0, processedCourses: 0, completedCourses: 0, skippedCourses: 0, failedCourses: 0, totalCourses: courses.length,
    stage: "model", completed: 0, total: 0, timings: {}, etaSeconds: null, createdAt: Date.now(), error: "", message: "Preparing series…" };
  pumpGeneration++; await persistQueue(); void pumpQueue(); return { ok: true, queue: publicQueue() };
}
const queueReady = chrome.storage.local.get(QUEUE_KEY).then(async stored => {
  const saved = stored[QUEUE_KEY];
  if (!saved || saved.schemaVersion !== 1 || !Array.isArray(saved.courses) || !saved.courses.length || saved.courses.length > 100 || !saved.courses.every(course => courseId(course.id)) || !selected(saved.features)) return;
  seriesQueue = { ...saved, features: features(saved.features), timings: saved.timings || {} };
  // Earlier releases kept only the active counters on the queue itself. Carry
  // them into the per-course phase records before recalculating a restored bar.
  const current = seriesQueue.courses[seriesQueue.currentIndex];
  if (current && ["language", "audio"].includes(seriesQueue.stage) && Number.isFinite(seriesQueue.total) && seriesQueue.total > 0) {
    current.stageTotals ||= {};
    current.stageProgress ||= {};
    const stage = seriesQueue.stage, total = seriesQueue.total;
    current.stageTotals[stage] ??= total;
    current.stageProgress[stage] ||= { completed: Math.max(0, Math.min(total, seriesQueue.completed || 0)), total };
    if (stage === "audio" && queueStages(seriesQueue).includes("language")) {
      const languageTotal = queueStageTotal(current, "language", seriesQueue) || total;
      current.stageProgress.language ||= { completed: languageTotal, total: languageTotal };
    }
    Object.assign(current, { stage, completed: seriesQueue.completed || 0, total, updatedAt: current.updatedAt || seriesQueue.updatedAt || null });
  }
  if (saved.status === "running") {
    seriesQueue.status = "paused"; seriesQueue.message = "Brave was restarted. You can resume the series.";
    for (const course of seriesQueue.courses) if (course.status === "running") course.status = "pending";
    recalculateQueue(); await persistQueue();
  } else recalculateQueue();
}).catch(() => {});

globalThis.IKnowReaderUpdateActivity = async () => {
  await queueReady;
  await globalThis.IKnowReaderComponents?.reconcile();
  return seriesQueue?.status === "running" || pendingAuto.size > 0 || transfers.size > 0 || nativeStopping.size > 0 ||
    [...states.values()].some(value => ["running", "connecting", "queued"].includes(value.status)) ||
    globalThis.IKnowReaderNeuralActivity?.() === true || globalThis.IKnowReaderWordPreparationActivity?.() === true || globalThis.IKnowReaderComponents?.busy === true;
};
importScripts("update-refresh.js", "update-discovery.js", "updates.js");
