/* Local saved-item practice. Recognition is deliberately not an accuracy score. */
(() => {
  "use strict";
  const Core = globalThis.IKnowReaderCore, Store = globalThis.IKnowReaderStudyStore, $ = id => document.getElementById(id);
  const query = new URL(location.href).searchParams;
  let records = [], filtered = [], selected = null, visibleCount = 40, reloadGeneration = 0, searchTimer = null;
  let cardIdentity = "", useContext = false, playGeneration = 0, pendingAudio = null, pendingWait = null, looping = false;
  let captureGeneration = 0, captureState = "idle", recorder = null, stream = null, captureTimer = null, takeUrl = "";
  let romajiStyle = "source", settingsRevision = 0;
  const original = new Audio(), take = new Audio(); original.preload = "none"; take.preload = "none";
  const announce = value => { $("page-status").textContent = value; };
  const currentRecord = () => records.find(record => record.key === selected);
  const currentDetails = () => { const item = currentRecord(); return useContext && item?.context ? item.context : item; };
  const el = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
  function updateMediaControls() {
    const hasSource = Boolean(currentDetails()?.audioUrl), capturing = captureState !== "idle";
    $("play-original").disabled = !hasSource || capturing;
    $("start-loop").disabled = !hasSource || capturing;
    $("start-loop").hidden = looping; $("stop-loop").hidden = !looping;
    $("repeat-count").disabled = looping; $("pause-duration").disabled = looping; $("original-speed").disabled = looping;
    $("record").disabled = !navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder || captureState === "finishing";
    $("record").textContent = captureState === "requesting" ? "Cancel microphone" : captureState === "recording" ? "Stop recording" : captureState === "finishing" ? "Finishing…" : "Record my voice";
    $("record-indicator").hidden = captureState !== "recording";
    $("play-take").disabled = !takeUrl || capturing; $("discard-take").hidden = !takeUrl;
  }
  function stopPlayback(message = "") {
    playGeneration++; looping = false; original.pause(); take.pause();
    if (pendingAudio) pendingAudio(false);
    if (pendingWait) { clearTimeout(pendingWait.timer); pendingWait.finish(false); pendingWait = null; }
    if (message) $("audio-status").textContent = message;
    updateMediaControls();
  }
  function clearTake() {
    take.pause(); take.removeAttribute("src"); take.load();
    if (takeUrl) URL.revokeObjectURL(takeUrl); takeUrl = ""; updateMediaControls();
  }
  function releaseTracks(value) { value?.getTracks().forEach(track => track.stop()); }
  function cancelCapture(discard = true) {
    clearTimeout(captureTimer); captureTimer = null;
    if (discard || captureState === "requesting") captureGeneration++;
    const active = recorder; recorder = null;
    if (active && active.state !== "inactive") { try { active.stop(); } catch { /* A completed device can already be stopped. */ } }
    releaseTracks(stream); stream = null;
    captureState = discard ? "idle" : active ? "finishing" : "idle";
    if (discard) clearTake(); updateMediaControls();
  }
  function changeTarget() {
    stopPlayback(); cancelCapture(true); $("audio-status").textContent = "";
    $("record-status").textContent = "Up to 20 seconds. Your recording stays on this page and is never uploaded.";
  }
  function playOnce(url, generation) {
    if (generation !== playGeneration) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (played, error) => {
        if (finished) return; finished = true; original.removeEventListener("ended", ended); original.removeEventListener("error", failed);
        if (pendingAudio === finish) pendingAudio = null;
        if (error) reject(error); else resolve(played);
      };
      const ended = () => finish(true), failed = () => finish(false, Error("The original recording could not be played. Check your connection and try again."));
      pendingAudio = finish; original.addEventListener("ended", ended); original.addEventListener("error", failed);
      original.src = Store.audioUrl(url); original.playbackRate = Number($("original-speed").value);
      original.preservesPitch = true;
      try { Promise.resolve(original.play()).catch(error => finish(false, error)); } catch (error) { finish(false, error); }
    });
  }
  function wait(ms) {
    return new Promise(resolve => { const value = { finish: resolve, timer: setTimeout(() => { if (pendingWait === value) pendingWait = null; resolve(true); }, ms) }; pendingWait = value; });
  }
  async function listen() {
    const source = currentDetails()?.audioUrl; if (!source || captureState !== "idle") return;
    stopPlayback(); const generation = playGeneration;
    $("audio-status").textContent = "Playing the original…";
    try { if (await playOnce(source, generation) && generation === playGeneration) $("audio-status").textContent = "Original finished."; }
    catch (error) { if (generation === playGeneration) $("audio-status").textContent = String(error.message || error); }
  }
  async function startLoop() {
    const source = currentDetails()?.audioUrl; if (!source || captureState !== "idle") return;
    stopPlayback(); const generation = playGeneration;
    const count = Number($("repeat-count").value), pause = Number($("pause-duration").value);
    if (![2, 3, 5, 10].includes(count) || ![1, 3, 5, 8, 10].includes(pause)) return;
    looping = true; updateMediaControls();
    try {
      for (let index = 0; index < count && generation === playGeneration; index++) {
        $("audio-status").textContent = `Listen · ${index + 1} of ${count}`;
        if (!await playOnce(source, generation) || generation !== playGeneration) return;
        $("audio-status").textContent = `Your turn · ${pause} ${pause === 1 ? "second" : "seconds"} to speak`;
        if (!await wait(pause * 1000) || generation !== playGeneration) return;
      }
      if (generation === playGeneration) $("audio-status").textContent = "Practice complete. Nice work taking the time to repeat.";
    } catch (error) { if (generation === playGeneration) $("audio-status").textContent = String(error.message || error); }
    finally { if (generation === playGeneration) { looping = false; updateMediaControls(); } }
  }
  async function recordVoice() {
    if (captureState === "requesting") { cancelCapture(true); $("record-status").textContent = "Microphone request cancelled."; return; }
    if (captureState === "recording") { cancelCapture(false); return; }
    if (captureState !== "idle" || !currentRecord()) return;
    stopPlayback(); clearTake();
    const generation = ++captureGeneration, target = selected; captureState = "requesting"; updateMediaControls();
    $("record-status").textContent = "Allow the microphone when your browser asks. Nothing is uploaded.";
    let acquired = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== captureGeneration || target !== selected || document.visibilityState !== "visible") { releaseTracks(acquired); return; }
      stream = acquired;
      const options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(acquired, options ? { mimeType: options } : undefined), chunks = []; let bytes = 0, tooLarge = false;
      recorder = active; captureState = "recording"; updateMediaControls(); $("record-status").textContent = "Recording… Click Stop when you finish.";
      active.addEventListener("dataavailable", event => {
        if (generation !== captureGeneration || tooLarge || !event.data?.size) return;
        bytes += event.data.size; if (bytes > 4 * 1024 * 1024) { tooLarge = true; cancelCapture(false); return; } chunks.push(event.data);
      });
      active.addEventListener("error", () => {
        if (generation !== captureGeneration) return;
        cancelCapture(true); $("record-status").textContent = "The microphone recording failed. You can try again.";
      });
      active.addEventListener("stop", () => {
        releaseTracks(acquired); if (stream === acquired) stream = null;
        if (generation !== captureGeneration || target !== selected) return;
        clearTimeout(captureTimer); captureTimer = null; recorder = null; captureState = "idle";
        if (chunks.length && !tooLarge) {
          const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" });
          takeUrl = URL.createObjectURL(blob); take.src = takeUrl;
          $("record-status").textContent = "Your take is ready. Listen to both recordings and compare.";
        } else $("record-status").textContent = tooLarge ? "The recording was too large. Try a shorter take." : "No audio was recorded. Try again.";
        updateMediaControls();
      });
      active.start(200); captureTimer = setTimeout(() => { if (generation === captureGeneration && captureState === "recording") cancelCapture(false); }, 20000);
    } catch (error) {
      releaseTracks(acquired);
      if (generation !== captureGeneration) return;
      stream = null; recorder = null; captureState = "idle"; updateMediaControls();
      $("record-status").textContent = error?.name === "NotAllowedError" ? "Microphone permission was not granted. You can still listen to the original." : "The microphone is unavailable. Check your device and try again.";
    }
  }
  async function listenTake() {
    if (!takeUrl || captureState !== "idle") return; stopPlayback(); const generation = playGeneration;
    take.currentTime = 0; $("record-status").textContent = "Playing your take…";
    take.onended = () => { if (generation === playGeneration) $("record-status").textContent = "Your take finished. Play the original to compare."; };
    try { await take.play(); } catch { if (generation === playGeneration) $("record-status").textContent = "Your recording could not be played. Try recording another take."; }
  }
  function readingLabel() {
    const nodes = [...$("romaji").querySelectorAll("button")], all = nodes.length > 0 && nodes.every(node => node.getAttribute("aria-pressed") === "true");
    $("reveal-all").textContent = all ? "Hide all Romaji" : "Reveal all Romaji"; $("reveal-all").disabled = !nodes.length;
  }
  function setToken(node, reveal) { node.textContent = reveal ? node.dataset.reading : "•••"; node.setAttribute("aria-pressed", String(reveal)); node.setAttribute("aria-label", reveal ? `Hide reading ${node.dataset.reading}` : `Reveal reading, word ${node.dataset.index}`); }
  function readingTokens(value) {
    const item = currentRecord(), kind = useContext && item?.context ? "sentence" : item?.kind;
    const reading = Core.displayRomaji({ ...value, kind }, romajiStyle);
    return reading.trim().split(/\s+/).filter(Boolean).slice(0, 250);
  }
  function renderReading(value) {
    $("romaji").replaceChildren();
    const tokens = readingTokens(value);
    for (const [index, word] of tokens.entries()) {
      const node = el("button", "reading-token"); node.type = "button"; node.dataset.reading = word; node.dataset.index = String(index + 1); setToken(node, false);
      node.addEventListener("click", () => { setToken(node, node.getAttribute("aria-pressed") !== "true"); readingLabel(); }); $("romaji").append(node);
    }
    if (!tokens.length) $("romaji").append(el("span", "status", "No published Romaji was saved for this item.")); readingLabel();
  }
  function updateReadingStyle(value) {
    const next = Core.normalizeSettings(value).romajiStyle;
    if (next === romajiStyle) return;
    romajiStyle = next;
    const details = currentDetails(); if (!details) return;
    const tokens = readingTokens(details), nodes = [...$("romaji").querySelectorAll("button")];
    // A reading preference must not restart practice, discard a microphone
    // take or hide already revealed tokens. The source token boundaries stay.
    for (const [index, node] of nodes.entries()) {
      if (tokens[index] === undefined) continue;
      const revealed = node.getAttribute("aria-pressed") === "true";
      node.dataset.reading = tokens[index]; setToken(node, revealed);
    }
    readingLabel();
  }
  async function loadReadingStyle() {
    const revision = settingsRevision;
    try {
      const stored = await chrome.storage.local.get(Core.STORAGE_KEY);
      if (revision === settingsRevision) updateReadingStyle(stored[Core.STORAGE_KEY]);
    } catch { /* The source spelling remains available when settings cannot load. */ }
  }
  function renderCard(force = false) {
    const item = currentRecord();
    $("empty").hidden = Boolean(item); $("study-card").hidden = !item;
    $("empty-filter").hidden = records.length === 0;
    if (!item) { if (cardIdentity) changeTarget(); cardIdentity = ""; return; }
    const value = currentDetails(), identity = JSON.stringify([item.key, value]);
    if (force || identity !== cardIdentity) {
      changeTarget(); cardIdentity = identity;
      $("item-source").textContent = `${item.kind === "word" ? useContext && item.context ? "Word in context" : "Word" : "Sentence"} · ${item.courseTitle || `Course ${item.courseId}`}`;
      $("japanese").textContent = value.japanese; $("kana").textContent = value.kana; $("kana").hidden = !value.kana;
      $("english").textContent = value.english; $("english").hidden = !value.english; $("german").textContent = value.german; $("german").hidden = !value.german;
      $("context-row").hidden = !item.context; $("use-context").checked = useContext;
      renderReading(value);
      if (!value.audioUrl) $("audio-status").textContent = "No original recording was saved for this item.";
      $("course-link").href = `https://iknow.jp/courses/${item.courseId}`; $("course-link").textContent = "Open course ↗";
    }
    $("review-position").textContent = `${Math.max(1, filtered.findIndex(record => record.key === selected) + 1)} of ${filtered.length} saved items`;
    $("next-item").disabled = filtered.length < 2; updateMediaControls();
  }
  function select(key) {
    if (selected !== key) { selected = key; useContext = Boolean(currentRecord()?.kind === "word" && currentRecord()?.context); }
    renderList(); renderCard();
  }
  function renderList() {
    $("library-items").replaceChildren(); $("library-count").textContent = filtered.length === records.length ? String(records.length) : `${filtered.length}/${records.length}`;
    const selectedIndex = filtered.findIndex(record => record.key === selected); if (selectedIndex >= visibleCount) visibleCount = selectedIndex + 1;
    for (const record of filtered.slice(0, visibleCount)) {
      const button = el("button", "library-item"); button.type = "button"; button.dataset.key = record.key; button.setAttribute("aria-current", String(record.key === selected));
      button.append(el("span", "saved-japanese", record.japanese), el("span", "saved-meaning", record.english || record.german || record.courseTitle));
      button.addEventListener("click", () => select(record.key)); $("library-items").append(button);
    }
    $("show-more").hidden = filtered.length <= visibleCount;
  }
  function filterRecords() {
    const search = $("search").value.trim().toLocaleLowerCase(), course = $("course-filter").value, kind = $("kind-filter").value;
    filtered = records.filter(record => (!course || record.courseId === course) && (!kind || record.kind === kind) && (!search || [record.japanese, record.kana, record.romaji, record.english, record.german].join(" ").toLocaleLowerCase().includes(search)));
    visibleCount = 40;
    if (!filtered.some(record => record.key === selected)) { selected = filtered[0]?.key || null; useContext = Boolean(currentRecord()?.kind === "word" && currentRecord()?.context); }
    renderList(); renderCard();
  }
  async function load() {
    const generation = ++reloadGeneration;
    try {
      const items = await Store.list(); if (generation !== reloadGeneration) return; records = items;
      const previous = $("course-filter").value || (generation === 1 ? query.get("course") : "");
      const courses = new Map(records.map(record => [record.courseId, record.courseTitle || `Course ${record.courseId}`]));
      $("course-filter").replaceChildren(new Option("All courses", ""));
      for (const [id, title] of [...courses].sort((a, b) => a[1].localeCompare(b[1]))) $("course-filter").append(new Option(title, id));
      if (previous && courses.has(previous)) $("course-filter").value = previous;
      if (generation === 1 && query.get("item") && records.some(record => record.key === query.get("item"))) { selected = query.get("item"); useContext = Boolean(currentRecord()?.kind === "word" && currentRecord()?.context); }
      filterRecords(); announce("");
    } catch (error) { announce(String(error.message || error)); }
  }
  $("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(filterRecords, 150); });
  for (const id of ["course-filter", "kind-filter"]) $(id).addEventListener("change", filterRecords);
  $("show-more").addEventListener("click", () => { visibleCount += 40; renderList(); });
  $("reveal-all").addEventListener("click", () => { const nodes = [...$("romaji").querySelectorAll("button")], show = nodes.some(node => node.getAttribute("aria-pressed") !== "true"); nodes.forEach(node => setToken(node, show)); readingLabel(); });
  $("use-context").addEventListener("change", () => { useContext = $("use-context").checked; renderCard(true); });
  $("play-original").addEventListener("click", () => { void listen(); }); $("start-loop").addEventListener("click", () => { void startLoop(); });
  $("stop-loop").addEventListener("click", () => stopPlayback("Practice stopped.")); $("record").addEventListener("click", () => { void recordVoice(); });
  $("play-take").addEventListener("click", () => { void listenTake(); }); $("discard-take").addEventListener("click", () => { clearTake(); $("record-status").textContent = "Your take was discarded."; });
  $("next-item").addEventListener("click", () => { const index = filtered.findIndex(record => record.key === selected); if (filtered.length) select(filtered[(index + 1) % filtered.length].key); });
  $("remove-item").addEventListener("click", async () => { if (!selected) return; const key = selected; $("remove-item").disabled = true; try { await Store.remove(key); await load(); announce("Removed from your saved library."); } catch (error) { announce(String(error.message || error)); } finally { $("remove-item").disabled = false; } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { stopPlayback("Practice stopped while this page is hidden."); cancelCapture(false); } });
  window.addEventListener("pagehide", () => { stopPlayback(); cancelCapture(true); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[Core.STORAGE_KEY]) { settingsRevision++; updateReadingStyle(changes[Core.STORAGE_KEY].newValue); }
    if (changes[Store.KEY]) void load();
  });
  void loadReadingStyle(); void load();
})();
