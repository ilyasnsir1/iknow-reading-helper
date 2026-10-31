"use strict";
const assert = require("node:assert/strict");
const Practice = require("../extension/study-practice.js");
const Core = require("../extension/core.js");
const NOW = Date.UTC(2026, 9, 30, 12), DAY = Practice.DAY_MS;
const sentence = {
  kind: "sentence", key: "sentence:19053:1", createdAt: NOW - DAY,
  japanese: "私は学校へ本を持って行きます。", jpan: "私 は 学校 へ 本 を 持って 行きます 。",
  kana: "わたし は がっこう へ ほん を もって いきます。",
  romaji: "watashi ha gakkou he hon wo motte ikimasu.", audioUrl: "https://assets0.iknow.jp/a.mp3"
};

// Ratings set a real due date and preserve the counters across sessions.
let review = Practice.nextReview(undefined, "good", NOW);
assert.deepEqual(review, { dueAt: NOW + DAY, lastReviewedAt: NOW, intervalDays: 1, repetitions: 1, lapses: 0, lastRating: "good" });
review = Practice.nextReview(review, "good", NOW + DAY);
assert.equal(review.intervalDays, 3);
review = Practice.nextReview(review, "good", NOW + 4 * DAY);
assert.equal(review.intervalDays, 6);
review = Practice.nextReview(review, "hard", NOW + 10 * DAY);
assert.equal(review.dueAt, NOW + 11 * DAY); assert.equal(review.intervalDays, 1);
review = Practice.nextReview(review, "again", NOW + 11 * DAY);
assert.equal(review.dueAt, NOW + 11 * DAY + 600000); assert.equal(review.intervalDays, 0);
assert.equal(review.repetitions, 0); assert.equal(review.lapses, 1);
for (let count = 0; count < 40; count++) review = Practice.nextReview(review, "good", NOW + (20 + count) * DAY);
assert.equal(review.intervalDays, 365);
assert.equal(Practice.nextReview(null, "good", Practice.DATE_LIMIT).dueAt, Practice.DATE_LIMIT);
assert.equal(Practice.nextReview({ ...review, repetitions: 1000000 }, "good", NOW).repetitions, 1000000);
for (const rating of ["easy", "Good", "", null, undefined]) assert.throws(() => Practice.nextReview(null, rating, NOW));
for (const stamp of [Infinity, NaN, -1, 1.5, Practice.DATE_LIMIT + 1]) assert.throws(() => Practice.nextReview(null, "good", stamp));
for (const bad of [{}, { ...review, dueAt: NaN }, { ...review, intervalDays: 366 }, { ...review, repetitions: -1 }, { ...review, dueAt: 0, lastReviewedAt: 1 }]) {
  assert.throws(() => Practice.nextReview(bad, "good", NOW));
}

// The blank removes an entire published segment, preserving all other text.
const original = structuredClone(sentence), cloze = Practice.buildCloze(sentence);
assert.equal(cloze.before, ""); assert.equal(cloze.answerJapanese, "私");
assert.equal(cloze.after, "は学校へ本を持って行きます。");
assert.equal(cloze.answerKana, "わたし"); assert.equal(cloze.answerRomaji, "watashi");
assert.equal(cloze.before + cloze.answerJapanese + cloze.after, sentence.japanese);
assert.equal(Practice.checkAnswer(cloze, "ＷＡＴＡＳＨＩ"), true);
assert.equal(Practice.checkAnswer(cloze, " wa ta shi "), true);
assert.equal(Practice.checkAnswer(cloze, "わたし"), true);
assert.equal(Practice.checkAnswer(cloze, "I"), false);
assert.equal(Practice.checkAnswer(cloze, ""), false);
assert.deepEqual(sentence, original);

