/* Refine shared word boundaries only when the recording contains a clear gap.
 * Continuous speech is left unchanged; no word-length timing is inferred. */
(() => {
  "use strict";
  const WINDOW_SECONDS = .005;
  const MIN_GAP_SECONDS = .015;
  const MAX_SHIFT_SECONDS = .07;
  const QUIET_RATIO = .045;
  const MIN_WORD_SECONDS = .015;

  function refine(record, mono, sampleRate) {
    if (!record || !Array.isArray(record.tokens) || record.tokens.length < 2 ||
        !Number.isFinite(record.duration) || record.duration <= 0 || record.duration > 120 ||
        !mono || !ArrayBuffer.isView(mono) || Object.prototype.toString.call(mono) !== "[object Float32Array]" ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
        mono.length < sampleRate * .1) return record;
    const decodedDuration = mono.length / sampleRate;
    if (Math.abs(decodedDuration - record.duration) > .18) return record;
    for (const token of record.tokens) {
      if (!Number.isFinite(token.start) || !Number.isFinite(token.end) || token.start < 0 ||
          token.end - token.start < MIN_WORD_SECONDS || token.end > record.duration + .05) return record;
    }
    const windowSamples = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
    const step = windowSamples / sampleRate;
    const energies = new Float64Array(Math.floor(mono.length / windowSamples));
    for (let frame = 0; frame < energies.length; frame++) {
      let energy = 0;
      const offset = frame * windowSamples;
      for (let sample = offset; sample < offset + windowSamples; sample++) {
        const value = mono[sample];
        if (!Number.isFinite(value)) return record;
        energy += value * value;
      }
      energies[frame] = Math.sqrt(energy / windowSamples);
    }
    const tokens = record.tokens.map(token => ({ ...token }));
    for (let index = 0; index < tokens.length - 1; index++) {
      const originalLeft = record.tokens[index], originalRight = record.tokens[index + 1];
      // Existing substantial gaps are already safe. Small overlaps can arise
      // from alignment quantization and use their shared midpoint as a seed.
      if (Math.abs(originalRight.start - originalLeft.end) > .025) continue;
      const boundary = (originalLeft.end + originalRight.start) / 2;
      const cap = Math.min(MAX_SHIFT_SECONDS, .25 * Math.min(originalLeft.end - originalLeft.start, originalRight.end - originalRight.start));
      const lower = Math.max(boundary - cap, tokens[index].start + MIN_WORD_SECONDS);
      const upper = Math.min(boundary + cap, tokens[index + 1].end - MIN_WORD_SECONDS, decodedDuration);
      const from = Math.max(0, Math.ceil((lower - 1e-9) / step));
      const through = Math.min(energies.length - 1, Math.floor((upper + 1e-9) / step) - 1);
      if (through - from + 1 < Math.ceil(MIN_GAP_SECONDS / step - 1e-9)) continue;
      let peak = 0;
      for (let frame = from; frame <= through; frame++) peak = Math.max(peak, energies[frame]);
      // A wholly silent or almost-zero neighborhood has no useful speech
      // contrast. Neither uniform room noise nor a voiced vowel is a gap.
      if (peak < .00001) continue;
      const threshold = peak * QUIET_RATIO;
      let runStart = null, best = null;
      const consider = endFrame => {
        if (runStart === null) return;
        const start = runStart * step, end = endFrame * step;
        if (end - start + 1e-9 >= MIN_GAP_SECONDS) {
          const candidate = (start + end) / 2, distance = Math.abs(candidate - boundary);
          if (!best || distance < best.distance - 1e-9 || Math.abs(distance - best.distance) < 1e-9 && end - start > best.length) {
            best = { time: candidate, distance, length: end - start };
          }
        }
        runStart = null;
      };
      for (let frame = from; frame <= through; frame++) {
        if (energies[frame] <= threshold) { if (runStart === null) runStart = frame; }
        else consider(frame);
      }
      consider(through + 1);
      if (!best) continue;
      const time = Math.round(best.time * 1e6) / 1e6;
      if (time < lower || time > upper || time - tokens[index].start < MIN_WORD_SECONDS || tokens[index + 1].end - time < MIN_WORD_SECONDS) continue;
      tokens[index].end = time;
      tokens[index + 1].start = time;
    }
    return { ...record, tokens };
  }

  const api = Object.freeze({ refine });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderAudioEdges = api;
})();
