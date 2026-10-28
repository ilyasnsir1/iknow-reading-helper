/* User-initiated, local diagnostic export. Report data is always inert text. */
(() => {
  "use strict";
  const button = document.getElementById("export-diagnostics"), status = document.getElementById("diagnostics-status");
  const preview = document.getElementById("report-preview"), text = document.getElementById("report-text");
  const urls = new Set();
  let busy = false;
  const revoke = url => { if (urls.delete(url)) URL.revokeObjectURL(url); };
  function show(message, state) { status.textContent = message; status.dataset.state = state; }
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true; button.disabled = true; button.setAttribute("aria-busy", "true");
    preview.hidden = true; preview.open = false; text.textContent = "";
    show("Collecting diagnostic information…", "loading");
    try {
      const response = await chrome.runtime.sendMessage({ type: "ikr:diagnostics:export" });
      if (!response?.ok || !response.report || typeof response.report !== "object" || Array.isArray(response.report)) throw new Error("Report unavailable");
      const serialized = JSON.stringify(response.report, null, 2) + "\n";
      if (new TextEncoder().encode(serialized).length > 1024 * 1024) throw new Error("Report too large");
      text.textContent = serialized; preview.hidden = false;
      const url = URL.createObjectURL(new Blob([serialized], { type: "application/json;charset=utf-8" })); urls.add(url);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
      const link = document.createElement("a"); link.href = url; link.download = `iKnow-Reading-Helper-diagnostics-${stamp}.json`;
      link.hidden = true; document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => revoke(url), 60000); }
      const helperStatus = response.report.helper?.status;
      const partial = helperStatus && !["ready", "ok", "available"].includes(helperStatus);
      show(partial ? "Download started · Local helper information is incomplete. You can still share this report." : "Download started. Review the report before sharing.", partial ? "partial" : "success");
    } catch {
      show("The report could not be exported. Please try again.", "error");
    } finally {
      busy = false; button.disabled = false; button.removeAttribute("aria-busy");
    }
  });
  window.addEventListener("pagehide", () => { for (const url of [...urls]) revoke(url); });
})();
