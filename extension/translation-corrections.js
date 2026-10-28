/* Reviewed presentation-only corrections for exact iKnow source sentences.
 * Source records, signatures, timings and stored course data remain unchanged.
 */
(() => {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./core.js") : globalThis.IKnowReaderCore;
  const signature = "5c8faef8";
  const expected = Object.freeze([
    "私もそう思います。",
    "I think so too. Let's listen to one.",
    "わたし も そう おもいます。",
    "watashi mo sou omoimasu."
  ]);
  const correction = Object.freeze({
    text: "I think so too.",
    originalText: expected[1],
    keptEnd: 15,
    note: Object.freeze({
      en: "iKnow’s source adds an unrelated second sentence. The reading helper omits it here; the original remains available under Source.",
      de: "Die iKnow-Quelle enthält einen zusätzlichen, hier nicht passenden zweiten Satz. Die Lesehilfe lässt ihn in dieser Ansicht weg; das Original bleibt unter Source verfügbar."
    }),
    sourceUrl: "https://iknow.jp/api/v2/goals/19053"
  });
  function get(sentence) {
    if (!Core || String(sentence?.cue?.id) !== "246987") return null;
    const fields = [sentence.cue.text, sentence.response?.text, sentence.cue.transliterations?.Hrkt, sentence.cue.transliterations?.Latn].map(Core.plainText);
    if (fields.some((field, index) => field !== expected[index]) || Core.signature(fields) !== signature) return null;
    return correction;
  }
  function projectRecord(record, selectedCorrection) {
    if (!record || selectedCorrection !== correction || record.signature !== signature || !Array.isArray(record.groups)) return record;
    const indexes = [];
    record.groups.forEach((group, index) => {
      if (Array.isArray(group?.en) && group.en.length && group.en.every(range => Array.isArray(range) && range.length === 2 &&
        Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] >= 0 && range[1] > range[0] && range[1] <= correction.keptEnd)) indexes.push(index);
    });
    if (indexes.length === record.groups.length) return record;
    // Keep complete semantic groups only. Never clip a range or move an offset
    // to make a questionable group appear to match the corrected presentation.
    const view = { ...record, groups: indexes.map(index => record.groups[index]) };
    if (record.german && Array.isArray(record.german.groups)) view.german = { ...record.german, groups: indexes.map(index => record.german.groups[index] || []) };
    return view;
  }
  const api = Object.freeze({ get, projectRecord });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderTranslationCorrections = api;
})();
