/* Small UI preferences, independent of preparation choices and course data. */
(() => {
  "use strict";
  const storage = globalThis.chrome?.storage?.local;
  const pending = new Map(), current = new Map();
  const normalize = value => ({ collapsed: value?.collapsed === true });
  function key(kind, id) {
    return ["course", "series"].includes(kind) && (/^\d{1,12}$/.test(String(id)) || kind === "series" && id === "content:japanese") ? `iknowReaderView:${kind}:${id}` : null;
  }
  async function load(kind, id) {
    const name = key(kind, id);
    if (!name || !storage) return normalize(null);
    if (current.has(name)) return normalize(current.get(name));
    try {
      const stored = await storage.get(name);
      // An explicit change made during a slow read wins over the old value.
      return normalize(current.has(name) ? current.get(name) : stored?.[name]);
    } catch { return normalize(current.get(name)); }
  }
  function save(kind, id, value) {
    const name = key(kind, id);
    if (!name || !storage || typeof value?.collapsed !== "boolean") return Promise.resolve(false);
    const next = normalize(value); current.set(name, next);
    const write = (pending.get(name) || Promise.resolve()).then(async () => {
      // A later click wins before an older queued write has even started.
      if (current.get(name) !== next) return true;
      try { await storage.set({ [name]: next }); return true; }
      catch { return false; }
    });
    pending.set(name, write);
    void write.finally(() => { if (pending.get(name) === write) pending.delete(name); });
    return write;
  }
  function flush() {
    if (!storage || pending.size === 0) return Promise.resolve(true);
    // A settled choice may already have been superseded in another tab. Only
    // rescue writes which this context has not finished sending/persisting.
    const values = Object.fromEntries([...pending.keys()].filter(name => current.has(name)).map(name => [name, current.get(name)]));
    if (Object.keys(values).length === 0) return Promise.resolve(true);
    let write;
    // Dispatch now, not from a Promise continuation which may never run once
    // the page unloads. This payload contains only the latest explicit choices.
    try { write = Promise.resolve(storage.set(values)).then(() => true, () => false); }
    catch { write = Promise.resolve(false); }
    const barriers = [];
    for (const name of Object.keys(values)) {
      // If this context survives (e.g. bfcache), later clicks must wait for the
      // flush and its earlier queue before writing a newer preference.
      const barrier = Promise.all([pending.get(name) || Promise.resolve(true), write]).then(([, saved]) => saved);
      pending.set(name, barrier); barriers.push(barrier);
      void barrier.finally(() => { if (pending.get(name) === barrier) pending.delete(name); });
    }
    return Promise.all(barriers).then(results => results.every(Boolean));
  }
  globalThis.addEventListener?.("pagehide", () => { void flush(); });
  globalThis.IKnowReaderViewState = Object.freeze({ load, save, flush });
})();
