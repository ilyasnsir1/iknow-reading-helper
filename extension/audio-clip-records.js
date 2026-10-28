/* Decode on demand for quiet-gap refinement and word-only PCM playback. */
(() => {
  "use strict";
  const records = new Map();
  let context = null, phraseContext = null, decodedBytes = 0, generation = 0;
  const remove = key => { const entry = records.get(key); if (entry) { decodedBytes -= entry.bytes; records.delete(key); } };
  function prune() { while (records.size > 24 || decodedBytes > 16 * 1024 * 1024) remove(records.keys().next().value); }
  async function inspect(record, src, phrase = false) {
    if ((!phrase && !globalThis.IKnowReaderAudioEdges) || !globalThis.chrome?.runtime || typeof src !== "string" || !record || typeof record !== "object") return { record, audio: null };
    const sampleRate = phrase ? 48000 : 16000;
    const key = `${sampleRate}\n${src}\n${record.signature}\n${record.duration}\n${JSON.stringify(record.tokens)}`;
    if (records.has(key)) { const hit = records.get(key); records.delete(key); records.set(key, hit); return hit.work; }
    const entry = { bytes: 0, work: null }, started = generation;
    entry.work = (async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "ikr:audio:source", src });
        if (started !== generation) return { record, audio: null };
        if (!response?.ok || typeof response.data !== "string" || response.data.length > 3 * 1024 * 1024) return { record, audio: null };
        const binary = atob(response.data), bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const decoder = phrase ? (phraseContext ||= new AudioContext({ sampleRate: 48000 })) : (context ||= new AudioContext({ sampleRate: 16000 }));
        const audio = await decoder.decodeAudioData(bytes.buffer);
        if (started !== generation) return { record, audio: null };
        if (Math.abs(audio.duration - record.duration) > .18 || audio.duration > 120 || audio.sampleRate !== sampleRate || !audio.numberOfChannels) return { record, audio: null };
        let mono = audio.getChannelData(0);
        if (audio.numberOfChannels > 1) {
          mono = new Float32Array(audio.length);
          for (let channel = 0; channel < audio.numberOfChannels; channel++) {
            const samples = audio.getChannelData(channel);
            for (let index = 0; index < mono.length; index++) mono[index] += samples[index] / audio.numberOfChannels;
          }
        }
        const buffer = { sampleRate: audio.sampleRate, numberOfChannels: 1, duration: mono.length / audio.sampleRate, length: mono.length, getChannelData: () => mono };
        if (records.get(key) === entry) { entry.bytes = mono.byteLength; decodedBytes += entry.bytes; prune(); }
        return { record: phrase ? record : globalThis.IKnowReaderAudioEdges.refine(record, mono, audio.sampleRate), audio: buffer };
      } catch { return { record, audio: null }; }
    })().then(value => { if (!value.audio && records.get(key) === entry) remove(key); return value; });
    records.set(key, entry); prune();
    return entry.work;
  }
  const refine = async (record, src) => (await inspect(record, src)).record;
  async function crop(record, src, start, end) {
    const inspected = await inspect(record, src);
    if (!inspected.audio || !globalThis.IKnowReaderAudioPcm) return null;
    const pcm = globalThis.IKnowReaderAudioPcm.crop(inspected.audio, start, Math.min(end, inspected.audio.duration));
    return pcm && Math.abs(pcm.duration - (end - start)) <= .002 ? pcm : null;
  }
  async function phrase(record, src, indices) {
    const inspected = await inspect(record, src, true);
    if (!inspected.audio || !globalThis.IKnowReaderAudioPhrases) return null;
    const range = globalThis.IKnowReaderAudioPhrases.select(inspected.record, inspected.audio.getChannelData(0), inspected.audio.sampleRate, indices);
    if (!range) return null;
    const start = Math.max(0, range.start), end = Math.min(range.end, inspected.audio.duration);
    if (end <= start || end - start > 8 || !globalThis.IKnowReaderAudioPcm?.cropPhrase) return null;
    const pcm = globalThis.IKnowReaderAudioPcm.cropPhrase(inspected.audio, start, end);
    return pcm && Math.abs(pcm.duration - (end - start)) <= .002 ? { ...range, start, end, pcm } : null;
  }
  window.addEventListener("pagehide", () => { generation++; records.clear(); decodedBytes = 0; for (const decoder of [context, phraseContext]) if (decoder) void decoder.close().catch(() => {}); context = null; phraseContext = null; });
  globalThis.IKnowReaderClipRecords = Object.freeze({ refine, crop, phrase });
})();
