/* A bounded text-only library. All writes run in the background transaction queue. */
(() => {
  "use strict";
  const KEY = "iknowReaderStudyLibrary", MAX_RECORDS = 2000, MAX_BYTES = 8 * 1024 * 1024;
  const HOSTS = new Set(["iknow.jp", "en.iknow.jp", "ja.iknow.jp", "assets.iknow.jp", "assets0.iknow.jp", "assets1.iknow.jp", "assets2.iknow.jp", "assets3.iknow.jp"]);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function courseId(value) { const text = String(value ?? ""); if (!/^[1-9]\d{0,9}$/.test(text) || Number(text) > 1000000000) throw Error("Choose a valid iKnow course."); return text; }
  function text(value, limit, required = false) {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error("The study item contains invalid text.");
    const result = value.trim(); if (required && !result) throw Error("The study item needs Japanese text."); return result;
  }
  function audioUrl(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || value.length > 2000) throw Error("This recording URL is not supported.");
    let url; try { url = new URL(value); } catch { throw Error("This recording URL is not supported."); }
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash || !/\.(mp3|wav)$/i.test(url.pathname)) throw Error("Only original HTTPS iKnow audio recordings can be saved.");
    return url.href;
  }
  function details(input) {
    if (!object(input)) throw Error("The study item is not valid.");
    return { japanese: text(input.japanese, 5000, true), kana: text(input.kana, 5000), romaji: text(input.romaji, 5000),
      english: text(input.english, 5000), german: text(input.german, 5000), audioUrl: audioUrl(input.audioUrl) };
  }
  function validate(input) {
    if (!object(input) || !["word", "sentence"].includes(input.kind)) throw Error("Choose a word or sentence to save.");
    const id = courseId(input.courseId), sourceId = text(input.sourceId, 100, true);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(sourceId)) throw Error("The study item has no stable source identifier.");
    const result = { kind: input.kind, courseId: id, courseTitle: text(input.courseTitle, 500), sourceId, ...details(input) };
    if (input.context !== undefined) result.context = details(input.context);
    return result;
  }
  function makeKey(input) { const value = validate(input); return `${value.kind}:${value.courseId}:${value.sourceId}`; }
  function library(value) {
    if (value === undefined) return { schemaVersion: 1, records: {} };
    if (!object(value) || value.schemaVersion !== 1 || !object(value.records) || Object.keys(value.records).length > MAX_RECORDS) throw Error("Your study library could not be read. Its existing data has been kept.");
    const records = {};
    for (const [key, input] of Object.entries(value.records)) {
      try {
        const record = validate(input); if (makeKey(record) !== key) continue;
        records[key] = { ...record, key, createdAt: Number.isFinite(input.createdAt) ? input.createdAt : 0, updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : 0 };
      } catch { /* Invalid imported entries cannot become executable content. */ }
    }
    return { schemaVersion: 1, records };
  }
  function createBackend(storage, now = Date.now) {
    let tail = Promise.resolve();
    const read = async () => library((await storage.get(KEY))[KEY]);
    const transaction = fn => { const job = tail.then(fn); tail = job.catch(() => {}); return job; };
    return Object.freeze({
      read,
      save(input) {
        const item = validate(input), key = makeKey(item);
        return transaction(async () => {
          const data = await read(), previous = data.records[key];
          if (!previous && Object.keys(data.records).length >= MAX_RECORDS) throw Error("Your study library is full. Remove an item before adding another.");
          const timestamp = now(), record = { ...item, key, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp };
          data.records[key] = record;
          if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_BYTES) throw Error("Your study library is full. Existing items have been kept.");
          await storage.set({ [KEY]: data }); return record;
        });
      },
      remove(key) {
        if (typeof key !== "string" || key.length > 130 || !/^(word|sentence):[1-9]\d{0,9}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(key)) return Promise.reject(Error("Choose a valid saved study item."));
        return transaction(async () => { const data = await read(); delete data.records[key]; await storage.set({ [KEY]: data }); return true; });
      }
    });
  }
  async function list(options = {}) {
    const data = library((await chrome.storage.local.get(KEY))[KEY]);
    const selected = options.courseId ? courseId(options.courseId) : null;
    return Object.values(data.records).filter(record => !selected || record.courseId === selected).sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  }
  async function command(type, data) {
    const result = await chrome.runtime.sendMessage({ type: "ikr:study:" + type, ...data });
    if (result?.ok !== true) throw Error(result?.message || "The study library is unavailable. Reload Reading Helper and try again.");
    return result.record ?? result.removed;
  }
  let listening = false;
  function listenBackground() {
    if (listening) return; listening = true;
    const backend = createBackend(chrome.storage.local);
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (!["ikr:study:save", "ikr:study:remove", "ikr:study:open"].includes(message?.type)) return;
      let sourceCourse = null, trusted = false;
      try {
        const url = new URL(sender?.url || ""), own = new URL(chrome.runtime.getURL("study.html"));
        trusted = sender?.id === chrome.runtime.id && (!sender.frameId || sender.frameId === 0) &&
          ((url.protocol === own.protocol && url.host === own.host && ["/study.html", "/popup.html"].includes(url.pathname)) ||
            (url.protocol === "https:" && !url.port && ["iknow.jp", "en.iknow.jp", "ja.iknow.jp"].includes(url.hostname) && /^\/courses\/[1-9]\d{0,9}\/?$/.test(url.pathname)));
        if (trusted && url.protocol === "https:") sourceCourse = url.pathname.split("/")[2];
      } catch { /* Invalid senders cannot mutate storage. */ }
      if (!trusted) { respond({ ok: false, message: "Study changes are only available from Reading Helper or an iKnow course." }); return; }
      const operation = async () => {
        if (message.type === "ikr:study:open") {
          const id = courseId(message.courseId);
          if (sourceCourse && id !== sourceCourse) throw Error("The study item belongs to another course.");
          const key = text(message.key, 130);
          if (key && !key.startsWith(`word:${id}:`) && !key.startsWith(`sentence:${id}:`)) throw Error("The study item belongs to another course.");
          await chrome.tabs.create({ url: chrome.runtime.getURL("study.html") + "?course=" + id + (key ? "&item=" + encodeURIComponent(key) : "") });
          return { ok: true };
        }
        if (message.type === "ikr:study:save") {
          const record = validate(message.record); if (sourceCourse && record.courseId !== sourceCourse) throw Error("The study item belongs to another course.");
          return { ok: true, record: await backend.save(record) };
        }
        if (sourceCourse && !String(message.key || "").startsWith(`word:${sourceCourse}:`) && !String(message.key || "").startsWith(`sentence:${sourceCourse}:`)) throw Error("The study item belongs to another course.");
        return { ok: true, removed: await backend.remove(message.key) };
      };
      void operation().then(respond, error => respond({ ok: false, message: String(error.message || error).slice(0, 200) }));
      return true;
    });
  }
  const api = Object.freeze({ KEY, MAX_RECORDS, MAX_BYTES, validate, makeKey, audioUrl, list,
    save: record => command("save", { record: validate(record) }), remove: key => command("remove", { key }), listenBackground, createBackend });
  globalThis.IKnowReaderStudyStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
