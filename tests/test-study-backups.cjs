"use strict";
const assert = require("node:assert/strict");
const Store = require("../extension/study-store.js"), Core = require("../extension/core.js");
const Practice = require("../extension/study-practice.js");
const LearningStore = require("../extension/study-learning-store.js"), Learning = require("../extension/study-learning.js");
const clone = value => structuredClone(value);
const record = { kind: "sentence", courseId: "19053", sourceId: "100", japanese: "それはとてもいい話だ。",
  romaji: "sore wa tottemo ii hanashi da.", english: "That's a really nice story.", audioUrl: "https://assets0.iknow.jp/assets/test.mp3" };
const key = Store.makeKey(record);
function fixture(initial = {}, clock = () => 123) {
  let data = clone(initial), writes = [];
  const storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(name => [name, clone(data[name])])),
    set: async patch => { await new Promise(resolve => setTimeout(resolve, 1)); writes.push(clone(patch)); data = { ...data, ...clone(patch) }; }
  };
  return { storage, backend: Store.createBackend(storage, clock), get data() { return clone(data); }, get writes() { return writes.map(clone); } };
}
function backup(records, settings) {
  const value = { format: Store.BACKUP_FORMAT, schemaVersion: 1, exportedAt: 123, library: { schemaVersion: 1, records } };
  if (settings !== undefined) value.settings = settings;
  return value;
}
function saved(input, updatedAt = 123) {
  const item = Store.validate(input);
  return { ...item, key: Store.makeKey(item), createdAt: 100, updatedAt };
}

