/* Pure examples never save grades, alter the catalog, or create fake course items. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const Catalog = require("../../extension/study-catalog.js");
const Examples = require("./study-result-examples.js");
const Results = require("./study-focus-results.js");
const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../native-audio-audit/goal-19053.json"), "utf8"));
const records = Catalog.normalizeSource(raw, { courseId: "19053", now: 0 }).records;
const original = JSON.stringify(records);
const sourceByKey = new Map(records.map(record => [record.key, record]));

for (const [size, correct, incorrect] of [[9, 6, 3], [200, 134, 66], [400, 268, 132]]) {
  const example = Examples.create(records, size), stats = Results.summarize(example.fixture);
  assert.equal(example.example, true);
  assert.equal(example.words.length, size);
  assert.equal(new Set(example.words.map(word => word.key)).size, size);
  assert.deepEqual({ total: stats.total, firstTry: stats.firstTry, missed: stats.missed, retried: stats.retried, unanswered: stats.unanswered, percent: stats.percent },
    { total: size, firstTry: correct, missed: incorrect, retried: 0, unanswered: 0, percent: 67 });
  assert.equal(stats.reviewKeys.length, incorrect, "The recommendation count follows the actual answers");
  assert.equal(stats.complete, true);
  assert.deepEqual(example, Examples.create(records, size), "Examples are deterministic");
  assert.deepEqual(example.fixture.keys, example.words.map(word => word.key));
  for (const word of example.words) {
    const source = sourceByKey.get(word.key);
    assert.ok(source, "Every displayed row comes from the actual course");
    assert.equal(word.japanese, source.japanese);
    assert.equal(word.english, source.english);
    assert.equal(word.german, source.german);
    assert.equal(word.kind, source.kind);
  }
  for (const answer of example.fixture.results) {
    assert.equal(answer.attempts, 1);
    if (answer.outcome === "again") {
      assert.notEqual(answer.submitted, answer.expected);
      assert.ok(example.words.some(word => word.english === answer.submitted && word.key !== answer.key));
    } else assert.equal(answer.submitted, answer.expected);
  }
  if (size === 9) {
    assert.deepEqual(example.words.map(word => word.japanese), ["それ", "見る", "円", "多い", "家", "これ", "新しい", "私", "仕事"]);
    assert.deepEqual(example.fixture.results.map(row => row.outcome), ["good", "good", "good", "good", "good", "good", "again", "again", "again"]);
  } else {
    assert.ok(example.fixture.results.slice(0, 20).some(row => row.outcome === "again"), "Mistakes are distributed through the course");
    assert.ok(example.fixture.results.slice(correct).some(row => row.outcome === "good"));
    const kinds = example.words.reduce((counts, row) => { counts[row.kind]++; return counts; }, { word: 0, sentence: 0 });
    assert.deepEqual(kinds, size === 400 ? { word: 200, sentence: 200 } : { word: 200, sentence: 0 });
  }
}
assert.equal(JSON.stringify(records), original, "The public catalog is not mutated");
for (const size of [0, -1, 10, 201, Infinity, NaN, "200", undefined]) assert.throws(() => Examples.create(records, size), /9, 200 or 400/);
assert.throws(() => Examples.create(null, 9), /normalized public course records/);
assert.throws(() => Examples.create(records.slice(0, 8), 9), /9 real vocabulary items/);
assert.throws(() => Examples.create(records.filter(row => row.kind === "word"), 400), /200 vocabulary items and 200 sentences/);
assert.throws(() => Examples.create([...records, records[0]], 200), /keys must be unique/);
assert.throws(() => Examples.create(records.map(row => ({ ...row, kind: "unknown" })), 9), /invalid course item/);
assert.throws(() => Examples.create(records.map(row => ({ ...row, english: "same meaning" })), 9), /distinct source meanings/);
assert.throws(() => Examples.create(records.map(row => ({ ...row, japanese: "" })), 9), /Japanese text and an English meaning/);
const detached = Examples.create(records, 9);
detached.words[0].japanese = "Changed example";
assert.equal(records[0].japanese, "それ", "Example row objects are detached from the catalog");
console.log("PASS Real 9/200/400-item result examples: unique public records, exact distributed outcomes, mixed course kinds, invalid-input checks and immutable source");