// Sentence gaps can vary, while explicit targets replay the exact same gap.
assert.equal(Practice.buildCloze(sentence, { gapPosition: "first", random: () => { throw Error("Unused RNG"); } }).targetIndex, 0);
const randomFirst = Practice.buildCloze(sentence, { gapPosition: "random", random: () => 0 });
const randomMiddle = Practice.buildCloze(sentence, { gapPosition: "random", random: () => .4 });
const randomLast = Practice.buildCloze(sentence, { gapPosition: "random", random: () => .999 });
assert.equal(randomFirst.answerJapanese, "私");
assert.equal(randomMiddle.answerJapanese, "本");
assert.equal(randomLast.answerJapanese, "行きます");
for (const chosen of [randomFirst, randomMiddle, randomLast]) {
  assert.equal(chosen.before + chosen.answerJapanese + chosen.after, sentence.japanese);
  const replay = Practice.buildCloze(sentence, { gapPosition: "random", targetIndex: chosen.targetIndex, romajiStyle: "spoken", random: () => { throw Error("Explicit target must not reroll"); } });
  assert.equal(replay.targetIndex, chosen.targetIndex); assert.equal(replay.answerJapanese, chosen.answerJapanese);
}
for (const targetIndex of [-1, 1, 3, 500, 2.5, NaN, "2"]) assert.equal(Practice.buildCloze(sentence, { targetIndex }), null);
assert.equal(Practice.buildCloze(sentence, { gapPosition: "unknown" }), null);
for (const random of [null, 2, () => -1, () => 1, () => NaN, () => Infinity]) assert.throws(() => Practice.buildCloze(sentence, { gapPosition: "random", random }));

const word = { kind: "word", key: "word:19053:2", japanese: "学校", kana: "がっこう", romaji: "gakkou", context: sentence };
const wordCloze = Practice.buildCloze(word, { romajiStyle: "spoken" });
assert.equal(wordCloze.before, "私は"); assert.equal(wordCloze.answerJapanese, "学校");
assert.equal(wordCloze.after, "へ本を持って行きます。"); assert.equal(wordCloze.targetIndex, 2);
assert.equal(Practice.checkAnswer(wordCloze, "がっこう"), true);
assert.equal(Practice.checkAnswer(wordCloze, "gakkou"), true);
assert.equal(Practice.checkAnswer(wordCloze, "gakou"), false);
assert.equal(Practice.checkAnswer(wordCloze, "gakko"), false);
assert.equal(Practice.buildCloze(word, { gapPosition: "random", random: () => .999 }).answerJapanese, "学校");
assert.equal(Practice.buildCloze(word, { targetIndex: 0 }), null, "Explicit gap must not quiz a different word for a saved vocabulary item");
assert.equal(Practice.buildCloze(word, { targetIndex: 2 }).answerJapanese, "学校");
assert.equal(Practice.buildCloze({ kind: "word", key: "word:19053:20", japanese: "見る", kana: "みる", romaji: "miru", context: {
  japanese: "私は映画を見ます。", jpan: "私 は 映画 を 見ます 。", kana: "わたし は えいが を みます。", romaji: "watashi ha eiga wo mimasu."
} }), null);
assert.equal(Practice.buildCloze({ ...word, japanese: "海", kana: "うみ", romaji: "umi" }), null);

const repeat = { kind: "word", key: "word:1:1", japanese: "本", kana: "ほん", romaji: "hon", context: {
  japanese: "本は本です。", jpan: "本 は 本 です 。", kana: "ほん は ほん です。", romaji: "hon ha hon desu."
} };
const repeated = Practice.buildCloze(repeat);
assert.equal(repeated.before, ""); assert.equal(repeated.after, "は本です。");
assert.equal(repeated.before + repeated.answerJapanese + repeated.after, repeat.context.japanese);
const spaced = Practice.buildCloze({ ...sentence, japanese: "私 は 学校へ本を持って行きます。" });
assert.equal(spaced.before + spaced.answerJapanese + spaced.after, "私 は 学校へ本を持って行きます。");
const quoted = Practice.buildCloze({ kind: "sentence", japanese: "「学校」へ行く。", jpan: "「学校」 へ 行く 。", kana: "「がっこう」 へ いく。", romaji: '"gakkou" he iku.' });
assert.equal(quoted.before, "「"); assert.equal(quoted.answerJapanese, "学校"); assert.equal(quoted.after, "」へ行く。");
assert.equal(quoted.answerRomaji, "gakkou");

