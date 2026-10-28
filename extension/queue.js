/* Persistent preparation view; leaving a series tab does not cancel its queue. */
(() => {
  "use strict";
  const KEY = "iknowReaderQueue", Core = globalThis.IKnowReaderCore;
  let queue = null, busy = false;
  const $ = id => document.getElementById(id);
  function remaining(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "Estimated time left: calculating";
    if (seconds < 60) return "Less than a minute left";
    const minutes = Math.ceil(seconds / 60);
    return minutes < 60 ? `About ${minutes} min left` : `About ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
  }
  function render() {
    $("empty").hidden = Boolean(queue); $("queue").hidden = !queue;
    $("connection").textContent = "";
    if (!queue) return;
    const total = queue.totalCourses || queue.courses?.length || 0;
    document.body.dataset.status = queue.status;
    $("status").dataset.status = queue.status;
    $("status").textContent = queue.status === "complete" && queue.failedCourses ? "Partly saved" : { running: "Preparing", paused: "Paused", complete: "Saved", error: "Interrupted" }[queue.status] || "Ready";
    $("series-title").textContent = queue.title || "Your series";
    const index = Math.min(total, Math.max(1, (queue.currentIndex || 0) + 1));
    $("course-count").textContent = queue.status === "complete" ? `${total} courses` : `Course ${index} of ${total}`;
    const mask = Core.normalizeFeatures(queue.features);
    $("features").replaceChildren(...Object.entries({ german: "German", colors: "Meaning colors", audio: "Audio timings" }).filter(([key]) => mask[key]).map(([, text]) => { const n = document.createElement("span"); n.textContent = text; return n; }));
    const current = queue.courses?.[queue.currentIndex];
    $("current-title").textContent = queue.status === "complete" ? queue.failedCourses ? "Finished with missing additions." : "Your results are saved." : current?.title || queue.message || "Preparing";
    const phase = { model: "Starting local helper", language: mask.german && mask.colors ? "German & meanings" : mask.german ? "German" : "Meaning colors", translation: "German", groups: "Meaning colors", audio: "Audio timings", done: "Saved" }[queue.stage] || "Preparing";
    $("phase").textContent = queue.status === "complete" ? "Saved additions appear when you open your courses." : `${phase}${queue.total > 0 ? ` · ${Math.min(queue.completed || 0, queue.total)} of ${queue.total} sentences` : ""}`;
    const processed = queue.processedCourses ?? queue.completedCourses ?? 0;
    $("course-progress").max = Math.max(1, total); $("course-progress").value = Math.min(total, processed);
    $("totals").textContent = `${processed} of ${total} courses processed${queue.skippedCourses ? ` · ${queue.skippedCourses} already saved` : ""}${queue.failedCourses ? ` · ${queue.failedCourses} with missing additions` : ""}`;
    $("eta").hidden = queue.status !== "running"; $("eta").textContent = $("eta").hidden ? "" : remaining(queue.etaSeconds);
    $("error").hidden = !queue.error; $("error").textContent = queue.error || "";
    $("pause").hidden = queue.status !== "running"; $("resume").hidden = !(["paused", "error"].includes(queue.status) || queue.status === "complete" && queue.failedCourses > 0);
    $("resume").textContent = queue.status === "complete" ? "Retry missing" : "Resume";
    $("pause").disabled = $("resume").disabled = $("refresh").disabled = busy;
    const rows = queue.courses || [];
    const list = $("courses");
    // Updating progress does not replace a focused course row or the whole list.
    while (list.children.length > rows.length) list.lastElementChild.remove();
    rows.forEach((course, i) => {
      let row = list.children[i];
      if (!row) { row = document.createElement("li"); row.append(document.createElement("span"), document.createElement("span")); list.append(row); }
      row.dataset.status = course.status;
      row.children[0].textContent = course.title || `Course ${course.id}`;
      row.children[1].textContent = course.partial ? "Partly saved" : { pending: "Waiting", running: "Preparing", complete: "Saved", skipped: "Already saved", error: "Retry needed" }[course.status] || "Waiting";
      if (course.error) row.title = course.error; else row.removeAttribute("title");
    });
  }
  async function command(type) {
    busy = true; render();
    try {
      const response = await chrome.runtime.sendMessage({ type: `ikr:queue:${type}` });
      if (!response?.ok) throw new Error(response?.error || "Preparation is currently unavailable.");
      queue = response.queue || null; render();
    } catch (error) { $("connection").textContent = error.message || "Please try again."; }
    finally { busy = false; if (queue) $("pause").disabled = $("resume").disabled = $("refresh").disabled = false; }
  }
  $("pause").addEventListener("click", () => { void command("pause"); });
  $("resume").addEventListener("click", () => { void command("resume"); });
  $("refresh").addEventListener("click", () => { void command("status"); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[KEY]) { queue = changes[KEY].newValue || null; render(); } });
  void chrome.storage.local.get(KEY).then(stored => { queue = stored[KEY] || null; render(); return command("status"); }).catch(() => { $("connection").textContent = "Preparation could not be loaded."; });
})();
