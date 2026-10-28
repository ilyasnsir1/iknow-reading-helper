/* Select an intact original-speech passage only at measured quiet pauses.
 * This does not infer word times or synthesize speech. Ambiguity keeps more audio. */
(() => {
  "use strict";
  const WINDOW = .005, MIN_PAUSE = .045, QUIET_AIR = .02;
  const TOKEN_GUARD = .02, EDGE_AIR = .05, MIN_PHRASE = .65;
  const MAX_SECONDS = 120, MAX_TOKENS = 2048;

  function select(record, mono, sampleRate, indices) {
    if (!record || !Number.isFinite(record.duration) || record.duration <= 0 || record.duration > MAX_SECONDS ||
        !Array.isArray(record.tokens) || !record.tokens.length || record.tokens.length > MAX_TOKENS ||
        Object.prototype.toString.call(mono) !== "[object Float32Array]" || !ArrayBuffer.isView(mono) ||
        !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 ||
        !mono.length || mono.length > MAX_SECONDS * sampleRate || !Array.isArray(indices) || !indices.length || indices.length > MAX_TOKENS ||
        indices.some(index => !Number.isInteger(index) || index < 0 || index > 65535)) return null;
    const duration = mono.length / sampleRate;
    if (Math.abs(duration - record.duration) > .18) return null;
    const requested = new Set(indices), found = new Set();
    let targetStart = Infinity, targetEnd = -Infinity, previousStart = -Infinity, previousEnd = 0;
    const tokens = [];
    for (const token of record.tokens) {
      const members = token?.indices === undefined ? [token?.index] : token.indices;
      if (!token || !Number.isFinite(token.start) || !Number.isFinite(token.end) ||
          token.start < 0 || token.end <= token.start || token.end > duration + .025 ||
          token.start < previousStart || token.start < previousEnd - .025 ||
          !Array.isArray(members) || !members.length || members.length > MAX_TOKENS ||
          members.some(index => !Number.isInteger(index) || index < 0 || index > 65535)) return null;
      tokens.push({ start: token.start, end: Math.min(duration, token.end) });
      previousStart = token.start; previousEnd = token.end;
      if (members.some(index => requested.has(index))) {
        for (const index of members) if (requested.has(index)) found.add(index);
        targetStart = Math.min(targetStart, token.start); targetEnd = Math.max(targetEnd, Math.min(duration, token.end));
      }
    }
    if (found.size !== requested.size || !Number.isFinite(targetStart) || targetEnd <= targetStart) return null;
    const protectedStart = Math.max(0, targetStart - TOKEN_GUARD), protectedEnd = Math.min(duration, targetEnd + TOKEN_GUARD);
    const windowSamples = Math.max(1, Math.round(sampleRate * WINDOW));
    const count = Math.ceil(mono.length / windowSamples), rms = new Float64Array(count);
    for (let frame = 0; frame < count; frame++) {
      const first = frame * windowSamples, last = Math.min(mono.length, first + windowSamples);
      let energy = 0;
      for (let sample = first; sample < last; sample++) {
        const value = mono[sample];
        if (!Number.isFinite(value)) return null;
        energy += value * value;
      }
      rms[frame] = Math.sqrt(energy / (last - first));
    }
    // A percentile prevents one loud transient from turning quiet consonants into silence.
    const ordered = Array.from(rms).filter(value => value > 1e-7).sort((a, b) => a - b);
    if (!ordered.length) return null;
    const reference = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * .9))];
    if (!Number.isFinite(reference) || reference < 1e-5) return null;
    const threshold = Math.min(.001, reference * .015);
    const runs = [];
    let runStart = null;
    function finish(endFrame) {
      if (runStart === null) return;
      const start = runStart * windowSamples / sampleRate, end = Math.min(duration, endFrame * windowSamples / sampleRate);
      if (end - start >= MIN_PAUSE - 1 / sampleRate) runs.push({ start, end });
      runStart = null;
    }
    for (let frame = 0; frame < count; frame++) {
      if (rms[frame] <= threshold) { if (runStart === null) runStart = frame; }
      else finish(frame);
    }
    finish(count);

    // Whole-speech fallback may remove only surplus file-edge silence, retaining 50 ms of air.
    const leading = runs.find(run => run.start === 0), trailing = runs.find(run => run.end === duration);
    const startEdge = Math.min(protectedStart, Math.max(0, tokens[0].start - TOKEN_GUARD), leading ? Math.max(0, leading.end - EDGE_AIR) : 0);
    const endEdge = Math.max(protectedEnd, Math.min(duration, tokens.at(-1).end + TOKEN_GUARD), trailing ? Math.min(duration, trailing.start + EDGE_AIR) : duration);
    const pauses = [];
    for (const run of runs) {
      if (run.start === 0 || run.end === duration) continue;
      const point = (run.start + run.end) / 2;
      if (point - run.start < QUIET_AIR || run.end - point < QUIET_AIR) continue;
      // Quiet inside a word is insufficient. It must also agree with an actual
      // transition between adjacent measured tokens (within alignment resolution).
      let transition = false;
      for (let index = 0; index < tokens.length - 1; index++) {
        const left = tokens[index], right = tokens[index + 1];
        if (point >= Math.min(left.end, right.start) - TOKEN_GUARD &&
            point <= Math.max(left.end, right.start) + TOKEN_GUARD) { transition = true; break; }
      }
      if (transition && point > startEdge && point < endEdge) pauses.push(point);
    }
    const boundaries = [startEdge, ...pauses, endEdge];
    let left = 0, right = boundaries.length - 1;
    for (let index = 1; index < boundaries.length - 1; index++) {
      if (boundaries[index] <= protectedStart) left = index;
      if (boundaries[index] >= protectedEnd) { right = index; break; }
    }
    // Tiny particles keep whole neighboring speech chunks rather than receiving
    // a longer hard cut. There is deliberately no maximum-duration truncation.
    while (boundaries[right] - boundaries[left] < MIN_PHRASE && (left > 0 || right < boundaries.length - 1)) {
      const options = [];
      if (left > 0) options.push({ left: left - 1, right, duration: boundaries[right] - boundaries[left - 1] });
      if (right < boundaries.length - 1) options.push({ left, right: right + 1, duration: boundaries[right + 1] - boundaries[left] });
      const longEnough = options.filter(option => option.duration >= MIN_PHRASE);
      const candidates = longEnough.length ? longEnough : options;
      candidates.sort((a, b) => a.duration - b.duration || a.left - b.left);
      ({ left, right } = candidates[0]);
    }
    // Round only to sample boundaries, then verify containment again.
    const start = Math.floor(boundaries[left] * sampleRate) / sampleRate;
    const end = Math.min(duration, Math.ceil(boundaries[right] * sampleRate) / sampleRate);
    if (start < 0 || end <= start || start > protectedStart + 1 / sampleRate || end < protectedEnd - 1 / sampleRate) return null;
    const whole = left === 0 && right === boundaries.length - 1;
    const reason = whole ? (pauses.length ? "whole-short-context" : "whole-no-safe-pause") : "pause-bounded";
    return { start, end, whole, reason };
  }

  const api = Object.freeze({ select });
  globalThis.IKnowReaderAudioPhrases = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})();
