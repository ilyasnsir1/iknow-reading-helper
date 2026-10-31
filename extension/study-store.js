/* A bounded text-only library. All writes run in the background transaction queue. */
(() => {
  "use strict";
  const KEY = "iknowReaderStudyLibrary", MAX_RECORDS = 2000, MAX_BYTES = 8 * 1024 * 1024;
  const BACKUP_FORMAT = "iknow-reading-helper-study-backup", MAX_BACKUP_BYTES = 12 * 1024 * 1024;
  const APP_THEME_KEY = "iknowReaderTheme", PANEL_THEME_KEY = "iknowReaderPanelTheme";
  const PREFERENCES_KEY = "iknowReaderStudyPreferences";
  const DEFAULT_PREFERENCES = Object.freeze({ attempts: "retry", gapPosition: "random" });
  const THEMES = ["paper", "midnight", "tokyo", "forest"], RATINGS = ["again", "hard", "good"];
  const MAX_TIMESTAMP = 8640000000000000, PERSONAL_KEYS = ["notes", "review"];
  const DETAIL_KEYS = ["japanese", "jpan", "kana", "romaji", "english", "german", "audioUrl"];
  const RECORD_KEYS = ["kind", "courseId", "courseTitle", "sourceId", ...DETAIL_KEYS, "context", ...PERSONAL_KEYS, "key", "createdAt", "updatedAt"];
  const HOSTS = new Set(["iknow.jp", "en.iknow.jp", "ja.iknow.jp", "assets.iknow.jp", "assets0.iknow.jp", "assets1.iknow.jp", "assets2.iknow.jp", "assets3.iknow.jp"]);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const core = () => globalThis.IKnowReaderCore || (typeof require === "function" ? require("./core.js") : null);
  const practice = () => globalThis.IKnowReaderStudyPractice || (typeof require === "function" ? require("./study-practice.js") : null);
  const learning = () => globalThis.IKnowReaderStudyLearningStore || (typeof require === "function" ? require("./study-learning-store.js") : null);
  let writeTail = Promise.resolve();
  // Bookmarks, backups and learning checkpoints share one background write
  // lane so an import cannot overwrite a result committed at the same time.
  const serialize = fn => { const job = writeTail.then(fn); writeTail = job.catch(() => {}); return job; };
  const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  function onlyKeys(value, keys, message = "This backup contains unsupported fields.") {
    if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error(message);
  }
  function preferences(value) {
    onlyKeys(value, ["attempts", "gapPosition"], "Choose valid Study preferences.");
    if (!Object.keys(value).length) throw Error("Choose a Study preference to change.");
    const result = {};
    if (own(value, "attempts")) {
      if (!["retry", "single"].includes(value.attempts)) throw Error("Choose Retry allowed or One attempt.");
      result.attempts = value.attempts;
    }
    if (own(value, "gapPosition")) {
      if (!["first", "random"].includes(value.gapPosition)) throw Error("Choose First word or Random word.");
      result.gapPosition = value.gapPosition;
    }
    return result;
  }
  function storedPreferences(value) {
    try { return { ...DEFAULT_PREFERENCES, ...preferences(value) }; } catch { return { ...DEFAULT_PREFERENCES }; }
  }
  function validKey(key) {
    if (typeof key !== "string" || key.length > 130 || !/^(word|sentence):[1-9]\d{0,9}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(key)) throw Error("Choose a valid saved study item.");
    return key;
  }
  function notes(value) {
    if (typeof value !== "string" || value.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error("Notes must be plain text with no more than 4,000 characters.");
    return value;
  }
  function review(value) {
    const keys = ["dueAt", "lastReviewedAt", "intervalDays", "repetitions", "lapses", "lastRating"];
    onlyKeys(value, keys, "The saved review history is not valid.");
    if (keys.some(key => !own(value, key)) || !timestamp(value.dueAt) || !timestamp(value.lastReviewedAt) || value.dueAt < value.lastReviewedAt ||
        !Number.isInteger(value.intervalDays) || value.intervalDays < 0 || value.intervalDays > 365 ||
        !Number.isInteger(value.repetitions) || value.repetitions < 0 || value.repetitions > 1000000 ||
        !Number.isInteger(value.lapses) || value.lapses < 0 || value.lapses > 1000000 || !RATINGS.includes(value.lastRating)) throw Error("The saved review history is not valid.");
    return Object.fromEntries(keys.map(key => [key, value[key]]));
  }
  function bounded(data) {
    if (Object.keys(data.records).length > MAX_RECORDS || bytes(data) > MAX_BYTES) throw Error("Your study library is full. Existing items have been kept.");
    return data;
  }
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
    return { japanese: text(input.japanese, 5000, true), jpan: text(input.jpan, 5000), kana: text(input.kana, 5000), romaji: text(input.romaji, 5000),
      english: text(input.english, 5000), german: text(input.german, 5000), audioUrl: audioUrl(input.audioUrl) };
  }
  function validate(input) {
    if (!object(input) || !["word", "sentence"].includes(input.kind)) throw Error("Choose a word or sentence to save.");
    const id = courseId(input.courseId), sourceId = text(input.sourceId, 100, true);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(sourceId)) throw Error("The study item has no stable source identifier.");
    const result = { kind: input.kind, courseId: id, courseTitle: text(input.courseTitle, 500), sourceId, ...details(input) };
    if (input.context !== undefined) result.context = details(input.context);
    if (own(input, "notes")) result.notes = notes(input.notes);
    if (own(input, "review")) result.review = review(input.review);
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
        records[key] = { ...record, key, createdAt: timestamp(input.createdAt) ? input.createdAt : 0, updatedAt: timestamp(input.updatedAt) ? input.updatedAt : 0 };
      } catch { /* Invalid imported entries cannot become executable content. */ }
    }
    return { schemaVersion: 1, records };
  }
  function backupSettings(input) {
    onlyKeys(input, ["reading", "appTheme", "panelTheme", "study"]);
    const result = {};
    if (own(input, "reading")) {
      const Core = core(); if (!Core) throw Error("Reading preferences are unavailable. Reload Reading Helper and try again.");
      onlyKeys(input.reading, Object.keys(Core.DEFAULTS));
      const normalized = Core.normalizeSettings(input.reading);
      if (Object.keys(input.reading).some(key => input.reading[key] !== normalized[key])) throw Error("This backup contains invalid reading preferences.");
      result.reading = normalized;
    }
    for (const key of ["appTheme", "panelTheme"]) if (own(input, key)) {
      if (!THEMES.includes(input[key])) throw Error("This backup contains an unsupported theme.");
      result[key] = input[key];
    }
    if (own(input, "study")) result.study = preferences(input.study);
    return result;
  }
  function parseBackup(input) {
    if (typeof input === "string") {
      if (input.length > MAX_BACKUP_BYTES || new TextEncoder().encode(input).length > MAX_BACKUP_BYTES) throw Error("This backup is too large. The limit is 12 MiB.");
      try { input = JSON.parse(input); } catch { throw Error("Choose a valid Reading Helper backup JSON file."); }
    }
    onlyKeys(input, ["format", "schemaVersion", "exportedAt", "library", "settings", "learning"]);
    if (input.format !== BACKUP_FORMAT || input.schemaVersion !== 1 || !timestamp(input.exportedAt)) throw Error("This backup format or version is not supported.");
    onlyKeys(input.library, ["schemaVersion", "records"]);
    if (input.library.schemaVersion !== 1 || !object(input.library.records) || Object.keys(input.library.records).length > MAX_RECORDS) throw Error("This backup has an invalid study library.");
    const records = {}; let recordBytes = 0;
    for (const [key, inputRecord] of Object.entries(input.library.records)) {
      validKey(key); onlyKeys(inputRecord, RECORD_KEYS);
      if (own(inputRecord, "context")) onlyKeys(inputRecord.context, DETAIL_KEYS);
      const item = validate(inputRecord);
      if (makeKey(item) !== key || inputRecord.key !== key || !timestamp(inputRecord.createdAt) || !timestamp(inputRecord.updatedAt)) throw Error("This backup contains an invalid study item.");
      records[key] = { ...item, key, createdAt: inputRecord.createdAt, updatedAt: inputRecord.updatedAt };
      recordBytes += bytes(records[key]) + key.length + 5;
      if (recordBytes > MAX_BYTES) throw Error("This backup exceeds the study library size limit.");
    }
    const result = { format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: input.exportedAt, library: bounded({ schemaVersion: 1, records }) };
    if (own(input, "settings")) result.settings = backupSettings(input.settings);
    if (own(input, "learning")) result.learning = learning().validateProgress(input.learning);
    if (bytes(input) > MAX_BACKUP_BYTES || bytes(result) > MAX_BACKUP_BYTES) throw Error("This backup is too large. The limit is 12 MiB.");
    return result;
  }
  function mergeBackup(current, backup) {
    const records = { ...current.records }; let newItems = 0, existingItems = 0, updated = 0, kept = 0;
    for (const [key, incoming] of Object.entries(backup.library.records)) {
      const previous = records[key];
      if (!previous) { records[key] = incoming; newItems++; }
      else {
        existingItems++;
        if (incoming.updatedAt > previous.updatedAt) { records[key] = incoming; updated++; }
        else kept++;
      }
    }
    const data = bounded({ schemaVersion: 1, records });
    return { data, summary: { newItems, existingItems, totalItems: Object.keys(records).length,
      backupItems: Object.keys(backup.library.records).length, hasSettings: Boolean(backup.settings && Object.keys(backup.settings).length),
      added: newItems, updated, kept, learningItems: Object.keys(backup.learning?.records || {}).length } };
  }
  function selectedKeys(input) {
    if (!Array.isArray(input) || input.length > MAX_RECORDS) throw Error("Choose valid saved items to delete.");
    return [...new Set(input.map(validKey))];
  }
  function deletedRecords(input) {
    if (!Array.isArray(input) || input.length > MAX_RECORDS) throw Error("The deleted items could not be restored.");
    const records = input.map(value => {
      onlyKeys(value, RECORD_KEYS); if (own(value, "context")) onlyKeys(value.context, DETAIL_KEYS); const item = validate(value), key = validKey(value.key);
      if (makeKey(item) !== key || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) throw Error("The deleted items could not be restored.");
      return { ...item, key, createdAt: value.createdAt, updatedAt: value.updatedAt };
    });
    if (new Set(records.map(record => record.key)).size !== records.length) throw Error("The deleted items could not be restored.");
    bounded({ schemaVersion: 1, records: Object.fromEntries(records.map(record => [record.key, record])) }); return records;
  }
  function createBackend(storage, now = Date.now) {
    const read = async () => library((await storage.get(KEY))[KEY]);
    const transaction = serialize;
    return Object.freeze({
      read,
      getPreferences() {
        return transaction(async () => storedPreferences((await storage.get(PREFERENCES_KEY))[PREFERENCES_KEY]));
      },
      setPreferences(input) {
        const patch = preferences(input);
        return transaction(async () => {
          const previous = storedPreferences((await storage.get(PREFERENCES_KEY))[PREFERENCES_KEY]);
          const next = { ...previous, ...patch };
          await storage.set({ [PREFERENCES_KEY]: next }); return next;
        });
      },
      save(input) {
        const item = validate(input), key = makeKey(item);
        return transaction(async () => {
          const data = await read(), previous = data.records[key];
          if (!previous && Object.keys(data.records).length >= MAX_RECORDS) throw Error("Your study library is full. Remove an item before adding another.");
          const { notes: ignoredNotes, review: ignoredReview, ...source } = item;
          const timestamp = now(), record = { ...source, key, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp };
          for (const key of PERSONAL_KEYS) if (previous && own(previous, key)) record[key] = previous[key];
          data.records[key] = record;
          bounded(data);
          await storage.set({ [KEY]: data }); return record;
        });
      },
      remove(key) {
        try { validKey(key); } catch (error) { return Promise.reject(error); }
        return transaction(async () => { const data = await read(); delete data.records[key]; await storage.set({ [KEY]: data }); return true; });
      },
      removeMany(input) {
        const keys = selectedKeys(input);
        return transaction(async () => {
          const data = await read(), deleted = keys.map(key => data.records[key]).filter(Boolean);
          for (const key of keys) delete data.records[key];
          if (deleted.length) await storage.set({ [KEY]: data }); return deleted;
        });
      },
      clearLibrary(options = {}) {
        onlyKeys(options, ["expectedKeys"]); const expected = own(options, "expectedKeys") ? selectedKeys(options.expectedKeys).sort() : null;
        return transaction(async () => {
          const data = await read(), keys = Object.keys(data.records).sort();
          if (expected && JSON.stringify(expected) !== JSON.stringify(keys)) throw Error("Your library changed. Review the item count and confirm again.");
          const deleted = Object.values(data.records); if (deleted.length) await storage.set({ [KEY]: { schemaVersion: 1, records: {} } }); return deleted;
        });
      },
      restoreDeleted(input) {
        const deleted = deletedRecords(input);
        return transaction(async () => {
          const data = await read(); let restored = 0, kept = 0;
          for (const record of deleted) { if (data.records[record.key]) { kept++; continue; } data.records[record.key] = record; restored++; }
          bounded(data); if (restored) await storage.set({ [KEY]: data }); return { restored, kept };
        });
      },
      enrich(input) {
        if (!Array.isArray(input) || input.length > MAX_RECORDS) throw Error("Choose valid course items.");
        const incoming = input.map(validate);
        return transaction(async () => {
          const data = await read(); let enriched = 0;
          for (const value of incoming) {
            const key = makeKey(value), previous = data.records[key]; if (!previous) continue;
            const record = { ...previous };
            // Enrichment never overwrites a learner's notes, review history or
            // existing source text. It only fills fields absent in old saves.
            for (const field of ["courseTitle", ...DETAIL_KEYS]) if (!record[field] && value[field]) record[field] = value[field];
            if (!record.context && value.context) record.context = value.context;
            else if (record.context && value.context && record.context.japanese === value.context.japanese) {
              record.context = { ...record.context };
              for (const field of DETAIL_KEYS) if (!record.context[field] && value.context[field]) record.context[field] = value.context[field];
            }
            if (JSON.stringify(record) !== JSON.stringify(previous)) { record.updatedAt = now(); data.records[key] = record; enriched++; }
          }
          bounded(data); if (enriched) await storage.set({ [KEY]: data }); return { enriched };
        });
      },
      updateNotes(key, value) {
        validKey(key); const next = notes(value);
        return transaction(async () => {
          const data = await read(), previous = data.records[key]; if (!previous) throw Error("This saved item no longer exists.");
          const record = { ...previous, notes: next, updatedAt: now() }; data.records[key] = record;
          bounded(data); await storage.set({ [KEY]: data }); return record;
        });
      },
      rate(key, rating) {
        validKey(key); if (!RATINGS.includes(rating)) throw Error("Choose Again, Hard or Good.");
        return transaction(async () => {
          const data = await read(), previous = data.records[key]; if (!previous) throw Error("This saved item no longer exists.");
          const engine = practice(); if (!engine?.nextReview) throw Error("Review practice is unavailable. Reload Reading Helper and try again.");
          const timestamp = now(), record = { ...previous, review: review(engine.nextReview(previous.review, rating, timestamp)), updatedAt: timestamp };
          data.records[key] = record; bounded(data); await storage.set({ [KEY]: data }); return record;
        });
      },
      exportBackup() {
        return transaction(async () => {
          const Core = core(); if (!Core) throw Error("Reading preferences are unavailable. Reload Reading Helper and try again.");
          const Learning = learning(), stored = await storage.get([KEY, Core.STORAGE_KEY, APP_THEME_KEY, PANEL_THEME_KEY, PREFERENCES_KEY, Learning.KEY]);
          return parseBackup({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: now(), library: library(stored[KEY]),
            learning: { records: Learning.normalizeData(stored[Learning.KEY]).records },
            settings: { reading: Core.normalizeSettings(stored[Core.STORAGE_KEY]), appTheme: THEMES.includes(stored[APP_THEME_KEY]) ? stored[APP_THEME_KEY] : "paper",
              panelTheme: THEMES.includes(stored[PANEL_THEME_KEY]) ? stored[PANEL_THEME_KEY] : "paper", study: storedPreferences(stored[PREFERENCES_KEY]) } });
        });
      },
      previewBackup(input) {
        const backup = parseBackup(input);
        return transaction(async () => mergeBackup(await read(), backup).summary);
      },
      importBackup(input, options = {}) {
        const backup = parseBackup(input); onlyKeys(options, ["includeSettings"]);
        if (own(options, "includeSettings") && typeof options.includeSettings !== "boolean") throw Error("Choose whether to restore preferences.");
        return transaction(async () => {
          const { data, summary } = mergeBackup(await read(), backup), patch = { [KEY]: data };
          if (options.includeSettings && backup.settings) {
            if (backup.settings.reading) patch[core().STORAGE_KEY] = backup.settings.reading;
            if (backup.settings.appTheme) patch[APP_THEME_KEY] = backup.settings.appTheme;
            if (backup.settings.panelTheme) patch[PANEL_THEME_KEY] = backup.settings.panelTheme;
            if (backup.settings.study) {
              const current = storedPreferences((await storage.get(PREFERENCES_KEY))[PREFERENCES_KEY]);
              patch[PREFERENCES_KEY] = { ...current, ...backup.settings.study };
            }
          }
          if (backup.learning) {
            const Learning = learning(), current = Learning.normalizeData((await storage.get(Learning.KEY))[Learning.KEY]);
            patch[Learning.KEY] = { ...current, records: Learning.mergeProgress(current, backup.learning).records };
          }
          await storage.set(patch);
          return { ...summary, importedSettings: Boolean(options.includeSettings && summary.hasSettings) };
        });
      }
    });
  }
  async function list(options = {}) {
    const data = library((await chrome.storage.local.get(KEY))[KEY]);
    const selected = options.courseId ? courseId(options.courseId) : null;
    const records=Object.values(data.records).filter(record => !selected || record.courseId === selected);
    return records.sort(options.order === "added" ? (a, b) => a.createdAt - b.createdAt : (a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  }
  async function command(type, data) {
    const result = await chrome.runtime.sendMessage({ type: "ikr:study:" + type, ...data });
    if (result?.ok !== true) throw Error(result?.message || "The study library is unavailable. Reload Reading Helper and try again.");
    return result.record ?? result.removed ?? result.deleted ?? result.backup ?? result.preview ?? result.summary ?? result.preferences;
  }
  let listening = false;
  function listenBackground() {
    if (listening) return; listening = true;
    const backend = createBackend(chrome.storage.local);
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      const privateCommands = ["ikr:study:notes", "ikr:study:rate", "ikr:study:backup:export", "ikr:study:backup:preview", "ikr:study:backup:import", "ikr:study:preferences:get", "ikr:study:preferences:set", "ikr:study:delete-many", "ikr:study:clear", "ikr:study:restore-deleted", "ikr:study:enrich"];
      if (!["ikr:study:save", "ikr:study:remove", "ikr:study:open", ...privateCommands].includes(message?.type)) return;
      let sourceCourse = null, trusted = false, studyPage = false;
      try {
        const url = new URL(sender?.url || ""), extension = new URL(chrome.runtime.getURL("study.html"));
        const identity = sender?.id === chrome.runtime.id && (sender.frameId === undefined || sender.frameId === 0);
        studyPage = identity && url.protocol === extension.protocol && url.host === extension.host && url.pathname === "/study.html";
        trusted = identity &&
          ((url.protocol === extension.protocol && url.host === extension.host && ["/study.html", "/popup.html"].includes(url.pathname)) ||
            (url.protocol === "https:" && !url.port && ["iknow.jp", "en.iknow.jp", "ja.iknow.jp"].includes(url.hostname) && /^\/courses\/[1-9]\d{0,9}\/?$/.test(url.pathname)));
        if (trusted && url.protocol === "https:") sourceCourse = url.pathname.split("/")[2];
      } catch { /* Invalid senders cannot mutate storage. */ }
      if (privateCommands.includes(message.type) && !studyPage) { respond({ ok: false, message: "Open Your study space to manage notes, reviews and backups." }); return; }
      if (!trusted) { respond({ ok: false, message: "Study changes are only available from Reading Helper or an iKnow course." }); return; }
      const operation = async () => {
        if (message.type === "ikr:study:delete-many") return { ok: true, deleted: await backend.removeMany(message.keys) };
        if (message.type === "ikr:study:clear") return { ok: true, deleted: await backend.clearLibrary(message.options) };
        if (message.type === "ikr:study:restore-deleted") return { ok: true, summary: await backend.restoreDeleted(message.records) };
        if (message.type === "ikr:study:enrich") return { ok: true, summary: await backend.enrich(message.records) };
        if (message.type === "ikr:study:preferences:get") return { ok: true, preferences: await backend.getPreferences() };
        if (message.type === "ikr:study:preferences:set") return { ok: true, preferences: await backend.setPreferences(message.preferences) };
        if (message.type === "ikr:study:notes") return { ok: true, record: await backend.updateNotes(message.key, message.notes) };
        if (message.type === "ikr:study:rate") return { ok: true, record: await backend.rate(message.key, message.rating) };
        if (message.type === "ikr:study:backup:export") return { ok: true, backup: await backend.exportBackup() };
        if (message.type === "ikr:study:backup:preview") return { ok: true, preview: await backend.previewBackup(message.backup) };
        if (message.type === "ikr:study:backup:import") return { ok: true, summary: await backend.importBackup(message.backup, message.options) };
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
  const api = Object.freeze({ KEY, PREFERENCES_KEY, MAX_RECORDS, MAX_BYTES, MAX_BACKUP_BYTES, BACKUP_FORMAT, validate, makeKey, audioUrl, list, serialize,
    getPreferences: () => command("preferences:get"), setPreferences: value => command("preferences:set", { preferences: preferences(value) }),
    save: record => command("save", { record: validate(record) }), remove: key => command("remove", { key }),
    removeMany: keys => command("delete-many", { keys: selectedKeys(keys) }), clearLibrary: options => command("clear", { options }),
    restoreDeleted: records => command("restore-deleted", { records: deletedRecords(records) }), enrich: records => command("enrich", { records }),
    updateNotes: (key, value) => command("notes", { key: validKey(key), notes: notes(value) }),
    rate: (key, rating) => command("rate", { key: validKey(key), rating }),
    exportBackup: () => command("backup:export"), previewBackup: backup => command("backup:preview", { backup }),
    importBackup: (backup, options = {}) => command("backup:import", { backup, options }), listenBackground, createBackend });
  globalThis.IKnowReaderStudyStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
