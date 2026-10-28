/* Use exactly the same published readings and reviewed merges as word clicks. */
(() => {
 'use strict';
 const Core = globalThis.IKnowReaderCore || require('./core.js');
 const Pron = globalThis.IKnowReaderPronunciation || require('./word-pronunciation.js');
 function collect(course, data = {}, settings = {}, audio = {}) {
  if (!course || !/^\d{1,12}$/.test(String(course.id)) || !Array.isArray(course.goal_items) || course.goal_items.length > 10000) throw Error('This course has no usable Japanese items.');
  const unique = new Map(); let skipped = 0, targets = 0;
  const add = word => { if (!word) { skipped++; return; } targets++; unique.set(word.text + '\u0000' + word.japanese, word); };
  for (const entry of course.goal_items) {
   if (entry.item?.cue) add(Pron.itemDescriptor(entry.item.cue));
   for (const sentence of entry.sentences || []) {
    const id = String(sentence.cue?.id), fields = [sentence.cue?.text, sentence.response?.text, sentence.cue?.transliterations?.Hrkt, sentence.cue?.transliterations?.Latn].map(Core.plainText);
    const signature = Core.signature(fields);
    const record = settings.pronunciation !== false ? Core.alignmentFor(data, id, signature) : undefined;
    let audioPath = null;
    try { if (sentence.sound) audioPath = new URL(sentence.sound, 'https://iknow.jp/').pathname; } catch { /* Unavailable timing keeps the published Kana reading. */ }
    const audioRecord = Core.audioFor(audio, id, { signature, audioPath });
    const state = { sentence, record, audioRecord }, roman = Core.tokenize(Core.plainText(sentence.cue?.transliterations?.Latn));
    for (let index = 0; index < roman.length; index++) {
     if (record?.pronunciation?.[index] === '') continue;
     const indices = [index];
     for (let next = index + 1; next < roman.length && record?.pronunciation?.[next] === ''; next++) indices.push(next);
     add(Pron.descriptor(state, indices));
    }
   }
  }
  const words = [...unique.values()];
  if (!words.length) throw Error('No reliable Japanese word readings were found.');
  if (words.length > 2000) throw Error('This course has more than 2,000 distinct word forms. Prepare a smaller course.');
  return { courseId: String(course.id), title: Core.plainText(course.title || course.name) || 'Course ' + course.id,
   words, skipped, targets, sourceSignature: Core.signature([String(course.id), JSON.stringify(words)]) };
 }
 const api = Object.freeze({ collect });
 if (typeof module !== 'undefined' && module.exports) module.exports = api; else globalThis.IKnowReaderWordVoiceCourse = api;
})();