// Ambiguous boundary information never attaches the next word's reading.
const split = Practice.buildCloze({ kind: "sentence", japanese: "大きな本です。", jpan: "大きな 本 です 。", kana: "おおき な ほん です。", romaji: "ooki na hon desu." });
assert.equal(split.answerJapanese, "大きな"); assert.equal(split.answerKana, ""); assert.equal(split.answerRomaji, "");
assert.deepEqual(split.acceptedAnswers, ["大きな"]);
const shifted = Practice.buildCloze({ kind: "sentence", japanese: "私は本です。", jpan: "私 は 本 です 。", kana: "わたし の ほん です。", romaji: "watashi ha hon desu." });
assert.equal(shifted.answerKana, "");
const fallback = Practice.buildCloze({ ...word, context: { ...sentence, kana: "わたし は がっ こう へ ほん を もって いきます。", romaji: "watashi ha gak kou he hon wo motte ikimasu." } });
assert.equal(fallback.answerKana, "がっこう"); assert.equal(fallback.answerRomaji, "gakkou");
for (const value of [null, {}, { kind: "word", japanese: "学校" }, { ...sentence, jpan: "", japanese: "私は学校です。" },
  { ...sentence, jpan: "私 は 仕事 です 。" }, { kind: "sentence", japanese: "はがを。", jpan: "は が を 。" },
  { kind: "sentence", japanese: "「は」。", jpan: "「 は 」 。" }, { kind: "sentence", japanese: "学校", jpan: "学校" }]) {
  assert.equal(Practice.buildCloze(value), null);
}
for (const value of [{ kind: "sentence", japanese: "見る。", jpan: "見 る 。" },
  { kind: "sentence", japanese: "日本。", jpan: "日 本 。" },
  { kind: "sentence", japanese: "3月。", jpan: "3 月 。" }]) assert.equal(Practice.buildCloze(value), null);
assert.notEqual(Practice.normalizeAnswer("toori"), Practice.normalizeAnswer("tori"));
assert.notEqual(Practice.normalizeAnswer("おおい"), Practice.normalizeAnswer("おい"));
assert.notEqual(Practice.normalizeAnswer("きって"), Practice.normalizeAnswer("きて"));
assert.notEqual(Practice.normalizeAnswer("ōi"), Practice.normalizeAnswer("oi"));
assert.equal(Practice.normalizeAnswer(" ｶﾞｯｺｳ "), "ガッコウ");

const overdue = { ...sentence, key: "sentence:19053:3", review: Practice.nextReview(null, "hard", NOW - 3 * DAY) };
const future = { ...sentence, key: "sentence:19053:4", review: Practice.nextReview(null, "good", NOW) };
const noAudio = { ...sentence, key: "sentence:19053:5", audioUrl: "" };
const noCloze = { kind: "word", key: "word:19053:6", japanese: "空", kana: "そら", romaji: "sora", audioUrl: "https://assets0.iknow.jp/b.mp3" };
const collection = [future, noCloze, word, sentence, noAudio, overdue, overdue];
const copy = structuredClone(collection);
assert.equal(Practice.dueCount([sentence, overdue, future], NOW), 2);
assert.deepEqual(Practice.selectSession(collection, { now: NOW, limit: 2 }).map(item => item.key), [overdue.key, word.key]);
assert.equal(Practice.selectSession(collection, { now: NOW, dueOnly: false }).length, 6);
assert.equal(Practice.selectSession(collection, { now: NOW }).some(item => item.key === future.key), false);
assert.equal(Practice.selectSession(collection, { now: NOW, mode: "cloze" }).some(item => item.key === noCloze.key), false);
assert.equal(Practice.selectSession(collection, { now: NOW, mode: "listening" }).some(item => item.key === noAudio.key), false);
assert.equal(Practice.selectSession(collection, { now: NOW, mode: "listening" }).some(item => item.key === word.key), true);
assert.deepEqual(collection, copy);
for (const options of [{ mode: "bad" }, { limit: 0 }, { limit: 2001 }, { limit: NaN }, { now: Infinity }]) assert.throws(() => Practice.selectSession(collection, options));

