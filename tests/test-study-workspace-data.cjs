"use strict";
const assert = require("node:assert/strict");
const Core = require("../extension/core.js"), Study = require("../extension/study-store.js"), Learning = require("../extension/study-learning.js");
const Progress = require("../extension/study-learning-store.js"), Practice = require("../extension/study-practice.js");
const Runtime = require("../extension/study-workspace-data.js");
const clone = value => structuredClone(value), DAY = Learning.DAY_MS, NOW = Date.UTC(2026, 9, 31, 12);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function card(sourceId = "one", courseId = "19053") {
  const source = { kind: "sentence", courseId, courseTitle: "Real saved course", sourceId,
    japanese: "私は学校へ行きます。", jpan: "私 は 学校 へ 行きます 。", kana: "わたし は がっこう へ いきます。", romaji: "watashi ha gakkou he ikimasu.",
    english: "I go to school.", german: "Ich gehe zur Schule.", audioUrl: "https://assets0.iknow.jp/assets/test.mp3", notes: "My own note" };
  return { ...source, key: Study.makeKey(source), createdAt: NOW - DAY, updatedAt: NOW - DAY };
}
function fixture() {
  const first = card(), listeners = new Set(), writes = [];
  let time = NOW, failRead = false, failWrite = false;
  let data = { [Study.KEY]: { schemaVersion: 1, records: { [first.key]: first } },
    [Core.STORAGE_KEY]: Core.normalizeSettings({ translationLanguage: "de", wordNeuralVoice: "male", followPanels: true }),
    iknowReaderTheme: "midnight", iknowReaderPanelTheme: "forest", modelSentinel: { installed: true }, courseCacheSentinel: [1, 2, 3] };
  const storage = {
    async get(keys) {
      if (failRead) { failRead = false; throw Error("Read unavailable"); }
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, clone(data[key])]));
    },
    async set(patch) {
      if (failWrite) { failWrite = false; throw Error("Storage full"); }
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: clone(data[key]), newValue: clone(value) }]));
      writes.push(clone(patch)); data = { ...data, ...clone(patch) }; for (const listener of listeners) listener(changes, "local");
    }
  };
  const studyBackend=Study.createBackend(storage,()=>time);
  const study = { ...Study, ...studyBackend, list:async()=>Object.values((await studyBackend.read()).records) }, progress = { ...Progress, ...Progress.createBackend(storage, { now: () => time }) };
  const browser = { runtime: { id: "isolated-extension" }, storage: { local: storage, onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } } };
  const runtime = Runtime.create({ chrome: browser, store: study, learningStore: progress, core: Core, learning: Learning });
  return { first, runtime, study, progress, storage, writes, listeners, get data() { return clone(data); }, set clock(value) { time = value; }, failRead() { failRead = true; }, failWrite() { failWrite = true; } };
}
function round(record, extra = {}) {
  return { runtimeId: "round-one", keys: [record.key], pool: [record], mode: "review", attempts: "retry", startedAt: NOW, test: false, exercises: [], ...extra };
}
(async () => {
  assert.equal(Runtime.create({ chrome: {} }), null, "The localhost page cannot silently become an extension store");
  const f = fixture(), initial = f.data, snapshot = await f.runtime.loadSnapshot();
  assert.equal(f.writes.length, 0, "Opening the new workspace never rewrites or clears existing data");
  assert.deepEqual(snapshot.library.records[f.first.key], f.first);
  assert.equal(snapshot.reading.translationLanguage, "de"); assert.equal(snapshot.appTheme, "midnight"); assert.equal(snapshot.panelTheme, "forest");
  assert.deepEqual(snapshot.learning, { schemaVersion: 1, records: {}, session: null });
  snapshot.library.records[f.first.key].notes = "External mutation";
  assert.equal((await f.runtime.loadSnapshot()).library.records[f.first.key].notes, "My own note");
  assert.equal(f.runtime.strength(f.first.key, snapshot.learning), "new", "An unpractised record never receives a demo strength");

  const updates = [], failures = [];
  const unsubscribe = f.runtime.subscribe(value => updates.push(value), error => failures.push(error.message));
  await f.runtime.setLanguage("both"); await f.runtime.setTheme("tokyo"); await pause(80);
  assert.ok(updates.length >= 1); assert.equal(updates.at(-1).reading.translationLanguage, "both"); assert.equal(updates.at(-1).appTheme, "tokyo");
  assert.equal(f.data[Core.STORAGE_KEY].wordNeuralVoice, "male"); assert.equal(f.data[Core.STORAGE_KEY].followPanels, true);
  assert.equal(f.data.iknowReaderPanelTheme, "forest", "App themes never change the iKnow panel theme");
  await assert.rejects(f.runtime.setLanguage("foreign"), /valid translation/); await assert.rejects(f.runtime.setTheme("bad"), /valid theme/);
  f.failWrite(); await assert.rejects(f.runtime.setTheme("paper"), /Storage full/); assert.equal(f.data.iknowReaderTheme, "tokyo");
  await f.runtime.setTheme("midnight"); await pause(80);

  const active = await f.runtime.beginRound(round(f.first), { language: "both", gapPosition: "first" });
  assert.equal(active.id, "round-one"); assert.equal(active.language, "both"); assert.equal(active.gapPosition, "first");
  assert.equal(active.cards[0].notes, undefined, "Frozen course source does not duplicate private notes");
  await assert.rejects(f.runtime.beginRound(round(f.first, { runtimeId: "different" })), /Finish or end/);
  assert.equal((await f.runtime.getRound()).id, "round-one", "A pre-existing session is not silently ended");
  await f.runtime.submitAttempt(active.id, 0, 1); await f.runtime.submitAttempt(active.id, 0, 2);
  f.failWrite(); await assert.rejects(f.runtime.commitAnswer(active.id, 0, "hard"), /Storage full/);
  assert.equal((await f.runtime.getRound()).index, 0, "A failed grade cannot advance the saved question");
  const graded = await f.runtime.commitAnswer(active.id, 0, "hard");
  assert.equal(graded.index, 1); assert.equal(graded.results[0].outcome, "hard");
  const afterGrade = f.writes.length;
  await f.runtime.commitAnswer(active.id, 0, "hard"); assert.equal(f.writes.length, afterGrade, "Retrying a successful commit cannot award a second grade");
  assert.equal(f.runtime.strength(f.first.key, (await f.runtime.loadSnapshot()).learning), "learning");
  await f.runtime.endRound(active.id);

  const gap = Practice.buildCloze(f.first, { targetIndex: 2 }); assert.ok(gap);
  const cloze = await f.runtime.beginRound(round(f.first, { runtimeId: "gap-round", mode: "cloze", exercises: [gap] }));
  assert.equal(cloze.targets[f.first.key], gap.targetIndex, "The durable session uses exactly the displayed missing word");
  const backup = await f.runtime.exportBackup(), second = card("two", "19055");
  backup.library.records[second.key] = second;
  assert.equal((await f.runtime.previewBackup(backup)).added, 1);
  await f.runtime.importBackup(backup, { includeSettings: false });
  assert.equal((await f.runtime.getRound()).id, cloze.id, "Import retains the active checkpoint");
  await f.runtime.endRound(cloze.id);
  await f.runtime.updateNotes(second.key, "Updated real note");
  assert.equal((await f.runtime.loadSnapshot()).library.records[second.key].notes, "Updated real note");
  const unsaved = card("course-only", "19057");
  await f.runtime.beginRound(round(unsaved, { runtimeId: "course-round", test: true, courseId: "19057", courseTitle: "Course-only test" }));
  await f.runtime.commitAnswer("course-round", 0, "good"); await f.runtime.endRound("course-round");
  assert.equal((await f.runtime.loadSnapshot()).library.records[unsaved.key], undefined, "Practising a full course never bookmarks every question");

  for (let day = 0; day < 3; day++) {
    f.clock = NOW + DAY * day;
    const id = "day-" + day;
    await f.runtime.beginRound(round(f.first, { runtimeId: id, startedAt: NOW + DAY * day }));
    await f.runtime.commitAnswer(id, 0, "good"); await f.runtime.endRound(id);
  }
  const learned = await f.runtime.loadSnapshot();
  assert.equal(f.runtime.strength(f.first.key, learned.learning, "review"), "strong");
  assert.equal(f.runtime.strength(f.first.key, learned.learning, "listening"), "new", "Listening and meaning keep separate skill histories");

  const staleKeys = Object.keys(learned.library.records), third = card("three"); await f.study.save(third);
  await assert.rejects(f.runtime.removeAll(staleKeys), /library changed/);
  assert.ok((await f.runtime.loadSnapshot()).library.records[third.key]);
  const beforeDelete = await f.runtime.loadSnapshot(); await f.runtime.removeAll(Object.keys(beforeDelete.library.records));
  const empty = await f.runtime.loadSnapshot(); assert.deepEqual(empty.library.records, {}); assert.deepEqual(empty.learning.records, beforeDelete.learning.records);
  assert.deepEqual(f.data.modelSentinel, initial.modelSentinel); assert.deepEqual(f.data.courseCacheSentinel, initial.courseCacheSentinel);
  await pause(80); const previousUpdates = updates.length; unsubscribe(); assert.equal(f.listeners.size, 0);
  await f.runtime.setTheme("paper"); await pause(80); assert.equal(updates.length, previousUpdates, "Unmounted workspaces do not keep receiving reads");
  assert.deepEqual(failures, []);
  console.log("PASS Real workspace data: validated snapshots, live storage subscription, source-preserving backup/delete/settings, durable attempt/grade writes, exact gap targets, no silent session replacement or demo strength");
})().catch(error => { console.error(error); process.exitCode = 1; });