(async () => {
  let now = 1000;
  const written = { ...record, romaji: "sore ha totemo ii hanashi da.", jpan: "それ は とても いい 話 だ 。" };
  const personal = fixture({ [Store.KEY]: { schemaVersion: 1, records: { [key]: saved(written) } } }, () => ++now);
  const note = "Long vowels matter.\n <strong>plain text only</strong> ";
  await personal.backend.updateNotes(key, note);
  const rated = await personal.backend.rate(key, "good");
  assert.deepEqual(rated.review, Practice.nextReview(undefined, "good", rated.updatedAt));
  await personal.backend.save({ ...written, german: "Neue Bedeutung", notes: "course cannot replace personal notes", review: Practice.nextReview(undefined, "again", 1) });
  assert.equal((await personal.backend.read()).records[key].notes, note);
  assert.deepEqual((await personal.backend.read()).records[key].review, rated.review);
  await Promise.all([personal.backend.updateNotes(key, "updated"), personal.backend.rate(key, "again"), personal.backend.save(written)]);
  const afterConcurrent = (await personal.backend.read()).records[key];
  assert.equal(afterConcurrent.notes, "updated"); assert.equal(afterConcurrent.review.lastRating, "again");
  assert.equal(afterConcurrent.review.lapses, 1);
  assert.throws(() => personal.backend.rate(key, "easy"));
  await assert.rejects(personal.backend.updateNotes("word:19053:missing", "note"));
  assert.throws(() => personal.backend.updateNotes("__proto__", "note"));
  for (const bad of [{ notes: "x".repeat(4001) }, { notes: "bad\u0000" }, { review: { dueAt: Infinity } }]) assert.throws(() => Store.validate({ ...record, ...bad }));

  const settings = Core.normalizeSettings({ translationLanguage: "both", romajiStyle: "spoken", wordAudioPolicy: 5, wordAudio: true });
  const exporting = fixture({ ...personal.data, [Core.STORAGE_KEY]: { ...settings, secretCredential: "must not leave", publisherKey: "must not leave" },
    [Store.PREFERENCES_KEY]: { attempts: "single" }, iknowReaderTheme: "tokyo", iknowReaderPanelTheme: "forest", nativeConfig: { privateKey: "must not leave" }, courseCache: { secret: "must not leave" } }, () => 5000);
  const exported = await exporting.backend.exportBackup();
  assert.equal(exported.format, Store.BACKUP_FORMAT); assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.library.records[key].notes, "updated"); assert.equal(exported.library.records[key].review.lastRating, "again");
  assert.deepEqual(exported.learning, { records: {} }, "Backups contain progress without an active session");
  assert.deepEqual(exported.settings, { reading: settings, appTheme: "tokyo", panelTheme: "forest", study: { attempts: "single", gapPosition: "random" } });
  assert.doesNotMatch(JSON.stringify(exported), /secretCredential|publisherKey|nativeConfig|courseCache|must not leave/);
  assert.equal(exporting.writes.length, 0);

  const existingKey = "word:19053:existing", addedKey = "word:19053:new";
  const current = { [key]: saved({ ...written, notes: "newer local note" }, 9000),
    [existingKey]: saved({ ...record, kind: "word", sourceId: "existing", notes: "old" }, 2000) };
  const importing = fixture({ [Store.KEY]: { schemaVersion: 1, records: current }, [Core.STORAGE_KEY]: Core.DEFAULTS,
    iknowReaderTheme: "paper", iknowReaderPanelTheme: "paper" });
  const incoming = clone(exported);
  incoming.library.records[existingKey] = saved({ ...record, kind: "word", sourceId: "existing", notes: "newer backup note" }, 3000);
  incoming.library.records[addedKey] = saved({ ...record, kind: "word", sourceId: "new", notes: "brand new" }, 3000);
  const preview = await importing.backend.previewBackup(JSON.stringify(incoming));
  assert.deepEqual(preview, { newItems: 1, existingItems: 2, totalItems: 3, backupItems: 3, hasSettings: true, added: 1, updated: 1, kept: 1, learningItems: 0 });
  assert.equal(importing.writes.length, 0, "Preview must not write");
  const summary = await importing.backend.importBackup(incoming);
  assert.equal(summary.importedSettings, false);
  assert.equal(importing.writes.length, 1); assert.deepEqual(Object.keys(importing.writes[0]), [Store.KEY, LearningStore.KEY]);
  assert.equal(importing.data[Store.KEY].records[key].notes, "newer local note");
  assert.equal(importing.data[Store.KEY].records[existingKey].notes, "newer backup note");
  assert.equal(importing.data[Store.KEY].records[addedKey].notes, "brand new");
  assert.equal(Object.keys(importing.data[Store.KEY].records).length, 3);
  const withSettings = await importing.backend.importBackup(incoming, { includeSettings: true });
  assert.equal(withSettings.importedSettings, true);
  assert.deepEqual(Object.keys(importing.writes[1]).sort(), [Store.KEY, Core.STORAGE_KEY, "iknowReaderTheme", "iknowReaderPanelTheme", Store.PREFERENCES_KEY, LearningStore.KEY].sort());
  assert.equal(importing.data.iknowReaderTheme, "tokyo"); assert.equal(importing.data.iknowReaderPanelTheme, "forest");
  assert.equal(importing.data[Core.STORAGE_KEY].romajiStyle, "spoken");
  assert.deepEqual(importing.data[Store.PREFERENCES_KEY], { attempts: "single", gapPosition: "random" });
  const legacy = clone(incoming); delete legacy.settings.study;
  await importing.backend.importBackup(legacy, { includeSettings: true });
  assert.deepEqual(importing.data[Store.PREFERENCES_KEY], { attempts: "single", gapPosition: "random" }, "Old backups must not reset attempts");
  assert.equal((await importing.backend.previewBackup(backup({}))).hasSettings, false);

  const poisonCases = [
    value => { value.schemaVersion = 2; }, value => { value.format = "some-other-app"; },
    value => { value.exportedAt = -1; }, value => { value.unknown = "forbidden"; },
    value => { value.library.records[key].audioUrl = "https://evil.test/x.mp3"; },
    value => { value.library.records[key].key = "sentence:19053:wrong"; },
    value => { value.library.records[key].updatedAt = Infinity; },
    value => { value.library.records[key].notes = "x".repeat(4001); },
    value => { value.library.records[key].review.dueAt = -1; },
    value => { value.library.records[key].review.intervalDays = 366; },
    value => { value.library.records[key].review.lapses = 1000001; },
    value => { value.library.records[key].review.lastRating = "easy"; },
    value => { value.library.records[key].credentials = "forbidden"; },
    value => { value.library.records[key].context = { japanese: "a", unknown: true }; },
    value => { value.settings.reading.wordAudioSpeed = "1"; },
    value => { value.settings.reading.autoPrepare = true; },
    value => { value.settings.reading.tokens = "forbidden"; },
    value => { value.settings.appTheme = "unknown"; }, value => { value.settings.credentials = "forbidden"; },
    value => { value.settings.study.attempts = "unlimited"; }, value => { value.settings.study.credentials = "forbidden"; },
    value => { value.learning.session = { private: "must not import" }; }, value => { value.learning.records[key] = { review: { dueAt: -1 } }; },
    value => { value.library.records = JSON.parse('{"__proto__":{"japanese":"bad"}}'); },
    value => { value.library.records[key] = JSON.parse('{"__proto__":{"kind":"sentence"}}'); },
    value => { value.settings = JSON.parse('{"__proto__":{"reading":{}}}'); },
  ];
  const unchanged = importing.data, unchangedWrites = importing.writes.length;
  for (const poison of poisonCases) {
    const value = clone(exported); poison(value);
    await assert.rejects(async () => importing.backend.previewBackup(value));
    await assert.rejects(async () => importing.backend.importBackup(value, { includeSettings: true }));
    assert.deepEqual(importing.data, unchanged); assert.equal(importing.writes.length, unchangedWrites);
  }
  await assert.rejects(async () => importing.backend.importBackup(incoming, { replace: true }));
  await assert.rejects(async () => importing.backend.previewBackup("x".repeat(Store.MAX_BACKUP_BYTES + 1)));
  const tooMany = {};
  for (let index = 0; index <= Store.MAX_RECORDS; index++) { const item = saved({ ...record, sourceId: `many${index}` }); tooMany[item.key] = item; }
  await assert.rejects(async () => importing.backend.previewBackup(backup(tooMany)));
  delete tooMany[Object.keys(tooMany)[0]];
  await assert.rejects(async () => importing.backend.importBackup(backup(tooMany)), /full/);
  const tooLarge = {};
  for (let index = 0; index < 350; index++) {
    const item = saved({ ...record, sourceId: `large${index}`, japanese: "x".repeat(5000), kana: "x".repeat(5000),
      jpan: "x".repeat(5000), romaji: "x".repeat(5000), english: "x".repeat(5000) }); tooLarge[item.key] = item;
  }
  await assert.rejects(async () => importing.backend.previewBackup(backup(tooLarge)), /size limit|too large/);
  assert.deepEqual(importing.data, unchanged);

  const unknown = fixture({ [Store.KEY]: { schemaVersion: 2, records: { personal: "retained" } } });
  const unknownBefore = unknown.data;
  await assert.rejects(unknown.backend.save(record));
  await assert.rejects(unknown.backend.importBackup(exported));
  assert.deepEqual(unknown.data, unknownBefore); assert.equal(unknown.writes.length, 0);

  const oldSkill = Learning.next(undefined, "good", 2000), newSkill = Learning.next(oldSkill, "again", 5000);
  const progress = fixture({ [LearningStore.KEY]: { schemaVersion: 1, records: { [key]: { review: newSkill, listening: oldSkill } }, session: null } });
  const learnedBackup = backup({}); learnedBackup.learning = { records: { [key]: { review: oldSkill, cloze: newSkill } } };
  assert.equal((await progress.backend.previewBackup(learnedBackup)).learningItems, 1, "A progress-only backup makes its learning count visible");
  await progress.backend.importBackup(learnedBackup);
  assert.deepEqual(progress.data[LearningStore.KEY].records[key], { review: newSkill, listening: oldSkill, cloze: newSkill });
  assert.deepEqual(Object.keys(progress.writes[0]).sort(), [Store.KEY, LearningStore.KEY].sort(), "Library and learning restore together");
  const beforeOld = progress.data[LearningStore.KEY]; await progress.backend.importBackup(backup({}));
  assert.deepEqual(progress.data[LearningStore.KEY], beforeOld, "Old backups do not reset learning history");
  const progressExport = await progress.backend.exportBackup(); assert.deepEqual(progressExport.learning.records, beforeOld.records); assert.equal("session" in progressExport.learning, false);

  // Personal data and backup mutations are restricted to the top-level Study page.
  let listener, currentSender;
  const messaging = fixture();
  const extensionId = "test-extension", studySender = { id: extensionId, url: `chrome-extension://${extensionId}/study.html`, frameId: 0 };
  const dispatch = (message, sender = studySender) => new Promise((resolve, reject) => {
    const result = listener(message, sender, resolve);
    if (result !== true && !message.type.startsWith("ikr:study:")) reject(Error("Unhandled test message"));
  });
  global.chrome = { storage: { local: messaging.storage }, tabs: { create: async () => ({}) }, runtime: {
    id: extensionId, getURL: name => `chrome-extension://${extensionId}/${name}`, onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: message => dispatch(message, currentSender || studySender)
  } };
  Store.listenBackground();
  await Store.save(record);
  const privateMessages = [ { type: "ikr:study:notes", key, notes: "must not save" }, { type: "ikr:study:rate", key, rating: "good" },
    { type: "ikr:study:backup:export" }, { type: "ikr:study:backup:preview", backup: exported },
    { type: "ikr:study:backup:import", backup: exported, options: { includeSettings: true } },
    { type: "ikr:study:preferences:get" }, { type: "ikr:study:preferences:set", preferences: { attempts: "single" } } ];
  const untrusted = [ { id: extensionId, url: "https://iknow.jp/courses/19053", frameId: 0 },
    { id: extensionId, url: `chrome-extension://${extensionId}/popup.html`, frameId: 0 },
    { ...studySender, frameId: 2 }, { ...studySender, id: "another-extension" },
    { ...studySender, url: "https://evil.test/study.html" }, { ...studySender, url: `chrome-extension://${extensionId}/other.html` } ];
  const beforeDenied = messaging.data, writesBeforeDenied = messaging.writes.length;
  for (const sender of untrusted) for (const message of privateMessages) assert.equal((await dispatch(message, sender)).ok, false);
  assert.deepEqual(messaging.data, beforeDenied); assert.equal(messaging.writes.length, writesBeforeDenied);
  assert.deepEqual(await Store.getPreferences(), { attempts: "retry", gapPosition: "random" });
  assert.deepEqual(await Store.setPreferences({ attempts: "single" }), { attempts: "single", gapPosition: "random" });
  assert.deepEqual(await Store.getPreferences(), { attempts: "single", gapPosition: "random" });
  assert.equal((await Store.updateNotes(key, "allowed note")).notes, "allowed note");
  assert.equal((await Store.rate(key, "hard")).review.lastRating, "hard");
  const publicBackup = await Store.exportBackup(); assert.equal(publicBackup.library.records[key].notes, "allowed note");
  assert.equal((await Store.previewBackup(publicBackup)).backupItems, 1);
  assert.equal((await Store.importBackup(publicBackup, { includeSettings: true })).importedSettings, true);
  const courseSender = untrusted[0];
  assert.equal((await dispatch({ type: "ikr:study:save", record: { ...record, courseId: "19054" } }, courseSender)).ok, false);
  assert.equal((await dispatch({ type: "ikr:study:save", record }, courseSender)).ok, true);
  assert.equal((await Store.list())[0].notes, "allowed note");
  delete global.chrome;
  console.log("PASS Personal notes and reviews survive concurrent source saves; backups validate completely, merge atomically with optional safe preferences, reject corrupt inputs, and enforce top-level Study-only access");
})().catch(error => { console.error(error); process.exitCode = 1; });