// A chosen collection is no longer silently cut to ten or twenty items.
assert.equal(Practice.MAX_SESSION_ITEMS, 2000);
const completeSelection = Array.from({ length: 27 }, (_, index) => ({ ...sentence, key: `sentence:19053:complete${index}`, createdAt: index,
  ...(index % 3 === 0 ? { review: Practice.nextReview(null, "good", NOW) } : {}) }));
assert.equal(Practice.selectSession(completeSelection, { now: NOW, dueOnly: false }).length, 27);
assert.equal(Practice.selectSession(completeSelection, { now: NOW, mode: "cloze", dueOnly: false }).length, 27);
assert.equal(Practice.selectSession(completeSelection, { now: NOW, mode: "listening", dueOnly: false }).length, 27);
assert.equal(Practice.selectSession(completeSelection, { now: NOW }).length, 18, "Due-only remains an explicit caller policy");
const fullLibrary = Array.from({ length: 2000 }, (_, index) => ({ ...sentence, key: `sentence:19053:full${index}`, createdAt: index }));
const fullBefore = structuredClone(fullLibrary);
const fullSession = Practice.selectSession([...fullLibrary, fullLibrary[0]], { now: NOW, dueOnly: false, shuffle: true, random: () => .5 });
assert.equal(fullSession.length, 2000); assert.equal(new Set(fullSession.map(item => item.key)).size, 2000);
assert.equal(Practice.selectSession(fullLibrary, { now: NOW, limit: 101 }).length, 101);
assert.equal(Practice.selectSession(fullLibrary, { now: NOW, limit: 2000 }).length, 2000);
assert.equal(Practice.selectSession([...fullLibrary, { ...sentence, key: "sentence:19053:overflow" }], { now: NOW, dueOnly: false }).length, 2000);
assert.deepEqual(fullLibrary, fullBefore);

// Shuffling changes only within a due-priority bucket, not the input or rank.
const shuffleItems = [
  ...[1, 2, 3].map(index => ({ ...sentence, key: `sentence:19053:due${index}`, createdAt: index, review: Practice.nextReview(null, "hard", NOW - (index + 1) * DAY) })),
  ...[1, 2, 3, 4].map(index => ({ ...sentence, key: `sentence:19053:new${index}`, createdAt: index })),
  ...[1, 2, 3].map(index => ({ ...sentence, key: `sentence:19053:future${index}`, createdAt: index, review: Practice.nextReview(null, "good", NOW + index * DAY) }))
];
const shuffleCopy = structuredClone(shuffleItems), shuffleOptions = { now: NOW, dueOnly: false, limit: 10 };
const unshuffled = Practice.selectSession(shuffleItems, shuffleOptions).map(item => item.key);
const shuffled = Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random: () => 0 }).map(item => item.key);
assert.notDeepEqual(shuffled, unshuffled);
assert.ok(shuffled.slice(0, 3).every(key => key.includes(":due")));
assert.ok(shuffled.slice(3, 7).every(key => key.includes(":new")));
assert.ok(shuffled.slice(7).every(key => key.includes(":future")));
assert.equal(new Set(shuffled).size, 10);
assert.deepEqual(Practice.selectSession(shuffleItems.slice().reverse(), { ...shuffleOptions, shuffle: true, random: () => 0 }).map(item => item.key), shuffled);
assert.deepEqual(shuffleItems, shuffleCopy);
const seeded = initial => { let state = initial >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }; };
assert.deepEqual(Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random: seeded(42) }), Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random: seeded(42) }));
assert.notDeepEqual(Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random: seeded(42) }), Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random: seeded(7) }));
for (const random of [null, 2, () => -1, () => 1, () => NaN]) assert.throws(() => Practice.selectSession(shuffleItems, { ...shuffleOptions, shuffle: true, random }));
let eligibilityRandomCalls = 0;
Practice.selectSession(shuffleItems, { now: NOW, mode: "cloze", gapPosition: "random", random: () => { eligibilityRandomCalls++; return .5; } });
assert.equal(eligibilityRandomCalls, 0, "Finding eligible cloze items must not choose displayed gaps");

