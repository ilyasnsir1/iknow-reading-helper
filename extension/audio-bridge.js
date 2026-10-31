/* Observe iKnow's native Audio objects without replacing its player or controls.
 * Runs only in the MAIN world on the declared course pages. No extension APIs. */
(() => {
  "use strict";
  const guard = Symbol.for("iknow.reader.audio.bridge.v1");
  if (window[guard]) return;
  window[guard] = true;
  const nativePlay = HTMLMediaElement.prototype.play;
  const watched = new WeakSet();
  const ids = new WeakMap();
  let sequence = 0;
  let enabled = false;
  let wordEnabled = false;
  let active = null;
  let frame = null;
  let lastSend = 0;
  let clipPlayer = null;
  let volumeEnabled=false,originalVolume=1,wordVolume=1,lastNative=null;
  const nativeVolumes=new WeakMap();
  let clip = null;
  let nativeStartedAt = 0;
  let preparedRequestId = null;
  const nativeControl = node => node?.closest?.(".sentence-audio-container, .item-audio-container, .item-details .audio-container");

  function finishClip(reason = "stopped", error = "") {
    const previous = clip;
    if (!previous) return;
    clip = null; clearTimeout(previous.timer); previous.abort.abort();
    clipPlayer.pause();
    if (previous.blobUrl) URL.revokeObjectURL(previous.blobUrl);
    window.postMessage({ type: "IKR_WORD_AUDIO_RESULT_V1", requestId: previous.requestId, status: reason, error }, location.origin);
  }
  function checkClip() {
    if (!clip || clipPlayer.paused || clip.end === null) return;
    clearTimeout(clip.timer);
    const remaining = clip.end - clipPlayer.currentTime;
    if (remaining <= (clip.pcm ? 0 : 0.008)) { finishClip("ended"); return; }
    // A wall-clock timer also works when animation frames are throttled.
    clip.timer = setTimeout(checkClip, Math.max(5, remaining / Math.max(.1, clipPlayer.playbackRate) * 1000));
  }
  function pcmPayload(value, request) {
    if (!value || typeof value !== "object" || typeof value.data !== "string" || value.data.length < 64 || value.data.length > 1024060 || value.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 8) return null;
    let binary;
    try { binary = atob(value.data); } catch { return null; }
    if (binary.length < 46 || binary.length > 768044) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const view = new DataView(bytes.buffer), tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const sampleRate = view.getUint32(24, true);
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || ![16000, 48000].includes(sampleRate) || view.getUint32(28, true) !== sampleRate * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2 || bytes.length > sampleRate * 8 * 2 + 44) return null;
    const duration = (bytes.length - 44) / (sampleRate * 2);
    if (Math.abs(duration - value.duration) > 1 / sampleRate || Math.abs(duration - (request.end - request.start)) > .002) return null;
    return { bytes, duration };
  }
  function playVoice(request) {
    if (!wordEnabled || request.requestId !== preparedRequestId || typeof request.requestId !== "string" || !Number.isFinite(request.intentTime) || request.intentTime < nativeStartedAt || typeof request.data !== "string" || request.data.length > 950000 || request.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(request.data) || ![16000, 24000, 44100, 48000].includes(request.sampleRate) || !Number.isFinite(request.duration) || request.duration <= 0 || request.duration > 8) return;
    let bytes;
    try { const binary = atob(request.data); bytes = Uint8Array.from(binary, value => value.charCodeAt(0)); } catch { return; }
    if (bytes.length < 46 || bytes.length > 705644 || (bytes.length - 44) % 2 || bytes.length > request.sampleRate * 8 * 2 + 44) return;
    const view = new DataView(bytes.buffer), tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== request.sampleRate || view.getUint32(28, true) !== request.sampleRate * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44 || Math.abs((bytes.length - 44) / (request.sampleRate * 2) - request.duration) > 1 / request.sampleRate) return;
    finishClip();
    if (active && active !== clipPlayer) active.pause();
    if (!clipPlayer) { clipPlayer = new Audio(); watch(clipPlayer); }
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const current = { requestId: request.requestId, start: 0, end: request.duration, pcm: true, voice: true, blobUrl, timer: null, abort: new AbortController() };
    clip = current;
    const options = { signal: current.abort.signal };
    clipPlayer.addEventListener("playing", () => {
      if (clip !== current) return;
      clearTimeout(current.timer);
      window.postMessage({ type: "IKR_WORD_VOICE_STATE_V1", requestId: request.requestId, status: "playing" }, location.origin);
    }, options);
    clipPlayer.addEventListener("ended", () => { if (clip === current) finishClip("ended"); }, options);
    clipPlayer.addEventListener("error", () => { if (clip === current) finishClip("error", "voice"); }, options);
    current.timer = setTimeout(() => { if (clip === current) finishClip("error", "load"); }, 10000);
    clipPlayer.volume=wordVolume;
    clipPlayer.preload = "auto";
    // The local voice produces the selected tempo itself; no time stretching.
    clipPlayer.defaultPlaybackRate = 1; clipPlayer.playbackRate = 1; clipPlayer.preservesPitch = true;
    clipPlayer.src = blobUrl;
    void clipPlayer.play().catch(() => { if (clip === current) finishClip("error", "play"); });
  }
  function playWord(request) {
    if (!wordEnabled || request.requestId !== preparedRequestId || typeof request.requestId !== "string" || request.requestId.length > 100 || !Number.isFinite(request.intentTime) || typeof request.src !== "string" || request.src.length > 4000) return;
    let url;
    try { url = new URL(request.src, location.href); } catch { return; }
    if (url.protocol !== "https:" || !/^assets\d*\.iknow\.jp$/i.test(url.hostname) || !url.pathname.startsWith("/assets/") || !/\.mp3$/i.test(url.pathname) || url.username || url.password || url.hash) return;
    const whole = request.start === 0 && request.end === null;
    const speed = request.speed === undefined ? 1 : request.speed;
    if (![.7, .85, 1].includes(speed)) return;
    if (Number.isFinite(request.intentTime) && request.intentTime < nativeStartedAt) {
      window.postMessage({ type: "IKR_WORD_AUDIO_RESULT_V1", requestId: request.requestId, status: "stopped", error: "" }, location.origin); return;
    }
    if (!whole && (!Number.isFinite(request.start) || !Number.isFinite(request.end) || !Number.isFinite(request.duration) || request.start < 0 || request.end <= request.start || request.end > request.duration + .05 || request.duration > 120)) return;
    let pcm = null;
    if (request.pcm !== undefined) {
      pcm = whole ? null : pcmPayload(request.pcm, request);
      if (!pcm) { window.postMessage({ type: "IKR_WORD_AUDIO_RESULT_V1", requestId: request.requestId, status: "error", error: "pcm" }, location.origin); return; }
    }
    finishClip();
    if (active && active !== clipPlayer) active.pause();
    if (!clipPlayer) { clipPlayer = new Audio(); watch(clipPlayer); }
    let blobUrl = null;
    try { if (pcm) blobUrl = URL.createObjectURL(new Blob([pcm.bytes], { type: "audio/wav" })); }
    catch { window.postMessage({ type: "IKR_WORD_AUDIO_RESULT_V1", requestId: request.requestId, status: "error", error: "pcm" }, location.origin); return; }
    const current = { requestId: request.requestId, start: pcm ? 0 : request.start, end: pcm ? pcm.duration : request.end, pcm: !!pcm, blobUrl, path: url.pathname, offset: request.start, originalDuration: request.duration, timer: null, abort: new AbortController(), begun: false, metadataValidated: false };
    clip = current;
    const options = { signal: current.abort.signal };
    const begin = () => {
      if (clip !== current || current.begun || !current.metadataValidated || clipPlayer.readyState < 1 || clipPlayer.seeking) return;
      // A streaming MP3 may initially clamp a seek to zero. Never play a wrong
      // section; retry once its data/seekable range is available instead.
      if (Math.abs(clipPlayer.currentTime - current.start) > .025) {
        if (clipPlayer.readyState >= 2 && clipPlayer.seekable.length) clipPlayer.currentTime = current.start;
        return;
      }
      current.begun = true;
      void clipPlayer.play().then(() => { if (clip === current) checkClip(); }).catch(() => { if (clip === current) finishClip("error", "play"); });
    };
    clipPlayer.addEventListener("loadedmetadata", () => {
      if (clip !== current || clipPlayer.readyState < 1 || clipPlayer.currentSrc !== (blobUrl || url.href)) return;
      clearTimeout(current.timer);
      const duration = clipPlayer.duration;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 120 || (pcm ? Math.abs(duration - pcm.duration) > .002 : !whole && (Math.abs(duration - request.duration) > .18 || request.end > duration + .05))) { finishClip("error", "duration"); return; }
      current.timer = setTimeout(() => { if (clip === current) finishClip("error", "load"); }, 15000);
      clipPlayer.playbackRate = speed;
      clipPlayer.currentTime = Math.min(current.start, duration);
      current.metadataValidated = true;
      begin();
    }, options);
    clipPlayer.addEventListener("seeked", begin, options);
    clipPlayer.addEventListener("loadeddata", begin, options);
    clipPlayer.addEventListener("canplay", begin, options);
    clipPlayer.addEventListener("progress", begin, options);
    clipPlayer.addEventListener("playing", () => { clearTimeout(current.timer); checkClip(); }, options);
    clipPlayer.addEventListener("timeupdate", checkClip, options);
    clipPlayer.addEventListener("ratechange", checkClip, options);
    clipPlayer.addEventListener("ended", () => { if (clipPlayer.ended) finishClip("ended"); }, options);
    clipPlayer.addEventListener("error", () => { if (clipPlayer.error) finishClip("error", "load"); }, options);
    current.timer = setTimeout(() => { if (clip === current) finishClip("error", "load"); }, 15000);
    clipPlayer.volume=wordVolume;
    clipPlayer.preload = "auto"; clipPlayer.defaultPlaybackRate = speed; clipPlayer.playbackRate = speed;
    clipPlayer.preservesPitch = true;
    clipPlayer.src = blobUrl || url.href; clipPlayer.load();
  }

  function allowedPath(media) {
    try {
      const url = new URL(media.currentSrc || media.src, location.href);
      return url.protocol === "https:" && /(^|\.)iknow\.jp$/i.test(url.hostname) && /\.mp3$/i.test(url.pathname) ? url.pathname : null;
    } catch { return null; }
  }
  function emit(media, kind) {
    if ((!enabled && !wordEnabled) || !media) return;
    if (clip?.voice && media === clipPlayer) return;
    const mapped = clip?.pcm && media === clipPlayer ? clip : null;
    const path = mapped?.path || allowedPath(media);
    if (!path) return;
    window.postMessage({
      type: "IKR_NATIVE_AUDIO_STATE_V1", kind, id: ids.get(media), path, clip: !!clip && media === clipPlayer, requestId: clip && media === clipPlayer ? clip.requestId : null,
      time: (Number.isFinite(media.currentTime) ? media.currentTime : 0) + (mapped?.offset || 0),
      duration: mapped ? mapped.originalDuration : Number.isFinite(media.duration) ? media.duration : 0,
      rate: media.playbackRate, paused: media.paused, ended: media.ended
    }, location.origin);
  }
  function cancelTick() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  function needsTick() { return active && !active.paused && !active.ended && (enabled || wordEnabled && active === clipPlayer && clip && !clip.voice); }
  function tick(now) {
    frame = null;
    if (!needsTick()) return;
    if (clip && active === clipPlayer && clip.end !== null && active.currentTime >= clip.end - (clip.pcm ? 0 : .008)) { finishClip("ended"); return; }
    if (now - lastSend >= 35) { emit(active, "time"); lastSend = now; }
    frame = requestAnimationFrame(tick);
  }
  function startTick() { cancelTick(); lastSend = 0; if (needsTick()) frame = requestAnimationFrame(tick); }
  function watch(media) {
    if (watched.has(media)) return;
    watched.add(media); ids.set(media, ++sequence);
    for (const eventName of ["play", "playing", "pause", "ended", "seeking", "seeked", "ratechange", "waiting", "error", "emptied", "loadedmetadata"]) {
      media.addEventListener(eventName, () => {
        if (["play", "playing"].includes(eventName)) {
          if (active && active !== media) emit(active, "switched");
          active = media; emit(media, eventName); startTick();
        } else if (media === active) {
          emit(media, eventName);
          if (["pause", "ended", "waiting", "error", "emptied"].includes(eventName)) cancelTick();
          else if (!media.paused && !media.ended) startTick();
        }
      });
    }
  }
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true, writable: true,
    value: function play(...args) {
      // Native playback must never depend on extension bookkeeping succeeding.
      // No promise, network request, model or timing preparation precedes play.
      try {
        if (this instanceof HTMLAudioElement) {
          if(this!==clipPlayer&&allowedPath(this)){
            if(volumeEnabled){if(!nativeVolumes.has(this))nativeVolumes.set(this,this.volume);this.volume=originalVolume;lastNative=this;}
            else if(nativeVolumes.has(this)){this.volume=nativeVolumes.get(this);nativeVolumes.delete(this);}
          }
          if (this !== clipPlayer) { nativeStartedAt = performance.now(); preparedRequestId = null; finishClip(); }
          if (enabled || wordEnabled) watch(this);
        }
      } catch { /* Preserve the site's original play return value and errors. */ }
      return Reflect.apply(nativePlay, this, args);
    }
  });
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "IKR_WORD_AUDIO_PREPARE_V1") {
      if (wordEnabled && typeof event.data.requestId === "string" && event.data.requestId.length <= 100 && Number.isFinite(event.data.intentTime) && event.data.intentTime >= nativeStartedAt) { preparedRequestId = event.data.requestId; finishClip(); }
      return;
    }
    if (event.data?.type === "IKR_WORD_AUDIO_PLAY_V1") { playWord(event.data); return; }
    if (event.data?.type === "IKR_WORD_VOICE_PLAY_V1") { playVoice(event.data); return; }
    if (event.data?.type === "IKR_WORD_AUDIO_STOP_V1") {
      if (typeof event.data.requestId === "string" && event.data.requestId !== preparedRequestId && event.data.requestId !== clip?.requestId) return;
      preparedRequestId = null; finishClip(); return;
    }
    if (event.data?.type !== "IKR_NATIVE_AUDIO_CONFIG_V1") return;
    enabled = event.data.enabled === true;
    wordEnabled = event.data.wordEnabled === true;
    volumeEnabled=event.data.volumeEnabled===true;
    const level=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?value:1;
    originalVolume=level(event.data.originalVolume);wordVolume=level(event.data.wordVolume);
    if(volumeEnabled&&lastNative)lastNative.volume=originalVolume;
    else if(lastNative&&nativeVolumes.has(lastNative)){lastNative.volume=nativeVolumes.get(lastNative);nativeVolumes.delete(lastNative);}
    if(clipPlayer)clipPlayer.volume=wordVolume;
    if (!wordEnabled) { preparedRequestId = null; finishClip(); }
    if (!enabled && !wordEnabled) cancelTick();
    else if (active && !active.paused && !active.ended) { emit(active, "playing"); startTick(); }
  });
  document.addEventListener("click", event => {
    if (event.button === 0 && nativeControl(event.target)) { nativeStartedAt = performance.now(); preparedRequestId = null; finishClip(); }
  }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) finishClip(); });
  window.addEventListener("pagehide", () => { finishClip(); cancelTick(); });
})();
