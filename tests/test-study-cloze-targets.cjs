"use strict";
const assert = require("node:assert/strict");
const Core = require("../extension/core.js"), Practice = require("../extension/study-practice.js");
const cue = (text, kana, romaji, jpan = "") => ({ text, transliterations: { Hrkt: kana, Latn: romaji, Jpan: jpan } });
function record(vocabulary, source, own = {}) {
  const context = { japanese: Core.plainText(source.text), kana: Core.plainText(source.transliterations.Hrkt),
    romaji: Core.plainText(source.transliterations.Latn), jpan: Core.plainText(source.transliterations.Jpan) };
  const target = Core.sourceClozeTarget(source, vocabulary);
  if (target) context.clozeTarget = target;
  return { kind: "word", japanese: vocabulary, ...own, context };
}
function exactReconstruction(input, exercise) {
  assert.equal(exercise.before + exercise.answerJapanese + exercise.after, input.context.japanese);
}

const gathered = record("集まる", cue("駅前に人が<b>集まって</b>います。", "えきまえ に ひと が <b>あつまって</b> います。",
  "ekimae ni hito ga <b>atsumatte</b> imasu.", "駅前 に 人 が 集まって います 。"), { kana: "あつまる", romaji: "atsumaru" });
const copy = structuredClone(gathered), exercise = Practice.buildCloze(gathered);
assert.equal(exercise.answerJapanese, "集まって"); assert.equal(exercise.answerKana, "あつまって"); assert.equal(exercise.answerRomaji, "atsumatte");
assert.equal(exercise.targetIndex, 0); exactReconstruction(gathered, exercise);
for (const answer of ["集まって", "あつまって", "atsumatte", "ＡＴＳＵＭＡＴＴＥ"]) assert.equal(Practice.checkAnswer(exercise, answer), true);
for (const answer of ["集まる", "あつまる", "atsumaru", "atsumate", "います"]) assert.equal(Practice.checkAnswer(exercise, answer), false);
assert.deepEqual(gathered, copy, "Building an exercise never changes its source metadata");
for (const options of [{ targetIndex: 0 }, { gapPosition: "first" }, { gapPosition: "random", random: () => { throw Error("A word highlight must not reroll"); } }]) {
  assert.equal(Practice.buildCloze(gathered, options).answerJapanese, "集まって");
}
for (const targetIndex of [-1, 1, 249, NaN, 1.5, "0", null]) assert.equal(Practice.buildCloze(gathered, { targetIndex }), null);
assert.equal(Practice.buildCloze(gathered, { gapPosition: "invalid" }), null);
assert.equal(Practice.clozeUnavailableReason(gathered), null);

const compound = record("国際", cue("ここで<b>国際</b>会議が開かれます。", "ここ で <b>こくさい</b> かいぎ が ひらかれます。",
  "koko de <b>kokusai</b> kaigi ga hirakaremasu.", "ここ で 国際 会議 が 開かれます 。"));
const compoundExercise = Practice.buildCloze(compound); exactReconstruction(compound, compoundExercise);
assert.equal(compoundExercise.before, "ここで"); assert.equal(compoundExercise.after, "会議が開かれます。");
assert.equal(Practice.checkAnswer(compoundExercise, "国際会議"), false); assert.equal(Practice.checkAnswer(compoundExercise, "こくさい"), true);
const repeated = record("本", cue("本は<b>本</b>です。", "ほん は <b>ほん</b> です。", "hon ha <b>hon</b> desu.", "本 は 本 です 。"));
assert.equal(Practice.buildCloze(repeated).before, "本は"); assert.equal(Practice.buildCloze(repeated).after, "です。");
const joined = record("公開", cue("その映画は今日、<b>公開</b>されます。", "その えいが は きょう、<b>こうかい</b> されます。",
  "sono eiga ha kyou,<b>koukai</b> saremasu.", "その 映画 は 今日、公開 されます 。"));
assert.equal(Practice.buildCloze(joined).answerRomaji, "koukai"); exactReconstruction(joined, Practice.buildCloze(joined));

const entities = record("本", cue("  &#x1F600; &amp; <b> 本 </b>へ。  ", "  まえ <b> ほん </b> へ。 ", "  mae <b> hon </b> he. "));
const entityTarget = entities.context.clozeTarget;
assert.equal(entityTarget.japanese.start, "😀 &  ".length); assert.equal(entityTarget.japanese.text, "本");
exactReconstruction(entities, Practice.buildCloze(entities));

const afterParticle = record("行く", cue("私は学校へ<b>行く</b>。", "わたし は がっこう へ <b>いく</b>。",
  "watashi ha gakkou he <b>iku</b>.", "私 は 学校 へ 行く 。"));
assert.equal(Practice.buildCloze(afterParticle, { romajiStyle: "spoken" }).answerRomaji, "iku");
const phrase = record("学校へ行く", cue("私は<b>学校へ行く</b>。", "わたし は <b>がっこう へ いく</b>。",
  "watashi ha <b>gakkou he iku</b>.", "私 は 学校 へ 行く 。"));
