/* Explicit, isolated result examples made from real public course records. */
(() => {
  "use strict";
  const SIZES = new Set([9, 200, 400]);
  const text = value => typeof value === "string" ? value.slice(0, 5000) : "";
  const comparable = value => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

  function create(records, size) {
    if (!SIZES.has(size)) throw Error("Choose an example with 9, 200 or 400 items.");
    if (!Array.isArray(records) || records.length > 2000) throw Error("Provide normalized public course records for this example.");
    const seen = new Set();
    const source = records.map(record => {
      if (!record || !["word", "sentence"].includes(record.kind) || typeof record.key !== "string" || !record.key || record.key.length > 130) throw Error("The example contains an invalid course item.");
      if (seen.has(record.key)) throw Error("Source item keys must be unique.");
      seen.add(record.key);
      const japanese = text(record.japanese), english = text(record.english);
      if (!japanese.trim() || !english.trim()) throw Error("Every example item needs Japanese text and an English meaning.");
      return { key: record.key, kind: record.kind, japanese, english, german: text(record.german) };
    });
    const vocabulary = source.filter(record => record.kind === "word");
    let words;
    if (size === 400) {
      const sentences = source.filter(record => record.kind === "sentence");
      if (vocabulary.length < 200 || sentences.length < 200) throw Error("The 400-item course example needs 200 vocabulary items and 200 sentences.");
      const chosen = new Set([...vocabulary.slice(0, 200), ...sentences.slice(0, 200)].map(record => record.key));
      words = source.filter(record => chosen.has(record.key));
    } else {
      if (vocabulary.length < size) throw Error(`The ${size}-item example needs ${size} real vocabulary items.`);
      words = vocabulary.slice(0, size);
    }

    const wrongCount = size === 9 ? 3 : size - Math.round(size * 0.67);
    function wrongAnswer(index) {
      const expected = comparable(words[index].english);
      // A real alternative meaning makes the example plausible without faking source rows.
      for (let offset = 1; offset < words.length; offset++) {
        const alternative = words[(index + offset) % words.length].english;
        if (comparable(alternative) !== expected) return alternative;
      }
      throw Error("The example needs distinct source meanings to show incorrect answers.");
    }
    const results = words.map((word, index) => {
      const incorrect = size === 9 ? index >= 6 : Math.floor((index + 1) * wrongCount / size) > Math.floor(index * wrongCount / size);
      return { key: word.key, japanese: word.japanese, expected: word.english,
        submitted: incorrect ? wrongAnswer(index) : word.english, outcome: incorrect ? "again" : "good", attempts: 1 };
    });
    return { words, fixture: { keys: words.map(word => word.key), results, test: true, mode: "review", complete: true },
      title: size === 400 ? "Vocabulary & sentences" : "Vocabulary", example: true };
  }

  const api = Object.freeze({ create });
  globalThis.IKnowResultExamples = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
