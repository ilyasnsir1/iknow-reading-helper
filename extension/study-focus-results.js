/* Results for the isolated Study preview. No stored grades or proficiency claims. */
(() => {
  "use strict";
  const MAX_ITEMS = 2000;
  const text = (value, max = 5000) => typeof value === "string" ? value.slice(0, max) : "";
  const escape = value => text(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  function summarize(session = {}) {
    session = session && typeof session === "object" ? session : {};
    const keys = [...new Set((Array.isArray(session.keys) ? session.keys : []).filter(key => typeof key === "string" && key && key.length <= 130))].slice(0, MAX_ITEMS);
    const allowed = new Set(keys), byKey = new Map();
    for (const row of (Array.isArray(session.results) ? session.results : []).slice(0, MAX_ITEMS * 2)) {
      if (!row || !allowed.has(row.key) || byKey.has(row.key) || !["good", "hard", "again", "unanswered"].includes(row.outcome)) continue;
      const attemptsHistory = (Array.isArray(row.attemptsHistory) ? row.attemptsHistory : []).slice(-50).filter(attempt => attempt && typeof attempt === "object").map(attempt => ({ submitted: text(attempt.submitted), correct: attempt.correct === true, shown: attempt.shown === true }));
      byKey.set(row.key, { key: row.key, japanese: text(row.japanese), expected: text(row.expected), submitted: text(row.submitted), outcome: row.outcome, attemptsHistory,
        attempts: Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? Math.min(row.attempts, 10000) : 0 });
    }
    const rows = keys.map(key => byKey.get(key) || { key, japanese: "", expected: "", submitted: "", outcome: "unanswered", attempts: 0, attemptsHistory: [] });
    const count = outcome => rows.filter(row => row.outcome === outcome).length;
    const firstTry = count("good"), retried = count("hard"), missed = count("again"), unanswered = count("unanswered"), total = keys.length;
    const correct = firstTry + retried, answered = total - unanswered;
    return { total, firstTry, retried, missed, unanswered, correct, answered, percent: total ? Math.round(firstTry / total * 100) : 0,
      complete: Boolean(session.complete) && unanswered === 0, test: Boolean(session.test), rows, reviewKeys: rows.filter(row => row.outcome !== "good").map(row => row.key) };
  }
  const states = new WeakMap(), PAGE_SIZE = 50;
  const labels = { good: "Correct", hard: "After a retry", again: "Incorrect", unanswered: "Not answered" };
  function model(session, options) {
    const result = summarize(session), pool = [...(Array.isArray(options.items) ? options.items : []), ...(Array.isArray(session.pool) ? session.pool : [])];
    const source = new Map(pool.filter(item => item && typeof item.key === "string").slice(-MAX_ITEMS * 2).map(item => [item.key, item]));
    const exercises = new Map();
    for (const [index, key] of (Array.isArray(session.keys) ? session.keys : []).slice(0, MAX_ITEMS).entries()) if (!exercises.has(key)) exercises.set(key, session.exercises?.[index]);
    const rows = result.rows.map((record, index) => {
      const item = source.get(record.key), fallback = session.mode === "listening" ? item?.japanese : options.language === "de" ? item?.german || item?.english : item?.english;
      const exercise = exercises.get(record.key), prompt = session.mode === "cloze" && (text(exercise?.before) || text(exercise?.after)) ? `${text(exercise.before)} _____ ${text(exercise.after)}` : session.mode === "listening" && text(exercise?.details?.japanese) !== record.japanese ? text(exercise?.details?.japanese) : "";
      return { ...record, number: index + 1, japanese: record.japanese || text(item?.japanese) || "Study item", expected: record.expected || text(fallback) || "Not available",
        english: text(item?.english), german: text(item?.german), prompt, kind: text(options.rowKind, 50) || (item?.kind === "sentence" ? "Sentence" : item?.kind === "word" ? "Word" : "") };
    });
    return { ...result, rows, byKey: new Map(rows.map(row => [row.key, row])) };
  }
  function stateFor(session, result) {
    let state = states.get(session);
    if (!state || !result.byKey.has(state.selected)) { state = { selected: (result.rows.find(row => row.outcome !== "good") || result.rows[0])?.key || "", page: 0, filter: "all", search: "" }; states.set(session, state); }
    return state;
  }
  function filtered(result, state) {
    const term = state.search.trim().toLocaleLowerCase();
    return result.rows.filter(row => (state.filter !== "review" || row.outcome !== "good") && (!term || [row.japanese, row.expected, row.english, row.german, String(row.number)].some(value => value.toLocaleLowerCase().includes(term))));
  }
  function status(row) { return `<span class="focus-result-label" data-result="${row.outcome}">${labels[row.outcome]}</span>`; }
  function attempts(row) {
    if (row.attemptsHistory.length < 2) return "";
    const earlier = row.attemptsHistory.slice(0, -1), offset = Math.max(0, row.attempts - row.attemptsHistory.filter(attempt => !attempt.shown).length);
    return `<section class="focus-result-attempts"><h4>Earlier answers</h4><ol>${earlier.map((attempt, index) => `<li><span class="focus-attempt-number">${offset + index + 1}</span><span class="focus-attempt-text">${escape(attempt.submitted.trim() ? attempt.submitted : "No answer entered")}</span><span class="focus-attempt-state" data-result="${attempt.correct ? "good" : "again"}">${attempt.shown ? "Answer shown" : attempt.correct ? "Correct" : "Incorrect"}</span></li>`).join("")}</ol></section>`;
  }
  function comparison(row) {
    return `${row.prompt ? `<p class="focus-result-prompt" lang="ja">${escape(row.prompt)}</p>` : ""}<dl class="focus-result-comparison"><div data-wrong="${row.outcome === "again"}"><dt>${row.outcome === "unanswered" && row.submitted.trim() ? "Your draft" : "Your answer"}</dt><dd>${escape(row.submitted.trim() ? row.submitted : row.outcome === "unanswered" ? "Not answered" : "No answer entered")}</dd></div><div class="focus-expected-answer"><dt>Expected answer</dt><dd>${escape(row.expected)}</dd></div></dl>${attempts(row)}`;
  }
  function disclosure(row) {
    return `<details class="focus-result-item" data-result="${row.outcome}"><summary><span class="focus-result-japanese" lang="ja">${escape(row.japanese)}</span>${status(row)}</summary>${comparison(row)}</details>`;
  }
  function filterLabel(result, state) { return state.filter === "review" ? `To review · ${result.reviewKeys.length}` : "All answers"; }
  function mainMarkup(session, options, result, state) {
    const rows = filtered(result, state), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), large = result.total > PAGE_SIZE;
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * PAGE_SIZE, visible = rows.slice(start, start + PAGE_SIZE), row = result.byKey.get(state.selected);
    const type = result.test ? "Test" : "Practice", title = !result.total ? "No results yet" : result.complete ? text(options.completeTitle,100)||`${type} complete` : text(options.endedTitle,100)||`${type} ended early`;
    const review = result.rows.filter(record => record.outcome !== "good"), correct = result.rows.filter(record => record.outcome === "good");
    const heading = `<header class="focus-results-heading"><div><p class="eyebrow">${escape(text(options.eyebrow,100) || text(session.courseTitle, 500) || `${type} results`)}</p><h2>${escape(title)}</h2></div><span>${result.total} ${result.total === 1 ? "answer" : "answers"}</span></header>`;
    const tools = large ? `<div class="focus-result-map-tools"><label class="focus-result-map-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m12 12 5 5"/></svg><input type="search" data-result-search placeholder="Find an answer" aria-label="Find an answer" value="${escape(state.search)}"></label><div class="focus-result-filter" role="group" aria-label="Answers to show"><button type="button" data-result-filter-step="previous" aria-label="Previous answers filter"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4"/></svg></button><output data-result-filter data-value="${state.filter}" aria-live="polite">${escape(filterLabel(result,state))}</output><button type="button" data-result-filter-step="next" aria-label="Next answers filter"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></div></div>` : "";
    const map = `<div class="focus-result-map-grid" role="group" aria-label="Answers in order">${visible.map(item => `<button type="button" class="focus-result-map-node" data-result-pick="${escape(item.key)}" data-result="${item.outcome}" aria-current="${state.selected === item.key}" aria-label="Answer ${item.number}, ${escape(item.japanese)}, ${labels[item.outcome]}">${item.number}<span lang="ja">${escape(item.japanese)}</span></button>`).join("") || '<p class="focus-result-empty">No matching answers.</p>'}</div>`;
    const pager = large ? `<div class="focus-result-map-paging"><span role="status">${rows.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)}` : "0"} of ${rows.length}${state.filter === "review" ? " to review" : " answers"}</span><div><button type="button" data-result-page="previous"${!state.page ? " disabled" : ""}>Previous</button><button type="button" data-result-page="next"${state.page + 1 >= pages ? " disabled" : ""}>Next</button></div></div>` : "";
    const legend = `<div class="focus-result-map-legend"><span><i data-result="good"></i>${result.firstTry} first try</span><span><i data-result="again"></i>${result.missed} incorrect</span>${result.retried ? `<span><i data-result="hard"></i>${result.retried} after a retry</span>` : ""}${result.unanswered ? `<span><i data-result="unanswered"></i>${result.unanswered} not answered</span>` : ""}</div>`;
    const selection = row ? `<article class="focus-result-selected" data-selected-key="${escape(row.key)}"><div class="focus-result-selected-context"><span>Answer ${row.number} of ${result.total}</span></div><div class="focus-result-selected-heading"><h3 class="focus-result-japanese" lang="ja">${escape(row.japanese)}</h3>${row.outcome === "unanswered" && !row.submitted.trim() ? "" : status(row)}</div>${comparison(row)}</article>` : "";
    const details = options.showAnswerList !== false && !large && result.total ? `<section class="focus-result-details"><div class="focus-result-details-heading"><h3>Your answers</h3><span>${result.answered} of ${result.total} answered</span></div>${review.map(disclosure).join("")}${correct.length ? `<details class="focus-correct-answers"${!review.length ? " open" : ""}><summary>Correct on the first try <span>${correct.length}</span></summary>${correct.map(disclosure).join("")}</details>` : ""}</section>` : "";
    return heading + (result.total ? tools + map + pager + legend + selection + details : '<p class="focus-result-empty">Start a round to see your results.</p>');
  }
  function render(session, options = {}) {
    session = session && typeof session === "object" ? session : {};
    options = options && typeof options === "object" ? options : {};
    const result = model(session, options), state = stateFor(session, result), count = result.reviewKeys.length;
    const review = result.rows.filter(row => row.outcome !== "good"), noun = review.length && review.every(row => row.kind === "Word") ? "word" : review.length && review.every(row => row.kind === "Sentence") ? "sentence" : "question", countLabel = `${count} ${text(options.noun,50) || noun+(count === 1 ? "" : "s")}`;
    const stat = (label, value, outcome) => `<div class="focus-result-stat" data-result="${outcome}"><strong>${value}</strong><span>${label}</span></div>`;
    return `<section class="session-screen focus-results" data-large="${result.total > PAGE_SIZE}" aria-label="${result.test ? "Test" : "Practice"} results"><div class="focus-results-inner"><main class="focus-result-map-main">${mainMarkup(session, options, result, state)}</main><aside class="focus-result-map-sidebar"><div class="focus-result-score"><strong>${result.percent}<span>%</span></strong><p>${result.firstTry} of ${result.total} correct<br>on the first try</p></div><div class="focus-result-stats">${stat("First try", result.firstTry, "good")}${stat("Incorrect", result.missed, "again")}${stat("After a retry", result.retried, "hard")}${stat("Not answered", result.unanswered, "unanswered")}</div><div class="focus-results-next"><p>${!result.total ? "No answers yet." : count ? `${escape(countLabel)} to revisit.` : "Every answer was correct on the first try."}</p>${count ? `<button class="primary" type="button" data-action="result-practice-mistakes">Practise ${escape(countLabel)}</button>` : ""}</div><footer class="focus-results-actions">${options.originalLabel?`<button type="button" data-action="result-original-report">${escape(text(options.originalLabel,100))}</button>`:""}<button type="button" data-action="result-back-study">${escape(text(options.backLabel,100)||"Back to study")}</button><button type="button" data-action="result-new-round">${escape(text(options.newLabel,100)||(result.test ? "New test" : "New practice"))}</button></footer></aside></div></section>`;
  }
  function mount(root, session, options = {}) {
    if (!root || !session || typeof session !== "object") return () => {};
    const result = model(session, options), state = stateFor(session, result);
    const rail = root.parentElement?.querySelector(":scope > .focus-rail");
    const updateRail = () => { if (rail) root.style.setProperty("--focus-results-rail-height", `${rail.getBoundingClientRect().height}px`); };
    const railObserver = rail && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateRail) : null;
    updateRail(); if (railObserver) railObserver.observe(rail);
    function update({ resetMap = false, focusSearch = false, start = null, end = null } = {}) {
      const main = root.querySelector(".focus-result-map-main"); if (!main) return;
      const tools = main.querySelector(".focus-result-map-tools"), activeFilter = root.contains(document.activeElement) && document.activeElement.matches("[data-result-filter-step]") ? document.activeElement : null;
      const top = main.scrollTop, mapTop = main.querySelector(".focus-result-map-grid")?.scrollTop || 0;
      const expanded = new Set([...main.querySelectorAll(".focus-result-item[open]")].map(node => node.querySelector("summary")?.textContent));
      main.innerHTML = mainMarkup(session, options, result, state); main.scrollTop = top;
      // Keep the visible filter and search controls themselves, including the
      // clicked arrow. Only their values and the answer content need updating.
      const replacementTools = main.querySelector(".focus-result-map-tools");
      if (tools && replacementTools) {
        const filter = tools.querySelector("[data-result-filter]"); filter.dataset.value = state.filter; filter.textContent = filterLabel(result,state);
        tools.querySelector("[data-result-search]").value = state.search;
        replacementTools.replaceWith(tools);
      }
      const map = main.querySelector(".focus-result-map-grid"); if (map) map.scrollTop = resetMap ? 0 : mapTop;
      for (const detail of main.querySelectorAll(".focus-result-item")) if (expanded.has(detail.querySelector("summary")?.textContent)) detail.open = true;
      if (focusSearch) { const input = main.querySelector("[data-result-search]"); input?.focus({preventScroll:true}); if (Number.isInteger(start) && Number.isInteger(end)) input?.setSelectionRange(start, end); }
      else if (activeFilter?.isConnected) activeFilter.focus({preventScroll:true});
    }
    function stepFilter() { state.filter = state.filter === "all" ? "review" : "all"; state.page = 0; update({resetMap:true}); }
    function click(event) {
      const node = event.target.closest("[data-result-pick],[data-result-page],[data-result-filter-step]"); if (!node || !root.contains(node) || node.disabled) return;
      event.stopPropagation();
      if (node.dataset.resultPick && result.byKey.has(node.dataset.resultPick)) { state.selected = node.dataset.resultPick; update(); }
      else if (node.dataset.resultPage) { state.page += node.dataset.resultPage === "next" ? 1 : -1; update({resetMap:true}); }
      else if (node.dataset.resultFilterStep) stepFilter();
    }
    function input(event) {
      if (!event.target.matches("[data-result-search]")) return;
      state.search = event.target.value; state.page = 0; update({resetMap:true, focusSearch:true, start:event.target.selectionStart, end:event.target.selectionEnd});
    }
    function keydown(event) {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const button = event.target.closest("[data-result-filter-step]"); if (!button || !root.contains(button) || button.disabled) return;
      event.preventDefault(); event.stopPropagation(); stepFilter();
    }
    root.addEventListener("click", click); root.addEventListener("input", input); root.addEventListener("keydown", keydown);
    return () => { railObserver?.disconnect(); root.removeEventListener("click", click); root.removeEventListener("input", input); root.removeEventListener("keydown", keydown); };
  }
  const api = Object.freeze({ summarize, render, mount });
  globalThis.IKnowFocusResults = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
