/* Public course text for explicit Study sessions. No preparation or model jobs. */
(() => {
  "use strict";
  const Core = globalThis.IKnowReaderCore || (typeof require === "function" ? require("./core.js") : null);
  const Store = globalThis.IKnowReaderStudyStore || (typeof require === "function" ? require("./study-store.js") : null);
  const Packs = globalThis.IKnowReaderPacks || (typeof require === "function" ? require("./course-packs.js") : null);
  const Practice = globalThis.IKnowReaderStudyPractice || (typeof require === "function" ? require("./study-practice.js") : null);
  const Corrections = globalThis.IKnowReaderTranslationCorrections || (typeof require === "function" ? require("./translation-corrections.js") : null);
  const KEY = "iknowReaderStudyCatalog", TTL = 3600000, MAX_COURSES = 30, MAX_BYTES = 8 * 1024 * 1024, MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const clean = value => Core.plainText(value || "");
  function courseId(value) {
    if (typeof value === "string" && /^https:/i.test(value)) {
      let url; try { url = new URL(value); } catch { throw Error("Enter an iKnow course ID or link."); }
      if (url.protocol !== "https:" || url.port || url.username || url.password || !["iknow.jp", "en.iknow.jp", "ja.iknow.jp"].includes(url.hostname) || !/^\/courses\/[1-9]\d{0,9}\/?$/.test(url.pathname)) throw Error("Enter an iKnow course ID or link.");
      value = url.pathname.split("/")[2];
    }
    const id = String(value ?? "").trim(); if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 1000000000) throw Error("Enter an iKnow course ID or link."); return id;
  }
  function compactSource(input, requested) {
    const id = courseId(requested ?? input?.id);
    if (!object(input) || String(input.id) !== id || typeof input.cue_language !== "string" || input.cue_language.split("-")[0] !== "ja" || !Array.isArray(input.goal_items) || !input.goal_items.length || input.goal_items.length > Store.MAX_RECORDS || bytes(input) > MAX_SOURCE_BYTES) throw Error("This course does not contain supported Japanese data.");
    const cue = value => {
      if (!object(value) || typeof value.text !== "string" || value.text.length > 10000) throw Error("The course contains invalid Japanese text.");
      for (const field of ["Jpan", "Hrkt", "Latn"]) if (value.transliterations?.[field] !== undefined && (typeof value.transliterations[field] !== "string" || value.transliterations[field].length > 10000)) throw Error("The course contains invalid readings.");
      return { id: value.id, text: value.text, transliterations: { Jpan: value.transliterations?.Jpan, Hrkt: value.transliterations?.Hrkt, Latn: value.transliterations?.Latn } };
    };
    return { id: Number(id), title: clean(input.title).slice(0, 500) || `Course ${id}`, cue_language: input.cue_language,
      goal_items: input.goal_items.map(entry => {
        if (!object(entry) || !object(entry.item) || !Array.isArray(entry.sentences || []) || (entry.sentences || []).length > 100) throw Error("The course contains invalid items.");
        return { item: { id: entry.item.id, cue: cue(entry.item.cue), response: { text: entry.item.response?.text } }, sound: entry.sound,
          sentences: (entry.sentences || []).map(sentence => ({ cue: cue(sentence?.cue), response: { text: sentence?.response?.text }, sound: sentence?.sound })) };
      }) };
  }
  function safeSound(value) { try { return Store.audioUrl(new URL(value, "https://iknow.jp/").href); } catch { return ""; } }
  function normalizeSource(input, options = {}) {
    const source = compactSource(input, options.courseId), id = String(source.id), title = source.title;
    let pack; try { const candidate = options.packs?.[id]; if (candidate) { const checked = Packs.validate(candidate); if (String(checked.course.id) === id) pack = checked; } } catch { /* Invalid additions cannot attach to source text. */ }
    const bundled = options.bundled || globalThis.IKnowReaderData || {}, expected = Core.expectedSource(source), records = [], seen = new Set();
    function fields(kind, cue, sourceId, english, sound) {
      return { kind, courseId: id, courseTitle: title, sourceId: String(sourceId), japanese: clean(cue?.text), jpan: clean(cue?.transliterations?.Jpan), kana: clean(cue?.transliterations?.Hrkt), romaji: clean(cue?.transliterations?.Latn), english, german: "", audioUrl: safeSound(sound) };
    }
    function sentenceRecord(sentence) {
      const sentenceId = String(sentence.cue?.id), signature = Core.signature([sentence.cue?.text, sentence.response?.text, sentence.cue?.transliterations?.Hrkt, sentence.cue?.transliterations?.Latn].map(clean));
      const record = fields("sentence", sentence.cue, sentenceId, Corrections?.get(sentence)?.text || clean(sentence.response?.text), sentence.sound);
      const prepared = pack?.alignments?.[sentenceId]?.signature === signature ? pack.alignments[sentenceId] : Core.alignmentFor(bundled, sentenceId, signature);
      record.german = prepared?.german?.text || ""; return Store.validate(record);
    }
    function append(record) { const key = Store.makeKey(record); if (!seen.has(key)) { seen.add(key); records.push({ ...record, key }); } }
    for (const entry of source.goal_items) {
      const item = entry.item, word = fields("word", item.cue, item.cue?.id || item.id, clean(item.response?.text), entry.sound);
      const itemSignature = expected.items[String(item.id)], prepared = pack?.germanItems?.[String(item.id)]?.signature === itemSignature ? pack.germanItems[String(item.id)] : Core.germanItemFor(bundled, String(item.id), itemSignature);
      word.german = prepared?.text || "";
      const examples = entry.sentences.map(sentenceRecord);
      const context = examples.find(example => Practice?.buildCloze({ ...word, context: example })) || examples[0];
      if (context) { const { kind, courseId: ignoredCourse, courseTitle: ignoredTitle, sourceId, ...details } = context; word.context = details; }
      append(Store.validate(word)); for (const example of examples) append(example);
      if (records.length > Store.MAX_RECORDS) throw Error("This course has too many items for a Study session.");
    }
    return { courseId: id, title, fingerprint: Core.fingerprint(JSON.stringify(records)), records, stale: false, fetchedAt: options.now ?? Date.now() };
  }
  function createBackend(storage, { fetchImpl = globalThis.fetch?.bind(globalThis), now = Date.now } = {}) {
    const pending = new Map(); let writeTail = Promise.resolve();
    async function cache() {
      const raw = (await storage.get(KEY))[KEY], result = {};
      if (raw?.schemaVersion !== 1 || !object(raw.entries)) return result;
      for (const [id, value] of Object.entries(raw.entries).slice(0, MAX_COURSES)) {
        try { if (!Number.isSafeInteger(value?.at) || value.at < 0 || value.at > now() + 60000) continue; result[courseId(id)] = { at: value.at, source: compactSource(value.source, id) }; } catch { /* Broken cache entries can be fetched again. */ }
      }
      return result;
    }
    async function prepare(source, at, stale) {
      const stored = await storage.get(Packs.STORAGE_KEY);
      return { ...normalizeSource(source, { packs: stored[Packs.STORAGE_KEY], now: at }), stale };
    }
    function persist(id, entry) {
      const job = writeTail.then(async () => {
        const entries = { ...await cache(), [id]: entry }, kept = {}; let size = 0;
        for (const [key, value] of Object.entries(entries).sort((a, b) => b[1].at - a[1].at)) { const length = bytes(value) + key.length + 5; if (Object.keys(kept).length < MAX_COURSES && size + length + 64 <= MAX_BYTES) { kept[key] = value; size += length; } }
        await storage.set({ [KEY]: { schemaVersion: 1, entries: kept } });
      }); writeTail = job.catch(() => {}); return job;
    }
    async function fetchCourse(id) {
      if (!fetchImpl) throw Error("Course data is unavailable offline.");
      const response = await fetchImpl(`https://iknow.jp/api/v2/goals/${id}`, { credentials: "include", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`Course data could not be loaded (${response.status}).`);
      if (Number(response.headers?.get("content-length")) > MAX_SOURCE_BYTES) throw Error("This course is too large.");
      let text = "";
      if (response.body?.getReader) {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_SOURCE_BYTES) throw Error("This course is too large."); text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
        catch (error) { await reader.cancel().catch(() => {}); throw error; }
      } else { text = await response.text(); if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES) throw Error("This course is too large."); }
      return compactSource(JSON.parse(text), id);
    }
    return Object.freeze({
      async list() {
        const stored = await storage.get([KEY, Packs.STORAGE_KEY, "iknowReaderAvailabilitySources", "iknowReaderStudyLibrary", "iknowReaderQueue"]), titles = new Map();
        const put = (rawId, rawTitle) => { try { const id = courseId(rawId), title = clean(rawTitle).slice(0, 500); if (title) titles.set(id, title); } catch {} };
        for (const [id, course] of Object.entries(globalThis.IKnowReaderData?.courses || {})) put(id, course.title);
        for (const [id, entry] of Object.entries(stored[KEY]?.entries || {})) put(id, entry?.source?.title);
        for (const [id, entry] of Object.entries(stored.iknowReaderAvailabilitySources?.entries || {})) put(id, entry?.source?.title);
        for (const [id, pack] of Object.entries(stored[Packs.STORAGE_KEY] || {})) if (String(pack?.course?.id) === id) put(id, pack.course.title);
        for (const record of Object.values(stored.iknowReaderStudyLibrary?.records || {})) put(record?.courseId, record?.courseTitle);
        for (const course of stored.iknowReaderQueue?.courses || []) put(course?.id, course?.title);
        return [...titles].map(([courseId, title]) => ({ courseId, title })).sort((a, b) => a.title.localeCompare(b.title));
      },
      load(value) {
        const id = courseId(value); if (pending.has(id)) return pending.get(id);
        const job = (async () => {
          const previous = (await cache())[id];
          if (previous && now() - previous.at < TTL) return prepare(previous.source, previous.at, false);
          try {
            const source = await fetchCourse(id), at = now(), result = await prepare(source, at, false); await persist(id, { at, source }); return result;
          } catch (error) { if (previous) return prepare(previous.source, previous.at, true); throw error; }
        })(); pending.set(id, job); job.finally(() => pending.delete(id)).catch(() => {}); return job;
      }
    });
  }
  async function command(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type: `ikr:catalog:${type}`, ...extra });
    if (!result?.ok) throw Error(result?.message || "Course data could not be loaded."); return result.courses ?? result.catalog;
  }
  let listening = false;
  function listenBackground() {
    if (listening) return; listening = true; const backend = createBackend(chrome.storage.local);
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (!["ikr:catalog:list", "ikr:catalog:load"].includes(message?.type)) return;
      let trusted = false;
      try { const actual = new URL(sender?.url || ""), expected = new URL(chrome.runtime.getURL("study.html")); trusted = sender.id === chrome.runtime.id && (sender.frameId === undefined || sender.frameId === 0) && actual.origin === expected.origin && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname; } catch {}
      if (!trusted) { respond({ ok: false, message: "Open Your study space to load a course." }); return; }
      const operation = message.type === "ikr:catalog:list" ? backend.list().then(courses => ({ ok: true, courses })) : Promise.resolve().then(() => backend.load(message.courseId)).then(catalog => ({ ok: true, catalog }));
      void operation.then(respond, error => respond({ ok: false, message: String(error.message || error).slice(0, 200) })); return true;
    });
  }
  const api = Object.freeze({ KEY, TTL, MAX_COURSES, MAX_BYTES, courseId, normalizeSource, createBackend, listenBackground, list: () => command("list"), load: value => command("load", { courseId: courseId(value) }) });
  globalThis.IKnowReaderStudyCatalog = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
