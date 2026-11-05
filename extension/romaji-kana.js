(() => {
  "use strict";
  const syllables = {};
  const rows = [
    ["a i u e o", "あいうえお"], ["ka ki ku ke ko", "かきくけこ"], ["sa shi su se so", "さしすせそ"],
    ["ta chi tsu te to", "たちつてと"], ["na ni nu ne no", "なにぬねの"], ["ha hi fu he ho", "はひふへほ"],
    ["ma mi mu me mo", "まみむめも"], ["ra ri ru re ro", "らりるれろ"], ["ga gi gu ge go", "がぎぐげご"],
    ["za ji zu ze zo", "ざじずぜぞ"], ["da di du de do", "だぢづでど"], ["ba bi bu be bo", "ばびぶべぼ"],
    ["pa pi pu pe po", "ぱぴぷぺぽ"]
  ];
  for (const [roman, kana] of rows) roman.split(" ").forEach((part, index) => { syllables[part] = kana[index]; });
  Object.assign(syllables, { ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wo: "を", si: "し", ti: "ち", tu: "つ", hu: "ふ", zi: "じ", dzu: "づ" });
  for (const [prefix, kana] of Object.entries({ ky: "き", ny: "に", hy: "ひ", my: "み", ry: "り", gy: "ぎ", by: "び", py: "ぴ", sh: "し", sy: "し", ch: "ち", ty: "ち", cy: "ち", j: "じ", jy: "じ", zy: "じ" })) {
    for (const [vowel, small] of Object.entries({ a: "ゃ", u: "ゅ", o: "ょ" })) syllables[prefix + vowel] = kana + small;
  }
  Object.assign(syllables, { fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ", she: "しぇ", che: "ちぇ", je: "じぇ", wi: "うぃ", we: "うぇ", tsa: "つぁ", tsi: "つぃ", tse: "つぇ", tso: "つぉ", thi: "てぃ", dhu: "でゅ", dhi: "でぃ" });
  const punctuation = { "(": "（", ")": "）", "[": "（", "]": "）", "!": "！", "?": "？", ",": "、", ".": "。", ":": "：", ";": "；", "/": "・", "-": "ー" };
  const longVowels = { ā: "aa", ī: "ii", ū: "uu", ē: "ee", ō: "ou", â: "aa", î: "ii", û: "uu", ê: "ee", ô: "ou" };

  function convert(value) {
    const fail = () => ({ ok: false, kana: "", needsReview: false });
    if (typeof value !== "string" || value.length > 5000) return fail();
    const source = value.normalize("NFKC").trim().toLowerCase().replace(/[’‘]/gu, "'");
    if (!/[a-zāīūēōâîûêô]/u.test(source)) return fail();
    const text = source.replace(/[āīūēōâîûêô]/gu, character => longVowels[character]);
    let kana = "";
    for (let index = 0; index < text.length;) {
      const char = text[index], next = text[index + 1];
      if (/\s/u.test(char)) { kana += " "; index++; continue; }
      if (char === "-" && (index === 0 || !/[a-zāīūēō]/u.test(text[index - 1]))) { index++; continue; }
      if (Object.hasOwn(punctuation, char)) { kana += punctuation[char]; index++; continue; }
      if (/\d/u.test(char)) { kana += char; index++; continue; }
      if (char === "n" && (next === "'" || !next || !/[a-z]/u.test(next) || /[^aeiouyn]/u.test(next))) {
        kana += "ん"; index += next === "'" ? 2 : 1; continue;
      }
      if (char === "n" && next === "n") {
        kana += "ん"; index += /[aeiouy]/u.test(text[index + 2] || " ") ? 1 : 2; continue;
      }
      if ((/[bcdfghjkmprstvyz]/u.test(char) && char === next) || text.slice(index, index + 3) === "tch") {
        kana += "っ"; index++; continue;
      }
      let part = "";
      for (const length of [3, 2, 1]) {
        const candidate = text.slice(index, index + length);
        if (syllables[candidate]) { part = candidate; break; }
      }
      if (!part) return fail();
      kana += syllables[part]; index += part.length;
    }
    return { ok: true, kana, needsReview: /([aeiou])\1|[āīūēōâîûêô]|(?:^|\s)(?:wa|o|e)(?:\s|$)/u.test(source) };
  }
  const romanSyllables = Object.fromEntries(Object.entries(syllables).reverse().map(([roman, kana]) => [kana, roman]));
  function toRomaji(value) {
    if(typeof value!=='string'||value.length>5000)return '';
    const text=value.normalize('NFKC').replace(/[\u30a1-\u30f6]/gu,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
    const signs={'。':'.','、':',','！':'!','？':'?','「':'"','」':'"','『':'"','』':'"','・':'/'};
    let result='';
    for(let index=0;index<text.length;index++){
      const char=text[index],next=romanSyllables[text.slice(index+1,index+3)]||romanSyllables[text[index+1]]||'';
      if(char==='ん'){result+=/^[aeiouy]/u.test(next)?"n'":'n';continue;}
      if(char==='っ'){if(!/^[bcdfghjkmprstvyz]/u.test(next))return '';result+=next.startsWith('ch')?'t':next[0];continue;}
      if(char==='ー'){const vowels=result.match(/[aeiou]/gu);if(!vowels?.length)return '';result+=vowels.at(-1);continue;}
      const pair=romanSyllables[text.slice(index,index+2)],part=pair||romanSyllables[char];
      if(part){result+=part;if(pair)index++;continue;}
      if(Object.hasOwn(signs,char)){result+=signs[char];continue;}
      if(/[\s\d\p{P}]/u.test(char)){result+=char;continue;}
      return '';
    }
    return /[a-z]/u.test(result)?result:'';
  }
  const api = Object.freeze({ convert, toRomaji });
  globalThis.IKnowRomajiKana = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
