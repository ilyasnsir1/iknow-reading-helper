/* Prefer an original standalone recording only for the same written/spoken form.
 * Reading-only matches and dictionary-form substitutions are deliberately excluded. */
(() => {
  'use strict';
  const root = globalThis;
  const bundled = new Map();
  let current = new Map();
  const plain = value => typeof value === 'string' && value.length <= 1000 ?
    (root.IKnowReaderCore?.plainText ? root.IKnowReaderCore.plainText(value) : value.replace(/<[^>]*>/g, '').trim()) : '';
  function normalized(value) {
    return plain(value).normalize('NFKC').replace(/[\u30a1-\u30f6]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60)).replace(/[\s\p{P}]/gu, '');
  }
  function keyFor(japanese, kana) {
    const native = normalized(japanese), reading = normalized(kana);
    return native && reading && !native.includes('\0') && !reading.includes('\0') ? `${native}\0${reading}` : null;
  }
  function recording(native, reading, source) {
    if (typeof source !== 'string' || source.length > 4000) return null;
    let url;
    try { url = new URL(source); } catch { return null; }
    if (url.protocol !== 'https:' || !/^assets\d*\.iknow\.jp$/i.test(url.hostname) || !url.pathname.startsWith('/assets/') || !/\.mp3$/i.test(url.pathname) || url.username || url.password || url.hash || url.search.length > 2000) return null;
    const key = keyFor(native, reading);
    if (!key) return null;
    return { key, value: Object.freeze({ src: url.href, reading: plain(reading).normalize('NFKC'), native: plain(native).normalize('NFKC') }) };
  }
  if (root.IKnowReaderWordAudioData?.schemaVersion === 1 && Array.isArray(root.IKnowReaderWordAudioData.entries)) {
    for (const row of root.IKnowReaderWordAudioData.entries) {
      if (!Array.isArray(row) || row.length !== 3) continue;
      const entry = recording(row[0], row[1], row[2]);
      if (entry && !bundled.has(entry.key)) bundled.set(entry.key, entry.value);
    }
  }
  function find({ japanese, kana } = {}) {
    const key = keyFor(japanese, kana);
    return key ? current.get(key) || bundled.get(key) || null : null;
  }
  function registerCourse(course) {
    const next = new Map();
    if (course?.cue_language?.split('-')[0] === 'ja' && Array.isArray(course.goal_items)) {
      for (const item of course.goal_items.slice(0, 10000)) {
        const cue = item?.item?.cue;
        const entry = recording(cue?.text, cue?.transliterations?.Hrkt, item?.sound);
        if (entry && !next.has(entry.key)) next.set(entry.key, entry.value);
      }
    }
    current = next;
    return current.size;
  }
  function sentence(state, requestedIndex) {
    const cue = state?.sentence?.cue;
    const readings = root.IKnowReaderCore?.tokenize(plain(cue?.transliterations?.Hrkt));
    const surfaces = root.IKnowReaderPronunciation?.nativeWords(cue);
    if (!readings?.length || surfaces?.length !== readings.length || !Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= readings.length) return null;
    let first = requestedIndex;
    while (first > 0 && state.romanElements?.[first]?.node?.hidden) first--;
    const indices = [first];
    for (let next = first + 1; next < readings.length && state.romanElements?.[next]?.node?.hidden; next++) indices.push(next);
    // An exact written form and its published reading are both required.
    // Never substitute a homophone, dictionary lemma or an acoustic neighbor.
    const value = find({ japanese: indices.map(index => surfaces[index].text).join(""), kana: indices.map(index => readings[index].text).join("") });
    return value ? { ...value, indices } : null;
  }
  root.IKnowReaderWordAudio = Object.freeze({ find, registerCourse, sentence });
})();
