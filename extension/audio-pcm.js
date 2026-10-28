/* Exact mono PCM: legacy16k word clips and48k original-phrase clips. */
(() => {
  "use strict";
  const WORD_RATE = 16000, PHRASE_RATE = 48000;
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64(bytes) {
    const pieces = [];
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index], b = bytes[index + 1], c = bytes[index + 2];
      pieces.push(BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)] +
        (index + 1 < bytes.length ? BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)] : "=") +
        (index + 2 < bytes.length ? BASE64[c & 63] : "="));
    }
    return pieces.join("");
  }
  function cropAtRate(audio, start, end, sampleRate, maxDataLength) {
    if (!audio || audio.sampleRate !== sampleRate || audio.numberOfChannels !== 1 ||
        !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 120 ||
        typeof audio.getChannelData !== "function" || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end <= start || end > audio.duration || end - start > 8) return null;
    let mono;
    try { mono = audio.getChannelData(0); } catch { return null; }
    if (!mono || !ArrayBuffer.isView(mono) || Object.prototype.toString.call(mono) !== "[object Float32Array]" ||
        mono.length < 1 || mono.length > sampleRate * 120 ||
        Math.abs(mono.length / sampleRate - audio.duration) > 1 / sampleRate ||
        audio.length !== undefined && audio.length !== mono.length) return null;
    const first = Math.round(start * sampleRate), last = Math.round(end * sampleRate), count = last - first;
    if (first < 0 || last > mono.length || count < 1 || count > sampleRate * 8) return null;
    const dataLength = count * 2, bytes = new Uint8Array(44 + dataLength), view = new DataView(bytes.buffer);
    const text = (offset, value) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
    text(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, dataLength, true);
    for (let index = 0; index < count; index++) {
      const value = mono[first + index];
      if (!Number.isFinite(value)) return null;
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    const data = base64(bytes);
    return data.length <= maxDataLength ? { data, duration: count / sampleRate } : null;
  }
  const crop = (audio, start, end) => cropAtRate(audio, start, end, WORD_RATE, 342000);
  const cropPhrase = (audio, start, end) => cropAtRate(audio, start, end, PHRASE_RATE, 1024060);
  const api = Object.freeze({ crop, cropPhrase });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderAudioPcm = api;
})();
