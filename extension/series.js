/* Explicit preparation and saved-module overview for iKnow series pages. */
(() => {
  "use strict";
  const Core = globalThis.IKnowReaderCore;
  if (!Core || !globalThis.chrome?.storage?.local || globalThis.__ikrSeriesLoaded) return;
  const seriesId = Core.seriesIdFromUrl(location.href);
  if (!seriesId) return;
  globalThis.__ikrSeriesLoaded = true;
  const ViewState = globalThis.IKnowReaderViewState;
  const QUEUE_KEY = "iknowReaderQueue", SELECTION_KEY = "iknowReaderSeriesSelections", PACKS_KEY = "iknowReaderCoursePacks";
  const moduleNames = { german: "German", colors: "Colors", audio: "Audio" };
  let settings = { ...Core.DEFAULTS }, queue = null, busy = false, initialized = false, commandError = "";
  let courses = [], selectedIds = new Set(), customSelection = false, coursesKey = "";
  let saveTimer = null, scanTimer = null, availabilityTimer = null, pendingMask = null, pendingSelection = false;
  let saveChain = Promise.resolve(), selectionChain = Promise.resolve();
  let availability = {}, availabilityErrors = {}, checking = false, checkingVisible = false, checkAgain = false, checkAgainRefresh = false, scheduledRefresh = false, requestGeneration = 0;
  let checkingRequestId = null, checkingIds = new Set(), checkedIds = new Set();
  const rows = new Map();
  const title = () => (document.querySelector(".content-details .details-primary, .category-name, .series-item-primary h1, h1:not(.logo)")?.textContent || document.title.replace(/\s*-\s*iKnow!\s*$/, "") || "iKnow series").trim().slice(0, 500);
  const node = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  const card = node("section", "ikr-series-card ikr-owned"); card.setAttribute("aria-label", "Prepare courses");
  const eyebrow = node("p", "ikr-series-eyebrow", "iKnow! Reading Helper"), heading = node("h2", "", "Prepare your courses");
  const detail = node("p", "ikr-series-detail", ""), features = node("div", "ikr-series-features");
  const savedCheck = node("div", "ikr-saved-check"); savedCheck.hidden = true;
  savedCheck.setAttribute("role", "status"); savedCheck.setAttribute("aria-live", "polite");
  const checkSpinner = node("span", "ikr-check-spinner"); checkSpinner.setAttribute("aria-hidden", "true");
  const checkCopy = node("div", "ikr-saved-check-copy"), checkLine = node("div", "ikr-saved-check-line");
  const checkTitle = node("strong", "", "Checking saved courses"), checkCount = node("span", "ikr-saved-check-count");
  const checkProgress = node("progress", "ikr-check-progress"); checkProgress.setAttribute("aria-label", "Courses checked for saved data");
  checkLine.append(checkTitle, checkCount); checkCopy.append(checkLine, checkProgress); savedCheck.append(checkSpinner, checkCopy);
  features.setAttribute("role", "group"); features.setAttribute("aria-label", "Choose additions to prepare");
  const inputs = new Map();
  for (const [feature, setting, label] of [["german", "prepareGerman", "German"], ["colors", "prepareColors", "Meaning colors"], ["audio", "prepareAudio", "Audio timings"]]) {
    const wrapper = node("label", "ikr-feature-option"), input = node("input"); input.type = "checkbox"; input.dataset.feature = feature;
    input.addEventListener("change", () => {
      settings = Core.normalizeSettings({ ...settings, [setting]: input.checked });
      pendingMask = { prepareGerman: settings.prepareGerman, prepareColors: settings.prepareColors, prepareAudio: settings.prepareAudio };
      clearTimeout(saveTimer); saveTimer = setTimeout(() => { void flushMask(); }, 140); render();
    });
    wrapper.append(input, node("span", "", label)); features.append(wrapper); inputs.set(feature, input);
  }
  // Read the saved fold state before mounting; a collapsed picker must never
  // briefly paint open while extension storage is still being read.
  const picker = node("details", "ikr-course-picker");
  let lastPickerOpen = false;
  picker.addEventListener("toggle", () => {
    if (!initialized || picker.open === lastPickerOpen) return;
    lastPickerOpen = picker.open;
    void ViewState?.save("series", seriesId, { collapsed: !picker.open });
  });
  const pickerSummary = node("summary", "ikr-picker-summary");
  const pickerTitle = node("span", "", "Choose courses"), selectionCount = node("span", "ikr-selection-count"); pickerSummary.append(pickerTitle, selectionCount);
  const pickerTools = node("div", "ikr-picker-tools");
  const all = node("button", "", "All"), none = node("button", "", "None"), missing = node("button", "", "Only missing"), refresh = node("button", "ikr-check-saved", "Check saved data");
  for (const button of [all, none, missing, refresh]) button.type = "button";
  all.dataset.selection = "all"; none.dataset.selection = "none"; missing.dataset.selection = "missing";
  pickerTools.append(all, none, missing, refresh);
  const list = node("div", "ikr-picker-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Courses in this series");
  const savedNote = node("p", "ikr-saved-note"); savedNote.setAttribute("role", "status"); savedNote.setAttribute("aria-live", "polite");
  picker.append(pickerSummary, pickerTools, list, savedNote);
  const actions = node("div", "ikr-series-actions");
  const start = node("button", "ikr-series-primary", "Prepare selected"), pause = node("button", "", "Pause"), resume = node("button", "", "Resume"), open = node("button", "", "Open queue");
  for (const button of [start, pause, resume, open]) button.type = "button";
  actions.append(start, pause, resume, open);
  const status = node("div", "ikr-series-status"); status.hidden = true;
  const statusTitle = node("p", "ikr-series-status-title"), statusDetail = node("p", "ikr-series-status-detail"), eta = node("p", "ikr-series-eta");
  statusDetail.setAttribute("role", "status"); statusDetail.setAttribute("aria-live", "polite");
  const progress = node("progress", "ikr-series-progress"); progress.setAttribute("aria-label", "Prepared courses");
  status.append(statusTitle, statusDetail, progress, eta); card.append(eyebrow, heading, detail, features, savedCheck, picker, actions, status);

  function etaText(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "Estimated time left: calculating";
    if (seconds < 60) return "Estimated time left: less than a minute";
    const minutes = Math.ceil(seconds / 60);
    return minutes < 60 ? `Estimated time left: about ${minutes} min` : `Estimated time left: about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }
  function selectedReady(id, mask = Core.preparationFeatures(settings)) {
    const saved = availability[id];
    if (!saved) return false;
    const chosen = Object.entries(mask).filter(([, value]) => value).map(([key]) => key);
    if (!chosen.length) return saved.complete === true;
    return chosen.every(key => saved.modules?.[key]?.status === "ready") && !(mask.german && mask.colors && saved.modules?.colors?.germanStatus && saved.modules.colors.germanStatus !== "ready");
  }
  // German links can still need repair when the three independent modules
  // are present. Keep that course selectable until those links are complete.
  function fullySaved(id) { return availability[id]?.complete === true && availability[id].germanColorsComplete !== false; }
  function applyDefaultSelection() {
    if (customSelection) return;
    selectedIds = new Set(courses.filter(course => !fullySaved(course.id) && !selectedReady(course.id)).map(course => course.id));
  }
  function shortTitle(course) { return course.title.match(/\bStep\s+\d+\b/i)?.[0] || course.title; }
  function renderCourses(locked) {
    const currentIds = new Set(courses.map(course => course.id));
    for (const [id, row] of rows) if (!currentIds.has(id)) { row.label.remove(); rows.delete(id); }
    courses.forEach((course, index) => {
      let row = rows.get(course.id);
      if (!row) {
        const label = node("label", "ikr-picker-course"), input = node("input"); input.type = "checkbox"; input.dataset.courseId = course.id;
        input.setAttribute("aria-label", `Prepare ${course.title}`);
        const copy = node("span", "ikr-picker-course-copy"), top = node("span", "ikr-picker-course-top"), name = node("a", "ikr-picker-course-name"), badge = node("span", "ikr-picker-course-badge"), modules = node("span", "ikr-picker-modules");
        name.href = new URL(`/courses/${course.id}`, location.origin).href;
        name.target = "_blank"; name.rel = "noopener noreferrer";
        // A native link keeps middle-click, context menus and keyboard access.
        // Its click must not bubble to site handlers or select the label's box.
        name.addEventListener("click", event => event.stopPropagation());
        const pills = new Map();
        for (const key of Object.keys(moduleNames)) { const pill = node("span", "ikr-module-status"); pill.dataset.module = key; pills.set(key, pill); modules.append(pill); }
        top.append(name, badge); copy.append(top, modules); label.append(input, copy);
        input.addEventListener("change", () => { if (fullySaved(course.id)) { render(); return; } customSelection = true; if (input.checked) selectedIds.add(course.id); else selectedIds.delete(course.id); void saveSelection(); render(); });
        row = { label, input, name, badge, pills }; rows.set(course.id, row);
      }
      if (list.children[index] !== row.label) list.insertBefore(row.label, list.children[index] || null);
      const complete = fullySaved(course.id);
      row.input.checked = !complete && selectedIds.has(course.id); row.input.disabled = locked || complete;
      // Only preparation selection is disabled. The course link remains usable
      // when this course is saved or another preparation is running.
      row.label.removeAttribute("aria-disabled");
      setText(row.name, shortTitle(course));
      row.name.setAttribute("aria-label", `Open ${course.title} in a new tab`);
      const saved = availability[course.id], error = availabilityErrors[course.id];
      const partial = saved && Object.values(saved.modules || {}).some(value => value.status === "ready" || value.status === "partial");
      row.label.dataset.saved = complete ? "ready" : saved ? partial ? "partial" : "missing" : error ? "unknown" : "checking";
      setText(row.badge, complete ? "Fully saved" : saved ? partial ? "Partly saved" : "Not saved" : error ? "Unable to check" : "Checking…");
      row.input.setAttribute("aria-label", complete ? `${course.title}, fully saved` : `Prepare ${course.title}`);
      for (const [key, pill] of row.pills) {
        const module = saved?.modules?.[key];
        pill.dataset.state = module?.status || (error ? "unknown" : "checking");
        let text = `${moduleNames[key]} · ${module ? `${module.ready}/${module.total}` : error ? "unknown" : "checking"}`;
        if (key === "german" && module && (module.wordsReady !== module.ready || module.wordsTotal !== module.total)) text += ` · words ${module.wordsReady}/${module.wordsTotal}`;
        if (key === "colors" && module?.status === "ready" && saved.modules?.german?.status === "ready" && module.germanStatus && module.germanStatus !== "ready") text += ` · DE links ${module.germanReady}/${module.germanTotal}`;
        setText(pill, text);
        const aria = module ? `${moduleNames[key]}: ${module.status === "ready" ? "saved" : module.status === "partial" ? "partly saved" : "not saved"}, ${module.ready} of ${module.total} sentences${key === "german" ? `, ${module.wordsReady} of ${module.wordsTotal} word meanings` : ""}` : `${moduleNames[key]}: ${error ? "saved status could not be checked" : "checking saved status"}`;
        pill.setAttribute("aria-label", aria);
      }
    });
  }
  function render() {
    const mask = Core.preparationFeatures(settings), running = queue?.status === "running";
    const own = queue && String(queue.seriesId) === seriesId;
    applyDefaultSelection();
    // Restored/custom selections and All must not leave completed courses
    // checked after a fresh saved-data response or a queue update.
    for (const course of courses) if (fullySaved(course.id)) selectedIds.delete(course.id);
    const chosen = courses.filter(course => selectedIds.has(course.id));
    const savedCount = courses.filter(course => fullySaved(course.id)).length;
    const known = courses.filter(course => availability[course.id]).length;
    const unknown = courses.filter(course => !availability[course.id] && availabilityErrors[course.id]).length;
    const chosenReady = chosen.filter(course => selectedReady(course.id, mask)).length;
    const any = Object.values(mask).some(Boolean);
    const pendingCheck = checkingVisible || known + unknown < courses.length;
    card.dataset.checking = String(pendingCheck);
    list.setAttribute("aria-busy", String(pendingCheck));
    savedCheck.hidden = !pendingCheck || !courses.length;
    const checkTotal = checking ? checkingIds.size : courses.length;
    const checkDone = checking ? checkedIds.size : known + unknown;
    setText(checkCount, `${checkDone} of ${checkTotal} checked`);
    checkProgress.max = Math.max(1, checkTotal); checkProgress.value = Math.min(checkDone, checkTotal);
    checkProgress.setAttribute("aria-valuetext", `${checkDone} of ${checkTotal} courses checked`);
    setText(detail, courses.length ? `${courses.length} courses · ${savedCount} fully saved${known < courses.length ? !checkingVisible && known + unknown === courses.length ? ` · ${unknown} could not be checked` : " · checking saved data…" : ""}` : "Finding courses in this series…");
    setText(selectionCount, `${chosen.length} of ${courses.length} selected`);
    for (const [key, input] of inputs) { input.checked = mask[key]; input.disabled = !initialized || busy || running; }
    const locked = !initialized || busy || running;
    for (const button of [all, none, missing]) button.disabled = locked || !courses.length;
    missing.disabled ||= checkingVisible || known + unknown < courses.length;
    refresh.disabled = !initialized || checkingVisible; refresh.textContent = checkingVisible ? "Checking…" : "Check saved data";
    renderCourses(locked);
    const note = !any ? "Saved data is shown above. Choose the additions you want to prepare." : !chosen.length ? "Choose at least one course." : chosenReady === chosen.length ? "Your selected additions are already saved for these courses." : `${chosen.length - chosenReady} selected ${chosen.length - chosenReady === 1 ? "course needs" : "courses need"} preparation${chosenReady ? ` · ${chosenReady} already saved and will be skipped` : ""}.`;
    const stale = courses.filter(course => availability[course.id]?.stale).length;
    setText(savedNote, `${running && !own ? "Another series is being prepared. Open the queue to manage it. " : ""}${note}${stale ? ` Using last-checked course data for ${stale} ${stale === 1 ? "course" : "courses"}.` : ""}`);
    start.disabled = locked || !chosen.length || !any || chosenReady === chosen.length;
    start.textContent = busy ? "Starting…" : "Prepare selected";
    pause.hidden = !own || !running; resume.hidden = !own || !(["paused", "error"].includes(queue.status) || queue.status === "complete" && queue.failedCourses > 0);
    resume.textContent = queue?.status === "complete" ? "Retry missing" : "Resume";
    pause.disabled = resume.disabled = busy;
    // There is one local processing queue, but its progress and ETA belong
    // only to the series that started it. Visiting another series never
    // represents that series as downloading.
    status.hidden = !own && !commandError;
    if (commandError) {
      statusTitle.textContent = "Preparation interrupted"; statusDetail.textContent = commandError;
      statusDetail.classList.add("ikr-series-error"); progress.hidden = eta.hidden = true; return;
    }
    progress.hidden = false;
    if (!own) return;
    const count = queue.totalCourses || queue.courses?.length || 0;
    const current = Math.min(count, Math.max(1, (queue.currentIndex || 0) + 1));
    const course = queue.courses?.[queue.currentIndex];
    statusTitle.textContent = queue.status === "complete" ? queue.failedCourses ? "Preparation finished with missing additions" : "Selected courses saved" : queue.status === "paused" ? "Preparation paused" : queue.status === "error" ? "Preparation interrupted" : `Course ${current} of ${count}`;
    const phase = { model: "Starting", language: "German & meanings", translation: "German", groups: "Meaning colors", audio: "Audio timings", done: "Saved" }[queue.stage] || "Preparing";
    const savedProgress = Core.preparationProgress(queue, availability[course?.id], queue.features);
    const sentenceCount = savedProgress ? ` · ${savedProgress.ready} of ${savedProgress.total} sentences ready` : "";
    statusDetail.textContent = queue.error || (own ? queue.status === "complete" ? `${queue.processedCourses ?? count} courses processed${queue.failedCourses ? ` · ${queue.failedCourses} with missing additions` : ""}` : `${course?.title || queue.message || "Your course"} · ${phase}${sentenceCount}` : queue.title || "View progress in the queue.");
    statusDetail.classList.toggle("ikr-series-error", Boolean(queue.error));
    progress.max = Math.max(1, count); progress.value = Math.min(count, queue.processedCourses ?? queue.completedCourses ?? 0);
    eta.hidden = queue.status !== "running"; eta.textContent = eta.hidden ? "" : etaText(queue.etaSeconds);
  }
  async function flushMask() {
    clearTimeout(saveTimer); const pending = pendingMask; pendingMask = null;
    if (!pending) return saveChain;
    saveChain = saveChain.catch(() => {}).then(async () => {
      const stored = await chrome.storage.local.get(Core.STORAGE_KEY);
      await chrome.storage.local.set({ [Core.STORAGE_KEY]: Core.normalizeSettings({ ...stored[Core.STORAGE_KEY], ...pending }) });
    });
    return saveChain;
  }
  function saveSelection() {
    pendingSelection = true;
    const ids = [...selectedIds];
    selectionChain = selectionChain.catch(() => {}).then(async () => {
      const stored = await chrome.storage.local.get(SELECTION_KEY);
      await chrome.storage.local.set({ [SELECTION_KEY]: { ...stored[SELECTION_KEY], [seriesId]: ids } });
    }).finally(() => { pendingSelection = false; });
    return selectionChain;
  }
  function applyAvailability(id, saved, error) {
    if (saved?.modules) { availability[id] = saved; delete availabilityErrors[id]; return; }
    availabilityErrors[id] = error || "Saved data could not be checked.";
    if (!checkingVisible && availability[id]) {
      // A transient automatic check failure is not evidence that saved data
      // disappeared. Retain the last verified counts with a stale qualifier.
      availability[id] = { ...availability[id], stale: true };
    } else delete availability[id];
  }
  async function checkAvailability(refreshSources = false) {
    if (!initialized || !courses.length) return;
    if (checking) { checkAgain = true; checkAgainRefresh ||= refreshSources; return; }
    checking = true;
    // First discovery and an explicit recheck show progress. Checkpoint-driven
    // updates keep the already checked UI in place and update its counts only.
    checkingVisible = refreshSources || courses.some(course => !availability[course.id] && !availabilityErrors[course.id]);
    const generation = ++requestGeneration, ids = courses.map(course => ({ id: course.id }));
    checkingRequestId = `saved-check-${Date.now().toString(36)}-${generation}`;
    checkingIds = new Set(ids.map(({ id }) => String(id))); checkedIds = new Set(); render();
    try {
      const response = await chrome.runtime.sendMessage({ type: "ikr:queue:availability", courses: ids, refresh: refreshSources, requestId: checkingRequestId });
      if (!response?.ok) throw new Error(response?.error || "Saved data could not be checked.");
      if (generation !== requestGeneration) return;
      for (const { id } of ids) {
        checkedIds.add(String(id));
        applyAvailability(id, response.availability?.[id], response.errors?.[id]);
      }
    } catch (error) {
      if (generation === requestGeneration) for (const { id } of ids) applyAvailability(id, null, error.message);
    } finally {
      checking = false; checkingVisible = false; checkingRequestId = null; render();
      if (checkAgain) {
        const refreshSources = checkAgainRefresh;
        checkAgain = false; checkAgainRefresh = false;
        scheduleAvailability(refreshSources, refreshSources);
      }
    }
  }
  function scheduleAvailability(urgent = false, refreshSources = false) {
    // Checkpoints can arrive several times per second. One bounded refresh
    // coalesces them instead of repeatedly rechecking every course in the list.
    scheduledRefresh ||= refreshSources;
    if (availabilityTimer && !urgent) return;
    clearTimeout(availabilityTimer);
    availabilityTimer = setTimeout(() => {
      availabilityTimer = null;
      const refresh = scheduledRefresh; scheduledRefresh = false;
      void checkAvailability(refresh);
    }, urgent ? 100 : 1200);
  }
  // The final batch response remains authoritative. Matching progress messages
  // expose actual completed checks without issuing a separate request per row.
  chrome.runtime.onMessage?.addListener((message, sender) => {
    if (sender?.id !== chrome.runtime.id || !checking || message?.type !== "ikr:queue:availability:progress" || message.requestId !== checkingRequestId) return;
    const id = String(message.courseId);
    if (!checkingIds.has(id) || checkedIds.has(id)) return;
    if (!message.availability?.modules && typeof message.error !== "string") return;
    applyAvailability(id, message.availability, message.error);
    checkedIds.add(id); render();
  });
  async function command(type, extra = {}) {
    busy = true; commandError = ""; render();
    try {
      const response = await chrome.runtime.sendMessage({ type: `ikr:queue:${type}`, ...extra });
      if (!response?.ok) throw new Error(response?.error || "Preparation could not be started.");
      if (response.queue !== undefined) queue = response.queue;
    } catch (error) { commandError = error.message || "Please try again."; }
    finally { busy = false; render(); }
  }
  function choose(mode) {
    customSelection = true;
    selectedIds = new Set(courses.filter(course => !fullySaved(course.id) && (mode === "all" || mode === "missing" && !selectedReady(course.id))).map(course => course.id));
    void saveSelection(); render();
  }
  all.addEventListener("click", () => choose("all")); none.addEventListener("click", () => choose("none")); missing.addEventListener("click", () => choose("missing"));
  refresh.addEventListener("click", () => { void checkAvailability(true); });
  start.addEventListener("click", () => {
    if (busy || queue?.status === "running") return;
    const chosenCourses = courses.filter(course => selectedIds.has(course.id) && !fullySaved(course.id));
    if (!chosenCourses.length || !Object.values(Core.preparationFeatures(settings)).some(Boolean)) return;
    customSelection = true; busy = true; render();
    void (async () => {
      try { await flushMask(); await saveSelection(); } catch { busy = false; commandError = "Your selection could not be saved. Please try again."; render(); return; }
      await command("start", { seriesId, title: title(), courses: chosenCourses, features: Core.preparationFeatures(settings) });
    })();
  });
  pause.addEventListener("click", () => { void command("pause"); }); resume.addEventListener("click", () => { void command("resume"); }); open.addEventListener("click", () => { void command("open"); });
  function scan() {
    if (!initialized) return;
    const found = new Map(); let first = null;
    for (const link of document.querySelectorAll("a[href]")) {
      if (link.closest(".ikr-owned")) continue;
      const id = Core.courseIdFromUrl(link.href); if (!id || found.has(id)) continue;
      const text = (link.textContent || link.querySelector("img")?.alt || `Course ${id}`).trim().replace(/\s+/g, " ").slice(0, 500);
      const context = link.closest("li, .course, .goal, .course-item") || link.parentElement;
      const count = context?.textContent.match(/(\d+)\s*(?:sentences|センテンス)/i)?.[1];
      found.set(id, { id, title: text || `Course ${id}`, ...(count ? { sentenceCount: Number(count) } : {}) }); if (!first) first = link;
    }
    courses = [...found.values()];
    if (!card.isConnected && first) {
      const list = document.querySelector(".series_list") || document.querySelector(".series-courses .courses") || first.closest(".courses, .goals, .course-list, ul, ol, table") || first.closest(".course, .goal, article") || first.parentElement; list.before(card);
    }
    const nextKey = courses.map(course => course.id).join(":");
    if (nextKey !== coursesKey) { coursesKey = nextKey; scheduleAvailability(); }
    render();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (![QUEUE_KEY, Core.STORAGE_KEY, SELECTION_KEY, PACKS_KEY].some(key => changes[key])) return;
    if (changes[QUEUE_KEY]) {
      const previous = queue;
      queue = changes[QUEUE_KEY].newValue || null;
      if (String(previous?.seriesId) === seriesId && previous?.status === "running" && queue?.status !== "running") scheduleAvailability(true);
    }
    if (changes[Core.STORAGE_KEY] && !pendingMask) settings = Core.normalizeSettings(changes[Core.STORAGE_KEY].newValue);
    if (changes[SELECTION_KEY] && !pendingSelection) {
      const saved = changes[SELECTION_KEY].newValue?.[seriesId];
      if (Array.isArray(saved)) { customSelection = true; selectedIds = new Set(saved.map(String)); }
    }
    if (changes[PACKS_KEY]) scheduleAvailability();
    render();
  });
  new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.(".ikr-owned"))) { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 180); }
  }).observe(document.body, { childList: true, subtree: true });
  void Promise.all([
    chrome.storage.local.get([Core.STORAGE_KEY, QUEUE_KEY, SELECTION_KEY]).catch(() => ({})),
    Promise.resolve(ViewState?.load("series", seriesId)).catch(() => ({ collapsed: false }))
  ]).then(([stored, view]) => {
    settings = Core.normalizeSettings(stored[Core.STORAGE_KEY]); queue = stored[QUEUE_KEY] || null;
    const saved = stored[SELECTION_KEY]?.[seriesId];
    if (Array.isArray(saved)) { customSelection = true; selectedIds = new Set(saved.map(String)); }
    picker.open = view?.collapsed !== true; lastPickerOpen = picker.open;
    initialized = true; scan(); return chrome.runtime.sendMessage({ type: "ikr:queue:status" });
  }).then(response => { if (response?.queue !== undefined) { queue = response.queue; render(); } }).catch(() => { initialized = true; scan(); });
  window.addEventListener("pagehide", () => {
    // Native details toggles dispatch their event in a later task. Capture a
    // last-moment fold change before unloading even if that task has not run.
    if (initialized && picker.open !== lastPickerOpen) {
      lastPickerOpen = picker.open;
      void ViewState?.save("series", seriesId, { collapsed: !picker.open });
      void ViewState?.flush();
    }
    void flushMask().catch(() => {});
  });
})();
