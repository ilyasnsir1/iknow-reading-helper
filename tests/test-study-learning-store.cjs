"use strict";
const assert = require("node:assert/strict"), Learning = require("../extension/study-learning.js"), Store = require("../extension/study-learning-store.js"), Study = require("../extension/study-store.js");
const DAY = Learning.DAY_MS, NOW = Date.UTC(2026, 9, 30, 12), clone = value => structuredClone(value);
function fixture(initial = {}) {
  let data = clone(initial), clock = NOW, rejectWrite = false;
  const writes = [], storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, clone(data[key])])),
    set: async patch => { await new Promise(resolve => setTimeout(resolve, 1)); if (rejectWrite) { rejectWrite = false; throw Error("Storage full"); } writes.push(clone(patch)); data = { ...data, ...clone(patch) }; }
  };
  return { storage, backend: Store.createBackend(storage, { now: () => clock }), get data() { return clone(data); }, get writes() { return clone(writes); }, set clock(value) { clock = value; }, failNextWrite() { rejectWrite = true; } };
}
function card(sourceId = "one") {
  const record = { kind: "sentence", courseId: "19053", courseTitle: "Core 2000 Step 1", sourceId, japanese: "私は学校へ行きます。", jpan: "私 は 学校 へ 行きます 。", kana: "わたし は がっこう へ いきます。", romaji: "watashi ha gakkou he ikimasu.", english: "I go to school.", german: "Ich gehe zur Schule.", audioUrl: "https://assets0.iknow.jp/assets/test.mp3" };
  return { ...record, key: Study.makeKey(record), createdAt: NOW - DAY, updatedAt: NOW - DAY };
}
function draft(id = "session-one", extra = {}) { return { id, kind: "practice", mode: "review", cards: [card(), card("two")], index: 0, attemptPolicy: "retry", gapPosition: "random", language: "en", createdAt: NOW, label: "Selected items", pool: [card(), card("two")], ...extra }; }
const result = (sessionId, index, outcome = "good") => ({ sessionId, index, outcome, firstCorrect: outcome === "good" });
(async () => {
  const empty = fixture();
  assert.deepEqual(await empty.backend.progress(), { records: {} }); assert.equal(await empty.backend.getSession(), null); assert.equal(empty.writes.length, 0);
  const initial = draft(), session = await empty.backend.startSession(initial);
  initial.cards[0].japanese = "Mutated input";
  assert.equal((await empty.backend.getSession()).cards[0].japanese, "私は学校へ行きます。");
  assert.equal(session.results.length, 0); assert.equal(session.index, 0);
  const oldCheckpoint = clone(session); delete oldCheckpoint.attempts; delete oldCheckpoint.state;
  const legacyCheckpoint = fixture({ [Store.KEY]: { schemaVersion: 1, records: {}, session: oldCheckpoint } });
  assert.equal((await legacyCheckpoint.backend.getSession()).attempts, 0);
  assert.equal((await legacyCheckpoint.backend.getSession()).state, "active", "An older running checkpoint continues automatically");
  assert.equal(legacyCheckpoint.writes.length, 0, "Adding the attempt counter never rewrites an older checkpoint just by reading it");
  await assert.rejects(empty.backend.startSession(draft("different")), /Finish or end/);
  const reloaded = Store.createBackend(empty.storage, { now: () => NOW + 1000 });
  assert.deepEqual(await reloaded.getSession(), session, "Reload resumes the exact card order and settings");
  const same = await reloaded.startSession(draft()); assert.deepEqual(same, session);
  assert.equal((await reloaded.setSessionState(session.id, "paused")).state, "paused");
  assert.equal((await Store.createBackend(empty.storage).getSession()).state, "paused", "Only an explicit pause survives as paused");
  const pauseWrites = empty.writes.length;
  await reloaded.setSessionState(session.id, "paused"); assert.equal(empty.writes.length, pauseWrites);
  empty.failNextWrite(); await assert.rejects(reloaded.setSessionState(session.id, "active"), /Storage full/);
  assert.equal((await reloaded.getSession()).state, "paused", "A failed resume does not silently replace the paused state");
  await reloaded.setSessionState(session.id, "active");
  await assert.rejects(reloaded.setSessionState("different", "paused"), /no longer active/);
  await assert.rejects(async () => reloaded.setSessionState(session.id, "finished"), /valid session state/);
  empty.failNextWrite(); await assert.rejects(empty.backend.commit(result(session.id, 0)), /Storage full/);
  assert.equal((await empty.backend.getSession()).index, 0); assert.deepEqual(await empty.backend.progress(), { records: {} });
  const beforeDouble = empty.writes.length;
  const replies = await Promise.all([empty.backend.commit(result(session.id, 0)), reloaded.commit(result(session.id, 0))]);
  assert.equal(replies[0].index, 1); assert.equal(replies[1].index, 1); assert.equal(empty.writes.length, beforeDouble + 1, "Duplicate commits do not advance or grade twice");
  let progress = await empty.backend.progress();
  assert.equal(progress.records[card().key].review.repetitions, 1); assert.equal(progress.records[card().key].listening, undefined);
  await assert.rejects(empty.backend.commit(result(session.id, 0, "again")), /different result/);
  await assert.rejects(empty.backend.commit(result(session.id, 3)), /current practice/);
  await empty.backend.commit(result(session.id, 1, "hard"));
  assert.equal((await empty.backend.getSession()).index, 2);
  assert.deepEqual((await empty.backend.getSession()).results.map(item => item.firstCorrect), [true, false]);
  assert.equal((await reloaded.getSession()).index, 2, "A finished summary remains durable");
  await empty.backend.endSession(session.id); assert.equal(await empty.backend.getSession(), null);
  await empty.backend.endSession(session.id); // Safe retry of an acknowledged end.
  await empty.backend.startSession(draft("listening", { mode: "listening", kind: "test", attemptPolicy: "single", cards: [card()], courseId: "19053", sourceFingerprint: "course:19053:source-v1" }));
  await assert.rejects(empty.backend.commit(result("listening", 0, "hard")), /current practice/);
  await empty.backend.commit(result("listening", 0, "again"));
  progress = await empty.backend.progress();
  assert.equal(Learning.strength(progress.records[card().key].review), "learning");
  assert.equal(Learning.strength(progress.records[card().key].listening), "weak", "Listening failure cannot erase meaning progress");
  assert.equal((await empty.backend.getSession()).results[0].firstCorrect, false);
  await empty.backend.endSession("listening");
  const cloze = draft("cloze", { mode: "cloze", cards: [card()], targets: { [card().key]: 2 } });
  await empty.backend.startSession(cloze);
  assert.equal((await Store.createBackend(empty.storage).getSession()).targets[card().key], 2, "The random gap survives a fresh backend");
  await empty.backend.endSession("cloze");
  const attempts = fixture();
  await attempts.backend.startSession(draft("attempts"));
  assert.equal((await attempts.backend.getSession()).attempts, 0);
  assert.equal((await attempts.backend.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 1 })).attempts, 1);
  const attemptWrites = attempts.writes.length;
  assert.equal((await attempts.backend.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 1 })).attempts, 1);
  assert.equal(attempts.writes.length, attemptWrites, "Retrying the same attempt checkpoint is read-only");
  const afterRefresh = Store.createBackend(attempts.storage, { now: () => NOW + 1000 });
  assert.equal((await afterRefresh.getSession()).attempts, 1, "A wrong retry survives a page or background reload");
  await assert.rejects(afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 3 }), /does not follow/);
  await Promise.all([afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 2 }), attempts.backend.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 2 })]);
  assert.equal(attempts.writes.length, attemptWrites + 1);
  await assert.rejects(afterRefresh.commit(result("attempts", 0)), /saved answer attempts/);
  const afterRetry = await afterRefresh.commit(result("attempts", 0, "hard"));
  assert.equal(afterRetry.index, 1); assert.equal(afterRetry.attempts, 0); assert.equal(afterRetry.results[0].firstCorrect, false);
  await assert.rejects(afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 2 }), /current practice item/);
  attempts.failNextWrite();
  await assert.rejects(afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 1, attempt: 1 }), /Storage full/);
  assert.equal((await afterRefresh.getSession()).attempts, 0, "A failed checkpoint can be retried without consuming an attempt");
  await afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 1, attempt: 1 });
  await assert.rejects(afterRefresh.commit(result("attempts", 1, "hard")), /saved answer attempts/);
  await afterRefresh.commit(result("attempts", 1));
  assert.equal((await afterRefresh.getSession()).attempts, 0);
  await assert.rejects(afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 2, attempt: 1 }), /current practice item/);
  await assert.rejects(afterRefresh.checkpointAttempt({ sessionId: "replaced", index: 1, attempt: 1 }), /current practice item/);
  for (const bad of [0, -1, 1.5, Infinity, Learning.MAX_COUNTER + 1, "1"]) await assert.rejects(async () => afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: bad }));
  await assert.rejects(async () => afterRefresh.checkpointAttempt({ sessionId: "attempts", index: 0, attempt: 1, unknown: true }));
  const writesBeforeBad = empty.writes.length;
  for (const bad of [draft("bad", { unknown: true }), draft("bad", { cards: [card(), card()] }), draft("bad", { index: 1 }), draft("bad", { results: [{ outcome: "good" }] }),
    draft("bad", { attemptPolicy: "unlimited" }), draft("bad", { state: "finished" }), draft("bad", { attempts: 1 }), draft("bad", { attempts: null }), draft("bad", { language: "fr" }), draft("bad", { label: "x".repeat(501) }), draft("bad", { mode: "cloze" }),
    draft("bad", { mode: "cloze", cards: [card()], targets: { [card().key]: 1 } }), draft("bad", { targets: { [card().key]: 0 } }),
    draft("bad", { cards: [{ ...card(), audioUrl: "https://evil.test/audio.mp3" }] }), draft("bad", { pool: [{ ...card(), key: "wrong" }] }),
    draft("bad", { sourceFingerprint: "bad\nline" }), draft("bad", { courseId: "../1" }), draft("bad", { cards: [] })]) {
    await assert.rejects(async () => empty.backend.startSession(bad));
  }
  for (const bad of [{ ...result("x", 0), firstCorrect: false }, { ...result("x", 0), extra: true }, result("x", -1), result("x", 0, "easy")]) await assert.rejects(async () => empty.backend.commit(bad));
  assert.equal(empty.writes.length, writesBeforeBad);
  const oldSkill = Learning.next(undefined, "good", NOW), newerSkill = Learning.next(undefined, "again", NOW + DAY);
  const merged = Store.mergeProgress({ records: { [card().key]: { review: oldSkill, listening: newerSkill } } }, { records: { [card().key]: { review: newerSkill, listening: oldSkill } } });
  assert.deepEqual(merged.records[card().key], { review: newerSkill, listening: newerSkill });
  assert.deepEqual(Store.mergeProgress(merged, merged), merged);
  for (const bad of [{ records: { [card().key]: { review: {} } } }, { records: {}, session: null }, { records: { invalid: { review: oldSkill } } }, { records: { [card().key]: { speaking: oldSkill } } }]) assert.throws(() => Store.validateProgress(bad));
  // Import and grading use the same transaction lane; neither can roll back the other.
  const shared = fixture(), bookmarkStore = Study.createBackend(shared.storage, () => NOW);
  await bookmarkStore.save(card());
  const backup = await bookmarkStore.exportBackup();
  backup.learning = { records: { [card("two").key]: { cloze: oldSkill } } };
  await shared.backend.startSession(draft("race"));
  await Promise.all([shared.backend.commit(result("race", 0)), bookmarkStore.importBackup(backup)]);
  assert.equal((await shared.backend.getSession()).index, 1);
  assert.equal((await shared.backend.progress()).records[card().key].review.lastRating, "good");
  assert.equal((await shared.backend.progress()).records[card("two").key].cloze.lastRating, "good");
  assert.equal(Object.keys((await bookmarkStore.read()).records).length, 1);
  // Invalid future data is preserved without a destructive automatic reset.
  for (const unsafe of [{ schemaVersion: 9, records: {}, session: null }, { schemaVersion: 1, records: { invalid: {} }, session: null }]) {
    const current = fixture({ [Store.KEY]: unsafe }), before = current.data;
    await assert.rejects(current.backend.progress()); await assert.rejects(current.backend.startSession(draft()));
    assert.deepEqual(current.data, before); assert.equal(current.writes.length, 0);
  }
  const full = fixture(), fullCards = Array.from({ length: Store.MAX_SESSION_ITEMS }, (_, index) => card(String(index)));
  const fullSession = await full.backend.startSession(draft("all-items", { cards: fullCards }));
  assert.equal(fullSession.cards.length, 2000, "The whole explicit selection is checkpointed without a hidden session cap");
  assert.equal((await full.backend.commit(result("all-items", 0))).cards.length, 2000);
  await full.backend.endSession("all-items");
  await assert.rejects(async () => full.backend.startSession(draft("too-many", { cards: [...fullCards, card("extra")] })));
  const tooLarge = fullCards.slice(0, 1300).map(item => ({ ...item, japanese: "字".repeat(5000), english: "x".repeat(5000) }));
  await assert.rejects(async () => full.backend.startSession(draft("too-large", { cards: tooLarge })), /size limit/);
  const maximumProgress = { records: Object.fromEntries(Array.from({ length: Store.MAX_RECORDS }, (_, index) => [`word:19053:${index}`, { review: oldSkill }])) };
  assert.equal(Object.keys(Store.validateProgress(maximumProgress).records).length, 10000);
  maximumProgress.records["word:19053:extra"] = { review: oldSkill };
  assert.throws(() => Store.validateProgress(maximumProgress), /too large/);
  // The runtime command boundary is private to the extension's top-level Study page.
  let listener; const privateFixture = fixture();
  global.chrome = { storage: { local: privateFixture.storage }, runtime: { id: "test-id", getURL: file => `chrome-extension://test-id/${file}`, onMessage: { addListener: fn => { listener = fn; } } } };
  Store.listenBackground(); assert.equal(typeof listener, "function");
  const sender = { id: "test-id", frameId: 0, url: "chrome-extension://test-id/study.html?course=19053" };
  const send = (message, source = sender) => new Promise(resolve => { const accepted = listener(message, source, resolve); if (accepted === undefined && !String(message.type).startsWith("ikr:learning:")) resolve(undefined); });
  const commands = [{ type: "ikr:learning:progress" }, { type: "ikr:learning:session:get" }, { type: "ikr:learning:session:start", session: draft("private") }, { type: "ikr:learning:session:state", sessionId: "private", state: "paused" }, { type: "ikr:learning:attempt", attempt: { sessionId: "private", index: 0, attempt: 1 } }, { type: "ikr:learning:commit", result: result("private", 0) }, { type: "ikr:learning:session:end", sessionId: "private" }];
  for (const bad of [{ ...sender, frameId: 1 }, { ...sender, id: "other-extension" }, { ...sender, url: "https://iknow.jp/courses/19053" }, { ...sender, url: "chrome-extension://test-id/popup.html" }, { ...sender, url: "chrome-extension://evil/study.html" }, { ...sender, url: "chrome-extension://test-id/study.html/other" }]) {
    for (const command of commands) assert.equal((await send(command, bad)).ok, false);
  }
  assert.equal(privateFixture.writes.length, 0);
  for (const command of commands) assert.equal((await send(command)).ok, true);
  global.chrome.runtime.sendMessage = message => send(message);
  assert.equal(await Store.getSession(), null); assert.ok((await Store.progress()).records[card().key].review);
  const reply = await Store.startSession(draft("api")); assert.equal(reply.id, "api");
  assert.equal((await Store.setSessionState("api", "paused")).state, "paused"); assert.equal((await Store.setSessionState("api", "active")).state, "active");
  assert.equal((await Store.checkpointAttempt({ sessionId: "api", index: 0, attempt: 1 })).attempts, 1);
  assert.equal((await Store.commit(result("api", 0))).index, 1); assert.equal(await Store.endSession("api"), null);
  delete global.chrome;
  console.log("PASS Durable checkpoints preserve independent skills, first-attempt results and fixed gaps; retries/imports are atomic and only top-level Study can write");
})().catch(error => { console.error(error); process.exitCode = 1; });
