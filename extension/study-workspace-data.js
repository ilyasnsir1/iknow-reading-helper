/* The Study workspace uses the existing extension stores and background transactions. */
(() => {
  "use strict";
  const THEMES = Object.freeze(["paper", "midnight", "tokyo", "forest"]);
  const copy = value => structuredClone(value);
  function create(options = {}) {
    const browser = options.chrome || globalThis.chrome;
    const Store = options.store || globalThis.IKnowReaderStudyStore;
    const Progress = options.learningStore || globalThis.IKnowReaderStudyLearningStore;
    const Learning = options.learning || globalThis.IKnowReaderStudyLearning;
    const Core = options.core || globalThis.IKnowReaderCore;
    if (!browser?.runtime?.id || !browser.storage?.local || !Store || !Progress || !Learning || !Core) return null;
    const themeKey = "iknowReaderTheme", panelThemeKey = "iknowReaderPanelTheme";
    const watched = new Set([Store.KEY, Progress.KEY, Store.PREFERENCES_KEY, Core.STORAGE_KEY, themeKey, panelThemeKey]);
    let settingsTail = Promise.resolve(), snapshotTail=Promise.resolve(), latestSnapshot = null;
    const readSnapshot=operation=>{const next=snapshotTail.then(operation);snapshotTail=next.catch(()=>{});return next;};
    const settingsTransaction = operation => {
      const next = settingsTail.then(operation); settingsTail = next.catch(() => {}); return next;
    };
    const loadSnapshot=()=>readSnapshot(fullSnapshot);
    async function fullSnapshot() {
      // Export validates the complete library, preferences and skill history in
      // the same background write lane used by save/import/learning commits.
      const [backup, active] = await Promise.all([Store.exportBackup(), Progress.getSession()]);
      const snapshot = {
        library: copy(backup.library),
        learning: { schemaVersion: 1, records: copy(backup.learning?.records || {}), session: copy(active) },
        reading: Core.normalizeSettings(backup.settings?.reading),
        preferences: copy(backup.settings?.study || { attempts: "retry", gapPosition: "random" }),
        appTheme: THEMES.includes(backup.settings?.appTheme) ? backup.settings.appTheme : "paper",
        panelTheme: THEMES.includes(backup.settings?.panelTheme) ? backup.settings.panelTheme : "paper"
      };
      latestSnapshot = snapshot; return snapshot;
    }
    const refreshParts=keys=>readSnapshot(()=>readParts(keys));
    async function readParts(keys) {
      if (!latestSnapshot) return fullSnapshot();
      const next = { ...latestSnapshot }, jobs = [];
      if (keys.has(Store.KEY)) jobs.push(Store.list({order:"added"}).then(records => {next.library = {schemaVersion:1,records:Object.fromEntries(records.map(record=>[record.key,record]))};}));
      if (keys.has(Progress.KEY)) jobs.push(Promise.all([Progress.progress(),Progress.getSession()]).then(([progress,session])=>{next.learning={schemaVersion:1,records:progress.records,session};}));
      if (keys.has(Store.PREFERENCES_KEY)) jobs.push(Store.getPreferences().then(value=>{next.preferences=value;}));
      const preferences=[Core.STORAGE_KEY,themeKey].filter(key=>keys.has(key));
      if (preferences.length) jobs.push(browser.storage.local.get(preferences).then(stored=>{
        if (keys.has(Core.STORAGE_KEY)) next.reading=Core.normalizeSettings(stored[Core.STORAGE_KEY]);
        if (keys.has(themeKey)) next.appTheme=THEMES.includes(stored[themeKey])?stored[themeKey]:"paper";
      }));
      await Promise.all(jobs); latestSnapshot=next; return next;
    }
    function subscribe(onSnapshot, onError = () => {}) {
      if (typeof onSnapshot !== "function") throw Error("Choose a library update handler.");
      const pageDocument=options.document||globalThis.document;
      const pending=new Set();let closed=false,timer=null,reading=false;
      const visible=()=>!pageDocument||pageDocument.visibilityState!=="hidden";
      const schedule=()=>{
        if(closed||reading||timer!==null||!pending.size||!visible())return;
        timer=setTimeout(async()=>{
          timer=null;if(closed||!pending.size||!visible())return;
          const keys=new Set(pending);pending.clear();reading=true;
          try{const snapshot=await refreshParts(keys);if(!closed)await onSnapshot(snapshot,keys);}
          catch(error){if(!closed)onError(error);}
          finally{reading=false;schedule();}
        },40);
      };
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const readingProjection=value=>{const normalized=Core.normalizeSettings(value);return[normalized.translationLanguage,normalized.romajiStyle];};
      const changed=(changes,area)=>{
        if(area!=="local")return;
        for(const key of Object.keys(changes)){
          if(!watched.has(key)||key===panelThemeKey)continue;
          const {oldValue,newValue}=changes[key];
          if(key===Core.STORAGE_KEY&&same(readingProjection(oldValue),readingProjection(newValue)))continue;
          if(key===Progress.KEY&&same(oldValue?.records||{},newValue?.records||{}))continue;
          if(key!==Store.KEY&&key!==Progress.KEY&&same(oldValue,newValue))continue;
          pending.add(key);
        }
        schedule();
      };
      const visibility=()=>{if(visible())schedule();else if(timer!==null){clearTimeout(timer);timer=null;}};
      browser.storage.onChanged.addListener(changed);pageDocument?.addEventListener("visibilitychange",visibility);
      return()=>{closed=true;if(timer!==null)clearTimeout(timer);pending.clear();browser.storage.onChanged.removeListener(changed);pageDocument?.removeEventListener("visibilitychange",visibility);};
    }

    function sessionCard(record) {
      const source = Store.validate(record), key = Store.makeKey(source);
      if (key !== record.key) throw Error("This practice item has an invalid source.");
      delete source.notes; delete source.review;
      return { ...source, key, createdAt: Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 ? record.createdAt : 0,
        updatedAt: Number.isSafeInteger(record.updatedAt) && record.updatedAt >= 0 ? record.updatedAt : 0 };
    }
    function beginRound(round, preferences = {}) {
      if (!round || !Array.isArray(round.keys) || !round.keys.length || !Array.isArray(round.pool)) throw Error("Choose words or sentences to practise.");
      const pool = round.pool.map(sessionCard), source = new Map(pool.map(record => [record.key, record]));
      const cards = round.keys.map(key => { const card = source.get(key); if (!card) throw Error("This practice item is no longer available."); return card; });
      const targets = {};
      if (round.mode === "cloze") round.keys.forEach((key, index) => { targets[key] = round.exercises?.[index]?.targetIndex; });
      const session = {
        id: typeof round.runtimeId === "string" ? round.runtimeId : globalThis.crypto.randomUUID(),
        kind: round.test ? "test" : "practice", mode: round.test ? "review" : round.mode,
        cards, pool, index: 0, attempts: 0,
        attemptPolicy: round.test ? "single" : round.attempts === "single" ? "single" : "retry",
        gapPosition: preferences.gapPosition === "first" ? "first" : "random",
        language: ["en", "de", "both"].includes(preferences.language) ? preferences.language : "en",
        createdAt: Number.isSafeInteger(round.startedAt) && round.startedAt >= 0 ? round.startedAt : Date.now(),
        targets, label: round.courseTitle || (round.test ? "Course test" : "Saved words and sentences")
      };
      if (round.courseId) session.courseId = round.courseId;
      return Progress.startSession(session);
    }
    return Object.freeze({
      loadSnapshot, subscribe,
      remove: key => Store.remove(key),
      removeAll: keys => Store.clearLibrary({ expectedKeys: keys }),
      updateNotes: (key, notes) => Store.updateNotes(key, notes),
      exportBackup: () => Store.exportBackup(),
      previewBackup: backup => Store.previewBackup(backup),
      importBackup: (backup, preferences = {}) => Store.importBackup(backup, preferences),
      setPreferences: preferences => Store.setPreferences(preferences),
      setLanguage: language => settingsTransaction(async () => {
        if (!["en", "de", "both"].includes(language)) throw Error("Choose a valid translation language.");
        const stored = await browser.storage.local.get(Core.STORAGE_KEY);
        const reading = Core.normalizeSettings(stored[Core.STORAGE_KEY]);
        reading.translationLanguage = language;
        await browser.storage.local.set({ [Core.STORAGE_KEY]: reading }); return reading;
      }),
      setTheme: theme => settingsTransaction(async () => {
        if (!THEMES.includes(theme)) throw Error("Choose a valid theme.");
        await browser.storage.local.set({ [themeKey]: theme }); return theme;
      }),
      strength: (key, history, mode = "review") => Learning.strength(history?.records?.[key]?.[Learning.MODES.includes(mode) ? mode : "review"]),
      beginRound,
      submitAttempt: (sessionId, index, attempt) => Progress.checkpointAttempt({ sessionId, index, attempt }),
      commitAnswer: (sessionId, index, outcome) => Progress.commit({ sessionId, index, outcome, firstCorrect: outcome === "good" }),
      endRound: sessionId => Progress.endSession(sessionId),
      getRound: () => Progress.getSession(),
      setRoundState: (sessionId, state) => Progress.setSessionState(sessionId, state)
    });
  }
  const api = Object.freeze({ create });
  globalThis.IKnowStudyWorkspaceData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
