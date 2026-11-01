/* In-tab recording for the Focus preview. No uploads, storage or speech scoring. */
(() => {
  "use strict";
  let host = null, target = "", options = {}, phase = "idle", message = "";
  let captureSerial = 0, recorder = null, stream = null, limit = null, takeUrl = "";
  let playbackSerial = 0, playing = "", visualHost = null, compareVisualHost = null, observedOriginal = null, releaseOriginal = null;
  const originalIcons=new WeakMap();let originalVisualKey='';
  let recordingUiState=null,recordingUiRevision=0;const recordingUiAnimations=new Set();
  let recordingAt = 0, takeDuration = 0, meterTimer = null, meterContext = null, meterSource = null, meter = null;
  let microphoneLevel=0;
  const take = new Audio();
  const volume=globalThis.IKnowReaderCore?.audioVolume();
  volume?.bind(take,'recording');
  take.preload = "none";
  const hasMediaSource = value => value.getAttribute("src") !== null || !value.paused;
  const control = name => host?.querySelector(`[data-compare-action="${name}"]`);
  const release = value => value?.getTracks().forEach(track => track.stop());
  const available = () => Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
  const seconds = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const time = value => { const total=Math.floor(seconds(value));return Math.floor(total/60)+':'+String(total%60).padStart(2,'0'); };
  function updateOriginalButton(button,active,elapsed=0,duration=0){
    if(!button)return;
    button.classList.add('focus-original-button');button.dataset.originalPlaying=String(active);button.setAttribute('aria-pressed',String(active));
    button.setAttribute('aria-label',active?'Stop original audio, '+time(elapsed)+(duration?' of '+time(duration):''):'Listen to original');
    const graphic=button.querySelector(':scope>svg');
    if(graphic){
      if(!originalIcons.has(graphic))originalIcons.set(graphic,graphic.innerHTML);
      if(graphic.dataset.originalActivity!==String(active)){
        graphic.dataset.originalActivity=String(active);
        graphic.innerHTML=active?'<path d="M3 8h3l4-3v10l-4-3H3Z"/><path class="focus-original-signal" d="M13 7c2 1.5 2 4.5 0 6"/><path class="focus-original-signal" d="M15 4c5 3 5 9 0 12"/>':originalIcons.get(graphic);
      }
    }
  }
  function updateVisual() {
    const capturing=phase==='recording'||phase==='finishing', originalPlaying=observedOriginal&&!observedOriginal.paused&&!observedOriginal.ended;
    if(visualHost){
      const elapsed=seconds(observedOriginal?.currentTime),duration=seconds(observedOriginal?.duration);
      const key=originalPlaying?'playing:'+time(elapsed)+':'+time(duration):'idle';
      if(key!==originalVisualKey){
        originalVisualKey=key;visualHost.hidden=!originalPlaying;visualHost.dataset.audioState=originalPlaying?'original':'';
        updateOriginalButton(visualHost.closest('button'),Boolean(originalPlaying),elapsed,duration);
        visualHost.querySelector('[data-audio-time]').textContent=time(elapsed)+(duration?' / '+time(duration):'');
      }
    }
    if(host){
      const microphone=host.querySelector('[data-microphone-meter]'),recordingTime=host.querySelector('[data-recording-time]');
      microphone.setAttribute('aria-valuenow',String(microphoneLevel));
      microphone.style.setProperty('--voice-level',microphoneLevel.toFixed(3));
      if(capturing)recordingTime.textContent=time((Date.now()-recordingAt)/1000)+' / 0:20';
    }
    if(compareVisualHost){
      const kind=capturing?'':playing==='take'?'take':takeUrl?'ready':'';
      compareVisualHost.hidden=!kind;compareVisualHost.dataset.audioState=kind;
      if(kind){
        const duration=seconds(take.duration)||takeDuration;
        const elapsed=kind==='ready'?0:seconds(take.currentTime);
        compareVisualHost.querySelector('[data-audio-source]').textContent='Your take';
        compareVisualHost.querySelector('[data-audio-time]').textContent=time(elapsed)+(duration?' / '+time(duration):'');
        const progress=compareVisualHost.querySelector('progress');progress.max=duration||1;progress.value=Math.min(elapsed,duration||1);
        progress.setAttribute('aria-label','Your take playback');progress.hidden=false;
      }
    }
  }
  function mountVisualizer(container) {
    if(visualHost&&visualHost!==container)updateOriginalButton(visualHost.closest('button'),false);
    visualHost=container||null;originalVisualKey='';if(!visualHost)return;
    visualHost.classList.add('focus-original-visual');
    visualHost.innerHTML='<span data-audio-time></span>';
    updateVisual();
  }
  function observeOriginal(player) {
    releaseOriginal?.();releaseOriginal=null;observedOriginal=player||null;
    if(player?.addEventListener){const refresh=()=>updateVisual(),events=['play','playing','pause','ended','timeupdate','loadedmetadata','durationchange','emptied','error'];events.forEach(name=>player.addEventListener(name,refresh));releaseOriginal=()=>events.forEach(name=>player.removeEventListener(name,refresh));}
    updateVisual();
    return()=>{if(observedOriginal===player){releaseOriginal?.();releaseOriginal=null;observedOriginal=null;updateVisual();}};
  }
  function stopMeter(){
    clearInterval(meterTimer);meterTimer=null;
    try{meterSource?.disconnect();}catch{}meterSource=null;meter=null;
    if(meterContext){void meterContext.close().catch(()=>{});meterContext=null;}
  }
  function startMeter(acquired){
    stopMeter();microphoneLevel=0;recordingAt=Date.now();
    try{const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(Context){meterContext=new Context();meter= meterContext.createAnalyser();meter.fftSize=1024;meterSource=meterContext.createMediaStreamSource(acquired);meterSource.connect(meter);void meterContext.resume().catch(()=>{});}}catch{stopMeter();}
    const sample=new Float32Array(1024),bytes=new Uint8Array(1024);let sampledAt=Date.now();
    meterTimer=setInterval(()=>{
      if(phase!=='recording'||document.hidden){stopMeter();return;}
      let level=0;
      if(meter){
        if(typeof meter.getFloatTimeDomainData==='function')meter.getFloatTimeDomainData(sample);
        else{meter.getByteTimeDomainData(bytes);for(let index=0;index<bytes.length;index++)sample[index]=(bytes[index]-128)/128;}
        // A fixed logarithmic scale makes ordinary speech visible without
        // changing the recording, adapting its gain or hiding louder speech.
        let sum=0,energy=0;for(const value of sample){sum+=value;energy+=value*value;}
        const mean=sum/sample.length,rms=Math.sqrt(Math.max(0,energy/sample.length-mean*mean));
        const decibels=20*Math.log10(Math.max(rms,1e-6));
        level=Math.max(0,Math.min(1,(decibels+60)/54));
      }
      const now=Date.now(),elapsed=Math.max(.005,Math.min(.25,(now-sampledAt)/1000));sampledAt=now;
      const response=1-Math.exp(-elapsed/(level>microphoneLevel ? .035 : .16));
      microphoneLevel+=(level-microphoneLevel)*response;
      if(level===0&&microphoneLevel<.005)microphoneLevel=0;
      updateVisual();
    },33);
  }
  for(const event of ['timeupdate','loadedmetadata','durationchange','ended','pause'])take.addEventListener?.(event,updateVisual);
  function cancelRecordingSwitch(){
    recordingUiRevision++;for(const animation of recordingUiAnimations)animation.cancel();recordingUiAnimations.clear();
    if(host)delete host.dataset.recordingSwitch;
  }
  function switchRecordingUi(capturing){
    if(!host||recordingUiState===capturing)return;
    const idle=host.querySelector('.focus-audio-idle-mode'),recording=host.querySelector('.focus-recording-mode');
    const incoming=capturing?recording:idle,outgoing=capturing?idle:recording;
    const animate=recordingUiState!==null&&incoming.animate&&typeof DOMMatrixReadOnly==='function'&&!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
    const angle=(node,fallback)=>{if(node.hidden||!animate)return fallback;const matrix=new DOMMatrixReadOnly(getComputedStyle(node).transform);return Math.atan2(matrix.m23,matrix.m22)*180/Math.PI;};
    const fromIdle=angle(idle,capturing?0:180),fromRecording=angle(recording,capturing?-180:0);
    const transferFocus=outgoing.contains?.(document.activeElement);
    cancelRecordingSwitch();const revision=recordingUiRevision;recordingUiState=capturing;
    incoming.hidden=false;incoming.inert=false;incoming.setAttribute('aria-hidden','false');
    outgoing.inert=true;outgoing.setAttribute('aria-hidden','true');
    if(transferFocus)(capturing?control('stop'):control(takeUrl?'take':'record'))?.focus?.({preventScroll:true});
    const finish=()=>{if(revision!==recordingUiRevision)return;incoming.hidden=false;outgoing.hidden=true;cancelRecordingSwitch();};
    if(!animate){finish();return;}
    outgoing.hidden=false;
    host.dataset.recordingSwitch='flip';
    const toIdle=capturing?180:0,toRecording=capturing?0:-180;
    const duration=Math.max(80,480*Math.max(Math.abs(toIdle-fromIdle),Math.abs(toRecording-fromRecording))/180);
    // Two opposite faces share the same turn; the back face never paints through the front.
    const timing={duration,easing:'cubic-bezier(.22,.7,.22,1)',fill:'both'};
    const front=idle.animate([{transform:`rotateX(${fromIdle}deg)`},{transform:`rotateX(${toIdle}deg)`}],timing);
    const back=recording.animate([{transform:`rotateX(${fromRecording}deg)`},{transform:`rotateX(${toRecording}deg)`}],timing);
    recordingUiAnimations.add(front);recordingUiAnimations.add(back);
    Promise.all([front.finished,back.finished]).then(finish).catch(()=>{});
  }
  function update() {
    updateVisual();if (!host) return;
    host.dataset.state = phase;
    host.dataset.playing = playing;
    const record = control("record"), stop = control("stop"), pending = phase === "requesting";
    const capturing=phase==='recording'||phase==='finishing';
    record.hidden = false;
    record.disabled = !available();
    record.textContent = pending ? "Cancel request" : "Record my voice";
    record.setAttribute('aria-label',pending?'Cancel microphone request':'Record my voice');
    stop.hidden = false;
    stop.disabled = phase !== "recording";
    stop.querySelector('[data-recording-stop-label]').textContent = "Stop";
    host.querySelector('[data-recording-label]').textContent=phase==='finishing'?'Saving take':'Recording';
    control("take").disabled = !takeUrl || phase !== "idle";
    control("take").textContent = playing === "take" ? "Stop playback" : "Play my take";
    control("discard").hidden = !takeUrl;
    control("discard").disabled = phase !== "idle";
    const status = host.querySelector(".focus-compare-status");
    status.textContent = message || (!available() ? "Recording is unavailable in this browser." : "");
    status.hidden = !status.textContent || pending || capturing || status.textContent==='Microphone request cancelled.' || !compareVisualHost?.hidden&&['Your take is ready.','Playing your take…'].includes(status.textContent);
    switchRecordingUi(capturing);
  }
  function stopPlayback() {
    playbackSerial++; playing = "";
    for (const value of [take]) {
      if (!hasMediaSource(value)) continue;
      value.pause(); value.removeAttribute("src"); value.load();
    }
  }
  function clearTake() {
    if (takeUrl) URL.revokeObjectURL(takeUrl);
    takeUrl = "";takeDuration=0;updateVisual();
  }
  function cancelCapture(discardRecording = true) {
    clearTimeout(limit); limit = null;
    stopMeter();
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
    if (phase === "idle" && !recorder && !stream && !playing && !hasMediaSource(take)) return;
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
      // Pronunciation comparison keeps the microphone's own sound. Conference
      // processing can suppress consonants or pump while adapting at startup.
      // Leave sample rate/channel count to the device; the meter only observes
      // a separate branch and never becomes the recorder's audio source.
      acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (serial !== captureSerial || key !== target || !host || document.hidden) {
        release(acquired);
        if (serial === captureSerial) { phase = "idle"; message = "Microphone request cancelled."; update(); }
        return;
      }
      stream = acquired;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported?.(type));
      const active = new MediaRecorder(acquired, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 128000 }), chunks = [];
      let size = 0, tooLarge = false;
      recorder = active; phase = "recording"; message = "Recording…";
      startMeter(acquired);
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
        stopMeter();
        if (chunks.length && !tooLarge) {
          stopPlayback(); clearTake();
          takeUrl = URL.createObjectURL(new Blob(chunks, { type: active.mimeType || "audio/webm" }));
          takeDuration=Math.max(.1,(Date.now()-recordingAt)/1000);
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
      stopMeter();
      message = error?.name === "NotAllowedError" ? "Microphone access was denied. You can allow it in your browser." : "The microphone is unavailable. Check your device and try again.";
      update();
    }
  }
  async function play() {
    if (phase !== "idle") return;
    const source = takeUrl, kind='take';
    if (!source) return;
    if (playing === kind) { stopPlayback(); message = takeUrl ? "Your take is ready." : ""; update(); return; }
    options.stopOtherAudio?.(); stopPlayback();
    const serial = playbackSerial, player = take;
    playing = kind; message = "Playing your take…";
    player.src = source; player.playbackRate = 1; player.preservesPitch = true;
    player.onended = () => { if (serial === playbackSerial) { playing = ""; message = takeUrl ? "Your take is ready." : ""; update(); } };
    update();
    try { await player.play(); }
    catch { if (serial === playbackSerial) { playing = ""; message = "Your take could not play. Try recording again."; update(); } }
  }
  function click(event) {
    const button = event.target.closest("[data-compare-action]");
    if (!button || button.disabled || !host?.contains(button)) return;
    switch (button.dataset.compareAction) {
      case "record": void record(); break;
      case "stop": cancelCapture(false); break;
      case "take": void play(); break;
      case "discard": stopPlayback(); clearTake(); message = ""; update(); break;
    }
  }
  function unmount({ discard = false } = {}) {
    cancelRecordingSwitch();recordingUiState=null;
    stopPlayback(); cancelCapture();
    if (host) host.removeEventListener("click", click);
    cancelRecordingSwitch();recordingUiState=null;host = null;observeOriginal(null);visualHost=null;compareVisualHost=null;message = takeUrl ? "Your take is ready." : "";
    if (discard) { clearTake(); target = ""; options = {}; message = ""; }
  }
  function mount(container, next) {
    if (!container || typeof next?.key !== "string" || !next.key) throw Error("Choose a study item before recording.");
    if (target !== next.key) unmount({ discard: true });
    else if (host && host !== container) unmount();
    target = next.key; options = { audioUrl: typeof next.audioUrl === "string" ? next.audioUrl : "", stopOtherAudio: typeof next.stopOtherAudio === "function" ? next.stopOtherAudio : null };
    host = container;
    host.classList.add("focus-compare-panel"); host.setAttribute("aria-label", "Listen and compare");
    cancelRecordingSwitch();recordingUiState=null;
    const recordingMarkup='<span class="focus-recording-mode" hidden><span class="focus-recording-signal" data-microphone-meter role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3m-3 0h6"/></svg></span><span class="focus-recording-copy"><strong data-recording-label>Recording</strong><span data-recording-time>0:00 / 0:20</span></span><button type="button" data-compare-action="stop" aria-label="Stop recording"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/></svg><span data-recording-stop-label>Stop</span></button></span>';
    host.innerHTML = '<div class="focus-compare-inner"><div class="focus-compare-controls"><span class="focus-audio-idle-mode"><button type="button" data-compare-action="record" aria-description="Record up to 20 seconds. Your recording stays in this tab.">Record my voice</button><span class="focus-take-player"><button type="button" data-compare-action="take" disabled>Play my take</button><span class="focus-compare-media" hidden><span class="focus-audio-screen-reader" data-audio-source></span><progress max="1" value="0"></progress><span data-audio-time></span></span></span><button type="button" data-compare-action="discard" class="quiet danger" hidden>Discard</button></span>'+recordingMarkup+'</div><p class="focus-compare-status" role="status" hidden></p></div>';
    compareVisualHost=host.querySelector('.focus-compare-media');
    mountVisualizer(next.visualHost||null);
    host.removeEventListener("click", click); host.addEventListener("click", click); update();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopMedia(); });
  window.addEventListener("pagehide", () => unmount({ discard: true }));
  globalThis.IKnowFocusAudio = Object.freeze({ mount, unmount, mountVisualizer, observeOriginal, reset: () => unmount({ discard: true }), stopMedia });
})();
