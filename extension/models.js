"use strict";
(() => {
  const $ = id => document.getElementById(id), active = new Set(["starting", "running", "downloading", "installing", "verifying", "pausing"]);
  let state = null, sending = false, timer = null, disposed = false;
  const text = (tag, className, value) => { const node = document.createElement(tag); node.className = className; node.textContent = String(value || ""); return node; };
  const size = value => Number.isFinite(value) && value > 0 ? value >= 1024 ** 3 ? (value / 1024 ** 3).toFixed(1) + " GB" : Math.ceil(value / 1024 ** 2) + " MB" : "Size depends on missing files";
  function error(message) { $("error").textContent = message || ""; $("error").hidden = !message; }
  function schedule() { clearTimeout(timer); if (!disposed && document.visibilityState === "visible" && active.has(state?.job?.status)) timer = setTimeout(() => void send("status"), 1600); }
  function render() {
    if (!state) return;
    const job = state.job, running = active.has(job?.status), paused = job?.status === "paused";
    $("catalogue").textContent = state.catalogVersion ? "Catalogue " + state.catalogVersion : "";
    $("job").hidden = !job || ["idle", "complete"].includes(job.status);
    if (job) {
      $("job-title").textContent = paused ? "Download paused" : job.status === "error" ? "Download needs attention" : job.title || job.componentTitle || "Preparing components";
      $("job-message").textContent = job.message || "";
      const completed = job.bytesDone ?? job.downloadedBytes ?? job.completedBytes ?? job.completed, total = job.bytesTotal ?? job.totalBytes ?? job.total;
      const fraction = Number.isFinite(job.progress) ? job.progress : Number.isFinite(total) && total > 0 && Number.isFinite(completed) ? completed / total : null;
      if (Number.isFinite(fraction)) $("progress").value = Math.max(0, Math.min(1, fraction)); else $("progress").removeAttribute("value");
      $("job-detail").textContent = (job.fileCount ? `File ${job.fileIndex || 0} of ${job.fileCount} · ` : "") + (Number.isFinite(completed) && completed > 0 ? size(completed) + (total > 0 ? " of " + size(total) : " downloaded") : job.phase || job.stage || "");
      $("job-time").textContent = Number.isFinite(job.etaSeconds) && job.etaSeconds > 0 ? "This file · About " + Math.ceil(job.etaSeconds / 60) + " min left" : running && job.phase === "downloading" ? "Measuring this download…" : "";
      $("pause").textContent = paused ? "Resume" : "Pause"; $("pause").disabled = sending || (!running && !paused);
    }
    const cards = state.components.map(component => {
      const ready = ["ready", "installed"].includes(component.status) || !component.status && component.installed === true;
      const card = text("article", "component"), top = text("div", "component-top"), status = text("span", "status", ready ? "Installed" : component.status === "update_available" ? "Update available" : component.status === "partial" ? "Partly installed" : "Not installed");
      status.dataset.ready = String(ready); top.append(text("h2", "", component.title || component.name || component.id), status);
      const bottom = text("div", "component-bottom"), meta = text("div", "component-meta");
      meta.append(text("span", "", component.version || ""), text("span", "", ready ? "Available on this PC" : (component.sizeIsEstimate ? "Approx. " : "") + size(component.downloadBytes ?? component.bytes ?? component.sizeBytes)));
      const button = text("button", ready ? "" : "primary", ready ? "Verify / repair" : job?.componentId === component.id && paused ? "Resume download" : component.status === "update_available" ? "Update component" : "Download");
      button.type = "button"; button.disabled = sending || running;
      button.addEventListener("click", () => void send(paused && job.componentId === component.id ? "resume" : "start", component.id));
      bottom.append(meta, button); card.append(top, text("p", "component-description", component.description), bottom); return card;
    });
    $("components").replaceChildren(...cards); $("refresh").disabled = sending;
  }
  async function send(action, componentId) {
    if (sending) return; sending = true; render();
    try {
      const result = await chrome.runtime.sendMessage({ type: "ikr:components:" + action, ...(componentId ? { componentId } : {}), ...(["start", "resume"].includes(action) ? { manual: true } : {}) });
      if (result?.snapshot) state = result.snapshot;
      error(result?.ok ? "" : result?.error || "The helper is unavailable. Complete first-time setup or update the helper, then retry.");
    } catch { error("The local helper is unavailable. Open First-time setup & repair, then retry."); }
    finally { sending = false; $("loading").hidden = true; render(); schedule(); }
  }
  $("refresh").addEventListener("click", () => void send("status"));
  $("pause").addEventListener("click", () => void send(state?.job?.status === "paused" ? "resume" : "pause", state?.job?.componentId));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void send("status"); else clearTimeout(timer); });
  window.addEventListener("pagehide", () => { disposed = true; clearTimeout(timer); });
  void send("status");
})();
