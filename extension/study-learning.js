/* Separate learning evidence for meaning, recall and listening. */
(() => {
  "use strict";
  const DAY_MS = 86400000, DATE_LIMIT = 8640000000000000, MAX_INTERVAL_DAYS = 365, MAX_COUNTER = 1000000;
  const MODES = Object.freeze(["review", "cloze", "listening"]), OUTCOMES = Object.freeze(["again", "hard", "good"]);
  const SKILL_KEYS = ["dueAt", "lastReviewedAt", "intervalDays", "repetitions", "lapses", "lastRating", "correctDays"];
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= DATE_LIMIT;
  const counter = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNTER;
  function validSkill(value) {
    return object(value) && Object.keys(value).length === SKILL_KEYS.length && SKILL_KEYS.every(key => Object.hasOwn(value, key)) &&
      timestamp(value.dueAt) && timestamp(value.lastReviewedAt) && value.dueAt >= value.lastReviewedAt &&
      Number.isSafeInteger(value.intervalDays) && value.intervalDays >= 0 && value.intervalDays <= MAX_INTERVAL_DAYS &&
      counter(value.repetitions) && counter(value.lapses) && OUTCOMES.includes(value.lastRating) &&
      Array.isArray(value.correctDays) && value.correctDays.length <= 3 && value.correctDays.every((day, index, days) =>
        Number.isSafeInteger(day) && day >= 0 && day <= Math.floor(value.lastReviewedAt / DAY_MS) && (!index || day > days[index - 1])) &&
      (value.lastRating === "good" ? value.correctDays.length > 0 && value.correctDays.at(-1) === Math.floor(value.lastReviewedAt / DAY_MS) && value.repetitions > 0 : value.correctDays.length === 0 && value.repetitions === 0) &&
      (value.lastRating === "again" ? value.intervalDays === 0 : value.intervalDays > 0);
  }
  function strength(skill) {
    if (skill === undefined || skill === null) return "new";
    if (!validSkill(skill)) throw Error("This learning history is invalid.");
    if (skill.lastRating === "again") return "weak";
    return skill.lastRating === "good" && skill.correctDays.length >= 3 ? "strong" : "learning";
  }
  function next(previous, outcome, now = Date.now()) {
    if (!OUTCOMES.includes(outcome) || !timestamp(now)) throw Error("Choose a valid learning result and time.");
    if (previous !== undefined && previous !== null && !validSkill(previous)) throw Error("This learning history is invalid.");
    // Clock adjustments cannot move existing history backwards or add evidence.
    const at = Math.max(now, previous?.lastReviewedAt || 0), day = Math.floor(at / DAY_MS);
    const repeatedDay = outcome === "good" && previous?.lastRating === "good" && previous.correctDays.includes(day);
    let intervalDays = outcome === "again" ? 0 : 1, correctDays = [], repetitions = 0;
    if (outcome === "good") {
      const oldDays = previous?.lastRating === "good" ? previous.correctDays : [];
      correctDays = repeatedDay ? [...oldDays] : [...oldDays, day].slice(-3);
      repetitions = repeatedDay ? previous.repetitions : Math.min(MAX_COUNTER, (previous?.lastRating === "good" ? previous.repetitions : 0) + 1);
      const priorInterval = previous?.lastRating === "good" ? previous.intervalDays : 0;
      intervalDays = repeatedDay ? priorInterval : !priorInterval ? 1 : priorInterval === 1 ? 3 : Math.min(MAX_INTERVAL_DAYS, priorInterval * 2);
    }
    return {
      dueAt: repeatedDay ? previous.dueAt : Math.min(DATE_LIMIT, at + (outcome === "again" ? 10 * 60000 : intervalDays * DAY_MS)),
      lastReviewedAt: at, intervalDays, repetitions,
      lapses: Math.min(MAX_COUNTER, (previous?.lapses || 0) + (outcome === "again" ? 1 : 0)), lastRating: outcome, correctDays
    };
  }
  function chooseWeak(records, progress, mode, now = Date.now()) {
    if (!Array.isArray(records) || !MODES.includes(mode) || !timestamp(now)) throw Error("Choose valid learning items, mode and time.");
    const histories = progress?.records || {}, seen = new Set(), selected = [];
    for (const record of records) {
      if (!object(record) || !["word", "sentence"].includes(record.kind) || typeof record.key !== "string" || seen.has(record.key)) continue;
      seen.add(record.key);
      const skill = histories[record.key]?.[mode];
      if (validSkill(skill) && (strength(skill) === "weak" || skill.dueAt <= now)) selected.push(record);
    }
    return selected.sort((a, b) => {
      const left = histories[a.key][mode], right = histories[b.key][mode];
      return Number(strength(left) !== "weak") - Number(strength(right) !== "weak") || left.dueAt - right.dueAt || a.key.localeCompare(b.key);
    });
  }
  const api = Object.freeze({ DAY_MS, DATE_LIMIT, MAX_INTERVAL_DAYS, MAX_COUNTER, MODES, OUTCOMES, validSkill, strength, next, chooseWeak });
  globalThis.IKnowReaderStudyLearning = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