// Listening checks only the actual original recording target, in published forms.
const listening = Practice.buildListening(sentence, { romajiStyle: "spoken" });
assert.deepEqual(listening.forms, ["Japanese", "Kana", "Romaji"]);
assert.equal(listening.details.kind, "sentence"); assert.equal(listening.details.romaji, sentence.romaji);
assert.equal(listening.displayRomaji, "watashi wa gakkou e hon o motte ikimasu.");
assert.equal(Core.displayRomaji(listening.details, "source"), "watashi ha gakkou he hon wo motte ikimasu.");
assert.equal(Core.displayRomaji(listening.details, "spoken"), "watashi wa gakkou e hon o motte ikimasu.");
assert.equal(Practice.checkListening(listening, "私は学校へ本を持って行きます"), true);
assert.equal(Practice.checkListening(listening, "わたし は がっこう へ ほん を もって いきます"), true);
assert.equal(Practice.checkListening(listening, "WATASHI WA GAKKOU E HON O MOTTE IKIMASU!"), true);
assert.equal(Practice.checkListening(listening, "watashi ha gakkou he hon wo motte ikimasu"), true);
assert.equal(Practice.checkListening(listening, "I take a book to school."), false);
assert.equal(Practice.checkListening(listening, "watashi wa gakou e hon o motte ikimasu"), false);
assert.equal(Practice.checkListening(listening, "watashi wa gakko e hon o mote ikimasu"), false);
assert.equal(Practice.checkListening(listening, ".!?。"), false);
assert.equal(Practice.checkListening(listening, ""), false);
assert.equal(Practice.normalizeListeningAnswer("「こんにちは！」 （世界）。"), "こんにちは世界");
assert.equal(Practice.normalizeListeningAnswer("Ｅ！", { kind: "word" }), "e!");
assert.equal(Practice.normalizeListeningAnswer("e-ru"), "e-ru");
assert.notEqual(Practice.normalizeListeningAnswer("e-ru"), Practice.normalizeListeningAnswer("eru"));
assert.notEqual(Practice.normalizeListeningAnswer("kin'en"), Practice.normalizeListeningAnswer("kinen"));
assert.notEqual(Practice.normalizeListeningAnswer("kin’en"), Practice.normalizeListeningAnswer("kinen"));
assert.notEqual(Practice.normalizeListeningAnswer("きって。"), Practice.normalizeListeningAnswer("きて。"));
assert.notEqual(Practice.normalizeListeningAnswer("コーヒー。"), Practice.normalizeListeningAnswer("コヒ。"));
assert.notEqual(Practice.normalizeListeningAnswer("tōri."), Practice.normalizeListeningAnswer("tori."));
const wordWithAudio = { ...word, audioUrl: "https://assets0.iknow.jp/word.mp3" };
const wordListening = Practice.buildListening(wordWithAudio);
assert.equal(wordListening.details.kind, "word"); assert.equal(wordListening.details.japanese, "学校");
assert.equal(wordListening.details.audioUrl, wordWithAudio.audioUrl);
assert.equal(Practice.checkListening(wordListening, "gakkou"), true);
assert.equal(Practice.checkListening(wordListening, sentence.japanese), false);
const contextListening = Practice.buildListening(word);
assert.equal(contextListening.details.kind, "sentence"); assert.equal(contextListening.details.japanese, sentence.japanese);
assert.equal(Practice.checkListening(contextListening, sentence.japanese), true);
assert.equal(Practice.checkListening(contextListening, "学校"), false);
assert.equal(Practice.buildListening({ ...word, context: { ...sentence, audioUrl: "" } }), null);
assert.equal(Practice.buildListening({ kind: "sentence", audioUrl: "https://assets0.iknow.jp/x.mp3" }), null);
assert.equal(Practice.buildListening(null), null); assert.equal(Practice.checkListening(null, "test"), false);
assert.deepEqual(sentence, original);

