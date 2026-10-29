/* iKnow! Reading Helper — local extension settings, no remote requests. */
(() => {
  "use strict";

  const STORAGE_KEY = "iknowReaderSettings";
  const DEFAULTS = Object.freeze({
    enabled: true,
    wordRomaji: true,
    sentenceRomaji: true,
    followPanels: false,
    kanaVisible: true,
    colorMode: "hover",
    alignmentMode: "phrases",
    pronunciation: true,
    fontSize: 16,
    sentenceBold: false,
    groupInfo: false,
    audioFollow: false,
    wordAudio: false,
    wordAudioPolicy: 5,
    wordAudioMode: "neural",
    wordAudioSpeed: 1,
    wordNeuralVoice: "female",
    translationLanguage: "en",
    autoPrepare: false,
    prepareGerman: false,
    prepareColors: false,
    prepareAudio: false
  });
  const BOOLEAN_KEYS = ["enabled", "wordRomaji", "sentenceRomaji", "followPanels", "kanaVisible", "pronunciation", "sentenceBold", "groupInfo", "audioFollow", "wordAudio"];
  const STORED_BOOLEAN_KEYS = [...BOOLEAN_KEYS, "prepareGerman", "prepareColors", "prepareAudio"];
  const COLOR_MODES = ["off", "hover", "all"];
  const ALIGNMENT_MODES = ["phrases", "words"];
  const TRANSLATION_LANGUAGES = ["en", "de", "both"];
  const FONT_SIZES = [14, 16, 18, 20];
  const WORD_AUDIO_SPEEDS = [.7, .85, 1];
  const form = document.getElementById("settings");
  const status = document.getElementById("save-status");
  const master = document.getElementById("enabled");
  const retry = document.getElementById("retry-save");
  const fieldsets = [...form.querySelectorAll("fieldset")];
  let current = { ...DEFAULTS };
  let confirmed = { ...DEFAULTS };
  let pending = {};
  let active = {};
  let saveTimer = null;
  let saving = false;
  let initialized = false;
  let wordCourseId = null;
  function updateWordPreparation(settings) {
    const row = document.getElementById("word-prepare-row"), link = document.getElementById("word-prepare-link");
    if (!row || !link) return;
    const available = initialized && settings.enabled && wordCourseId;
    link.setAttribute("aria-disabled", String(!available));
    if (available) link.href = chrome.runtime.getURL(`word-voice.html?course=${wordCourseId}&voice=${settings.wordNeuralVoice}&speed=${settings.wordAudioSpeed}`);
    else link.removeAttribute("href");
    document.getElementById("word-prepare-note").textContent = wordCourseId ? "Save this course's word audio before listening." : "Open an iKnow course to prepare its words.";
  }

  // Native selects may report :focus-visible after pointer activation too.
  // Keep keyboard focus clear without drawing a ring after a mouse click.
  document.addEventListener("pointerdown", () => { document.body.dataset.focusMode = "pointer"; }, { capture: true });
  document.addEventListener("keydown", () => { document.body.dataset.focusMode = "keyboard"; }, { capture: true });

  function normalize(value) {
    const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const normalized = { ...DEFAULTS };
    // Preserve the explicit series selection without exposing it as a default
    // for every course. Ignore the legacy automatic-preparation preference.
    for (const key of STORED_BOOLEAN_KEYS) {
      if (typeof safe[key] === "boolean") normalized[key] = safe[key];
    }
    if (COLOR_MODES.includes(safe.colorMode)) normalized.colorMode = safe.colorMode;
    if (ALIGNMENT_MODES.includes(safe.alignmentMode)) normalized.alignmentMode = safe.alignmentMode;
    if (TRANSLATION_LANGUAGES.includes(safe.translationLanguage)) normalized.translationLanguage = safe.translationLanguage;
    if (FONT_SIZES.includes(Number(safe.fontSize))) normalized.fontSize = Number(safe.fontSize);
    if (["female", "male"].includes(safe.wordNeuralVoice)) normalized.wordNeuralVoice = safe.wordNeuralVoice;
    if (WORD_AUDIO_SPEEDS.includes(Number(safe.wordAudioSpeed))) normalized.wordAudioSpeed = Number(safe.wordAudioSpeed);
    // Keep recognized explicit on/off choices, voice and speed while retiring
    // the rejected playback modes. Unknown old opt-ins never enable audio.
    if (![2, 3, 4, 5].includes(safe.wordAudioPolicy)) {
      normalized.wordAudio = false; normalized.wordAudioSpeed = 1;
    }
    return normalized;
  }

  function showStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
    retry.hidden = state !== "error";
    form.setAttribute("aria-busy", String(!initialized || saving || (Object.keys(pending).length > 0 && state !== "error")));
  }

  function render(settings) {
    for (const key of BOOLEAN_KEYS) document.getElementById(key).checked = settings[key];
    document.getElementById("colorMode").value = settings.colorMode;
    document.getElementById("alignmentMode").value = settings.alignmentMode;
    document.getElementById("translationLanguage").value = settings.translationLanguage;
    document.getElementById("fontSize").value = String(settings.fontSize);
    document.getElementById("wordNeuralVoice").value = settings.wordNeuralVoice;
    updateWordPreparation(settings);
    const audioNote = document.getElementById("word-audio-note");
    if (audioNote) audioNote.textContent = "Local neural voice · Setup: helper/Setup.cmd. No audio timings needed.";
    document.getElementById("wordAudioSpeed").value = String(settings.wordAudioSpeed);
    master.disabled = !initialized;
    for (const fieldset of fieldsets) fieldset.disabled = !initialized || !settings.enabled;
    form.setAttribute("aria-busy", String(!initialized || saving || (Object.keys(pending).length > 0 && status.dataset.state !== "error")));
  }

  function refresh() {
    current = normalize({ ...confirmed, ...active, ...pending });
    render(current);
  }

  function saveSetting(key, value) {
    // Render immediately; collapse rapid changes into one storage update.
    // Explicit hover selection also enables its interaction switch. Loading
    // saved settings never changes an earlier choice to keep Meaning off.
    Object.assign(pending, key === "colorMode" && value === "hover" ? { colorMode: value, groupInfo: true } : { [key]: value });
    refresh();
    showStatus("Saving …");
    scheduleSave();
  }

  function scheduleSave(delay = 100) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flush(); }, delay);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saving || !Object.keys(pending).length) return;
    active = pending;
    pending = {};
    saving = true;
    let failed = false;
    refresh();
    try {
      // A fresh read retains edits made through the page toolbar.
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const next = normalize({ ...normalize(stored[STORAGE_KEY]), ...active });
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      confirmed = next;
    } catch {
      failed = true;
      // Keep the newest choice for every field; a retry sends the final state.
      pending = { ...active, ...pending };
      showStatus("Could not save settings.", "error");
    } finally {
      active = {};
      saving = false;
      refresh();
      if (!failed && Object.keys(pending).length) scheduleSave(0);
      else if (!failed) showStatus("Saved", "success");
    }
  }

  form.addEventListener("submit", event => event.preventDefault());
  form.addEventListener("change", event => {
    if (!initialized || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    const key = event.target.name;
    if (BOOLEAN_KEYS.includes(key)) saveSetting(key, event.target.checked);
    else if (key === "colorMode") saveSetting(key, event.target.value);
    else if (key === "alignmentMode") saveSetting(key, event.target.value);
    else if (key === "translationLanguage") saveSetting(key, event.target.value);
    else if (key === "fontSize") saveSetting(key, Number(event.target.value));
    else if (key === "wordAudioSpeed") saveSetting(key, Number(event.target.value));
    else if (key === "wordNeuralVoice") saveSetting(key, event.target.value);
  });

  async function initialize() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      confirmed = normalize(stored[STORAGE_KEY]);
      initialized = true;
      refresh();
      showStatus("Saved");
    } catch {
      initialized = false;
      render(current);
      showStatus("Settings are unavailable.", "error");
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    confirmed = normalize(changes[STORAGE_KEY].newValue);
    if (!initialized) return;
    // An older in-flight event cannot roll back a more recent local click.
    refresh();
    if (!saving && !Object.keys(pending).length) showStatus("Saved", "success");
  });
  retry.addEventListener("click", () => {
    showStatus("Saving …");
    if (initialized) void flush(); else void initialize();
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    if (!Object.keys(active).length && !Object.keys(pending).length) return;
    // Start the final write synchronously, before the popup is destroyed.
    const latest = normalize({ ...confirmed, ...active, ...pending });
    void chrome.storage.local.set({ [STORAGE_KEY]: latest }).catch(() => {});
  });

  void initialize();
  if (chrome.tabs?.query) void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    try { const url = new URL(tabs[0]?.url || ""); if (url.protocol === "https:" && /^(?:(?:en|ja)\.)?iknow\.jp$/.test(url.hostname) && !url.port) wordCourseId = url.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1] || null; } catch { }
    updateWordPreparation(current);
    const studyLink = document.getElementById("study-link");
    if (studyLink && wordCourseId) studyLink.href = chrome.runtime.getURL(`study.html?course=${wordCourseId}`);
  }).catch(() => {});
})();
