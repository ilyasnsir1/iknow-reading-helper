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

      return normalize(current.has(name) ? current.get(name) : stored?.[name]);
    } catch { return normalize(current.get(name)); }
  }
  function save(kind, id, value) {
    const name = key(kind, id);
    if (!name || !storage || typeof value?.collapsed !== "boolean") return Promise.resolve(false);
    const next = normalize(value); current.set(name, next);
    const write = (pending.get(name) || Promise.resolve()).then(async () => {

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

    const values = Object.fromEntries([...pending.keys()].filter(name => current.has(name)).map(name => [name, current.get(name)]));
    if (Object.keys(values).length === 0) return Promise.resolve(true);
    let write;

    try { write = Promise.resolve(storage.set(values)).then(() => true, () => false); }
    catch { write = Promise.resolve(false); }
    const barriers = [];
    for (const name of Object.keys(values)) {

      const barrier = Promise.all([pending.get(name) || Promise.resolve(true), write]).then(([, saved]) => saved);
      pending.set(name, barrier); barriers.push(barrier);
      void barrier.finally(() => { if (pending.get(name) === barrier) pending.delete(name); });
    }
    return Promise.all(barriers).then(results => results.every(Boolean));
  }
  globalThis.addEventListener?.("pagehide", () => { void flush(); });
  globalThis.IKnowReaderViewState = Object.freeze({ load, save, flush });
})();
