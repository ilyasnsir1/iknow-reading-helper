(() => {
  "use strict";
  const VERSION = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/;
  const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  function parts(value) {
    if (typeof value !== "string" || !VERSION.test(value)) return null;
    const result = value.split(".").map(Number);
    if (result.some(part => part > 65535)) return null;
    while (result.length < 4) result.push(0);
    return result;
  }
  function compare(a, b) {
    const left = parts(a), right = parts(b);
    if (!left || !right) return null;
    for (let index = 0; index < 4; index++) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
  }
  function select(entries, target) {
    if (!parts(target) || !Array.isArray(entries) || entries.length > 100) return null;
    let selected = null;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !["status", "id", "version"].every(key => Object.hasOwn(entry, key)) ||
        entry.status !== "released" || typeof entry.id !== "string" || !ID.test(entry.id)) continue;
      const withinTarget = compare(entry.version, target);
      if (withinTarget === null || withinTarget > 0) continue;
      const order = selected ? compare(entry.version, selected.version) : 1;
      if (order > 0 || order === 0 && entry.version === target && selected.version !== target) {
        selected = { id: entry.id, version: entry.version };
      }
    }
    return selected;
  }
  function sameReleaseLine(a, b) {
    const left = parts(a), right = parts(b);
    return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
  }
  globalThis.IKnowReaderChangelogVersions = Object.freeze({ compare, select, sameReleaseLine });
})();
