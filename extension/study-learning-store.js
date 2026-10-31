/* Durable practice checkpoints and skill-specific progress, separate from bookmarks. */
(() => {
  "use strict";
  const KEY = "iknowReaderStudyLearning", MAX_RECORDS = 10000, MAX_SESSION_ITEMS = 2000;
  const MAX_SESSION_BYTES = 12 * 1024 * 1024, MAX_BYTES = 16 * 1024 * 1024;
  const Learning = globalThis.IKnowReaderStudyLearning || (typeof require === "function" ? require("./study-learning.js") : null);
  const Study = globalThis.IKnowReaderStudyStore || (typeof require === "function" ? require("./study-store.js") : null);
  const Practice = globalThis.IKnowReaderStudyPractice || (typeof require === "function" ? require("./study-practice.js") : null);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const stamp = value => Number.isSafeInteger(value) && value >= 0 && value <= Learning.DATE_LIMIT;
  const copy = value => structuredClone(value);
  function fields(value, allowed, error = "This learning data is not valid.") {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error(error);
  }
  function key(value) {
    if (typeof value !== "string" || value.length > 130 || !/^(word|sentence):[1-9]\d{0,9}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value)) throw Error("Choose a valid study item.");
    return value;
  }
  function sessionId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value)) throw Error("This practice session is not valid.");
    return value;
  }
  function text(value, max) {
    if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw Error("This practice session contains invalid text.");
    return value;
  }
  function records(input) {
    if (!object(input) || Object.keys(input).length > MAX_RECORDS) throw Error("This learning history is too large or invalid.");
    const result = {};
    for (const [id, modes] of Object.entries(input)) {
      key(id); fields(modes, Learning.MODES);
      if (!Object.keys(modes).length) throw Error("This learning item has no skill history.");
      const clean = {};
      for (const [mode, value] of Object.entries(modes)) {
        if (!Learning.validSkill(value)) throw Error("This saved skill history is invalid.");
        clean[mode] = copy(value);
      }
      result[id] = clean;
    }
    return result;
  }
  function validateProgress(input) {
    fields(input, ["records"]);
    const result = { records: records(input.records) };
    if (bytes(result) > MAX_BYTES) throw Error("This learning history exceeds its size limit.");
    return result;
  }
  function mergeProgress(current, incoming) {
    const local = validateProgress({ records: current.records }), added = validateProgress(incoming), result = local.records;
    for (const [id, modes] of Object.entries(added.records)) {
      const target = result[id] ||= {};
      for (const [mode, skill] of Object.entries(modes)) if (!target[mode] || skill.lastReviewedAt > target[mode].lastReviewedAt) target[mode] = skill;
    }
    return validateProgress({ records: result });
  }
  function cards(input) {
    if (!Array.isArray(input) || !input.length || input.length > MAX_SESSION_ITEMS) throw Error("Choose between 1 and 2,000 practice items.");
    const seen = new Set();
    return input.map(record => {
      const source = Study.validate(record), id = Study.makeKey(source);
      if (record.key !== id || seen.has(id)) throw Error("The session contains duplicate or invalid study items.");
      seen.add(id);
      // Personal notes and the old shared schedule are not course source data.
      delete source.notes; delete source.review;
      return { ...source, key: id, createdAt: stamp(record.createdAt) ? record.createdAt : 0, updatedAt: stamp(record.updatedAt) ? record.updatedAt : 0 };
    });
  }
  function validResult(input, card, atLeast, atMost) {
    fields(input, ["key", "outcome", "firstCorrect", "at"]);
    if (input.key !== card.key || !Learning.OUTCOMES.includes(input.outcome) || typeof input.firstCorrect !== "boolean" ||
        input.firstCorrect !== (input.outcome === "good") || !stamp(input.at) || input.at < atLeast || input.at > atMost) throw Error("This practice answer history is invalid.");
    return { key: card.key, outcome: input.outcome, firstCorrect: input.firstCorrect, at: input.at };
  }
  function session(input, starting = false) {
    fields(input, ["id", "kind", "mode", "cards", "pool", "index", "attempts", "attemptPolicy", "gapPosition", "language", "createdAt", "targets", "sourceFingerprint", "label", "courseId", "results", "state"]);
    const result = { id: sessionId(input.id), kind: input.kind, mode: input.mode, cards: cards(input.cards), index: input.index,
      attempts: input.attempts === undefined ? 0 : input.attempts, attemptPolicy: input.attemptPolicy, gapPosition: input.gapPosition, language: input.language, createdAt: input.createdAt, state: input.state === undefined ? "active" : input.state };
    if (!["practice", "test"].includes(result.kind) || !Learning.MODES.includes(result.mode) || !Number.isSafeInteger(result.index) || result.index < 0 || result.index > result.cards.length ||
        !Number.isSafeInteger(result.attempts) || result.attempts < 0 || result.attempts > Learning.MAX_COUNTER || result.index === result.cards.length && result.attempts !== 0 ||
        !["retry", "single"].includes(result.attemptPolicy) || !["first", "random"].includes(result.gapPosition) || !["en", "de", "both"].includes(result.language) || !["active", "paused"].includes(result.state) || !stamp(result.createdAt)) throw Error("This practice session is invalid.");
    if (starting && (result.index !== 0 || result.attempts !== 0 || own(input, "results") && (!Array.isArray(input.results) || input.results.length))) throw Error("A new session must start with its first item.");
    if (own(input, "pool")) result.pool = cards(input.pool);
    if (own(input, "label")) result.label = text(input.label, 500);
    if (own(input, "sourceFingerprint")) result.sourceFingerprint = text(input.sourceFingerprint, 256);
    if (own(input, "courseId")) {
      const id = String(input.courseId);
      if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 1000000000) throw Error("This practice course is invalid.");
      result.courseId = id;
    }
    const targets = input.targets === undefined ? {} : input.targets; fields(targets, result.cards.map(card => card.key));
    result.targets = {};
    for (const [id, value] of Object.entries(targets)) {
      if (result.mode !== "cloze" || !Number.isSafeInteger(value) || value < 0 || value >= 250) throw Error("This saved gap position is invalid.");
      result.targets[id] = value;
    }
    if (result.mode === "cloze") for (const card of result.cards) {
      if (!own(result.targets, card.key) || !Practice.buildCloze(card, { targetIndex: result.targets[card.key] })) throw Error("This practice item has no valid saved gap.");
    }
    const answers = input.results === undefined && starting ? [] : input.results;
    if (!Array.isArray(answers) || answers.length !== result.index) throw Error("The practice checkpoint does not match its answers.");
    let previousAt = result.createdAt;
    result.results = answers.map((answer, index) => {
      const clean = validResult(answer, result.cards[index], previousAt, Learning.DATE_LIMIT); previousAt = clean.at;
      if (result.attemptPolicy === "single" && clean.outcome === "hard") throw Error("A single-attempt session cannot contain retries.");
      return clean;
    });
    if (bytes(result) > MAX_SESSION_BYTES) throw Error("This practice session exceeds its size limit.");
    return result;
  }
  function normalizeData(input) {
    if (input === undefined) return { schemaVersion: 1, records: {}, session: null };
    fields(input, ["schemaVersion", "records", "session"]);
    if (input.schemaVersion !== 1 || !own(input, "session")) throw Error("This learning history version is unsupported. Its data has been kept.");
    const result = { schemaVersion: 1, records: records(input.records), session: input.session === null ? null : session(input.session) };
    if (bytes(result) > MAX_BYTES) throw Error("This learning history exceeds its size limit.");
    return result;
  }
  function createBackend(storage, options = {}) {
    const now = typeof options === "function" ? options : options.now || Date.now;
    if (typeof now !== "function") throw Error("Choose a valid learning clock.");
    let tail = Promise.resolve();
    const localTransaction = operation => { const job = tail.then(operation); tail = job.catch(() => {}); return job; };
    const transaction = typeof options.transaction === "function" ? options.transaction : typeof Study.serialize === "function" ? Study.serialize : localTransaction;
    const read = async () => normalizeData((await storage.get(KEY))[KEY]);
    const write = async value => { const clean = normalizeData(value); await storage.set({ [KEY]: clean }); return clean; };
    return Object.freeze({
      getData: () => transaction(read),
      progress: () => transaction(async () => ({ records: (await read()).records })),
      getSession: () => transaction(async () => (await read()).session),
      setSessionState(value, state) {
        const id = sessionId(value);
        if (!["active", "paused"].includes(state)) throw Error("Choose a valid session state.");
        return transaction(async () => {
          const data = await read();
          if (!data.session || data.session.id !== id) throw Error("This practice session is no longer active.");
          if (data.session.state === state) return data.session;
          data.session.state = state; return (await write(data)).session;
        });
      },
      startSession(input) {
        const draft = session(input, true);
        return transaction(async () => {
          const data = await read();
          if (data.session) {
            if (data.session.id === draft.id && JSON.stringify({ ...data.session, index: 0, attempts: 0, results: [] }) === JSON.stringify(draft)) return data.session;
            throw Error("Finish or end the saved session before starting another.");
          }
          data.session = draft; return (await write(data)).session;
        });
      },
      checkpointAttempt(input) {
        fields(input, ["sessionId", "index", "attempt"]);
        const id = sessionId(input.sessionId);
        if (!Number.isSafeInteger(input.index) || input.index < 0 || !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > Learning.MAX_COUNTER) throw Error("This answer attempt is invalid.");
        return transaction(async () => {
          const data = await read(), active = data.session;
          if (!active || active.id !== id || input.index !== active.index || active.index >= active.cards.length) throw Error("This answer does not match the current practice item.");
          if (input.attempt === active.attempts) return active;
          if (input.attempt !== active.attempts + 1) throw Error("This answer attempt does not follow the saved checkpoint.");
          active.attempts = input.attempt; return (await write(data)).session;
        });
      },
      commit(input) {
        fields(input, ["sessionId", "index", "outcome", "firstCorrect"]);
        const id = sessionId(input.sessionId);
        if (!Number.isSafeInteger(input.index) || input.index < 0 || !Learning.OUTCOMES.includes(input.outcome) || typeof input.firstCorrect !== "boolean" || input.firstCorrect !== (input.outcome === "good")) throw Error("This practice result is invalid.");
        return transaction(async () => {
          const data = await read(), active = data.session;
          if (!active || active.id !== id) throw Error("This practice session is no longer active.");
          if (input.index < active.index) {
            const previous = active.results[input.index];
            if (previous?.outcome === input.outcome && previous.firstCorrect === input.firstCorrect) return active;
            throw Error("This answer was already saved with a different result.");
          }
          if (input.index !== active.index || active.index >= active.cards.length || active.attemptPolicy === "single" && input.outcome === "hard") throw Error("This answer does not match the current practice item.");
          if (input.outcome === "good" && active.attempts > 1 || input.outcome === "hard" && active.attempts === 1) throw Error("This result does not match the saved answer attempts.");
          const card = active.cards[active.index], modes = data.records[card.key] || {};
          const timestamp = Math.max(now(), active.createdAt, active.results.at(-1)?.at || 0, modes[active.mode]?.lastReviewedAt || 0);
          const skill = Learning.next(modes[active.mode], input.outcome, timestamp);
          data.records[card.key] = { ...modes, [active.mode]: skill };
          active.results.push({ key: card.key, outcome: input.outcome, firstCorrect: input.firstCorrect, at: timestamp }); active.index++; active.attempts = 0;
          return (await write(data)).session;
        });
      },
      endSession(value) {
        const id = sessionId(value);
        return transaction(async () => {
          const data = await read();
          if (!data.session) return null;
          if (data.session.id !== id) throw Error("A different practice session is active.");
          data.session = null; await write(data); return null;
        });
      }
    });
  }
  async function command(type, values = {}) {
    const result = await chrome.runtime.sendMessage({ type: "ikr:learning:" + type, ...values });
    if (result?.ok !== true) throw Error(result?.message || "Learning progress is unavailable. Reload Reading Helper and try again.");
    return own(result, "session") ? result.session : result.progress;
  }
  let listening = false;
  function listenBackground() {
    if (listening) return; listening = true;
    const backend = createBackend(chrome.storage.local), commands = ["progress", "session:get", "session:start", "session:state", "attempt", "commit", "session:end"];
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (!commands.some(type => message?.type === "ikr:learning:" + type)) return;
      let trusted = false;
      try {
        const actual = new URL(sender?.url || ""), target = new URL(chrome.runtime.getURL("study.html"));
        trusted = sender?.id === chrome.runtime.id && (sender.frameId === undefined || sender.frameId === 0) &&
          actual.protocol === target.protocol && actual.host === target.host && actual.pathname === target.pathname;
      } catch { /* Only the extension's top-level Study page can manage learning. */ }
      if (!trusted) { respond({ ok: false, message: "Open Your study space to manage learning progress." }); return; }
      const operation = async () => {
        if (message.type === "ikr:learning:progress") return { ok: true, progress: await backend.progress() };
        if (message.type === "ikr:learning:session:get") return { ok: true, session: await backend.getSession() };
        if (message.type === "ikr:learning:session:start") return { ok: true, session: await backend.startSession(message.session) };
        if (message.type === "ikr:learning:session:state") return { ok: true, session: await backend.setSessionState(message.sessionId, message.state) };
        if (message.type === "ikr:learning:attempt") return { ok: true, session: await backend.checkpointAttempt(message.attempt) };
        if (message.type === "ikr:learning:commit") return { ok: true, session: await backend.commit(message.result) };
        return { ok: true, session: await backend.endSession(message.sessionId) };
      };
      void operation().then(respond, error => respond({ ok: false, message: String(error.message || error).slice(0, 220) }));
      return true;
    });
  }
  const api = Object.freeze({ KEY, MAX_RECORDS, MAX_SESSION_ITEMS, MAX_SESSION_BYTES, MAX_BYTES, validateProgress, mergeProgress, normalizeData, createBackend, listenBackground,
    progress: () => command("progress"), getSession: () => command("session:get"), startSession: value => command("session:start", { session: value }),
    setSessionState: (id, state) => command("session:state", { sessionId: id, state }),
    checkpointAttempt: value => command("attempt", { attempt: value }), commit: value => command("commit", { result: value }), endSession: id => command("session:end", { sessionId: id }) });
  globalThis.IKnowReaderStudyLearningStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
