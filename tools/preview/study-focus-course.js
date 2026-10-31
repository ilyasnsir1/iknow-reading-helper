/* Full public course text for the isolated preview, separate from saved items. */
(() => {
  "use strict";
  const Catalog = globalThis.IKnowReaderStudyCatalog;
  const CACHE_DATABASE = "iknow-reading-helper-study-course-preview", CACHE_STORE = "cache";
  function createPreviewStorage() {
    const memory = {};
    let database, lastRead, memoryOnly = false;
    function mergeConcurrent(incoming, current, snapshot) {
      const entries = { ...incoming.entries }, at = Date.now();
      for (const [id, entry] of Object.entries(current?.schemaVersion === 1 && current.entries || {}).slice(0, Catalog.MAX_COURSES)) {
        if (entries[id] && entries[id].at >= entry?.at) continue;
        try {
          if (JSON.stringify(entry) === JSON.stringify(snapshot?.entries?.[id])) continue;
          if (!Number.isSafeInteger(entry?.at) || entry.at < 0 || entry.at > at + 60000) continue;
          Catalog.normalizeSource(entry.source, { courseId: id, now: entry.at });
          entries[Catalog.courseId(id)] = entry;
        } catch { /* Invalid or previously rejected cache entries cannot return through a merge. */ }
      }
      const kept = {}; let size = 0;
      for (const [id, entry] of Object.entries(entries).sort((a,b) => b[1].at-a[1].at)) {
        const length = new TextEncoder().encode(JSON.stringify(entry)).length + id.length + 5;
        if (Object.keys(kept).length < Catalog.MAX_COURSES && size + length + 64 <= Catalog.MAX_BYTES) { kept[id] = entry; size += length; }
      }
      return { schemaVersion: 1, entries: kept };
    }
    function open() {
      if (!globalThis.indexedDB) return Promise.resolve(null);
      if (!database) database = new Promise(resolve => {
        let settled = false;
        const finish = db => { if (settled) { db?.close(); return; } settled = true; resolve(db); };
        let request;
        try { request = indexedDB.open(CACHE_DATABASE, 1); } catch { finish(null); return; }
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE); };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); database = null; };
          finish(db);
        };
        request.onerror = request.onblocked = () => finish(null);
      });
      return database;
    }
    return {
      async get(keys) {
        const names = typeof keys === "string" ? [keys] : keys || [], result = Object.fromEntries(names.map(key => [key, memory[key]]));
        if (memoryOnly) return result;
        const db = await open(); if (!db || !names.includes(Catalog.KEY)) return result;
        try {
          const value = await new Promise((resolve, reject) => {
            const transaction = db.transaction(CACHE_STORE, "readonly"), request = transaction.objectStore(CACHE_STORE).get(Catalog.KEY);
            request.onsuccess = () => resolve(request.result);
            request.onerror = transaction.onabort = () => reject(Error("Course cache is unavailable."));
          });
          if (value !== undefined) result[Catalog.KEY] = value;
          lastRead = value;
        } catch { memoryOnly = true; /* Public course caching is optional; source loading still works. */ }
        return result;
      },
      async set(values) {
        Object.assign(memory, structuredClone(values));
        if (!Object.hasOwn(values, Catalog.KEY) || memoryOnly) return;
        const db = await open(); if (!db) return;
        const snapshot = lastRead;
        try {
          await new Promise((resolve, reject) => {
            const transaction = db.transaction(CACHE_STORE, "readwrite"), store = transaction.objectStore(CACHE_STORE), request = store.get(Catalog.KEY);
            request.onsuccess = () => {
              const merged = mergeConcurrent(values[Catalog.KEY], request.result, snapshot);
              store.put(merged, Catalog.KEY); memory[Catalog.KEY] = merged;
            };
            transaction.oncomplete = resolve;
            transaction.onerror = transaction.onabort = () => reject(Error("Course cache could not be saved."));
          });
        } catch { memoryOnly = true; /* A full/private browser store cannot prevent an explicit course load. */ }
      }
    };
  }
  function createClient({fetchImpl = globalThis.fetch?.bind(globalThis)} = {}) {
    if (!Catalog || typeof fetchImpl !== "function") throw Error("Course data is unavailable.");
    if(globalThis.IKnowStudyWorkspaceProduction){
      return Object.freeze({
        load:value=>Catalog.load(Catalog.courseId(value)),
        cached:async value=>{
          const storage={get:keys=>chrome.storage.local.get(keys),set:async()=>{throw Error('A cache-only read cannot write.');}};
          try{return await Catalog.createBackend(storage,{fetchImpl:async()=>{throw Error('No saved course.');}}).load(Catalog.courseId(value));}catch{return null;}
        },
        courseId:Catalog.courseId
      });
    }
    const storage = createPreviewStorage();
    const backend = Catalog.createBackend(storage, {fetchImpl: (url, options = {}) => {
      const id = Catalog.courseId(String(url).split("/").pop());
      return fetchImpl(id === "19053" ? "/catalog-source.json" : "/api/courses/" + id,
        {signal: options.signal, credentials: "omit", headers: {Accept: "application/json"}});
    }});
    // The same catalog validator prepares cached text before the workspace can
    // display it. Missing or broken entries never become a visible course.
    const cachedBackend = Catalog.createBackend(storage, {fetchImpl: async () => { throw Error("No saved course."); }});
    return Object.freeze({
      load: value => backend.load(Catalog.courseId(value)),
      cached: async value => { try { return await cachedBackend.load(Catalog.courseId(value)); } catch { return null; } },
      courseId: Catalog.courseId
    });
  }
  globalThis.IKnowFocusCourse = Object.freeze({createClient});
})();
