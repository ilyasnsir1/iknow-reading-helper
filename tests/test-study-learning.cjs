"use strict";
const assert = require("node:assert/strict"), Learning = require("../extension/study-learning.js");
const DAY = Learning.DAY_MS, NOW = Date.UTC(2026, 9, 30, 12);
assert.equal(Learning.strength(), "new");
assert.equal(Learning.strength(null), "new");
let skill = Learning.next(undefined, "good", NOW);
assert.equal(Learning.strength(skill), "learning");
assert.equal(skill.dueAt, NOW + DAY); assert.equal(skill.intervalDays, 1); assert.equal(skill.repetitions, 1);
const first = structuredClone(skill);
for (let index = 1; index <= 30; index++) skill = Learning.next(skill, "good", NOW + index * 1000);
assert.equal(Learning.strength(skill), "learning", "Repeated clicks on the same day cannot establish strength");
assert.equal(skill.dueAt, first.dueAt); assert.equal(skill.intervalDays, 1); assert.equal(skill.repetitions, 1);
assert.deepEqual(skill.correctDays, first.correctDays);
skill = Learning.next(skill, "good", NOW + DAY);
assert.equal(Learning.strength(skill), "learning"); assert.equal(skill.intervalDays, 3); assert.equal(skill.repetitions, 2);
skill = Learning.next(skill, "good", NOW + 2 * DAY);
assert.equal(Learning.strength(skill), "strong"); assert.equal(skill.intervalDays, 6); assert.equal(skill.repetitions, 3);
assert.equal(skill.correctDays.length, 3);
skill = Learning.next(skill, "hard", NOW + 2 * DAY + 1000);
assert.equal(Learning.strength(skill), "learning"); assert.equal(skill.intervalDays, 1); assert.deepEqual(skill.correctDays, []);
skill = Learning.next(skill, "good", NOW + 3 * DAY);
assert.equal(Learning.strength(skill), "learning", "A retried answer resets the first-try streak");
skill = Learning.next(skill, "again", NOW + 4 * DAY);
assert.equal(Learning.strength(skill), "weak"); assert.equal(skill.dueAt, NOW + 4 * DAY + 600000);
assert.equal(skill.intervalDays, 0); assert.equal(skill.repetitions, 0); assert.equal(skill.lapses, 1); assert.deepEqual(skill.correctDays, []);
skill = Learning.next(skill, "good", NOW + 4 * DAY + 1000);
assert.equal(Learning.strength(skill), "learning"); assert.equal(skill.repetitions, 1);
const beforeClockChange = structuredClone(skill);
skill = Learning.next(skill, "good", NOW - DAY);
assert.deepEqual(skill, beforeClockChange, "A backwards clock cannot add a successful day or regress timestamps");
for (let index = 0; index < 70; index++) skill = Learning.next(skill, "good", NOW + (5 + index) * DAY);
assert.equal(skill.intervalDays, 365); assert.equal(skill.correctDays.length, 3); assert.equal(Learning.strength(skill), "strong");
assert.equal(Learning.next(undefined, "again", Learning.DATE_LIMIT).dueAt, Learning.DATE_LIMIT);
assert.equal(Learning.next(undefined, "good", Learning.DATE_LIMIT).dueAt, Learning.DATE_LIMIT);
for (const value of [-1, NaN, Infinity, 1.5, Learning.DATE_LIMIT + 1]) assert.throws(() => Learning.next(null, "good", value));
for (const value of ["easy", "Good", "weak", null, undefined]) assert.throws(() => Learning.next(null, value, NOW));
for (const value of [{}, { ...skill, unknown: true }, { ...skill, intervalDays: 366 }, { ...skill, correctDays: [1, 1] },
  { ...skill, correctDays: [1, 2, 3, 4] }, { ...skill, correctDays: [Math.floor(Learning.DATE_LIMIT / DAY) + 1] },
  { ...skill, lastRating: "again" }, { ...skill, repetitions: -1 }, { ...skill, dueAt: 1 }]) {
  assert.equal(Learning.validSkill(value), false); assert.throws(() => Learning.next(value, "good", NOW)); assert.throws(() => Learning.strength(value));
}
const records = ["new", "weak", "due", "future", "other-skill"].map(sourceId => ({ key: `word:19053:${sourceId}`, kind: "word" }));
const progress = { records: {
  [records[1].key]: { review: Learning.next(undefined, "again", NOW) },
  [records[2].key]: { review: Learning.next(undefined, "good", NOW - 2 * DAY) },
  [records[3].key]: { review: Learning.next(undefined, "good", NOW) },
  [records[4].key]: { listening: Learning.next(undefined, "again", NOW) }
} };
const snapshot = structuredClone({ records, progress });
assert.deepEqual(Learning.chooseWeak([...records, records[1]], progress, "review", NOW).map(item => item.key), [records[1].key, records[2].key]);
assert.deepEqual(Learning.chooseWeak(records, progress, "listening", NOW).map(item => item.key), [records[4].key]);
assert.deepEqual(Learning.chooseWeak(records, { records: {} }, "review", NOW), [], "Unseen or legacy shared reviews are New, not Weak");
assert.deepEqual({ records, progress }, snapshot);
for (const mode of ["speaking", "", null]) assert.throws(() => Learning.chooseWeak(records, progress, mode, NOW));
assert.throws(() => Learning.chooseWeak({}, progress, "review", NOW));
console.log("PASS Skill-specific learning requires distinct successful days, bounds schedules and selects actual weak/due items without mutating source records");
