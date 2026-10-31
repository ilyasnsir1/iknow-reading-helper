/* Local review scheduling and source-based exercises. No speech assessment. */
(() => {
  "use strict";
  const DAY_MS = 86400000, DATE_LIMIT = 8640000000000000, MAX_INTERVAL_DAYS = 365, MAX_COUNTER = 1000000;
  const RATINGS = Object.freeze(["again", "hard", "good"]);
  const MAX_SESSION_ITEMS = 2000;
  const Core = globalThis.IKnowReaderCore || (typeof require === "function" ? require("./core.js") : null);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const stamp = value => Number.isSafeInteger(value) && value >= 0 && value <= DATE_LIMIT;
  const counter = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNTER;
  const string = value => typeof value === "string" && value.length <= 5000 ? value : "";
  const compact = value => string(value).normalize("NFC").replace(/\s/gu, "");
  const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
  const word = value => string(value).replace(EDGE_PUNCTUATION, "");
  const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
  // These are function words rather than vocabulary targets. A source sentence
  // may still use these when showing the surrounding Japanese context.
  const FUNCTION_WORDS = new Set(["は", "が", "を", "に", "へ", "で", "と", "の", "も", "や", "か", "ね", "よ", "な", "て", "ば", "ぞ", "さ", "し", "だ", "です", "ます", "でした", "ません", "ください"]);

  function validReview(value) {
    return object(value) && stamp(value.dueAt) && stamp(value.lastReviewedAt) && value.dueAt >= value.lastReviewedAt &&
      Number.isSafeInteger(value.intervalDays) && value.intervalDays >= 0 && value.intervalDays <= MAX_INTERVAL_DAYS &&
      counter(value.repetitions) && counter(value.lapses) && RATINGS.includes(value.lastRating);
  }
  function nextReview(previous, rating, now = Date.now()) {
    if (!RATINGS.includes(rating)) throw Error("Choose Again, Hard or Got it.");
    if (!stamp(now)) throw Error("The review time is invalid.");
    if (previous !== undefined && previous !== null && !validReview(previous)) throw Error("The saved review schedule is invalid.");
    const prior = previous || {}, again = rating === "again";
    const intervalDays = again ? 0 : rating === "hard" ? 1 :
      !prior.intervalDays ? 1 : prior.intervalDays === 1 ? 3 : Math.min(MAX_INTERVAL_DAYS, Math.ceil(prior.intervalDays * 2));
    return {
      dueAt: Math.min(DATE_LIMIT, now + (again ? 10 * 60000 : intervalDays * DAY_MS)),
      lastReviewedAt: now, intervalDays,
      repetitions: again ? 0 : Math.min(MAX_COUNTER, (prior.repetitions || 0) + 1),
      lapses: Math.min(MAX_COUNTER, (prior.lapses || 0) + (again ? 1 : 0)), lastRating: rating
    };
  }
  function normalizeAnswer(value) {
    if (typeof value !== "string" || value.length > 5000) return "";
    // Keep long vowels, apostrophes, small kana and consonant doubling intact.
    return value.normalize("NFKC").normalize("NFC").toLowerCase().replace(/\s/gu, "");
  }
  function toHiragana(value) {
    return value.normalize("NFKC").replace(/[\u30a1-\u30f6]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
  }
  function meaningful(value) {
    return JAPANESE.test(value) && !FUNCTION_WORDS.has(value) &&
      (/\p{Script=Han}/u.test(value) || Array.from(value).length >= 2);
  }
  function detailsFor(record) {
    if (!object(record)) return null;
    if (record.kind === "word") return object(record.context) ? record.context : null;
    return record.kind === "sentence" ? record : null;
  }
  function sourceSegments(details) {
    const japanese = string(details.japanese), raw = string(details.jpan) || (/\s/u.test(japanese) ? japanese : "");
    if (!raw.trim() || !japanese.trim() || compact(raw) !== compact(japanese)) return null;
    const parts = raw.trim().split(/\s+/u);
    if (parts.length < 2 || parts.length > 250) return null;
    const positions = [];
    for (let index = 0; index < japanese.length;) {
      const character = String.fromCodePoint(japanese.codePointAt(index));
      if (!/\s/u.test(character)) positions.push({ character, start: index, end: index + character.length });
      index += character.length;
    }
    const segments = []; let cursor = 0;
    for (const [tokenIndex, part] of parts.entries()) {
      const characters = Array.from(part), plain = word(part), startOffset = plain ? part.indexOf(plain) : 0;
      const offset = Array.from(part.slice(0, startOffset)).length, length = Array.from(plain).length;
      if (length) {
        const start = positions[cursor + offset]?.start, end = positions[cursor + offset + length - 1]?.end;
        if (start === undefined || end === undefined || japanese.slice(start, end) !== plain) return null;
        segments.push({ value: plain, start, end, tokenIndex });
      }
      cursor += characters.length;
    }
    return cursor === positions.length ? { japanese, segments } : null;
  }
  function alignedReadings(details, segments, field) {
    const text = string(details[field]).trim();
    if (!text) return null;
    const tokens = text.split(/\s+/u).map(word).filter(Boolean);
    if (tokens.length !== segments.length) return null;
    if (field === "kana") {
      if (!tokens.every(value => KANA_ONLY.test(value))) return null;
      // A shifted boundary must not assign a later word's reading to a target.
      for (const [index, segment] of segments.entries()) {
        if (KANA_ONLY.test(segment.value) && toHiragana(segment.value) !== toHiragana(tokens[index])) return null;
      }
    }
    return tokens;
  }
  function completeSegment(segment, index, segments) {
    const previous = segments[index - 1], next = segments[index + 1];
    // Some source segmentation separates a date/compound or an inflection
    // (3 月, 日 本, 見 る). Do not turn that into a one-character word quiz.
    if (previous?.end === segment.start && /[\p{Script=Han}\d]$/u.test(previous.value) && /^\p{Script=Han}/u.test(segment.value)) return false;
    if (next?.start === segment.end && /\p{Script=Han}$/u.test(segment.value) && /^\p{Script=Han}/u.test(next.value)) return false;
    if (next?.start === segment.end && /\p{Script=Han}$/u.test(segment.value) &&
        /^[\p{Script=Hiragana}]$/u.test(next.value) && !FUNCTION_WORDS.has(next.value)) return false;
    return true;
  }
  function randomIndex(length, random = Math.random) {
    if (typeof random !== "function") throw Error("Choose a valid random source.");
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw Error("Choose a valid random source.");
    return Math.floor(value * length);
  }
  function buildCloze(record, options = {}) {
    const details = detailsFor(record);
    if (!details) return null;
    const source = sourceSegments(details);
    if (!source) return null;
    const candidates = source.segments.filter((segment, index, segments) => meaningful(segment.value) && completeSegment(segment, index, segments));
    if (!candidates.length) return null;
    const preferred = record.kind === "word" ? word(string(record.japanese).trim()) : "";
    // One exact segmented occurrence is removed. Repeated words elsewhere stay.
    // A word review must actually test that saved word, not a different word
    // that happens to occur in its example sentence (including inflections).
    const choices = record.kind === "word" ? candidates.filter(segment => segment.value === preferred) : candidates;
    const gapPosition = options.gapPosition ?? "first";
    if (!["first", "random"].includes(gapPosition)) return null;
    let target;
    if (options.targetIndex !== undefined) {
      if (!Number.isSafeInteger(options.targetIndex) || options.targetIndex < 0) return null;
      target = choices.find(segment => source.segments.indexOf(segment) === options.targetIndex);
    } else {
      // A saved vocabulary item always tests that word. Sentence practice can
      // choose a different complete word each time without cutting characters.
      target = gapPosition === "random" && record.kind === "sentence" && choices.length > 1 ?
        choices[randomIndex(choices.length, options.random)] : choices[0];
    }
    if (!target) return null;
    const targetIndex = source.segments.indexOf(target), kana = alignedReadings(details, source.segments, "kana");
    const rawRomaji = alignedReadings(details, source.segments, "romaji");
    const spoken = Core?.displayRomaji ? Core.displayRomaji({ ...details, kind: "sentence" }, "spoken") : details.romaji;
    const spokenRomaji = alignedReadings({ ...details, romaji: spoken }, source.segments, "romaji");
    let answerKana = kana?.[targetIndex] || "", answerSourceRomaji = rawRomaji?.[targetIndex] || "";
    let answerSpokenRomaji = spokenRomaji?.[targetIndex] || answerSourceRomaji;
    // Standalone word metadata remains useful when iKnow splits its sentence's
    // Kana or Romaji into different units from the Japanese segmentation.
    if (preferred && target.value === preferred) {
      const ownKana = word(string(record.kana).trim());
      if (!answerKana && ownKana && !/\s/u.test(ownKana) && KANA_ONLY.test(ownKana)) answerKana = ownKana;
      const ownRomaji = word(string(record.romaji).trim());
      if (!answerSourceRomaji && ownRomaji && !/\s/u.test(ownRomaji)) answerSourceRomaji = ownRomaji;
      if (!answerSpokenRomaji) answerSpokenRomaji = answerSourceRomaji;
    }
    const acceptedAnswers = [...new Set([target.value, answerKana, answerSourceRomaji, answerSpokenRomaji].filter(Boolean))];
    return {
      before: source.japanese.slice(0, target.start), after: source.japanese.slice(target.end),
      answerJapanese: target.value, answerKana,
      answerRomaji: options.romajiStyle === "spoken" ? answerSpokenRomaji : answerSourceRomaji,
      acceptedAnswers, targetIndex, details: { ...details }
    };
  }
  function checkAnswer(cloze, input) {
    const value = normalizeAnswer(input);
    return Boolean(value && object(cloze) && Array.isArray(cloze.acceptedAnswers) &&
      cloze.acceptedAnswers.some(answer => normalizeAnswer(answer) === value));
  }
  function normalizeListeningAnswer(value, options = {}) {
    const normalized = normalizeAnswer(value);
    const kind = typeof options === "string" ? options : options.kind || "sentence";
    // Sentence punctuation is not part of a dictated word sequence. Hyphens,
    // apostrophes, prolonged sounds, small kana and doubled letters remain.
    return kind === "sentence" ? normalized.replace(/[.,!?。、！？…:;：；「」『』【】〈〉《》（）()\[\]{}"“”„«»]/gu, "") : normalized;
  }
  function buildListening(record, options = {}) {
    if (!object(record) || !["word", "sentence"].includes(record.kind)) return null;
    const context = !string(record.audioUrl).trim() && object(record.context) && string(record.context.audioUrl).trim();
    const value = context ? record.context : record;
    if (!string(value.audioUrl).trim()) return null;
    const kind = context ? "sentence" : record.kind, details = { ...value, kind };
    const japanese = string(value.japanese).trim(), kana = string(value.kana).trim(), raw = string(value.romaji).trim();
    const spoken = Core?.displayRomaji ? Core.displayRomaji(details, "spoken").trim() : raw;
    const visibleRomaji = options.romajiStyle === "spoken" ? spoken : raw;
    const forms = [japanese ? "Japanese" : "", kana ? "Kana" : "", raw || spoken ? "Romaji" : ""].filter(Boolean);
    const acceptedAnswers = [...new Set([japanese, kana, raw, spoken].filter(value => normalizeListeningAnswer(value, { kind })))];
    if (!acceptedAnswers.length) return null;
    // Keep the saved spelling intact so a later style change can always format
    // from the original source rather than reformatting an already spoken form.
    return { details, displayRomaji: visibleRomaji, acceptedAnswers, forms };
  }
  function checkListening(answer, input) {
    if (!object(answer) || !object(answer.details) || !Array.isArray(answer.acceptedAnswers)) return false;
    const options = { kind: answer.details.kind }, value = normalizeListeningAnswer(input, options);
    return Boolean(value && answer.acceptedAnswers.some(expected => normalizeListeningAnswer(expected, options) === value));
  }
  function stableHash(value) {
    let hash = 2166136261;
    for (const character of value) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function meaningParts(value) {
    return new Set(string(value).split(/[,;\/|]/u).map(part => normalizeListeningAnswer(part)).filter(Boolean));
  }
  function buildReviewQuestion(record, collection, options = {}) {
    if (!object(record) || !["word", "sentence"].includes(record.kind) || typeof record.key !== "string" ||
        !record.key || record.key.length > 130 || !Array.isArray(collection)) return null;
    const preferred = options.language === "de" ? "de" : "en", fields = { en: "english", de: "german" };
    const language = string(record[fields[preferred]]).trim() ? preferred : preferred === "en" ? "de" : "en";
    const field = fields[language], correct = string(record[field]).trim(), japanese = normalizeAnswer(record.japanese);
    const correctNormalized = normalizeListeningAnswer(correct);
    if (!correctNormalized || !japanese) return null;
    const targetParts = meaningParts(correct);
    const seenKeys = new Set([record.key]), best = [];
    const compare = (a, b) => a.hash - b.hash || a.id.localeCompare(b.id);
    // A Study library can contain 2,000 items. Keep only the three best
    // distinct distractors during one pass instead of sorting the full list.
    for (const candidate of collection) {
      if (!object(candidate) || candidate.kind !== record.kind || typeof candidate.key !== "string" ||
          !candidate.key || candidate.key.length > 130 || seenKeys.has(candidate.key)) continue;
      const candidateJapanese = normalizeAnswer(candidate.japanese);
      if (!candidateJapanese || candidateJapanese === japanese) continue;
      const label = string(candidate[field]).trim(), normalized = normalizeListeningAnswer(label);
      if (!normalized || normalized === correctNormalized) continue;
      // Shared published glosses are ambiguous choices, not useful distractors.
      if ([...meaningParts(label)].some(part => targetParts.has(part))) continue;
      seenKeys.add(candidate.key);
      const choice = { id: candidate.key, label, normalized, hash: stableHash(record.key + candidate.key) };
      const duplicate = best.findIndex(item => item.normalized === normalized);
      if (duplicate >= 0) {
        if (compare(choice, best[duplicate]) >= 0) continue;
        best.splice(duplicate, 1);
      }
      if (best.length === 3 && compare(choice, best[2]) >= 0) continue;
      best.push(choice); best.sort(compare);
      if (best.length > 3) best.pop();
    }
    const choices = best.map(({ id, label }) => ({ id, label }));
    if (!choices.length) return null;
    choices.splice(stableHash(record.key) % (choices.length + 1), 0, { id: record.key, label: correct });
    return { choices, correctId: record.key, details: { ...record }, language };
  }
  function isDue(record, now) {
    return !validReview(record?.review) || record.review.dueAt <= now;
  }
  function dueCount(records, now = Date.now()) {
    if (!Array.isArray(records) || !stamp(now)) return 0;
    return records.filter(record => object(record) && isDue(record, now)).length;
  }
  function selectSession(records, options = {}) {
    if (!Array.isArray(records)) throw Error("Choose saved study items to practice.");
    const mode = options.mode || "review", now = options.now ?? Date.now(), limit = options.limit ?? MAX_SESSION_ITEMS;
    if (!["review", "cloze", "listening"].includes(mode)) throw Error("Choose a supported practice mode.");
    if (!stamp(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SESSION_ITEMS) throw Error("Choose a valid practice size and time.");
    const seen = new Set(), candidates = records.filter(record => {
      if (!object(record) || !["word", "sentence"].includes(record.kind) || typeof record.key !== "string" || seen.has(record.key)) return false;
      seen.add(record.key);
      if (options.dueOnly !== false && !isDue(record, now)) return false;
      // Eligibility should not consume the session RNG or pick a hidden gap.
      // The displayed exercise selects its target once when that card opens.
      if (mode === "cloze") return Boolean(buildCloze(record, { ...options, gapPosition: "first" }));
      if (mode === "listening") return Boolean(string(record.audioUrl) || string(record.context?.audioUrl));
      return true;
    });
    const rank = record => validReview(record.review) ? record.review.dueAt <= now ? 0 : 2 : 1;
    const ordered = candidates.slice().sort((a, b) => rank(a) - rank(b) ||
      (validReview(a.review) ? a.review.dueAt : Number(a.createdAt) || 0) -
      (validReview(b.review) ? b.review.dueAt : Number(b.createdAt) || 0) || a.key.localeCompare(b.key));
    if (options.shuffle === true) {
      // Keep overdue reviews ahead of new items and future reviews. Only the
      // order inside each priority bucket changes, on a fresh copied array.
      let start = 0;
      while (start < ordered.length) {
        let end = start + 1;
        while (end < ordered.length && rank(ordered[end]) === rank(ordered[start])) end++;
        for (let index = end - 1; index > start; index--) {
          const other = start + randomIndex(index - start + 1, options.random);
          [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
        }
        start = end;
      }
    }
    return ordered.slice(0, limit);
  }
  const api = Object.freeze({ DAY_MS, DATE_LIMIT, MAX_INTERVAL_DAYS, MAX_SESSION_ITEMS, RATINGS, validReview, nextReview,
    normalizeAnswer, buildCloze, checkAnswer, normalizeListeningAnswer, buildListening, checkListening,
    buildReviewQuestion, selectSession, dueCount });
  globalThis.IKnowReaderStudyPractice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
