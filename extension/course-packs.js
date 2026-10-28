/* Data-only course packs. Importing a pack never executes scripts or HTML. */
(() => {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./core.js") : globalThis.IKnowReaderCore;
  const STORAGE_KEY = "iknowReaderCoursePacks";
  const MAX_BYTES = 8 * 1024 * 1024;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const provenanceNotes = new Set([
    "Generated locally with Qwen3.5-9B; text ranges checked automatically.",
    "Translated locally; uncertain meaning groups were omitted.",
    "Automatisch lokal mit Qwen3.5-9B erzeugt; Textpositionen maschinell geprüft.",
    "Automatisch lokal übersetzt; unsichere Bedeutungsgruppen wurden ausgelassen."
  ]);
  function mergeNote(existing, incoming) {
    const explains = value => typeof value === "string" && value.trim() && !provenanceNotes.has(value.trim());
    if (explains(incoming)) return incoming;
    if (explains(existing)) return existing;
    return incoming !== undefined ? incoming : existing;
  }
  const fail = () => { throw new Error("The file does not contain valid iKnow course data."); };
  function signature(value) { return typeof value === "string" && /^[a-f0-9]{8}$/.test(value); }
  function ranges(value) {
    if (!Array.isArray(value) || value.length > 2000) fail();
    return value.map(range => {
      if (!Array.isArray(range) || range.length !== 2 || !integer(range[0], 0, 200000) || !integer(range[1], range[0] + 1, 200000)) fail();
      return [range[0], range[1]];
    });
  }
  function validate(input) {
    if (!object(input) || input.format !== "iknow-reader-course" || input.schemaVersion !== 1 || !object(input.course)) fail();
    const source = input.course;
    if (!integer(source.id, 1, 1000000000) || typeof source.title !== "string" || !source.title.trim() || source.title.length > 500 || !integer(source.wordCount, 0, 10000) || !integer(source.sentenceCount, 1, 10000)) fail();
    if (!object(input.alignments) || !object(input.audio) || Object.keys(input.alignments).length > 10000 || Object.keys(input.audio).length > 10000) fail();
    const sentenceIds = new Set([...Object.keys(input.alignments), ...Object.keys(input.audio)]);
    if (!sentenceIds.size || sentenceIds.size > source.sentenceCount) fail();
    const alignments = {}, audio = {};
    for (const [id, record] of Object.entries(input.alignments)) {
      if (!/^\d{1,12}$/.test(id) || !object(record) || !signature(record.signature) || !Array.isArray(record.groups)) fail();
      const groups = record.groups.map(group => {
        if (!object(group) || !Array.isArray(group.tokens) || group.tokens.length > 2000 || !group.tokens.every(index => integer(index, 0, 1999))) fail();
        return { ja: ranges(group.ja), en: ranges(group.en), tokens: [...group.tokens] };
      });
      if (!Core.validGroupRanges(groups, { ja: 200000, en: 200000 }, 2000)) fail();
      const pronunciation = {};
      if (record.pronunciation !== undefined) {
        if (!object(record.pronunciation)) fail();
        for (const [index, value] of Object.entries(record.pronunciation)) {
          if (!/^\d{1,4}$/.test(index) || !integer(Number(index), 0, 1999) || typeof value !== "string" || value.length > 300) fail();
          pronunciation[index] = value;
        }
      }
      alignments[id] = { signature: record.signature, groups, pronunciation };
      for (const key of ["colorsReady", "germanColorsReady"]) {
        if (record[key] !== undefined) {
          if (typeof record[key] !== "boolean") fail();
          alignments[id][key] = record[key];
        }
      }
      if (record.note !== undefined) {
        if (typeof record.note !== "string" || record.note.length > 5000) fail();
        alignments[id].note = record.note;
      }
      if (record.german !== undefined) {
        const german = record.german;
        if (!object(german) || typeof german.text !== "string" || !german.text.trim() || german.text.length > 20000 || !Array.isArray(german.groups) || german.groups.length !== groups.length) fail();
        const used = [];
        const germanGroups = german.groups.map(value => {
          const spans = ranges(value);
          for (const [a, b] of spans) {
            if (b > german.text.length || used.some(([c, d]) => a < d && b > c)) fail();
            used.push([a, b]);
          }
          return spans;
        });
        alignments[id].german = { text: german.text, groups: germanGroups };
        if (german.note !== undefined) {
          if (typeof german.note !== "string" || german.note.length > 5000) fail();
          alignments[id].german.note = german.note;
        }
      }
    }
    for (const [id, record] of Object.entries(input.audio)) {
      if (!/^\d{1,12}$/.test(id) || !object(record) || !signature(record.signature) || typeof record.audioPath !== "string" || record.audioPath.length > 2000 || !/^\/assets\/.+\.mp3$/i.test(record.audioPath) || /[?#\r\n]/.test(record.audioPath) || !Number.isFinite(record.duration) || record.duration <= 0 || record.duration > 600 || !Array.isArray(record.tokens) || !record.tokens.length || record.tokens.length > 2000) fail();
      let end = 0;
      const indexes = new Set(), usedJa = [];
      const tokens = record.tokens.map(token => {
        if (!object(token) || !integer(token.index, 0, 1999) || !Number.isFinite(token.start) || !Number.isFinite(token.end) || token.start < end - 0.025 || token.start < 0 || token.end <= token.start || token.end > record.duration + 0.05) fail();
        const indices = token.indices === undefined ? [token.index] : token.indices;
        if (!Array.isArray(indices) || !indices.length || indices.length > 2000 || !indices.includes(token.index)) fail();
        for (const index of indices) { if (!integer(index, 0, 1999) || indexes.has(index)) fail(); indexes.add(index); }
        const ja = ranges(token.ja || []);
        for (const [a, b] of ja) { if (usedJa.some(([c, d]) => a < d && b > c)) fail(); usedJa.push([a, b]); }
        end = token.end;
        const result = { index: token.index, start: token.start, end: token.end, ja };
        if (token.indices !== undefined) result.indices = [...indices];
        return result;
      });
      if (alignments[id] && alignments[id].signature !== record.signature) fail();
      audio[id] = { signature: record.signature, audioPath: record.audioPath, duration: record.duration, tokens };
    }
    const germanItems = {};
    if (input.germanItems !== undefined) {
      if (!object(input.germanItems) || Object.keys(input.germanItems).length > 10000) fail();
      for (const [id, value] of Object.entries(input.germanItems)) {
        if (!/^\d{1,12}$/.test(id) || !object(value) || !signature(value.signature) || typeof value.text !== "string" || !value.text.trim() || value.text.length > 5000) fail();
        germanItems[id] = { signature: value.signature, text: value.text };
      }
    }
    const pack = { format: "iknow-reader-course", schemaVersion: 1, course: { id: source.id, title: source.title.trim(), wordCount: source.wordCount, sentenceCount: source.sentenceCount }, alignments, audio, germanItems };
    if (new TextEncoder().encode(JSON.stringify(pack)).length > MAX_BYTES) throw new Error("The course file is too large.");
    return pack;
  }
  function safePacks(value) {
    const output = {};
    if (!object(value)) return output;
    for (const [id, candidate] of Object.entries(value)) {
      try { const pack = validate(candidate); if (String(pack.course.id) === id) output[id] = pack; } catch { /* Ignore invalid stored records. */ }
    }
    return output;
  }
  function mergeAlignment(existing, incoming) {
    if (!existing || existing.signature !== incoming.signature) return incoming;
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const useIncomingGroups = incoming.colorsReady !== false || existing.colorsReady === false;
    const base = useIncomingGroups ? incoming : existing;
    const result = { ...existing, ...incoming, groups: base.groups,
      pronunciation: { ...(existing.pronunciation || {}), ...(incoming.pronunciation || {}) } };
    const note = mergeNote(existing.note, incoming.note);
    if (note !== undefined) result.note = note;
    else delete result.note;
    if (base.colorsReady !== undefined) result.colorsReady = base.colorsReady;
    else delete result.colorsReady;
    const german = incoming.german || existing.german;
    if (german) {
      // A German-only result must not attach positions from an unrelated group
      // layout. Preserve a matching old mapping or leave German groups neutral.
      const mapped = [incoming, existing].find(record => record.german?.text === german.text && record.colorsReady !== false && record.germanColorsReady !== false && same(record.groups, base.groups));
      result.german = mapped ? { ...mapped.german } : { ...german, groups: base.groups.map(() => []) };
      // Sentence explanations have no group offsets. They survive a group-layout
      // update, but German translation notes belong only to the exact same text.
      const germanNote = mergeNote(existing.german?.text === german.text ? existing.german.note : undefined,
        incoming.german?.text === german.text ? incoming.german.note : undefined);
      if (germanNote !== undefined) result.german.note = germanNote;
      else delete result.german.note;
      if (mapped) {
        if (mapped.germanColorsReady !== undefined) result.germanColorsReady = mapped.germanColorsReady;
        else delete result.germanColorsReady;
      } else result.germanColorsReady = false;
    } else {
      delete result.german;
      if (incoming.germanColorsReady !== undefined || existing.germanColorsReady !== undefined) result.germanColorsReady = false;
    }
    return result;
  }
  function merge(bundledData, bundledAudio, stored) {
    const alignments = { ...bundledData.alignments }, sentences = { ...bundledAudio.sentences };
    const courses = { ...(bundledData.courses || {}) }, germanItems = { ...(bundledData.germanItems || {}) };
    const alignmentVariants = { ...(bundledData.alignmentVariants || {}) }, germanItemVariants = { ...(bundledData.germanItemVariants || {}) };
    const sentenceVariants = { ...(bundledAudio.sentenceVariants || {}) };
    function insert(records, variants, id, incoming, key, combine = (_, value) => value) {
      const existing = records[id], incomingKey = key(incoming), existingKey = existing && key(existing);
      const matching = existingKey === incomingKey ? existing : variants[id]?.[incomingKey];
      const merged = combine(matching, incoming);
      // Cue IDs are reused across courses with differing responses/recordings.
      // Keep a sparse in-memory index of those validated variants. The saved
      // course files remain separate and require no format/cache migration.
      if (variants[id] || existing && existingKey !== incomingKey) {
        const bucket = { ...variants[id] };
        if (existing) bucket[existingKey] = existing;
        bucket[incomingKey] = merged;
        variants[id] = bucket;
      }
      records[id] = merged;
    }
    for (const [id, pack] of Object.entries(safePacks(stored))) {
      for (const [sentenceId, record] of Object.entries(pack.alignments)) {
        insert(alignments, alignmentVariants, sentenceId, record, value => value.signature, mergeAlignment);
      }
      for (const [sentenceId, record] of Object.entries(pack.audio)) insert(sentences, sentenceVariants, sentenceId, record, value => `${value.signature}\n${value.audioPath}`);
      for (const [itemId, record] of Object.entries(pack.germanItems)) insert(germanItems, germanItemVariants, itemId, record, value => value.signature);
      courses[id] = { ...pack.course };
    }
    return { data: { ...bundledData, courses, alignments, germanItems, alignmentVariants, germanItemVariants }, audio: { ...bundledAudio, sentences, sentenceVariants } };
  }
  const api = Object.freeze({ STORAGE_KEY, MAX_BYTES, validate, safePacks, mergeAlignment, merge });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderPacks = api;
})();
