/* iKnow! Reading Helper. Public course data plus optional local preparation. */
(() => {
  "use strict";
  if (globalThis.__iknowReaderLoaded) return;
  globalThis.__iknowReaderLoaded = true;
  const Core = globalThis.IKnowReaderCore;
  const BundledData = globalThis.IKnowReaderData || { alignments: {} };
  const BundledAudio = globalThis.IKnowReaderAudioData || { sentences: {} };
  const Packs = globalThis.IKnowReaderPacks;
  let Data = BundledData;
  const AudioFollow = globalThis.IKnowReaderAudio;
  if (!Core || !globalThis.chrome?.storage?.local) return;
  let settings = { ...Core.DEFAULTS };
  let courseId = null;
  let course = null;
  let preparationChoices = { german: false, colors: false, audio: false };
  let loading = false;
  let initialStorageReady = false;
  let savedDataReady = false;
  let initialPacksChanged = false, latestInitialPacks;
  let latestStoredPacks = null, packUpdateTimer = null, sourceRecordIds = null;
  let generation = 0;
  let timer = null;
  let toolbar = null;
  let automation = null;
  let panelLayout = null;
  let completenessCache = null;
  let availabilityCache = null;
  let error = "";
  let pendingSave = {};
  let activeSave = {};
  let saveTimer = null;
  let saving = false;
  let saveError = "";
  let audioError = "";
  let retryNotBefore = 0;
  const courseCache = new Map();
  let recordCache = new WeakMap();
  let displayRecordCache = new WeakMap(), alignmentLexicon = null;
  const textCache = new Map();
  const romanCache = new WeakMap();
  let packages = new Map();
  let canonicalSentences = new Map();
  const sentenceStates = new Map();
  const itemStates = new Map();
  const sentenceLanguages = new Map();
  const englishNotes = globalThis.IKnowReaderEnglishNotes || {};
  const germanNotes = new Map(Object.entries(englishNotes).map(([german, english]) => [english, german]));
  const provenanceNotes = new Set([
    "Generated locally with Qwen3.5-9B; text ranges checked automatically.",
    "Translated locally; uncertain meaning groups were omitted.",
    "Automatisch lokal mit Qwen3.5-9B erzeugt; Textpositionen maschinell geprüft.",
    "Automatisch lokal übersetzt; unsichere Bedeutungsgruppen wurden ausgelassen."
  ]);
  const originalTexts = new WeakMap();
  const owned = new Set();
  const observed = new MutationObserver(records => {
    if (records.some(record => record.type === "childList" && !record.target.closest?.(".ikr-owned"))) schedule();
  });

  function plain(html) {
    const source = String(html || "");
    if (textCache.has(source)) return textCache.get(source);
    const template = document.createElement("template");
    template.innerHTML = source;
    const value = (template.content.textContent || "").trim();
    textCache.set(source, value);
    return value;
  }
  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function own(node) { node.classList.add("ikr-owned"); owned.add(node); return node; }
  function readTokens(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    let text = "";
    const bold = [];
    function walk(node, isBold = false) {
      if (node.nodeType === Node.TEXT_NODE) {
        const start = text.length;
        text += node.textContent;
        if (isBold) bold.push([start, text.length]);
      } else for (const child of node.childNodes) walk(child, isBold || ["B", "STRONG"].includes(node.nodeName));
    }
    walk(template.content);
    return Core.tokenize(text).map(token => ({ ...token, bold: bold.some(([a, b]) => token.start < b && token.end > a) }));
  }
  function disconnect() { observed.disconnect(); }
  function observe() { observed.observe(document.body, { childList: true, subtree: true }); }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { reconcile().catch(showUnexpected); }, 100);
  }
  function showUnexpected() {
    error = "This view could not be enhanced. Please reload the page.";
    updateStatus();
  }
  function sameData(previous, next) {
    return previous === next || JSON.stringify(previous) === JSON.stringify(next);
  }
  function packChangesAffectCourse(previous, next) {
    if (!course) return true;
    if (sourceRecordIds?.course !== course) {
      const expected = Core.expectedSource(course);
      sourceRecordIds = { course, sentences: Object.keys(expected.sentences), items: Object.keys(expected.items) };
    }
    const relevant = pack => pack && (String(pack.course?.id) === courseId ||
      sourceRecordIds.sentences.some(id => pack.alignments?.[id] || pack.audio?.[id]) ||
      sourceRecordIds.items.some(id => pack.germanItems?.[id]));
    for (const id of new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])) {
      const oldPack = previous?.[id], newPack = next?.[id];
      if ((relevant(oldPack) || relevant(newPack)) && !sameData(oldPack, newPack)) return true;
    }
    return false;
  }
  function scheduleCoursePacks(stored, previous) {
    latestStoredPacks = stored;
    // A different course's checkpoints must not rebuild this 200-row view.
    // Shared sentences/words are still updated wherever they are visible.
    if (!packChangesAffectCourse(previous, stored)) return;
    if (packUpdateTimer) return;
    packUpdateTimer = setTimeout(() => {
      packUpdateTimer = null;
      applyCoursePacks(latestStoredPacks);
    }, 100);
  }
  function applyCoursePacks(stored) {
    if (!Packs) return;
    const merged = Packs.merge(BundledData, BundledAudio, stored);
    const previousData = Data;
    const previousAudio = globalThis.IKnowReaderAudioData;
    observed.disconnect();
    try {
      Data = merged.data;
      completenessCache = null;
      availabilityCache = null;
      globalThis.IKnowReaderAudioData = merged.audio;
      recordCache = new WeakMap();
      displayRecordCache = new WeakMap(); alignmentLexicon = null;
      for (const state of itemStates.values()) {
        const item = packages.get(state.id);
        if (!item) continue;
        const signature = Core.signature([plain(item.item.cue.text), plain(item.item.response?.text)]);
        if (!sameData(Core.germanItemFor(previousData, state.id, signature), Core.germanItemFor(Data, state.id, signature))) syncItemGerman(state, item);
      }
      for (const [container, state] of sentenceStates) {
        const record = reviewedRecord(state.sentence);
        if (!sameData(state.record, record)) {
          // Rebuild only this sentence when its translated text or groups change.
          clearSentence(state);
          sentenceStates.delete(container);
        } else {
          state.record = record;
          const fields = [plain(state.sentence.cue.text), plain(state.sentence.response?.text), plain(state.sentence.cue.transliterations?.Hrkt), plain(state.sentence.cue.transliterations?.Latn)];
          let audioPath = null;
          try { audioPath = new URL(state.sentence.sound, location.href).pathname; } catch { /* Unsupported audio stays unavailable. */ }
          const expected = { signature: Core.signature(fields), audioPath };
          const timing = audio => Core.audioFor(audio, state.id, expected) ||
            (record?.sourceVariant?.audioPath === audioPath ? Core.audioFor(audio, state.id, record.sourceVariant) : null);
          if (!sameData(timing(previousAudio), timing(merged.audio))) {
            // New word times only need audio decorations; keep readings, groups,
            // translation controls and the native player in their current state.
            AudioFollow?.remove(state);
            delete state.audioRecord;
            AudioFollow?.register(state);
          }
        }
      }
    } finally { observe(); }
    updateAutomation();
    schedule();
  }
  function remember(node) { if (node && !originalTexts.has(node)) originalTexts.set(node, true); }
  function unwrapGroups(node) {
    for (const span of node.querySelectorAll(".ikr-group[data-ikr-group], .ikr-audio-piece")) span.replaceWith(...span.childNodes);
    node.normalize();
  }
  function restore(node) {
    if (node && originalTexts.has(node)) {
      // Unwrap only our own spans. Preserve any newer content rendered by iKnow.
      unwrapGroups(node);
      originalTexts.delete(node);
    }
  }
  function clearSentence(state) {
    clearTimeout(state.infoDismissTimer);
    AudioFollow?.remove(state);
    state.abort?.abort();
    if (state.container) state.container.classList.remove("ikr-reader-sentence");
    for (const node of state.nativeNodes || []) { restore(node); node.classList.remove("ikr-reader-kana", "ikr-translation-native", "ikr-translation-source"); }
    if (state.container) { delete state.container.dataset.translationMode; delete state.container.dataset.alignmentMode; }
    for (const node of state.ownedNodes || []) { node.remove(); owned.delete(node); }
  }
  function clearItem(state) {
    AudioFollow?.removeItem(state);
    state.studyTools?.remove();
    for (const node of [state.line, state.germanLine]) if (node) { node.remove(); owned.delete(node); }
    state.response?.classList.remove("ikr-item-english");
  }
  function syncItemGerman(state, item) {
    const german = Core.germanItemFor(Data, state.id, Core.signature([plain(item.item.cue.text), plain(item.item.response.text)]));
    const valid = german &&
      state.response?.textContent.trim() === plain(item.item.response.text);
    if (!valid) {
      if (state.germanLine) { state.germanLine.remove(); owned.delete(state.germanLine); delete state.germanLine; }
      state.response?.classList.remove("ikr-item-english");
      return;
    }
    if (!state.germanLine?.isConnected) {
      state.germanLine = own(create("p", "ikr-item-german", german.text));
      state.germanLine.lang = "de";
      state.response.after(state.germanLine);
    } else if (state.germanLine.textContent !== german.text) state.germanLine.textContent = german.text;
    state.response.classList.add("ikr-item-english");
  }
  function clearAll() {
    for (const state of sentenceStates.values()) clearSentence(state);
    sentenceStates.clear();
    for (const state of itemStates.values()) clearItem(state);
    itemStates.clear();
    for (const node of owned) { if (node !== toolbar) node.remove(); }
    owned.clear();
    if (toolbar) owned.add(toolbar);
    document.documentElement.classList.remove("ikr-active");
    AudioFollow?.clear();
  }

  function saveSetting(key, value) {
    const previous = settings;
    // Choosing hover is an explicit request to use the existing Meaning/hover
    // interaction. Commit both choices together; Meaning can still turn it off.
    const changes = key === "colorMode" && value === "hover" ? { colorMode: value, groupInfo: true } : { [key]: value };
    Object.assign(pendingSave, changes);
    settings = Core.normalizeSettings({ ...settings, ...changes });
    saveError = "";
    applySettings(previous);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flushSettings(); }, 100);
  }
  async function flushSettings() {
    clearTimeout(saveTimer);
    if (saving || !Object.keys(pendingSave).length) return;
    saving = true;
    activeSave = pendingSave;
    pendingSave = {};
    let failed = false;
    try {
      const stored = await chrome.storage.local.get(Core.STORAGE_KEY);
      await chrome.storage.local.set({ [Core.STORAGE_KEY]: Core.normalizeSettings({ ...Core.normalizeSettings(stored[Core.STORAGE_KEY]), ...activeSave }) });
      saveError = "";
    } catch {
      failed = true;
      pendingSave = { ...activeSave, ...pendingSave };
      saveError = "Could not save your settings.";
    } finally {
      saving = false;
      activeSave = {};
      updateStatus();
      if (!failed && Object.keys(pendingSave).length) saveTimer = setTimeout(() => { void flushSettings(); }, 0);
    }
  }
  function applySettings(previous = {}) {
    // A local click is applied immediately; its storage notification often
    // contains exactly the same settings. Do not repeat the whole view update.
    if (!Object.keys(Core.DEFAULTS).some(key => previous[key] !== settings[key])) { updateStatus(); return; }
    const root = document.documentElement;
    const enabledChanged = previous.enabled !== settings.enabled;
    const languageChanged = previous.translationLanguage !== settings.translationLanguage;
    const romajiChanged = previous.romajiStyle !== settings.romajiStyle;
    const alignmentChanged = previous.alignmentMode !== settings.alignmentMode;
    const interactive = settings.enabled && settings.groupInfo && settings.colorMode !== "off";
    const interactionChanged = Boolean(previous.enabled && previous.groupInfo && previous.colorMode !== "off") !== interactive;
    for (const [key, className] of [["enabled", "ikr-active"], ["wordRomaji", "ikr-show-words"], ["sentenceRomaji", "ikr-show-sentences"],
      ["kanaVisible", "ikr-show-kana"], ["sentenceBold", "ikr-sentence-bold"], ["groupInfo", "ikr-show-info"]]) {
      if (previous[key] !== settings[key]) root.classList.toggle(className, settings[key]);
    }
    if (interactionChanged) root.classList.toggle("ikr-interactive", interactive);
    if (previous.colorMode !== settings.colorMode) for (const mode of ["off", "hover", "all"]) root.classList.toggle(`ikr-mode-${mode}`, settings.colorMode === mode);
    if (languageChanged) for (const mode of ["en", "de", "both"]) root.classList.toggle(`ikr-language-${mode}`, settings.translationLanguage === mode);
    if (previous.fontSize !== settings.fontSize) root.style.setProperty("--ikr-font-size", `${settings.fontSize}px`);
    if (languageChanged) sentenceLanguages.clear();
    if (alignmentChanged) {
      // Alignment changes affect the color wrappers only. Source data and
      // remembered per-sentence language choices are kept intact.
      for (const state of sentenceStates.values()) clearSentence(state);
      sentenceStates.clear(); displayRecordCache = new WeakMap(); schedule();
    }
    if (romajiChanged) for (const state of sentenceStates.values()) updateRomanText(state);
    // Bold and the three reading visibility switches are CSS-only. Sentence
    // content, meaning controls and audio targets do not change for those.
    if (interactionChanged || languageChanged) for (const state of sentenceStates.values()) {
      if (interactionChanged) syncInteractivity(state);
      if (languageChanged) updateTranslation(state);
      if (interactionChanged && !interactive) state.dismissInfo?.();
      else if (interactionChanged) updateInfo(state);
    }
    renderToolbar();
    const audioChanged = enabledChanged || ["audioFollow", "wordAudio", "wordAudioMode", "wordAudioSpeed", "wordNeuralVoice"].some(key => previous[key] !== settings[key]);
    if (audioChanged) AudioFollow?.configure(settings.enabled && settings.audioFollow, message => {
        if (audioError === message) return;
        audioError = message;
        updateStatus();
      }, settings.enabled && settings.wordAudio, { mode: settings.wordAudioMode, speed: settings.wordAudioSpeed, voice: settings.wordNeuralVoice });
    if (interactionChanged || romajiChanged) AudioFollow?.refresh({ wordsOnly: true });
    if (settings.enabled && !previous.enabled) schedule();
    if (enabledChanged) updateAutomation();
  }

  function courseComplete(features = preparationChoices) {
    if (!course) return false;
    const key = Core.featuresKey(features);
    if (completenessCache?.course === course && completenessCache.data === Data && completenessCache.features === key) return completenessCache.complete;
    const complete = Core.completeness(Data, globalThis.IKnowReaderAudioData, course, features).complete;
    completenessCache = { course, data: Data, features: key, complete };
    return complete;
  }
  function updateAutomation() {
    if (!automation || !courseId) return;
    // Unknown is not an empty course. Native DOM mutations can reconcile while
    // the source request is still running; never publish a temporary Ready
    // card before its real saved modules are known.
    if (!course || !savedDataReady) {
      automation.update({ courseId, course: null, availability: null, enabled: settings.enabled,
        features: { german: false, colors: false, audio: false }, displayFeatures: { ...preparationChoices },
        complete: false, initializing: true });
      return;
    }
    const audio = globalThis.IKnowReaderAudioData;
    if (course && (availabilityCache?.course !== course || availabilityCache.data !== Data || availabilityCache.audio !== audio)) {
      availabilityCache = { course, data: Data, audio, availability: Core.courseAvailability(Data, audio, course) };
    }
    const availability = availabilityCache?.course === course ? availabilityCache.availability : null;
    const displayFeatures = { ...preparationChoices }, features = { ...displayFeatures };
    // Colors reuse an already saved German translation, including its missing
    // meaning links. Keep this dependency stable once the links finish saving.
    // It is local to this course; the user's preparation choices stay unchanged.
    if (features.colors && availability?.modules.german.status === "ready") features.german = true;
    // A newly requested German translation can add its links to existing
    // colors internally. The saved Colors checkbox stays disabled/unchecked;
    // this effective dependency never becomes a new user selection.
    if (features.german && availability?.modules.colors.status === "ready") features.colors = true;
    const complete = courseComplete(features) && !(features.german && features.colors && availability?.germanColorsComplete === false);
    automation.update({ courseId, course, availability, enabled: settings.enabled, features, displayFeatures, complete, initializing: false });
    panelLayout?.refresh();
  }
  function checkbox(key, labelText) {
    const label = create("label");
    const input = create("input");
    input.type = "checkbox";
    input.dataset.setting = key;
    input.addEventListener("change", () => { void saveSetting(key, input.checked); });
    label.append(input, document.createTextNode(labelText));
    return label;
  }
  function ensureToolbar() {
    const container = document.querySelector(".course-content-container");
    if (!container) return;
    if (toolbar?.isConnected) return;
    if (toolbar) { globalThis.IKnowReaderTheme?.unmount(toolbar); owned.delete(toolbar); toolbar.remove(); }
    automation?.destroy(); automation = null;
    panelLayout?.destroy(); panelLayout = null;
    toolbar = own(create("div", "ikr-toolbar"));
    toolbar.setAttribute("role", "region");
    toolbar.setAttribute("aria-label", "iKnow Reading Helper");
    toolbar.append(create("strong", "", "iKnow! Reading Helper"));
    toolbar.append(checkbox("enabled", "On"), checkbox("wordRomaji", "Words"), checkbox("sentenceRomaji", "Sentences"), checkbox("kanaVisible", "Kana"), checkbox("sentenceBold", "Bold"), checkbox("groupInfo", "Meaning"), checkbox("wordAudio", "Word audio"), checkbox("audioFollow", "Follow audio"), checkbox("followPanels", "Pin panels"));
    const menus = create("div", "ikr-toolbar-selects");
    const colorLabel = create("label", "", "Colors ");
    const select = create("select");
    select.dataset.setting = "colorMode";
    for (const [value, label] of [["hover", "On hover"], ["all", "All groups"], ["off", "Off"]]) {
      const option = create("option", "", label); option.value = value; select.append(option);
    }
    select.addEventListener("change", () => { void saveSetting("colorMode", select.value); });
    colorLabel.append(select);
    menus.append(colorLabel);
    const alignmentLabel = create("label", "", "Alignment ");
    const alignmentSelect = create("select"); alignmentSelect.dataset.setting = "alignmentMode";
    for (const [value, label] of [["phrases", "Meaning groups"], ["words", "Word detail"]]) {
      const option = create("option", "", label); option.value = value; alignmentSelect.append(option);
    }
    alignmentSelect.addEventListener("change", () => { void saveSetting("alignmentMode", alignmentSelect.value); });
    alignmentLabel.append(alignmentSelect); menus.append(alignmentLabel);
    const translationLabel = create("label", "", "Language ");
    const languageSelect = create("select"); languageSelect.dataset.setting = "translationLanguage";
    for (const [value, label] of [["en", "English"], ["de", "German"], ["both", "Both"]]) {
      const option = create("option", "", label); option.value = value; languageSelect.append(option);
    }
    languageSelect.addEventListener("change", () => { void saveSetting("translationLanguage", languageSelect.value); });
    translationLabel.append(languageSelect); menus.append(translationLabel);
    const romajiLabel = create("label", "", "Romaji ");
    const romajiSelect = create("select"); romajiSelect.dataset.setting = "romajiStyle";
    for (const [value, label] of [["source", "Source spelling"], ["spoken", "Pronunciation"]]) {
      const option = create("option", "", label); option.value = value; romajiSelect.append(option);
    }
    romajiSelect.addEventListener("change", () => { void saveSetting("romajiStyle", romajiSelect.value); });
    romajiLabel.append(romajiSelect); menus.append(romajiLabel);
    const themePicker = create("span", "ikr-toolbar-theme");
    toolbar.append(menus, themePicker);
    const retry = create("button", "", "Reload");
    retry.type = "button"; retry.dataset.retry = "true"; retry.hidden = true;
    retry.addEventListener("click", () => {
      if (saveError) { saveError = ""; void flushSettings(); }
      else { courseCache.delete(courseId); course = null; retryNotBefore = 0; error = ""; schedule(); }
    });
    toolbar.append(retry);
    const status = create("span", "ikr-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    toolbar.append(status);
    // Outside the React-owned .course-content so its search/sort events remain intact.
    container.before(toolbar);
    globalThis.IKnowReaderTheme?.mount(themePicker);
    panelLayout = globalThis.IKnowReaderPanelLayout?.create({ toolbar, before: container }) || null;
    automation = globalThis.IKnowReaderAutomation?.create({
      anchor: toolbar,
      onFeatureChange: (key, value) => {
        const feature = { prepareGerman: "german", prepareColors: "colors", prepareAudio: "audio" }[key];
        if (feature) { preparationChoices = { ...preparationChoices, [feature]: value }; updateAutomation(); }
      },
      onResumeSelection: features => {
        preparationChoices = Core.normalizeFeatures(features);
        // A paused/partial job may include an internal dependency which is
        // already stored. Keep that module out of the displayed selection;
        // the explicit retry uses the job's original effective mask.
        for (const key of Object.keys(preparationChoices)) {
          if (availabilityCache?.availability.modules[key]?.status === "ready") preparationChoices[key] = false;
        }
        updateAutomation();
      }
    }) || null;
    renderToolbar();
  }
  function renderToolbar() {
    if (!toolbar) return;
    for (const input of toolbar.querySelectorAll("[data-setting]")) {
      const key = input.dataset.setting;
      if (input.type === "checkbox") { if (input.checked !== settings[key]) input.checked = settings[key]; }
      else if (input.value !== settings[key]) input.value = settings[key];
      const disabled = key !== "enabled" && key !== "followPanels" && !settings.enabled;
      if (input.disabled !== disabled) input.disabled = disabled;
    }
    panelLayout?.setFollow(settings.followPanels);
    updateStatus();
  }
  function updateStatus() {
    if (!toolbar) return;
    const status = toolbar.querySelector(".ikr-status");
    const message = saveError || error || (settings.enabled && (settings.audioFollow || settings.wordAudio) ? audioError : "") || (loading && settings.enabled ? "Loading…" : "");
    if (status.textContent !== message) status.textContent = message;
    if (status.hidden !== !message) status.hidden = !message;
    const errorState = String(Boolean(error || saveError));
    if (status.dataset.error !== errorState) status.dataset.error = errorState;
    const retry = toolbar.querySelector("[data-retry]"), hideRetry = !error && !saveError;
    if (retry.hidden !== hideRetry) retry.hidden = hideRetry;
  }
  function reviewedRecord(sentence) {
    if (recordCache.has(sentence)) return displayRecord(sentence, recordCache.get(sentence));
    const fields = [plain(sentence.cue.text), plain(sentence.response?.text), plain(sentence.cue.transliterations?.Hrkt), plain(sentence.cue.transliterations?.Latn)];
    const id = String(sentence.cue?.id), signature = Core.signature(fields);
    let candidate = Core.alignmentFor(Data, id, signature);
    if (!candidate) {
      // iKnow sometimes lists the same spoken sentence twice in one course,
      // with a different English response. Its verified Japanese translation
      // can be reused; English character offsets cannot. Keep this alternate
      // display neutral rather than losing German or inventing color links.
      const canonical = canonicalSentences.get(id);
      if (canonical && canonical !== sentence) {
        const original = [plain(canonical.cue.text), plain(canonical.response?.text), plain(canonical.cue.transliterations?.Hrkt), plain(canonical.cue.transliterations?.Latn)];
        const base = [0, 2, 3].every(index => original[index] === fields[index]) ? Core.alignmentFor(Data, id, Core.signature(original)) : null;
        if (base) {
          candidate = { ...base, signature, groups: [], colorsReady: false, germanColorsReady: false };
          if (base.german) candidate.german = { ...base.german, groups: [] };
          try {
            const audioPath = new URL(canonical.sound, location.href).pathname;
            if (audioPath === new URL(sentence.sound, location.href).pathname) candidate.sourceVariant = { signature: base.signature, audioPath };
          } catch { /* Different or unsupported recordings are never reused. */ }
        }
      }
    }
    if (!candidate) { recordCache.set(sentence, null); return null; }
    const count = Core.tokenize(fields[3]).length;
    const valid = Core.tokenize(fields[2]).length === count && Core.validGroupRanges(candidate.groups, { ja: fields[0].length, en: fields[1].length }, count);
    recordCache.set(sentence, valid ? candidate : null);
    return displayRecord(sentence, valid ? candidate : null);
  }
  function displayRecord(sentence, base) {
    if (!base) return null;
    const cached = displayRecordCache.get(sentence);
    if (cached?.base === base && cached.mode === settings.alignmentMode) return cached.record;
    const corrections = globalThis.IKnowReaderTranslationCorrections;
    const correction = corrections?.get(sentence);
    let record = correction ? corrections.projectRecord(base, correction) : base;
    if (settings.alignmentMode === "words" && globalThis.IKnowReaderWordAlignment) {
      alignmentLexicon ||= globalThis.IKnowReaderWordAlignment.createLexicon(course, Data);
      record = globalThis.IKnowReaderWordAlignment.project(record, sentence, alignmentLexicon);
    }
    displayRecordCache.set(sentence, { base, mode: settings.alignmentMode, record });
    return record;
  }
  function applyGroup(node, state, groupIndex, colorIndex = groupIndex) {
    node.classList.add("ikr-group", `ikr-color-${colorIndex % 6}`);
    node.dataset.ikrGroup = String(groupIndex);
    node.tabIndex = settings.enabled && settings.groupInfo && settings.colorMode !== "off" && !node.hidden ? 0 : -1;
    node.setAttribute("role", "button");
    node.setAttribute("aria-pressed", "false");
    node.setAttribute("aria-label", state.labels[groupIndex] || "Related meaning group");
    state.groupNodes.push(node);
  }
  function highlightRanges(root, groups, field, state) {
    const ranges = groups.flatMap((group, index) => group[field].map(([start, end]) => ({ start, end, group: index }))).sort((a, b) => a.start - b.start);
    remember(root);
    // Wrap the entire semantic range, even across iKnow's partial <b> markup.
    // Descending offsets leave earlier source positions intact.
    for (const segment of ranges.reverse()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0, startNode = null, endNode = null, startOffset = 0, endOffset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode, end = offset + node.textContent.length;
        if (!startNode && segment.start >= offset && segment.start < end) { startNode = node; startOffset = segment.start - offset; }
        if (segment.end > offset && segment.end <= end) { endNode = node; endOffset = segment.end - offset; break; }
        offset = end;
      }
      if (!startNode || !endNode) continue;
      const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      const span = create("span"); applyGroup(span, state, segment.group);
      span.append(range.extractContents()); range.insertNode(span);
    }
  }
  function highlightKana(node, record, state) {
    const tokens = Core.tokenize(node.textContent);
    const groups = record.groups.map(group => ({ ja: group.tokens.map(index => [tokens[index].start, tokens[index].end]) }));
    highlightRanges(node, groups, "ja", state);
  }
  function romanValues(state) {
    if (!state.romanDisplay) {
      const cue = state.sentence.cue, source = state.romanTokens.map(token => token.text);
      const spoken = Core.tokenize(Core.displayRomaji({ kind: "sentence", romaji: plain(cue.transliterations?.Latn),
        kana: plain(cue.transliterations?.Hrkt), japanese: plain(cue.text), jpan: plain(cue.transliterations?.Jpan) }, "spoken")).map(token => token.text);
      state.romanDisplay = { source, spoken: spoken.length === source.length ? spoken : source };
    }
    return state.romanDisplay[settings.romajiStyle] || state.romanDisplay.source;
  }
  function groupLabels(record, sentence, values, language = "en") {
    const en = plain(sentence.response?.text);
    return record.groups.map((group, groupIndex) => {
      let previous = null;
      const pieces = [];
      for (const index of [...group.tokens].sort((a, b) => a - b)) {
        const word = values[index].replace(/^[,.;:!?「」『』"“”]+|[,.;:!?「」『』"“”]+$/gu, "");
        if (!word) continue;
        if (previous !== null && index > previous + 1) pieces.push("…");
        pieces.push(word); previous = index;
      }
      const english = group.en.map(([a, b]) => en.slice(a, b)).join(" … ") || (settings.alignmentMode === "words" ? "no direct English word" : "implicit");
      const german = record.german?.groups[groupIndex]?.map(([a, b]) => record.german.text.slice(a, b)).join(" … ") || (settings.alignmentMode === "words" ? "keine direkte Wortentsprechung" : "mitgemeint");
      const meaning = language === "de" ? german : english;
      return `${pieces.join(" ")} ↔ ${meaning}`;
    });
  }
  function hintLanguage(state, node) {
    const mode = state.container.dataset.translationMode || "en";
    if (mode !== "both") return mode;
    return node?.closest?.(".ikr-translation-de") ? "de" : "en";
  }
  function groupLabelForNode(state, node) {
    const labels = state.labelsByLanguage?.[hintLanguage(state, node)] || state.labels;
    return labels[Number(node.dataset.ikrGroup)] || "Related meaning group";
  }
  function updateLabels(state) {
    if (!state.record) return;
    const values = romanValues(state);
    state.labelsByLanguage = { en: groupLabels(state.record, state.sentence, values, "en"), de: groupLabels(state.record, state.sentence, values, "de") };
    state.labels = state.labelsByLanguage[hintLanguage(state)];
    for (const node of state.groupNodes) if (!node.classList.contains("ikr-word-audio")) node.setAttribute("aria-label", groupLabelForNode(state, node));
  }
  function updateTranslation(state) {
    const requested = settings.translationLanguage === "both" ? "both" : sentenceLanguages.get(state.id) || settings.translationLanguage;
    const mode = state.germanLine ? requested : "en";
    state.container.dataset.translationMode = mode;
    if (state.languageButton) {
      state.languageButton.hidden = mode === "both";
      state.languageButton.disabled = mode === "both";
      state.languageButton.textContent = mode === "de" ? "EN" : "DE";
      state.languageButton.setAttribute("aria-label", mode === "de" ? "Show this sentence in English" : "Show this sentence in German");
      state.languageButton.title = state.languageButton.getAttribute("aria-label");
    }
    updateLabels(state); updateInfo(state);
  }
  function updateInfo(state) {
    if (!state.info) return;
    const show = settings.enabled && settings.colorMode !== "off" && settings.groupInfo && state.selected !== null;
    state.info.hidden = !show;
    if (!show) return;
    const cleanNote = value => typeof value === "string" && !provenanceNotes.has(value.trim()) ? value.trim() : "";
    const base = cleanNote(state.record.note), dedicated = cleanNote(state.record.german?.note);
    const enSource = base || dedicated, deSource = dedicated || base;
    const context = !base && !dedicated ? globalThis.IKnowReaderMeaningNotes?.context(plain(state.sentence.cue.text), plain(state.sentence.response?.text)) : null;
    const germanIch = /\bich\b/iu.test(state.record.german?.text || "");
    const reviewedNote = state.correction?.note || globalThis.IKnowReaderMeaningNotes?.reviewed(state.id, state.record.signature) || (state.id === "1109041" && state.record.signature === "92b35a28" ? {
      en: `仕事 (“work”) is the subject marked by が. The English “I”${germanIch ? " and German “ich” express" : " expresses"} the chosen translation viewpoint; 私 (I) is not an explicit word in this Japanese sentence. は presents March as the topic.`,
      de: `仕事 („Arbeit“) ist das durch が markierte Subjekt. Das englische „I“${germanIch ? " und das deutsche „ich“ ergänzen" : " ergänzt"} die gewählte Übersetzungsperspektive; 私 (ich) steht hier nicht ausdrücklich. は macht März zum Thema.`
    } : null);
    const enNote = reviewedNote?.en || (Object.prototype.hasOwnProperty.call(englishNotes, enSource) ? englishNotes[enSource] : enSource) || context?.en || "";
    const deNote = reviewedNote?.de || germanNotes.get(deSource) || deSource || context?.de || "";
    const mode = state.container.dataset.translationMode || "en";
    const language = mode === "both" ? state.selectedLanguage || "en" : mode;
    const detail = state.record.groups[Number(state.selected)]?.wordDetail;
    const detailNote = detail?.note?.[language] || (detail?.kind === "phrase" ? language === "de" ? "Diese größere Bedeutungsgruppe bleibt erhalten, weil eine feinere Zuordnung nicht zuverlässig belegt ist." : "This larger meaning group is retained because a finer mapping is not reliably established." : "");
    const note = [language === "de" ? deNote : enNote, detailNote].filter(Boolean).join(" · ");
    const labels = state.labelsByLanguage?.[language] || state.labels;
    const value = `${labels[Number(state.selected)]}${note ? " · " + note : ""}`;
    state.info.lang = language;
    const text = state.infoText || state.info;
    if (text.textContent !== value) text.textContent = value;
    if (state.infoPin) {
      const pinned = state.pinned === state.selected && state.pinnedLanguage === state.selectedLanguage;
      state.info.dataset.pinned = String(pinned);
      state.infoPin.textContent = pinned ? "Unpin" : "Pin";
      state.infoPin.setAttribute("aria-label", pinned ? "Unpin this explanation" : "Pin this explanation");
      state.infoPin.setAttribute("aria-pressed", String(pinned));
      state.infoPin.title = pinned ? "Release this explanation" : "Keep this explanation visible · Shift-click a group";
    }
  }
  function syncInteractivity(state) {
    const interactive = settings.enabled && settings.groupInfo && settings.colorMode !== "off";
    state.groupInteractive = interactive;
    for (const node of state.groupNodes) {
      node.tabIndex = interactive && !node.hidden ? 0 : -1;
      if (interactive) node.setAttribute("role", "button"); else node.removeAttribute("role");
    }
  }
  function updateRomanText(state) {
    const values = romanValues(state);
    for (const piece of state.romanElements || []) {
      const value = values[piece.index];
      if (piece.node.textContent !== value) piece.node.textContent = value;
      piece.node.hidden = !value;
      const next = values.slice(piece.index + 1).find(Boolean);
      const separator = value && next && !/^[.,!?;:)\]」』]/u.test(next) ? " " : "";
      if (piece.after.textContent !== separator) piece.after.textContent = separator;
    }
    updateLabels(state);
    syncInteractivity(state);
    updateInfo(state);
  }
  function attachInteractions(state) {
    if (state.interactionsAttached) return;
    state.interactionsAttached = true;
    const select = (groupId, language = "en") => {
      if (state.selected === groupId && state.selectedLanguage === language) return;
      state.selected = groupId;
      state.selectedLanguage = language;
      for (const span of state.groupNodes) {
        const active = groupId !== null && span.dataset.ikrGroup === groupId;
        span.classList.toggle("ikr-selected", active);
        if (span.getAttribute("role") === "button" && !span.classList.contains("ikr-word-audio")) span.setAttribute("aria-pressed", String(active)); else span.removeAttribute("aria-pressed");
      }
      updateInfo(state);
    };
    state.select = select;
    const cancelDismiss = () => { clearTimeout(state.infoDismissTimer); };
    const restorePin = () => select(state.pinned ?? null, state.pinnedLanguage || "en");
    const dismissLater = () => {
      cancelDismiss();
      state.infoDismissTimer = setTimeout(restorePin, 180);
    };
    const pin = (id, language) => {
      cancelDismiss();
      const unpin = state.pinned === id && state.pinnedLanguage === language;
      state.pinned = unpin ? null : id;
      state.pinnedLanguage = unpin ? null : language;
      // Explicit Unpin dismisses immediately, rather than briefly rendering
      // an unpinned preview with a Pin button under the pointer.
      select(unpin ? null : id, language); updateInfo(state);
    };
    state.dismissInfo = () => { cancelDismiss(); state.pinned = null; state.pinnedLanguage = null; select(null); };
    state.infoPin?.addEventListener("click", () => {
      if (state.selected !== null) pin(state.selected, state.selectedLanguage || "en");
    }, { signal: state.abort.signal });
    const find = event => event.target.closest?.(".ikr-group")?.dataset.ikrGroup ?? null;
    const handlers = {
      pointerover: event => {
        const id = find(event);
        if (id !== null) { cancelDismiss(); select(id, hintLanguage(state, event.target)); }
        else if (state.info?.contains(event.target)) cancelDismiss();
      },
      pointerout: event => {
        if (state.info?.contains(event.relatedTarget)) { cancelDismiss(); return; }
        const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".ikr-group") : null;
        if (!next || !state.container.contains(next)) dismissLater();
      },
      focusin: event => { cancelDismiss(); const id = find(event); if (id !== null) select(id, hintLanguage(state, event.target)); },
      focusout: event => { if (!state.container.contains(event.relatedTarget)) { cancelDismiss(); restorePin(); } },
      click: event => {
        const id = find(event);
        if (id !== null) {
          const language = hintLanguage(state, event.target);
          pin(id, language);
        }
      },
      keydown: event => {
        if (event.key === "Escape") state.dismissInfo();
        if (["Enter", " "].includes(event.key) && find(event) !== null) { event.preventDefault(); handlers.click(event); }
      }
    };
    for (const [type, handler] of Object.entries(handlers)) state.container.addEventListener(type, event => {
      if (settings.enabled && settings.groupInfo && settings.colorMode !== "off") handler(event);
    }, { signal: state.abort.signal });
  }
  function makeRomaji(sentence, record, state) {
    const tokens = state.romanTokens;
    const line = own(create("p", "ikr-sentence-line"));
    line.lang = "ja-Latn";
    line.setAttribute("aria-label", "Japanese sentence in Romaji");
    tokens.forEach((token, index) => {
      const span = create("span", token.bold ? "ikr-token-bold" : "", token.text);
      if (record) {
        const groupIndex = record.groups.findIndex(group => group.tokens.includes(index));
        if (groupIndex !== -1) applyGroup(span, state, groupIndex);
      }
      line.append(span);
      const after = document.createTextNode(" ");
      line.append(after);
      state.romanElements.push({ node: span, after, index });
    });
    return line;
  }
  function renderSentence(container, sentence, record) {
    const text = container.querySelector(".sentence-text > .text");
    const kana = container.querySelector(".sentence-text > .transliteration");
    const english = container.querySelector(".sentence-text > .translation");
    if (!text || !english) return;
    const id = String(sentence.cue.id);
    const existing = sentenceStates.get(container);
    const nativeNodes = [text, english, ...(kana ? [kana] : [])];
    const sourceMatches = text.textContent.trim() === plain(sentence.cue.text) && english.textContent.trim() === plain(sentence.response?.text);
    const sameNodes = existing && nativeNodes.length === existing.nativeNodes.length && nativeNodes.every((node, index) => existing.nativeNodes[index] === node);
    const intact = existing && [...existing.groupNodes, ...(existing.audioPieces || []).map(piece => piece.node), ...existing.ownedNodes].every(node => node.isConnected && container.contains(node));
    if (sourceMatches && sameNodes && intact && existing.id === id && existing.record === record && (!existing.line || existing.line.isConnected)) return;
    if (existing) { existing.abort.abort(); clearSentence(existing); sentenceStates.delete(container); }
    // A React re-render or site update may have changed the visible sentence.
    if (!sourceMatches) return;
    if (!settings.enabled) return;
    // A native replacement may have cloned already-annotated content. Strip only
    // our scoped wrappers before generating new ones, preserving native markup.
    for (const node of nativeNodes) unwrapGroups(node);
    if (!romanCache.has(sentence)) romanCache.set(sentence, readTokens(sentence.cue.transliterations?.Latn));
    const state = { id, sentence, container, record, nativeNodes, ownedNodes: [], labels: [], groupNodes: [], romanElements: [], romanTokens: romanCache.get(sentence), selected: null, selectedLanguage: null, pinned: null, pinnedLanguage: null, abort: new AbortController() };
    state.groupLabelForNode = node => groupLabelForNode(state, node);
    state.correction = globalThis.IKnowReaderTranslationCorrections?.get(sentence) || null;
    let displayEnglish = english;
    if (state.correction) {
      // Keep iKnow's original node intact for source validation and cleanup.
      // Only the reviewed presentation is shortened; stored hashes stay raw.
      english.classList.add("ikr-translation-source");
      displayEnglish = own(create("p", "ikr-translation-en", state.correction.text)); displayEnglish.lang = "en";
      english.before(displayEnglish); state.ownedNodes.push(displayEnglish);
    }
    if (record) state.labels = groupLabels(record, sentence, romanValues(state));
    container.classList.add("ikr-reader-sentence");
    container.dataset.alignmentMode = settings.alignmentMode;
    if (kana) kana.classList.add("ikr-reader-kana");
    if (sentence.cue.transliterations?.Latn) {
      state.line = makeRomaji(sentence, record, state);
      displayEnglish.before(state.line); state.ownedNodes.push(state.line);
    }
    if (record) {
      // Range offsets are only applied when native text matches the exact reviewed source.
      highlightRanges(text, record.groups, "ja", state);
      highlightRanges(displayEnglish, record.groups, "en", state);
      if (kana && kana.textContent.trim() === plain(sentence.cue.transliterations.Hrkt) && Core.tokenize(kana.textContent).length === Core.tokenize(plain(sentence.cue.transliterations.Hrkt)).length) highlightKana(kana, record, state);
      if (record.german) {
        state.germanLine = own(create("p", "ikr-translation-de", record.german.text)); state.germanLine.lang = "de";
        displayEnglish.classList.add("ikr-translation-native"); displayEnglish.after(state.germanLine); state.ownedNodes.push(state.germanLine);
        highlightRanges(state.germanLine, record.german.groups.map(ranges => ({ de: ranges })), "de", state);
        state.languageButton = own(create("button", "ikr-language-button", "DE")); state.languageButton.type = "button";
        displayEnglish.before(state.languageButton); state.ownedNodes.push(state.languageButton);
        state.languageButton.addEventListener("click", () => {
          if (settings.translationLanguage === "both") return;
          sentenceLanguages.set(state.id, state.container.dataset.translationMode === "de" ? "en" : "de");
          updateTranslation(state);
        }, { signal: state.abort.signal });
      }
      state.info = own(create("div", "ikr-group-info")); state.info.hidden = true;
      state.infoText = create("span", "ikr-group-info-text"); state.infoText.setAttribute("role", "status");
      state.infoPin = create("button", "ikr-group-info-pin", "Pin"); state.infoPin.type = "button";
      state.infoPin.setAttribute("aria-label", "Pin this explanation"); state.infoPin.setAttribute("aria-pressed", "false");
      state.info.append(state.infoText, state.infoPin);
      (state.germanLine || displayEnglish).after(state.info); state.ownedNodes.push(state.info);
      attachInteractions(state);
    }
    if (state.correction) {
      const source = own(create("details", "ikr-source-note")), summary = create("summary", "", "Source");
      source.setAttribute("aria-label", "Original iKnow translation");
      const original = create("p", "", state.correction.originalText); original.lang = "en";
      source.append(summary, original); (state.info || state.germanLine || displayEnglish).after(source); state.ownedNodes.push(source);
    }
    updateRomanText(state);
    updateTranslation(state);
    AudioFollow?.register(state);
    globalThis.IKnowReaderCourseStudy?.sentence(state, courseId, course?.title);
    sentenceStates.set(container, state);
  }
  function renderItems() {
    const rows = document.querySelectorAll(".course-content .items > .item");
    for (const [container, state] of sentenceStates) {
      if (!container.isConnected) { state.abort.abort(); clearSentence(state); sentenceStates.delete(container); }
    }
    for (const [row, state] of itemStates) if (!row.isConnected) { clearItem(state); itemStates.delete(row); }
    for (const row of rows) {
      const cueLink = row.querySelector(".item-details .cue-response .cue");
      const id = cueLink?.getAttribute("href")?.match(/\/items\/(\d+)(?:[/?#-]|$)/)?.[1];
      const item = packages.get(id);
      if (!item || cueLink.textContent.trim() !== plain(item.item.cue.text)) {
        const oldItem = itemStates.get(row);
        if (oldItem) { clearItem(oldItem); itemStates.delete(row); }
        for (const [container, state] of sentenceStates) if (row.contains(container)) { clearSentence(state); sentenceStates.delete(container); }
        continue;
      }
      const response = row.querySelector(".item-details .cue-response > .response");
      const current = itemStates.get(row);
      if (current && (current.id !== id || !current.line.isConnected || (current.germanLine && !current.germanLine.isConnected) || current.response !== response)) { clearItem(current); itemStates.delete(row); }
      if (settings.enabled && !itemStates.has(row) && response && item.item.cue.transliterations?.Latn) {
        const line = own(create("p", "ikr-item-line", plain(item.item.cue.transliterations.Latn)));
        line.lang = "ja-Latn"; line.setAttribute("aria-label", "Japanese word in Romaji");
        response.before(line);
        const state = { id, line, response };
        AudioFollow?.registerItem(state, item, cueLink);
        syncItemGerman(state, item);
        globalThis.IKnowReaderCourseStudy?.word(state, item, courseId, course?.title);
        itemStates.set(row, state);
      }
      const candidates = [...row.querySelectorAll(".item-sentences > .sentence")];
      for (const container of candidates) {
        const nativeText = container.querySelector(".sentence-text > .text")?.textContent.trim();
        const nativeEnglish = container.querySelector(".sentence-text > .translation")?.textContent.trim();
        const sentence = (item.sentences || []).find(candidate => plain(candidate.cue.text) === nativeText && plain(candidate.response?.text) === nativeEnglish);
        if (sentence) renderSentence(container, sentence, reviewedRecord(sentence));
        else if (sentenceStates.has(container)) { clearSentence(sentenceStates.get(container)); sentenceStates.delete(container); }
      }
    }
  }
  async function loadCourse(id) {
    const token = ++generation;
    loading = true; error = ""; updateStatus();
    try {
      let result = courseCache.get(id);
      if (!result) {
        const response = await fetch(`/api/v2/goals/${encodeURIComponent(id)}`, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("course unavailable");
        result = await response.json();
        if (String(result.id) !== id || !Array.isArray(result.goal_items) || result.cue_language?.split("-")[0] !== "ja") throw new Error("unsupported course");
        courseCache.set(id, result);
      }
      if (token !== generation || courseId !== id) return;
      course = result; retryNotBefore = 0; alignmentLexicon = null; displayRecordCache = new WeakMap();
      globalThis.IKnowReaderWordAudio?.registerCourse(course);
      packages = new Map(result.goal_items.map(item => [String(item.item.id), item]));
      canonicalSentences = new Map();
      for (const entry of result.goal_items) for (const sentence of entry.sentences || []) {
        const id = String(sentence.cue?.id);
        if (!canonicalSentences.has(id)) canonicalSentences.set(id, sentence);
      }
      // Include checkpoints saved while another course was being viewed.
      if (Packs) { clearTimeout(packUpdateTimer); packUpdateTimer = null; applyCoursePacks(latestStoredPacks); }
    } catch {
      if (token !== generation) return;
      error = "Course data is unavailable or this is not a Japanese course. Original content remains available.";
      retryNotBefore = Date.now() + 30000;
    } finally {
      if (token === generation) { loading = false; schedule(); }
    }
  }
  async function reconcile() {
    // The first saved-pack read is part of availability, not a background
    // enhancement that may briefly be represented as missing data.
    if (!initialStorageReady) return;
    disconnect();
    try {
      const nextId = Core.courseIdFromUrl(location.href);
      if (nextId !== courseId) {
        generation += 1; clearAll(); textCache.clear(); packages = new Map(); courseId = nextId; course = null; loading = false; error = ""; retryNotBefore = 0;
        preparationChoices = { german: false, colors: false, audio: false };
        completenessCache = null; availabilityCache = null;
      }
      if (!courseId) { automation?.destroy(); automation = null; panelLayout?.destroy(); panelLayout = null; if (toolbar) { globalThis.IKnowReaderTheme?.unmount(toolbar); toolbar.remove(); owned.delete(toolbar); toolbar = null; } return; }
      ensureToolbar(); renderToolbar();
      document.documentElement.classList.toggle("ikr-active", settings.enabled);
      if (!settings.enabled && !course) return;
      if (!course && !loading && Date.now() >= retryNotBefore) { updateAutomation(); void loadCourse(courseId); return; }
      if (course) renderItems();
      updateAutomation();
      updateStatus();
    } finally { observe(); }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Packs && changes[Packs.STORAGE_KEY]) {
      if (!initialStorageReady) { initialPacksChanged = true; latestInitialPacks = changes[Packs.STORAGE_KEY].newValue; }
      savedDataReady = true; scheduleCoursePacks(changes[Packs.STORAGE_KEY].newValue, changes[Packs.STORAGE_KEY].oldValue);
    }
    if (!changes[Core.STORAGE_KEY]) return;
    const previous = settings;
    settings = Core.normalizeSettings({ ...changes[Core.STORAGE_KEY].newValue, ...activeSave, ...pendingSave });
    applySettings(previous);
  });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  document.addEventListener("pointerdown", event => {
    if (toolbar) toolbar.dataset.focusMode = "pointer";
    // Shift-click is a pin command, not the browser's extend-selection gesture.
    // Ordinary dragging within the explanation remains native text selection.
    if (event.shiftKey && event.button === 0 && settings.enabled && settings.groupInfo && settings.colorMode !== "off" && event.target.closest?.(".ikr-reader-sentence .ikr-group")) event.preventDefault();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") for (const state of sentenceStates.values()) state.dismissInfo?.();
    if (toolbar && ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) toolbar.dataset.focusMode = "keyboard";
  }, true);
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    if (Object.keys(pendingSave).length) void chrome.storage.local.set({ [Core.STORAGE_KEY]: settings }).catch(() => {});
  });
  chrome.storage.local.get([Core.STORAGE_KEY, ...(Packs ? [Packs.STORAGE_KEY] : [])]).then(stored => {
    settings = Core.normalizeSettings(stored[Core.STORAGE_KEY]);
    if (Packs) {
      latestStoredPacks = initialPacksChanged ? latestInitialPacks : stored[Packs.STORAGE_KEY];
      const merged = Packs.merge(BundledData, BundledAudio, latestStoredPacks);
      Data = merged.data;
      globalThis.IKnowReaderAudioData = merged.audio;
    }
    savedDataReady = true; initialStorageReady = true;
    applySettings();
    schedule();
  }).catch(() => { initialStorageReady = true; error = "Settings could not be loaded. Please reload the extension."; schedule(); });
})();
