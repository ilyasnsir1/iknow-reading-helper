/* In-tab recording for the Focus preview. No uploads, storage or speech scoring. */
(() => {
  "use strict";
  let host = null, target = "", options = {}, phase = "idle", message = "";
  let captureSerial = 0, recorder = null, stream = null, limit = null, takeUrl = "";
  let playbackSerial = 0, playing = "";
  const original = new Audio(), take = new Audio();
  const volume=globalThis.IKnowReaderCore?.audioVolume();
  volume?.bind(original,'original');volume?.bind(take,'recording');
  original.preload = take.preload = "none";
  const hasMediaSource = value => value.getAttribute("src") !== null || !value.paused;
  const control = name => host?.querySelector(`[data-compare-action="${name}"]`);
  const release = value => value?.getTracks().forEach(track => track.stop());
  const available = () => Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
  function update() {
    if (!host) return;
    host.dataset.state = phase;
    host.dataset.playing = playing;
    const record = control("record"), stop = control("stop"), pending = phase === "requesting";
    record.hidden = phase === "recording" || phase === "finishing";
    record.disabled = !available();
    record.textContent = pending ? "Cancel request" : "Record my voice";
    stop.hidden = !["recording", "finishing"].includes(phase);
    stop.disabled = phase === "finishing";
    stop.textContent = phase === "finishing" ? "Finishing…" : "Stop recording";
    control("take").disabled = !takeUrl || phase !== "idle";
    control("take").textContent = playing === "take" ? "Stop playback" : "Play my take";
    control("original").disabled = !options.audioUrl || phase !== "idle";
    control("original").textContent = playing === "original" ? "Stop original" : "Original";
    control("discard").hidden = !takeUrl;
    control("discard").disabled = phase !== "idle";
    const status = host.querySelector(".focus-compare-status");
    status.textContent = message || (!available() ? "Recording is unavailable in this browser." : "");
    status.hidden = !status.textContent;
  }
  function stopPlayback() {
    playbackSerial++; playing = "";
    for (const value of [original, take]) {
      if (!hasMediaSource(value)) continue;
      value.pause(); value.removeAttribute("src"); value.load();
    }
  }
  function clearTake() {
    if (takeUrl) URL.revokeObjectURL(takeUrl);
    takeUrl = "";
  }
  function cancelCapture(discardRecording = true) {
    clearTimeout(limit); limit = null;
    if (!discardRecording && phase === "finishing" && !recorder) { update(); return; }
    if (discardRecording || phase === "requesting") captureSerial++;
    const active = recorder; recorder = null;
    const finishing = !discardRecording && active && active.state !== "inactive";
    phase = finishing ? "finishing" : "idle";
    if (active && active.state !== "inactive") {
      try { active.stop(); } catch { phase = "idle"; }
    }
    release(stream); stream = null;
    if (finishing) message = "Finishing recording…";
    update();
  }
  function stopMedia() {
    if (phase === "idle" && !recorder && !stream && !playing && !hasMediaSource(original) && !hasMediaSource(take)) return;
    stopPlayback();
    const requesting = phase === "requesting";
    cancelCapture(false);
    if (requesting) message = "Microphone request cancelled.";
    update();
  }
  async function record() {
    if (phase === "requesting") {
      cancelCapture(); message = "Microphone request cancelled."; update(); return;
    }
    if (phase !== "idle" || !target || !available()) return;
    options.stopOtherAudio?.(); stopPlayback();
    const serial = ++captureSerial, key = target;
    phase = "requesting"; message = "Waiting for microphone permission…"; update();
    let acquired = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (serial !== captureSerial || key !== target || !host || document.hidden) {
        release(acquired);
        if (serial === captureSerial) { phase = "idle"; message = "Microphone request cancelled."; update(); }
        return;
      }
      stream = acquired;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported?.(type));
      const active = new MediaRecorder(acquired, mime ? { mimeType: mime } : undefined), chunks = [];
      let size = 0, tooLarge = false;
      recorder = active; phase = "recording"; message = "Recording…";
      active.addEventListener("dataavailable", event => {
        if (serial !== captureSerial || tooLarge || !event.data?.size) return;
        size += event.data.size;
        if (size > 4 * 1024 * 1024) { tooLarge = true; cancelCapture(false); return; }
        chunks.push(event.data);
      });
      active.addEventListener("error", () => {
        if (serial !== captureSerial) return;
        cancelCapture(); message = "Recording failed. Try again."; update();
      });
      active.addEventListener("stop", () => {
        release(acquired); if (stream === acquired) stream = null;
        if (serial !== captureSerial || key !== target) return;
        clearTimeout(limit); limit = null; recorder = null; phase = "idle";
        if (chunks.length && !tooLarge) {
          stopPlayback(); clearTake();
          takeUrl = URL.createObjectURL(new Blob(chunks, { type: active.mimeType || "audio/webm" }));
          message = "Your take is ready.";
        } else message = tooLarge ? "Try a shorter recording." : "No audio recorded. Try again.";
        update();
      });
      active.start(200); update();
      limit = setTimeout(() => { if (serial === captureSerial && phase === "recording") cancelCapture(false); }, 20000);
    } catch (error) {
      release(acquired);
      if (serial !== captureSerial) return;
      stream = null; recorder = null; phase = "idle";
      message = error?.name === "NotAllowedError" ? "Microphone access was denied. You can allow it in your browser." : "The microphone is unavailable. Check your device and try again.";
      update();
    }
  }
  async function play(kind) {
    if (phase !== "idle") return;
    const source = kind === "original" ? options.audioUrl : takeUrl;
    if (!source) return;
    if (playing === kind) { stopPlayback(); message = takeUrl ? "Your take is ready." : ""; update(); return; }
    options.stopOtherAudio?.(); stopPlayback();
    const serial = playbackSerial, player = kind === "original" ? original : take;
    playing = kind; message = kind === "original" ? "Playing original…" : "Playing your take…";
    player.src = source; player.playbackRate = 1; player.preservesPitch = true;
    player.onended = () => { if (serial === playbackSerial) { playing = ""; message = takeUrl ? "Your take is ready." : ""; update(); } };
    update();
    try { await player.play(); }
    catch { if (serial === playbackSerial) { playing = ""; message = kind === "original" ? "The original could not play. Check your connection." : "Your take could not play. Try recording again."; update(); } }
  }
  function click(event) {
    const button = event.target.closest("[data-compare-action]");
    if (!button || button.disabled || !host?.contains(button)) return;
    switch (button.dataset.compareAction) {
      case "record": void record(); break;
      case "stop": cancelCapture(false); break;
      case "take": void play("take"); break;
      case "original": void play("original"); break;
      case "discard": stopPlayback(); clearTake(); message = ""; update(); break;
    }
  }
  function unmount({ discard = false } = {}) {
    stopPlayback(); cancelCapture();
    if (host) host.removeEventListener("click", click);
    host = null; message = takeUrl ? "Your take is ready." : "";
    if (discard) { clearTake(); target = ""; options = {}; message = ""; }
  }
  function mount(container, next) {
    if (!container || typeof next?.key !== "string" || !next.key) throw Error("Choose a study item before recording.");
    if (target !== next.key) unmount({ discard: true });
    else if (host && host !== container) unmount();
    target = next.key; options = { audioUrl: typeof next.audioUrl === "string" ? next.audioUrl : "", stopOtherAudio: typeof next.stopOtherAudio === "function" ? next.stopOtherAudio : null };
    host = container;
    host.classList.add("focus-compare-panel"); host.setAttribute("aria-label", "Listen and compare");
    host.innerHTML = '<div class="focus-compare-inner"><div class="focus-compare-controls"><button type="button" data-compare-action="record">Record my voice</button><button type="button" data-compare-action="stop" hidden>Stop recording</button><button type="button" data-compare-action="take" disabled>Play my take</button><button type="button" data-compare-action="original">Original</button><button type="button" data-compare-action="discard" class="quiet" hidden>Discard</button></div><p class="focus-compare-status" role="status" hidden></p><p class="focus-compare-privacy">Up to 20 seconds. Kept in this tab.</p></div>';
    host.removeEventListener("click", click); host.addEventListener("click", click); update();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopMedia(); });
  window.addEventListener("pagehide", () => unmount({ discard: true }));
  globalThis.IKnowFocusAudio = Object.freeze({ mount, unmount, reset: () => unmount({ discard: true }), stopMedia });
})();
