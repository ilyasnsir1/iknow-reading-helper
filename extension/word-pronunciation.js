/* Use iKnow's reading, rather than guessing a Kanji reading for isolated speech. */
(() => {
  "use strict";
  const Core = globalThis.IKnowReaderCore || (typeof require === "function" ? require("./core.js") : null);
  const clean = value => Core.plainText(value).normalize("NFKC").replace(/[\s、。！？,.!?「」『』（）()・…:;"“”]/gu, "");
  const valid = value => typeof value === "string" && value.length > 0 && value.length <= 80 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30faー]+$/u.test(value);
  const syllables = {};
  const rows = {
    "": "あいうえお", k: "かきくけこ", g: "がぎぐげご", s: "さしすせそ", z: "ざじずぜぞ",
    t: "たちつてと", d: "だぢづでど", n: "なにぬねの", h: "はひふへほ", b: "ばびぶべぼ",
    p: "ぱぴぷぺぽ", m: "まみむめも", r: "らりるれろ"
  };
  for (const [consonant, kana] of Object.entries(rows)) for (let index = 0; index < 5; index++) syllables[consonant + "aiueo"[index]] = kana[index];
  Object.assign(syllables, { shi: "し", chi: "ち", tsu: "つ", ji: "じ", fu: "ふ", ja: "じゃ", ju: "じゅ", jo: "じょ", ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wo: "お", wi: "うぃ", we: "うぇ", she: "しぇ", che: "ちぇ", je: "じぇ", ti: "てぃ", di: "でぃ", tu: "とぅ", du: "どぅ", fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ" });
  for (const [stem, kana] of Object.entries({ ky: "き", gy: "ぎ", sh: "し", sy: "し", ch: "ち", ty: "ち", jy: "じ", j: "じ", ny: "に", hy: "ひ", by: "び", py: "ぴ", my: "み", ry: "り" })) {
    for (const [vowel, small] of Object.entries({ a: "ゃ", u: "ゅ", o: "ょ" })) syllables[stem + vowel] = kana + small;
  }
  function romanKana(value) {
    const text = String(value || "").toLowerCase().replace(/’/g, "'").replace(/[.,!?;:\s-]/g, "");
    if (!/^[a-z']+$/.test(text)) return null;
    let output = "";
    for (let index = 0; index < text.length;) {
      const letter = text[index], next = text[index + 1];
      if (letter === "n" && next === "'") { output += "ん"; index += 2; continue; }
      if (letter === next && !"aeioun".includes(letter)) { output += "っ"; index++; continue; }
      if (letter === "n" && (!next || next === "n" || !"aiueoy".includes(next))) { output += "ん"; index++; continue; }
      let found = false;
      for (let length = 3; length >= 1; length--) {
        const syllable = text.slice(index, index + length);
        if (syllables[syllable]) { output += syllables[syllable]; index += length; found = true; break; }
      }
      if (!found) return null;
    }
    return valid(output) ? output : null;
  }
  function nativeWords(cue) {
    const native = Core.plainText(cue?.text), separated = Core.tokenize(Core.plainText(cue?.transliterations?.Jpan));
    if (!native || !separated.length) return null;
    let cursor = 0;
    const words = [];
    for (const token of separated) {
      const start = native.indexOf(token.text, cursor);
      if (start < cursor || /\S/u.test(native.slice(cursor, start))) return null;
      cursor = start + token.text.length;
      words.push({ text: token.text, start, end: cursor, quoted: /[「『]/u.test(native[start - 1] || "") && /[」』]/u.test(native[cursor] || "") });
    }
    if (/\S/u.test(native.slice(cursor))) return null;
    const count = Core.tokenize(Core.plainText(cue?.transliterations?.Hrkt)).length;
    if (words.length === count) return words;
    const spoken = words.filter(word => !/^[。、！？,.!?「」『』（）()…:;"“”]+$/u.test(word.text));
    return spoken.length === count ? spoken : null;
  }
  function sentence(state, indices) {
    const cue = state.sentence?.cue;
    const kana = Core.tokenize(Core.plainText(cue?.transliterations?.Hrkt));
    const roman = Core.tokenize(Core.plainText(cue?.transliterations?.Latn));
    if (!indices?.length || kana.length !== roman.length || indices.some(index => !kana[index])) return null;
    // Reviewed counter readings may combine several written tokens (ichi satsu → issatsu).
    const overrides = state.record?.pronunciation || {};
    const revised = indices.some(index => overrides[index] !== undefined && overrides[index] !== roman[index].text);
    if (revised) {
      const value = romanKana(indices.map(index => overrides[index] ?? roman[index].text).join(""));
      if (value) return value;
    }
    const ranges = state.audioRecord?.tokens.filter(token => (token.indices || [token.index]).some(index => indices.includes(index))).flatMap(token => token.ja || []) || [];
    const native = Core.plainText(cue.text);
    const written = ranges.map(([start, end]) => native.slice(start, end)).join("");
    const surfaces = nativeWords(cue);
    const value = indices.map(index => {
      const reading = clean(kana[index].text), latin = roman[index].text.replace(/[.,!?;:]/g, "").toLowerCase();
      const surface = surfaces?.length === kana.length ? surfaces[index] : null;
      const exactWritten = surface?.text || (indices.length === 1 ? written : "");
      if (reading === "を") return "お";
      if (reading === "は" && !surface?.quoted && (latin === "wa" || latin === "ha" && exactWritten === "は")) return "わ";
      if (reading === "へ" && !surface?.quoted && (latin === "e" || latin === "he" && exactWritten === "へ")) return "え";
      return reading;
    }).join("");
    return valid(value) ? value : null;
  }
  function item(cue) {
    const reading = clean(cue?.transliterations?.Hrkt || "");
    return valid(reading) ? reading : romanKana(Core.plainText(cue?.transliterations?.Latn));
  }
  // Keep the known reading alongside its exact written form. The local neural
  // engine checks that form against the reading before using it for accent.
  function speechDescriptor(reading, written) {
    if (!valid(reading)) return null;
    let japanese = clean(written || "");
    if (!japanese || japanese.length > 160 || !/^[\p{Script=Han}\u3041-\u3096\u3099\u309a\u30a1-\u30faー々〆〇0-9]+$/u.test(japanese)) japanese = reading;
    // An isolated orthographic particle must retain its spoken pronunciation.
    if ((japanese === "は" && reading === "わ") || (japanese === "を" && reading === "お") || (japanese === "へ" && reading === "え")) japanese = reading;
    return { text: reading, japanese };
  }
  function descriptor(state, indices) {
    if (!Array.isArray(indices) || !indices.length || indices.some((index, position) => !Number.isInteger(index) || index < 0 || position > 0 && index !== indices[position - 1] + 1)) return null;
    const reading = sentence(state, indices);
    const words = nativeWords(state.sentence?.cue);
    const written = words && indices.every(index => words[index]) ? indices.map(index => words[index].text).join("") : "";
    return speechDescriptor(reading, written);
  }
  function itemDescriptor(cue) { return speechDescriptor(item(cue), Core.plainText(cue?.text)); }
  const api = Object.freeze({ sentence, item, valid, romanKana, nativeWords, descriptor, itemDescriptor });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderPronunciation = api;
})();
