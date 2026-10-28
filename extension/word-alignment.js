/* Conservative view-only lexical links. Phrase data and saved fingerprints stay
 * unchanged; unsupported segmentation or semantics fall back explicitly. */
(() => {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./core.js") : globalThis.IKnowReaderCore;
  const MAX_GROUPS = 12;
  const lexical = text => /[\p{L}\p{N}]/u.test(text);
  const stripEdges = text => String(text || "").replace(/^[\p{P}\p{Z}\s]+|[\p{P}\p{Z}\s]+$/gu, "");
  const kana = text => String(text || "").normalize("NFKC").replace(/[ァ-ヶ]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const copyRanges = value => (value || []).map(range => [...range]);
  function splitGlosses(value) {
    const source = Core.plainText(value), parts = []; let depth = 0, start = 0;
    for (let index = 0; index < source.length; index++) {
      if (source[index] === "(") depth++;
      else if (source[index] === ")") depth = Math.max(0, depth - 1);
      else if (!depth && /[,;]/u.test(source[index])) { parts.push(source.slice(start, index)); start = index + 1; }
    }
    parts.push(source.slice(start));
    return [...new Set(parts.flatMap(part => {
      const exact = part.trim(), short = exact.replace(/\s*\([^()]*\)\s*$/u, "").trim();
      return [exact, short].filter(text => text && lexical(text) && text.length <= 120);
    }))];
  }
  function createLexicon(course, data = {}) {
    const entries = [], bySurface = new Map();
    for (const owner of course?.goal_items || []) {
      const item = owner?.item, surface = Core.plainText(item?.cue?.text), english = Core.plainText(item?.response?.text);
      if (!surface || !english || surface.length > 100) continue;
      const saved = Core.germanItemFor(data, String(item.id), Core.signature([surface, english]));
      const validGerman = saved?.signature === Core.signature([surface, english]) && typeof saved.text === "string";
      const noun = /^noun$/iu.test(item.cue.part_of_speech || "");
      const de = validGerman ? splitGlosses(saved.text).map(gloss => {
        return noun ? gloss.replace(/^(?:[Dd]er|[Dd]ie|[Dd]as|[Ee]in|[Ee]ine)\s+(?=[A-ZÄÖÜ])/u, "") : gloss;
      }) : [];
      const entry = Object.freeze({ surface, reading: kana(stripEdges(Core.plainText(item.cue.transliterations?.Hrkt))),
        en: Object.freeze(splitGlosses(english)), de: Object.freeze([...new Set(de)]), noun });
      entries.push(entry);
      if (!bySurface.has(surface)) bySurface.set(surface, []);
      bySurface.get(surface).push(entry);
    }
    return Object.freeze({ entries: Object.freeze(entries), bySurface });
  }
  function literalMatches(text, gloss, limits) {
    if (!gloss) return [];
    const results = [], regex = new RegExp(escape(gloss), "giu");
    for (const match of text.matchAll(regex)) {
      const start = match.index, end = start + match[0].length;
      const word = char => !!char && /[\p{L}\p{N}_’'\-]/u.test(char);
      if (word(match[0][0]) && word(text[start - 1]) || word(match[0].slice(-1)) && word(text[end])) continue;
      if (limits.some(([a, b]) => start >= a && end <= b)) results.push([start, end]);
    }
    return results;
  }
  function uniqueMatch(text, glosses, limits) {
    const ranges = [...new Map(glosses.flatMap(gloss => literalMatches(text, gloss, limits)).map(range => [range.join(":"), range])).values()];
    // A longer exact glossary phrase supersedes its own contained short form.
    const maximal = ranges.filter(([a, b]) => !ranges.some(([c, d]) => c <= a && d >= b && (c < a || d > b)));
    return maximal.length === 1 ? maximal[0] : null;
  }
  function nativeUnits(sentence, lexicon) {
    const cue = sentence?.cue, japanese = Core.plainText(cue?.text);
    const spoken = Core.tokenize(Core.plainText(cue?.transliterations?.Hrkt)).map((token, index) => ({ text: stripEdges(token.text), index })).filter(token => lexical(token.text));
    const written = Core.tokenize(Core.plainText(cue?.transliterations?.Jpan)).map(token => stripEdges(token.text)).filter(lexical);
    if (!written.length || written.length !== spoken.length) return null;
    const units = []; let cursor = 0;
    for (let index = 0; index < written.length; index++) {
      const text = written[index], start = japanese.indexOf(text, cursor), reading = kana(spoken[index].text), normalized = kana(text);
      if (start < cursor || lexical(japanese.slice(cursor, start))) return null;
      // Exact Kana units, literal affixes and known headword readings must agree.
      // Equal token counts alone are insufficient (e.g. 3 月 vs 3がつ).
      if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー0-9]+$/u.test(text) && normalized !== reading) return null;
      const prefix = normalized.match(/^[\p{Script=Hiragana}ー]+/u)?.[0], suffix = normalized.match(/[\p{Script=Hiragana}ー]+$/u)?.[0];
      if (prefix && !reading.startsWith(prefix) || suffix && !reading.endsWith(suffix)) return null;
      const known = (lexicon?.bySurface?.get(text) || []).map(entry => entry.reading).filter(Boolean);
      if (known.length && !known.includes(reading)) return null;
      cursor = start + text.length;
      units.push({ text, start, end: cursor, index: spoken[index].index, reading,
        quoted: /[「『]/u.test(japanese[start - 1] || "") && /[」』]/u.test(japanese[cursor] || "") });
    }
    return lexical(japanese.slice(cursor)) ? null : units;
  }
  const isParticle = unit => !unit.quoted && ["は", "が", "を"].includes(unit.text) && kana(unit.text) === unit.reading;
  const inside = (range, limits) => limits.some(([a, b]) => range[0] >= a && range[1] <= b);
  const overlap = (range, ranges) => ranges.some(([a, b]) => range[0] < b && range[1] > a);
  function subtract(ranges, removed) {
    let result = copyRanges(ranges);
    for (const [c, d] of removed) result = result.flatMap(([a, b]) => b <= c || a >= d ? [[a, b]] : [...(a < c ? [[a, c]] : []), ...(b > d ? [[d, b]] : [])]);
    return result;
  }
  const phraseDetail = () => ({ kind: "phrase", note: {
    en: "A phrase equivalent is kept here; a reliable smaller word link is not available.",
    de: "Hier bleibt eine sinngemäße Gruppe erhalten; eine verlässliche kleinere Wortzuordnung liegt nicht vor."
  } });
  function fallback(group, de, units) {
    const particles = units?.filter(unit => isParticle(unit) && group.tokens.includes(unit.index) && inside([unit.start, unit.end], group.ja)) || [];
    const tokens = group.tokens.filter(index => !particles.some(unit => unit.index === index));
    const ja = subtract(group.ja, particles.map(unit => [unit.start, unit.end]));
    return ja.length && tokens.length ? { ja, en: copyRanges(group.en), de: copyRanges(de), tokens, wordDetail: phraseDetail() } : null;
  }
  function output(record, groups) {
    const selected = groups.slice(0, MAX_GROUPS);
    const projected = { ...record, groups: selected.map(({ de, ...group }) => group), pronunciation: { ...(record.pronunciation || {}) },
      wordDetail: { projection: true, refinedGroups: selected.filter(group => group.wordDetail.kind !== "phrase").length,
        fallbackGroups: selected.filter(group => group.wordDetail.kind === "phrase").length } };
    if (record.german) projected.german = { ...record.german, groups: selected.map(group => copyRanges(group.de)) };
    return projected;
  }
  function reviewedOverride(record, sentence) {
    const id = String(sentence?.cue?.id), ja = Core.plainText(sentence?.cue?.text), en = Core.plainText(sentence?.response?.text);
    const de = record.german?.text || "";
    const lexicalDetail = () => ({ kind: "lexical" });
    const make = (japanese, english, german, tokens, detail = lexicalDetail()) => ({ ja: [japanese], en: english ? [english] : [], de: german ? [german] : [], tokens, wordDetail: detail });
    const locate = (source, text) => { const start = source.indexOf(text); return start >= 0 ? [start, start + text.length] : null; };
    if (id === "246957" && record.signature === "4d030538" && ja === "それはとてもいい話だ。" && en === "That's a really nice story.") {
      const german = de === "Das ist eine wirklich schöne Geschichte.";
      return output(record, [
        make([0, 2], [0, 4], german ? [0, 3] : null, [0]),
        make([3, 6], locate(en, "really"), german ? locate(de, "wirklich") : null, [2]),
        make([6, 8], locate(en, "nice"), german ? locate(de, "schöne") : null, [3]),
        make([8, 9], locate(en, "story"), german ? locate(de, "Geschichte") : null, [4]),
        make([9, 10], [4, 6], german ? [4, 7] : null, [5], { kind: "grammar", note: {
          en: "だ supplies the copula here: the “is” in “that’s”.",
          de: "だ übernimmt hier die Kopulafunktion: das „ist“ in „Das ist …“."
        } })
      ]);
    }
    if (id === "1109041" && record.signature === "92b35a28" && ja === "3月は仕事が忙しい。" && en === "I have a lot of work in March.") {
      const german = de === "Im März habe ich bei der Arbeit viel zu tun.";
      const groups = [
        make([0, 2], locate(en, "March"), german ? locate(de, "März") : null, [0]),
        make([3, 5], locate(en, "work"), german ? locate(de, "Arbeit") : null, [2])
      ];
      if (german) groups.push(make([6, 9], null, locate(de, "viel zu tun"), [4], { kind: "lexical", note: {
        en: "This link marks the German equivalent. The English paraphrase has no separate, non-overlapping word equivalent here.",
        de: "Hier wird die deutsche Entsprechung markiert; die englische Umschreibung hat kein separates, überschneidungsfreies Wortgegenstück."
      } }));
      return output(record, groups);
    }
    return null;
  }
  function project(record, sentence, lexicon) {
    if (!record || !Array.isArray(record.groups)) return record;
    const fields = [Core.plainText(sentence?.cue?.text), Core.plainText(sentence?.response?.text), Core.plainText(sentence?.cue?.transliterations?.Hrkt), Core.plainText(sentence?.cue?.transliterations?.Latn)];
    if (Core.signature(fields) !== record.signature) return output(record, record.groups.map((group, index) => fallback(group, record.german?.groups?.[index], null)).filter(Boolean));
    const reviewed = reviewedOverride(record, sentence);
    if (reviewed) return reviewed;
    const units = nativeUnits(sentence, lexicon), groups = [];
    const ja = fields[0], en = fields[1], de = record.german?.text || "";
    record.groups.forEach((parent, parentIndex) => {
      const germanLimits = record.german?.groups?.[parentIndex] || [], candidates = [];
      if (units && lexicon?.bySurface) for (let start = 0; start < units.length; start++) {
        for (let end = start; end < Math.min(start + 4, units.length); end++) {
          const run = units.slice(start, end + 1), first = run[0], last = run[run.length - 1];
          if (run.some(unit => isParticle(unit) || !parent.tokens.includes(unit.index) || !inside([unit.start, unit.end], parent.ja))) break;
          if (run.some((unit, index) => index && unit.start !== run[index - 1].end)) break;
          const surface = ja.slice(first.start, last.end);
          // Do not pull a lexical prefix out of a contiguous Kanji compound.
          const hanBoundary = (left, right) => !!left && !!right && /\p{Script=Han}$/u.test(left.text) && /^\p{Script=Han}/u.test(right.text) && left.end === right.start;
          if (hanBoundary(units[start - 1], first) || hanBoundary(last, units[end + 1])) continue;
          const reading = run.map(unit => unit.reading).join("");
          const entries = (lexicon.bySurface.get(surface) || []).filter(entry => !entry.reading || entry.reading === reading);
          if (!entries.length) continue;
          const english = uniqueMatch(en, entries.flatMap(entry => entry.en), parent.en);
          if (!english) continue;
          const german = uniqueMatch(de, entries.flatMap(entry => entry.de), germanLimits);
          candidates.push({ ja: [[first.start, last.end]], en: [english], de: german ? [german] : [], tokens: run.map(unit => unit.index), wordDetail: { kind: "lexical" } });
        }
      }
      const accepted = [], used = { ja: [], en: [], de: [] }, tokens = new Set();
      candidates.sort((left, right) => (right.ja[0][1] - right.ja[0][0]) - (left.ja[0][1] - left.ja[0][0]));
      for (const candidate of candidates) {
        if (candidate.tokens.some(index => tokens.has(index)) || ["ja", "en", "de"].some(field => candidate[field].some(range => overlap(range, used[field])))) continue;
        accepted.push(candidate); for (const field of ["ja", "en", "de"]) used[field].push(...candidate[field]);
        candidate.tokens.forEach(index => tokens.add(index));
      }
      if (accepted.length) groups.push(...accepted.sort((left, right) => left.ja[0][0] - right.ja[0][0]));
      else { const kept = fallback(parent, germanLimits, units); if (kept) groups.push(kept); }
    });
    return output(record, groups);
  }
  const api = Object.freeze({ createLexicon, project });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderWordAlignment = api;
})();
