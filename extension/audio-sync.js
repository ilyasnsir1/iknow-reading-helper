/* Exact iKnow standalone recordings play complete words without source fallback.
 * Phrase/excerpt/synthetic modes remain explicit alternatives. */
(() => {
  "use strict";
  const tracks = new Map();
  let enabled = false;
  let wordEnabled = false;
  let wordMode = "recording", wordSpeed = 1, wordNeuralVoice = "female";
  let wordPlayback = null;
  let gesture = null;
  const wordStates = new Set();
  const wordTargets = new WeakMap();
  let activeStates = new Set();
  let lastMessage = null;
  let statusCallback = () => {};
  const WORD_NOTICE_DELAY = 280, WORD_NOTICE_MINIMUM = 420;
  let wordNotice = null;
  const Core = globalThis.IKnowReaderCore;

  // Word feedback is outside document flow and follows the clicked target.
  // It never inserts a toolbar row, changes course geometry or delays playback.
  function positionWordNotice() {
    const notice = wordNotice;
    if (!notice?.element) return;
    if (!notice.target?.isConnected) { cancelWordNotice(); return; }
    const anchor = notice.target.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const visible = anchor.bottom > top && anchor.top < top + height && anchor.right > left && anchor.left < left + width && notice.target.getClientRects().length;
    notice.element.hidden = !visible;
    if (!visible) return;
    const bubble = notice.element.getBoundingClientRect(), margin = 10;
    const x = Math.min(Math.max(left + margin, anchor.left), Math.max(left + margin, left + width - bubble.width - margin));
    let y = anchor.bottom + 7;
    if (y + bubble.height > top + height - margin) y = anchor.top - bubble.height - 7;
    y = Math.max(top + margin, Math.min(y, top + height - bubble.height - margin));
    notice.element.style.left = `${Math.round(x)}px`;
    notice.element.style.top = `${Math.round(y)}px`;
  }
  function showWordNotice(notice, message, error = false) {
    if (wordNotice !== notice || !notice.target?.isConnected) return;
    const element = document.createElement("div");
    element.className = "ikr-owned ikr-word-notice";
    element.dataset.state = error ? "error" : "loading";
    element.setAttribute("role", "status"); element.setAttribute("aria-live", "polite"); element.setAttribute("aria-atomic", "true");
    const spinner = document.createElement("span"); spinner.className = "ikr-word-notice-spinner"; spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("span"); text.textContent = message;
    element.append(spinner, text); notice.element = element;
    document.body.append(element);
    if (!error) notice.target.classList.add("ikr-word-loading");
    positionWordNotice();
  }
  function cancelWordNotice() {
    const notice = wordNotice;
    if (!notice) return;
    clearTimeout(notice.showTimer); clearTimeout(notice.hideTimer);
    notice.target?.classList.remove("ikr-word-loading");
    notice.element?.remove();
    wordNotice = null;
  }
  function status(message) {
    statusCallback(message);
  }
  function wordError(message, target) {
    cancelWordNotice();
    if (!target) return;
    const notice = { target: target.node, state: target.state, shownAt: performance.now(), element: null };
    wordNotice = notice;
    showWordNotice(notice, message, true);
  }
  function beginWordNotice(requestId, target) {
    cancelWordNotice();
    const notice = { requestId, state: target.state, target: target.node, shownAt: null, showTimer: null, hideTimer: null, element: null };
    wordNotice = notice;
    notice.showTimer = setTimeout(() => {
      if (wordNotice !== notice || wordPlayback?.requestId !== requestId || !wordEnabled) return;
      notice.shownAt = performance.now();
      showWordNotice(notice, "Word audio");
    }, WORD_NOTICE_DELAY);
  }
  function finishWordNotice(requestId) {
    const notice = wordNotice;
    if (!notice || notice.requestId !== requestId) return;
    clearTimeout(notice.showTimer);
    if (notice.shownAt === null) { wordNotice = null; return; }
    notice.target.classList.remove("ikr-word-loading");
    if (notice.element) notice.element.dataset.state = "ready";
    const remaining = Math.max(0, WORD_NOTICE_MINIMUM - (performance.now() - notice.shownAt));
    const hide = () => {
      if (wordNotice !== notice) return;
      cancelWordNotice();
    };
    if (remaining === 0) hide();
    else notice.hideTimer = setTimeout(hide, remaining);
  }
  function clearWord() {
    for (const node of wordPlayback?.nodes || []) { node.classList.remove("ikr-word-playing"); node.removeAttribute("aria-busy"); }
    wordPlayback = null;
  }
  function stopWord() {
    cancelWordNotice();
    if (!wordPlayback) return;
    clearWord(); window.postMessage({ type: "IKR_WORD_AUDIO_STOP_V1" }, location.origin);
  }
  function addWordTarget(state, node, index = null) {
    if (!node) return;
    const attributes = Object.fromEntries(["role", "tabindex", "aria-label", "aria-pressed"].map(key => [key, node.getAttribute(key)]));
    const target = { state, node, index, attributes };
    state.wordTargets.push(target); wordTargets.set(node, target);
  }
  function selectedIndices(state, index) {
    let first = index;
    while (first > 0 && state.romanElements[first]?.node.hidden) first--;
    const indices = [first];
    for (let next = first + 1; next < state.romanElements.length && state.romanElements[next].node.hidden; next++) indices.push(next);
    return indices;
  }
  function syncWords(state) {
    const targets = state.wordTargets || [];
    const available = wordEnabled && (wordMode === "voice" || (state.sentence ? !!state.sentence.sound && (wordMode === "context" || !!state.audioRecord) : !!state.wordSound));
    // Japanese, Kana and Romaji often expose the same token three times. Work
    // out exact recording readiness once per index, not again for every parent
    // meaning group and every target attribute below.
    const recordings = new Map(), readings = new Map(), readiness = new Map();
    for (const target of targets) {
      let playable = available;
      if (wordMode === "recording") {
        if (!wordEnabled) playable = false;
        else if (!state.sentence) playable = Boolean(state.wordSound);
        else {
          if (!recordings.has(target.index)) recordings.set(target.index, Boolean(globalThis.IKnowReaderWordAudio?.sentence(state, target.index)));
          playable = recordings.get(target.index);
        }
      } else if (wordMode === "neural") {
        if (!wordEnabled) playable = false;
        else {
          if (!readings.has(target.index)) readings.set(target.index, Boolean(state.sentence
            ? globalThis.IKnowReaderPronunciation?.descriptor(state, selectedIndices(state, target.index))
            : globalThis.IKnowReaderPronunciation?.itemDescriptor(state.wordCue)));
          playable = readings.get(target.index);
        }
      }
      readiness.set(target, playable);
    }
    // A meaning wrapper containing several audio buttons is no longer itself a button.
    for (const node of state.groupNodes || []) {
      const nested = targets.some(target => readiness.get(target) && target.node !== node && node.contains(target.node));
      const interactive = state.groupInteractive && !nested;
      node.tabIndex = interactive && !node.hidden ? 0 : -1;
      if (interactive) { node.setAttribute("role", "button"); node.setAttribute("aria-pressed", String(node.classList.contains("ikr-selected"))); }
      else { node.removeAttribute("role"); node.removeAttribute("aria-pressed"); }
      node.setAttribute("aria-label", state.groupLabelForNode?.(node) || state.labels?.[Number(node.dataset.ikrGroup)] || "Related meaning group");
    }
    for (const target of targets) {
      const { node } = target;
      const playable = readiness.get(target);
      node.classList.toggle("ikr-word-audio", playable);
      if (playable) {
        node.setAttribute("role", "button"); node.tabIndex = node.hidden ? -1 : 0;
        node.setAttribute("aria-label", `Play ${node.textContent.trim()}`); node.removeAttribute("aria-pressed");
      } else if (!node.dataset.ikrGroup) {
        for (const [name, value] of Object.entries(target.attributes)) { if (value === null) node.removeAttribute(name); else node.setAttribute(name, value); }
      }
    }
  }
  function removeWords(state) {
    if (wordNotice?.state === state) cancelWordNotice();
    if (wordPlayback?.state === state) stopWord();
    for (const target of state.wordTargets || []) {
      target.node.classList.remove("ikr-word-audio", "ikr-word-playing"); wordTargets.delete(target.node);
      if (!target.node.dataset.ikrGroup) for (const [name, value] of Object.entries(target.attributes)) { if (value === null) target.node.removeAttribute(name); else target.node.setAttribute(name, value); }
    }
    state.wordTargets = []; wordStates.delete(state);
  }
  function registerItem(state, item, cue) {
    if (!item.sound && !globalThis.IKnowReaderPronunciation?.item(item.cue)) return;
    state.wordSound = item.sound; state.wordCue = item.cue; state.wordTargets = [];
    addWordTarget(state, state.line); addWordTarget(state, cue);
    wordStates.add(state); syncWords(state);
  }
  async function playTarget(target) {
    const { state, index } = target;
    stopWord(); status(""); clear();
    const requestId = crypto.randomUUID(), mode = wordMode, speed = wordSpeed, voice = wordNeuralVoice, intentTime = performance.now();
    wordPlayback = { requestId, state, nodes: [], mode };
    window.postMessage({ type: "IKR_WORD_AUDIO_PREPARE_V1", requestId, intentTime }, location.origin);
    let start = 0, end = null, duration = 0, indices = [];
    let src = state.sentence?.sound || state.wordSound, pcm = null;
    if (state.sentence) {
      indices = selectedIndices(state, index);
      const measured = state.audioRecord?.tokens.filter(token => (token.indices || [token.index]).some(value => indices.includes(value)));
      if (["tight", "context"].includes(mode) && measured?.length) indices = [...new Set(measured.flatMap(token => token.indices || [token.index]))];
    }
    wordPlayback.nodes = (state.wordTargets || []).filter(value => !state.sentence || indices.includes(value.index)).map(value => value.node);
    for (const node of wordPlayback.nodes) node.setAttribute("aria-busy", "true");
    if (mode === "recording") {
      const recording = state.sentence ? globalThis.IKnowReaderWordAudio?.sentence(state, index) : { src: state.wordSound, indices: [] };
      if (!recording?.src) { clearWord(); wordError("No standalone recording is available for this exact word form.", target); return; }
      const nodes = state.sentence ? (state.wordTargets || []).filter(value => recording.indices.includes(value.index)).map(value => value.node) : (state.wordTargets || []).map(value => value.node);
      for (const node of wordPlayback.nodes) node.removeAttribute("aria-busy");
      wordPlayback = { requestId, state, nodes, mode, target };
      window.postMessage({ type: "IKR_WORD_AUDIO_PLAY_V1", requestId, src: recording.src, start: 0, end: null, duration: 0, speed, intentTime }, location.origin);
      return;
    }
    if (mode === "voice" || mode === "neural") {
      const descriptor = mode === "neural" ? (state.sentence ? globalThis.IKnowReaderPronunciation?.descriptor(state, indices) : globalThis.IKnowReaderPronunciation?.itemDescriptor(state.wordCue)) : null;
      const text = mode === "neural" ? descriptor?.text : (state.sentence ? globalThis.IKnowReaderPronunciation?.sentence(state, indices) : globalThis.IKnowReaderPronunciation?.item(state.wordCue));
      if (!text) { clearWord(); wordError("This word has no reliable Kana reading.", target); return; }
      const nodes = (state.wordTargets || []).filter(value => !state.sentence || indices.includes(value.index)).map(value => value.node);
      wordPlayback.nodes = nodes;
      for (const node of nodes) node.setAttribute("aria-busy", "true");
      let response;
      wordPlayback.target = target;
      if (mode === "neural") beginWordNotice(requestId, target);
      try { response = await chrome.runtime.sendMessage(mode === "neural" ? { type: "ikr:word:neural", text, japanese: descriptor.japanese, speed, voice } : { type: "ikr:word:speech", text, speed }); }
      catch { response = { ok: false, code: mode === "neural" ? "word_neural_missing" : "word_voice_missing" }; }
      if (wordPlayback?.requestId !== requestId || !wordEnabled) return;
      for (const node of nodes) node.removeAttribute("aria-busy");
      if (!response?.ok) {
        clearWord();
        if (mode === "neural") wordError(["word_neural_missing", "neural_voice_missing"].includes(response?.code) ? "Set up the local neural voice: helper/Setup.cmd. Then click the word again." : ["word_neural_busy", "neural_voice_busy"].includes(response?.code) ? "Local voice is busy. Click again in a moment." : ["word_neural_timeout", "neural_voice_timeout"].includes(response?.code) ? "The local voice took too long to start. Click again to retry." : "Could not create local word audio. Click again to retry.", target);
        else wordError(response?.code === "word_voice_missing" ? "Set up the local word voice: helper/Setup-word-voice.cmd. Then reload the extension." : response?.code === "word_voice_busy" ? "Word voice is busy. Click again in a moment." : "Could not create word audio. Click again to retry.", target);
        return;
      }
      if (mode === "neural") finishWordNotice(requestId); else status("");
      window.postMessage({ type: "IKR_WORD_VOICE_PLAY_V1", requestId, intentTime, data: response.data, sampleRate: response.sampleRate, duration: response.duration, voice: response.voice }, location.origin);
      return;
    }
    if (state.audioRecord) {
      let firstIndex = index;
      while (firstIndex > 0 && state.romanElements[firstIndex]?.node.hidden) firstIndex--;
      indices = [firstIndex];
      for (let next = firstIndex + 1; next < state.romanElements.length && state.romanElements[next].node.hidden; next++) indices.push(next);
      let record = state.audioRecord;
      let intervals = record.tokens.filter(token => (token.indices || [token.index]).some(value => indices.includes(value)));
      if (!intervals.length) { clearWord(); return; }
      // Merged reading tokens use the complete measured interval, e.g. "issatsu".
      indices = [...new Set(intervals.flatMap(token => token.indices || [token.index]))];
      if (mode === "tight" && globalThis.IKnowReaderClipRecords) {
          record = await globalThis.IKnowReaderClipRecords.refine(record, src);
          if (wordPlayback?.requestId !== requestId || !wordEnabled) return;
          intervals = record.tokens.filter(token => (token.indices || [token.index]).some(value => indices.includes(value)));
      }
      const first = intervals[0], last = intervals.at(-1);
      const before = record.tokens[record.tokens.indexOf(first) - 1], after = record.tokens[record.tokens.indexOf(last) + 1];
      if (mode === "context") {
        // Keep connected speech intact. Only decoded quiet-pause boundaries
        // may shorten a sentence; failed/uncertain analysis plays it in full.
        const phrase = await globalThis.IKnowReaderClipRecords?.phrase?.(record, src, indices);
        if (wordPlayback?.requestId !== requestId || !wordEnabled) return;
        if (phrase?.pcm) { start = phrase.start; end = phrase.end; pcm = phrase.pcm; }
        else { start = 0; end = null; }
      } else if (mode === "tight") {
        // Use room between measured words, never extend into a neighbor's time.
        // In connected speech these boundaries often touch (e.g. kyoukasho / o),
        // so adding a fixed margin would play and highlight the next word.
        const leadGap = Math.max(0, first.start - (before?.end ?? 0));
        const tailGap = Math.max(0, (after?.start ?? record.duration) - last.end);
        start = Math.max(0, first.start - Math.min(.035, leadGap / 2));
        end = Math.min(record.duration, last.end + Math.min(.055, tailGap / 2));
      } else {
        start = Math.max(0, first.start - Math.min(.025, Math.max(0, first.start - (before?.end || 0)) / 2));
        end = Math.min(record.duration, last.end + Math.min(.04, Math.max(0, (after?.start ?? record.duration) - last.end) / 2));
      }
      duration = record.duration;
      if (mode === "tight" && globalThis.IKnowReaderClipRecords?.crop) {
        pcm = await globalThis.IKnowReaderClipRecords.crop(state.audioRecord, src, start, end);
      }
    }
    if (wordPlayback?.requestId !== requestId || !wordEnabled) return;
    const primaryIndices = new Set(state.audioRecord?.tokens.filter(token => (token.indices || [token.index]).some(value => indices.includes(value))).map(token => token.index));
    const nodes = state.sentence ? (state.wordTargets || []).filter(value => primaryIndices.has(value.index) || indices.includes(value.index)).map(value => value.node) : state.wordTargets.map(value => value.node);
    for (const node of wordPlayback.nodes) node.removeAttribute("aria-busy");
    wordPlayback = { requestId, state, nodes, mode, target };
    window.postMessage({ type: "IKR_WORD_AUDIO_PLAY_V1", requestId, src, start, end, duration, speed, intentTime, ...(pcm ? { pcm } : {}) }, location.origin);
  }
  function targetFrom(event) { return wordTargets.get(event.target.closest?.(".ikr-word-audio")); }
  document.addEventListener("pointerdown", event => { const target = targetFrom(event); gesture = target ? { x: event.clientX, y: event.clientY, dragged: false } : null; }, true);
  document.addEventListener("pointermove", event => { if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.dragged = true; }, true);
  document.addEventListener("pointercancel", () => { gesture = null; }, true);
  document.addEventListener("click", event => {
    const target = targetFrom(event), dragged = gesture?.dragged; gesture = null;
    if (!target && event.target.closest?.(".sentence-audio-container, .item-audio-container, .item-details .audio-container")) { stopWord(); clear(); return; }
    if (!wordEnabled || !target || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || dragged) return;
    event.preventDefault(); event.stopPropagation(); playTarget(target);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && (wordPlayback || wordNotice)) { stopWord(); return; }
    if (!wordEnabled || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["Enter", " "].includes(event.key)) return;
    const target = targetFrom(event); if (!target) return;
    event.preventDefault(); event.stopPropagation(); playTarget(target);
  }, true);

  function decorate(node, segments) {
    if (!node || !segments.length) return [];
    const parts = [];
    let offset = 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    for (const textNode of texts) {
      const text = textNode.textContent, from = offset;
      offset += text.length;
      const matches = sorted.filter(range => range.start < offset && range.end > from);
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        const a = Math.max(0, match.start - from), b = Math.min(text.length, match.end - from);
        if (a < cursor || b <= a) continue;
        fragment.append(document.createTextNode(text.slice(cursor, a)));
        const span = document.createElement("span");
        span.className = "ikr-audio-piece"; span.textContent = text.slice(a, b);
        fragment.append(span); parts.push({ node: span, index: match.index, wordIndex: match.wordIndex ?? match.index }); cursor = b;
      }
      fragment.append(document.createTextNode(text.slice(cursor)));
      textNode.replaceWith(fragment);
    }
    return parts;
  }
  function clearState(state) {
    for (const node of state.audioActiveNodes || []) node.classList.remove("ikr-speaking");
    state.audioActiveNodes = []; state.audioIndex = null;
  }
  function clear() { for (const state of activeStates) clearState(state); activeStates.clear(); }
  function registerTiming(state) {
    const sentence = state.sentence;
    const clean = value => {
      const template = document.createElement("template"); template.innerHTML = value || "";
      return (template.content.textContent || "").trim();
    };
    const fields = [clean(sentence.cue.text), clean(sentence.response?.text), clean(sentence.cue.transliterations?.Hrkt), clean(sentence.cue.transliterations?.Latn)];
    const path = new URL(sentence.sound, location.href).pathname;
    const candidate = Core.audioFor(globalThis.IKnowReaderAudioData, state.id, { signature: Core.signature(fields), audioPath: path }) ||
      (state.record?.sourceVariant?.audioPath === path ? Core.audioFor(globalThis.IKnowReaderAudioData, state.id, state.record.sourceVariant) : null);
    if (!candidate || !Array.isArray(candidate.tokens) || !candidate.tokens.length) return;
    const count = Core.tokenize(fields[3]).length;
    let previousEnd = 0;
    for (const token of candidate.tokens) {
      if (!(token.indices || [token.index]).every(index => Number.isInteger(index) && index >= 0 && index < count) || !Number.isInteger(token.index) || token.index < 0 || token.index >= count || !Number.isFinite(token.start) || !Number.isFinite(token.end) || token.start < previousEnd - 0.025 || token.end <= token.start || token.end > candidate.duration + 0.05) return;
      previousEnd = token.end;
    }
    state.audioRecord = candidate;
    state.audioPieces = [];
    const kana = state.nativeNodes[2];
    if (kana && kana.textContent.trim() === fields[2]) {
      const kanaTokens = Core.tokenize(kana.textContent);
      if (kanaTokens.length === count) state.audioPieces.push(...decorate(kana, candidate.tokens.flatMap(token => (token.indices || [token.index]).map(index => ({ index: token.index, wordIndex: index, start: kanaTokens[index].start, end: kanaTokens[index].end })))));
    }
    const ja = state.nativeNodes[0];
    if (ja && ja.textContent.trim() === fields[0]) {
      const words = globalThis.IKnowReaderPronunciation?.nativeWords(sentence.cue);
      const ranges = words?.length === count ? words.flatMap((word, index) => {
        const acoustic = candidate.tokens.find(token => (token.indices || [token.index]).includes(index));
        return acoustic ? [{ index: acoustic.index, wordIndex: index, start: word.start, end: word.end }] : [];
      }) : candidate.tokens.flatMap(token => (token.ja || []).filter(([a, b]) => a >= 0 && b > a && b <= fields[0].length).map(([start, end]) => ({ index: token.index, start, end })));
      state.audioPieces.push(...decorate(ja, ranges));
    }
    if (!tracks.has(path)) tracks.set(path, new Set());
    tracks.get(path).add(state);
    state.wordTargets = [];
    for (const piece of state.audioPieces) addWordTarget(state, piece.node, piece.wordIndex);
    for (const piece of state.romanElements) if (candidate.tokens.some(token => (token.indices || [token.index]).includes(piece.index))) addWordTarget(state, piece.node, piece.index);
    wordStates.add(state); syncWords(state);
    if (enabled && lastMessage?.path === path) follow(lastMessage);
    return true;
  }
  function register(state) {
    if (registerTiming(state)) return;
    // Published readings also provide clickable phrase targets without saved
    // word timings. Those clicks play the intact original sentence.
    const kana = Core.tokenize(Core.plainText(state.sentence?.cue.transliterations?.Hrkt));
    if (!kana.length || kana.length !== state.romanElements.length) return;
    state.wordTargets = []; state.audioPieces = [];
    const node = state.nativeNodes[2];
    if (node?.textContent.trim() === Core.plainText(state.sentence.cue.transliterations.Hrkt)) {
      state.audioPieces = decorate(node, kana.map((token, index) => ({ start: token.start, end: token.end, index })));
      for (const piece of state.audioPieces) if (globalThis.IKnowReaderPronunciation?.sentence(state, [piece.index])) addWordTarget(state, piece.node, piece.index);
    }
    const native = state.nativeNodes[0], words = globalThis.IKnowReaderPronunciation?.nativeWords(state.sentence.cue);
    if (words?.length === kana.length && native?.textContent.trim() === Core.plainText(state.sentence.cue.text)) {
      const pieces = decorate(native, words.map((word, index) => ({ start: word.start, end: word.end, index })));
      state.audioPieces.push(...pieces);
      for (const piece of pieces) if (globalThis.IKnowReaderPronunciation?.sentence(state, [piece.index])) addWordTarget(state, piece.node, piece.index);
    }
    for (const piece of state.romanElements) if (globalThis.IKnowReaderPronunciation?.sentence(state, [piece.index])) addWordTarget(state, piece.node, piece.index);
    wordStates.add(state); syncWords(state);
  }
  function remove(state) {
    removeWords(state);
    clearState(state); activeStates.delete(state);
    const path = state.audioRecord?.audioPath;
    tracks.get(path)?.delete(state);
    if (tracks.has(path) && !tracks.get(path).size) tracks.delete(path);
    for (const node of state.nativeNodes || []) {
      for (const span of node.querySelectorAll(".ikr-audio-piece")) span.replaceWith(...span.childNodes);
      node.normalize();
    }
    state.audioPieces = [];
  }
  function follow(message) {
    lastMessage = message;
    if (!enabled) return;
    const states = tracks.get(message.path);
    if (!states?.size) { clear(); return; }
    if (["pause", "ended", "waiting", "error", "emptied", "switched"].includes(message.kind) || message.paused || message.ended) { clear(); return; }
    for (const previous of activeStates) if (!states.has(previous)) clearState(previous);
    activeStates = new Set(states);
    for (const state of states) {
      const record = state.audioRecord;
      // Audio replacement at the same URL must not silently reuse old timings.
      if (message.duration && Math.abs(message.duration - record.duration) > 0.18) { clearState(state); status("Word timings do not match this recording."); continue; }
      status("");
      const token = record.tokens.find(value => message.time >= value.start && message.time < value.end);
      const index = token?.index ?? null;
      if (state.audioIndex === index) continue;
      clearState(state); state.audioIndex = index;
      if (index === null) continue;
      const nodes = state.audioPieces.filter(piece => piece.index === index).map(piece => piece.node);
      let roman = state.romanElements[index]?.node;
      if (roman?.hidden) {
        for (let previous = index - 1; previous >= 0; previous -= 1) if (!state.romanElements[previous].node.hidden) { roman = state.romanElements[previous].node; break; }
      }
      if (roman && !roman.hidden) nodes.push(roman);
      for (const node of nodes) node.classList.add("ikr-speaking");
      state.audioActiveNodes = nodes;
    }
  }
  function configure(value, callback, wordValue = false, options = {}) {
    if (callback) statusCallback = callback;
    const mode = ["recording", "voice", "neural", "tight", "context"].includes(options.mode) ? options.mode : "recording";
    const speed = [.7, .85, 1].includes(options.speed) ? options.speed : 1;
    const voice = ["female", "male"].includes(options.voice) ? options.voice : "female";
    const modeChanged = mode !== wordMode;
    const wordsChanged = wordEnabled !== wordValue || modeChanged;
    if (modeChanged || speed !== wordSpeed || voice !== wordNeuralVoice) { stopWord(); status(""); }
    wordMode = mode; wordSpeed = speed; wordNeuralVoice = voice;
    const changed = enabled !== value || wordEnabled !== wordValue;
    enabled = value;
    wordEnabled = wordValue;
    if (!wordEnabled) stopWord();
    if (wordsChanged) for (const state of wordStates) syncWords(state);
    if (!changed) return;
    if (!enabled) { clear(); lastMessage = null; }
    window.postMessage({ type: "IKR_NATIVE_AUDIO_CONFIG_V1", enabled, wordEnabled }, location.origin);
  }
  function refresh({ wordsOnly = false } = {}) {
    for (const state of wordStates) syncWords(state);
    if (wordsOnly) return;
    const message = lastMessage;
    clear();
    if (message && enabled) follow(message);
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "IKR_WORD_AUDIO_RESULT_V1") {
      if (event.data.requestId === wordPlayback?.requestId) { const target = wordPlayback.target; clearWord(); if (event.data.status === "error") wordError(event.data.error === "duration" ? "Word timings do not match this recording." : "Could not play word audio. Click the word to try again.", target); }
      return;
    }
    if (event.data?.type === "IKR_WORD_VOICE_STATE_V1") {
      if (event.data.requestId === wordPlayback?.requestId && event.data.status === "playing") for (const node of wordPlayback.nodes) node.classList.add("ikr-word-playing");
      return;
    }
    if (event.data?.type !== "IKR_NATIVE_AUDIO_STATE_V1") return;
    const value = event.data;
    if (typeof value.path !== "string" || !Number.isFinite(value.time) || value.time < 0 || !Number.isFinite(value.duration)) return;
    if (wordPlayback && wordEnabled) {
      if (value.clip && value.requestId === wordPlayback.requestId && ["play", "playing", "time"].includes(value.kind) && !value.paused) {
        for (const node of wordPlayback.nodes) node.classList.add("ikr-word-playing");
      } else if (!value.clip && ["play", "playing"].includes(value.kind)) { cancelWordNotice(); clearWord(); }
      // A single-word clip may use a separate recording or refined boundaries.
      // Its clicked word supplies feedback; the full sentence clock is separate.
      if (value.clip && wordPlayback?.mode !== "context") { clear(); return; }
    }
    follow(value);
  });
  window.addEventListener("pagehide", () => { stopWord(); clear(); lastMessage = null; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopWord(); });
  window.addEventListener("scroll", positionWordNotice, { capture: true, passive: true });
  window.addEventListener("resize", positionWordNotice, { passive: true });
  window.visualViewport?.addEventListener("resize", positionWordNotice, { passive: true });
  window.visualViewport?.addEventListener("scroll", positionWordNotice, { passive: true });
  globalThis.IKnowReaderAudio = Object.freeze({ register, remove, registerItem, removeItem: removeWords, configure, clear, refresh });
})();