assert.equal(Practice.buildCloze(phrase, { romajiStyle: "source" }).answerRomaji, "gakkou he iku");
const spokenPhrase = Practice.buildCloze(phrase, { romajiStyle: "spoken", targetIndex: 0 });
assert.equal(spokenPhrase.answerRomaji, "gakkou e iku");
assert.equal(Practice.checkAnswer(spokenPhrase, "gakkou he iku"), true); assert.equal(Practice.checkAnswer(spokenPhrase, "gakkou e iku"), true);
assert.equal(Practice.checkAnswer(spokenPhrase, "gakkou iku"), false);

const japaneseOnly = record("見る", cue("本を<b>見ます</b>。", "ほん を みます。", "hon wo mimasu."), { kana: "みる", romaji: "miru" });
assert.deepEqual(Practice.buildCloze(japaneseOnly).acceptedAnswers, ["見ます"]);

for (const text of ["本を読む。", "<b></b>。", "<b>本</b>と<b>本</b>。", "<b><b>本</b></b>。", "<b>本</b></b>。",
  "<span><b>本</b></span>。", '<b class="target">本</b>。', "<b>本。", "本</b>。", "<script>bad()</script><b>本</b>。", "x".repeat(10001)]) {
  assert.equal(Core.sourceClozeTarget(cue(text, "", ""), "本"), null, text.slice(0, 60));
}
for (const reading of ["<b>ほん</b>と<b>ほん</b>", "<b><i>ほん</i></b>", "<b>ほん", "<b>ほん\u0000</b>"]) {
  assert.equal(Core.sourceClozeTarget(cue("<b>本</b>。", reading, ""), "本"), null);
}
assert.equal(Core.sourceClozeTarget(cue("<b>本</b>。", "<b>ほ<n>ん</n></b>。", ""), "本"), null);
assert.equal(Core.sourceClozeTarget(cue("<b>本</b>。", "<b>wrong</b>。", ""), "本"), null);
assert.equal(Core.sourceClozeTarget(cue("<b>本</b>。", "", "<b><img src=x></b>"), "本"), null);

const valid = gathered.context.clozeTarget;
assert.deepEqual(Core.validateClozeTarget(valid, gathered.context, "集まる"), valid);
assert.notEqual(Core.validateClozeTarget(valid, gathered.context).japanese, valid.japanese, "Validation copies spans");
assert.equal(Core.validateClozeTarget(valid, gathered.context, "違う"), null);
assert.equal(Core.validateClozeTarget(valid, { ...gathered.context, japanese: "人が集まっています。" }), null);
for (const mutate of [
  target => { target.extra = "unused"; }, target => { delete target.vocabulary; }, target => { delete target.japanese; },
  target => { target.japanese.start = -1; }, target => { target.japanese.start = .5; }, target => { target.japanese.end = 9999; },
  target => { target.japanese.end = target.japanese.start; }, target => { target.japanese.text = "集まる"; },
  target => { target.japanese.extra = true; }, target => { target.kana.text = "あつまる"; }, target => { target.romaji.start++; },
  target => { target.vocabulary = "集まる\u0000"; }
]) { const target = structuredClone(valid); mutate(target); assert.equal(Core.validateClozeTarget(target, gathered.context), null); }
assert.equal(Core.validateClozeTarget(Object.create(valid), gathered.context), null, "Inherited metadata is not an anchor");
assert.equal(Core.validateClozeTarget(JSON.parse(JSON.stringify(valid).slice(0, -1) + ',"__proto__":{}}'), gathered.context), null);
assert.equal(Core.validateClozeTarget({ vocabulary: "字", japanese: { start: 1, end: 3, text: "\uDE00字" } }, { japanese: "😀字" }), null);

const noMarker = structuredClone(gathered); delete noMarker.context.clozeTarget;
assert.equal(Practice.buildCloze(noMarker), null); assert.equal(Practice.clozeUnavailableReason(noMarker), "target");
assert.equal(Practice.clozeUnavailableReason({ kind: "word", japanese: "本" }), "example");
assert.equal(Practice.clozeUnavailableReason({ kind: "sentence", japanese: "本です。", jpan: "" }), "boundaries");
const oldExact = { kind: "word", japanese: "本", kana: "ほん", romaji: "hon", context: { japanese: "本を読む。", jpan: "本 を 読む 。", kana: "ほん を よむ。", romaji: "hon wo yomu." } };
assert.equal(Practice.buildCloze(oldExact).answerJapanese, "本"); assert.equal(Practice.clozeUnavailableReason(oldExact), null);
const sentence = { ...gathered.context, kind: "sentence" };
assert.notEqual(Practice.buildCloze(sentence).answerJapanese, "集まって", "Sentence practice keeps its independent complete-word selection");

console.log("PASS Source-anchored cloze: marked inflections, compounds, repetitions, punctuation/entities, exact answer forms, both Romaji styles, bounded metadata, malformed/stale anchors, checkpoints and legacy fallback");