// Meaning choices use saved text in one actual language, not invented translations.
const meaningTarget = { kind: "word", key: "word:19053:10", japanese: "家", english: "house, home", german: "Haus; Zuhause" };
const meaningItems = [meaningTarget,
  { kind: "word", key: "word:19053:11", japanese: "学校", english: "school", german: "Schule" },
  { kind: "word", key: "word:19053:12", japanese: "車", english: "car", german: "Auto" },
  { kind: "word", key: "word:19053:13", japanese: "円", english: "circle", german: "Kreis" },
  { kind: "word", key: "word:19053:14", japanese: "絵", english: "picture", german: "Bild" },
  { kind: "word", key: "word:19053:15", japanese: "別宅", english: " HOME " },
  { kind: "word", key: "word:19053:16", japanese: "家", english: "another meaning", german: "andere Bedeutung" },
  { kind: "word", key: "word:19053:17", japanese: "住居", english: "HOUSE , HOME." },
  { kind: "sentence", key: "sentence:19053:18", japanese: "家です。", english: "It is a house.", german: "Es ist ein Haus." }
];
const englishQuestion = Practice.buildReviewQuestion(meaningTarget, meaningItems);
assert.equal(englishQuestion.language, "en"); assert.equal(englishQuestion.correctId, meaningTarget.key);
assert.equal(englishQuestion.choices.length, 4); assert.equal(englishQuestion.choices.find(choice => choice.id === meaningTarget.key).label, meaningTarget.english);
assert.equal(englishQuestion.choices.some(choice => ["word:19053:15", "word:19053:16", "word:19053:17", "sentence:19053:18"].includes(choice.id)), false);
assert.deepEqual(Practice.buildReviewQuestion(meaningTarget, meaningItems), englishQuestion);
const germanQuestion = Practice.buildReviewQuestion(meaningTarget, meaningItems, { language: "de" });
assert.equal(germanQuestion.language, "de");
assert.ok(germanQuestion.choices.every(choice => meaningItems.find(item => item.key === choice.id).german === choice.label));
assert.equal(Practice.buildReviewQuestion(meaningTarget, meaningItems, { language: "both" }).language, "en");
assert.equal(Practice.buildReviewQuestion({ ...meaningTarget, english: "" }, meaningItems, { language: "en" }).language, "de");
assert.equal(Practice.buildReviewQuestion({ ...meaningTarget, german: "" }, meaningItems, { language: "de" }).language, "en");
assert.equal(Practice.buildReviewQuestion(meaningTarget, [meaningTarget]), null);
assert.equal(Practice.buildReviewQuestion(meaningTarget, [meaningTarget, meaningItems[5], meaningItems[6], meaningItems[7]]), null);
assert.equal(Practice.buildReviewQuestion({ ...meaningTarget, english: "", german: "" }, meaningItems), null);
assert.equal(Practice.buildReviewQuestion({ ...meaningTarget, english: "...", german: "" }, meaningItems), null);
assert.equal(Practice.buildReviewQuestion(meaningTarget, [{ ...meaningItems[1], german: "" }], { language: "de" }), null);
assert.equal(Practice.buildReviewQuestion(null, meaningItems), null);
const positionSet = new Set(meaningItems.slice(0, 5).map(item => {
  const question = Practice.buildReviewQuestion(item, meaningItems);
  return question.choices.findIndex(choice => choice.id === question.correctId);
}));
assert.ok(positionSet.size > 1, "Correct choice placement should vary across saved items");
const duplicateChoices = Practice.buildReviewQuestion(meaningTarget, [meaningItems[1], { ...meaningItems[2], english: "school" }, meaningItems[1]]);
assert.equal(duplicateChoices.choices.length, 2);
const largeCollection = Array.from({ length: 2000 }, (_, index) => ({
  kind: "word", key: `word:19053:${1000 + index}`, japanese: `単語${index}`, english: `Meaning ${index % 20}`
}));
const largeQuestion = Practice.buildReviewQuestion(meaningTarget, largeCollection);
assert.equal(largeQuestion.choices.length, 4);
assert.equal(new Set(largeQuestion.choices.map(choice => choice.label)).size, 4);
assert.deepEqual(Practice.buildReviewQuestion(meaningTarget, largeCollection.slice().reverse()), largeQuestion);
assert.equal(Practice.buildReviewQuestion(meaningTarget, largeCollection.map(item => ({ ...item, english: " HOME " }))), null);
console.log("PASS Study scheduling, safe cloze targets/readings, active dictation checks, saved-meaning choices and eligible due-first sessions");
