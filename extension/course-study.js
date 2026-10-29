/* Small course actions. Learning data is plain text and saved only on click. */
(() => {
  "use strict";
  const clean = value => globalThis.IKnowReaderCore.plainText(value || ""), buttons = new Map();
  let loaded = false, library = new Set();
  const icon = (kind) => kind === "save" ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10v13L10 13l-5 3.5z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.5 8 5.5-8 5.5z"/></svg>';
  function paint() {
    for (const [key, set] of buttons) {
      for (const button of set) {
        if (!button.isConnected) { set.delete(button); continue; }
        const saved = library.has(key); button.classList.toggle("ikr-study-saved", saved); button.setAttribute("aria-pressed", String(saved)); button.title = saved ? "Remove from study library" : "Save to study library"; button.setAttribute("aria-label", button.title);
      }
      if (!set.size) buttons.delete(key);
    }
  }
  async function refresh() {
    try { const list = await globalThis.IKnowReaderStudyStore.list(); library = new Set(list.map(record => globalThis.IKnowReaderStudyStore.makeKey(record))); paint(); } catch {}
  }
  function initialize() {
    if (loaded) return; loaded = true;
    void refresh(); chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.iknowReaderStudyLibrary) void refresh(); });
  }
  function tools(input, signal) {
    const Store = globalThis.IKnowReaderStudyStore;
    if (!Store) return null; initialize();
    const current = typeof input === "function" ? input : () => input, record = current();
    let key; try { key = Store.makeKey(record); } catch { return null; }
    const root = document.createElement("span"); root.className = "ikr-study-tools ikr-owned";
    const save = document.createElement("button"), practice = document.createElement("button");
    for (const button of [save, practice]) { button.type = "button"; button.className = "ikr-study-action"; }
    save.innerHTML = icon("save"); save.setAttribute("aria-label", "Save to study library"); save.setAttribute("aria-pressed", String(library.has(key)));
    save.title = library.has(key) ? "Remove from study library" : "Save to study library"; save.classList.toggle("ikr-study-saved", library.has(key));
    practice.innerHTML = icon("practice"); practice.title = "Save and practise this " + record.kind; practice.setAttribute("aria-label", practice.title);
    if (!buttons.has(key)) buttons.set(key, new Set()); buttons.get(key).add(save);
    save.addEventListener("click", async event => {
      event.stopPropagation(); save.disabled = true;
      try { if (library.has(key)) { await Store.remove(key); library.delete(key); } else { await Store.save(current()); library.add(key); } paint(); }
      catch { save.title = "Could not save. Please retry."; } finally { save.disabled = false; }
    }, { signal });
    practice.addEventListener("click", async event => {
      event.stopPropagation(); practice.disabled = true;
      try { await Store.save(current()); library.add(key); paint();
        const result = await chrome.runtime.sendMessage({ type: "ikr:study:open", courseId: record.courseId, key });
        if (!result?.ok) throw Error("Practice could not be opened.");
      } catch { practice.title = "Could not open practice. Please retry."; } finally { practice.disabled = false; }
    }, { signal });
    root.append(save, practice); return root;
  }
  function base(kind, cue, courseId, title) {
    return { kind, courseId: String(courseId), courseTitle: clean(title), sourceId: String(cue.id), japanese: clean(cue.text), kana: clean(cue.transliterations?.Hrkt), romaji: clean(cue.transliterations?.Latn) };
  }
  function sound(value) { try { return globalThis.IKnowReaderStudyStore.audioUrl(new URL(value, location.href).href); } catch { return ""; } }
  function sentence(state, courseId, courseTitle) {
    if (!courseId || state.studyTools?.isConnected) return;
    const source = state.sentence, record = { ...base("sentence", source.cue, courseId, courseTitle), english: state.correction?.text || clean(source.response?.text), german: state.record?.german?.text || "", audioUrl: sound(source.sound) };
    const node = tools(record, state.abort?.signal); if (!node) return;
    const anchor = state.germanLine || state.container.querySelector(".ikr-translation-en, .sentence-text > .translation");
    if (!anchor) return; anchor.after(node); state.studyTools = node; state.ownedNodes.push(node);
  }
  function word(state, entry, courseId, courseTitle) {
    if (!courseId || state.studyTools?.isConnected) return;
    const source = entry.item, record = { ...base("word", { ...source.cue, id: source.cue.id || source.id }, courseId, courseTitle), english: clean(source.response?.text), german: state.germanLine?.textContent || "", audioUrl: sound(entry.sound) };
    const node = tools(() => ({...record, german: state.germanLine?.textContent || ""})); if (!node) return; state.response.after(node); state.studyTools = node;
  }
  globalThis.IKnowReaderCourseStudy = Object.freeze({ sentence, word });
})();
