/* Explicit library actions, using the same background stores as the Study page. */
(() => {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  function create({ runtime, getCurrent, getItems, onChanged = () => {}, onError = () => {}, container = () => document.getElementById("demo") }) {
    if (!runtime || typeof getCurrent !== "function" || typeof getItems !== "function") throw Error("Study library actions are unavailable.");
    let root = null, kind = "", item = null, keys = [], original = "", draft = "", busy = false, returnFocus = null, previousInert = false;
    const selector = () => kind === "note" ? '[data-action="note"],[data-action="notes"]' : keys.length ? '[data-action="delete-all"]' : '[data-action="delete"]';
    function restoreFocus() {
      const page = container(), target = returnFocus?.isConnected ? returnFocus : page?.querySelector(selector()) || page?.querySelector('.focus-rail [data-view="study"]');
      target?.focus({ preventScroll: true });
    }
    function close() {
      if (!root || busy) return false;
      root.removeEventListener("click", click); root.removeEventListener("input", input); root.removeEventListener("keydown", keydown);
      root.remove(); root = null;
      const page = container(); if (page) page.inert = previousInert;
      restoreFocus(); return true;
    }
    function markup() {
      const note = kind === "note", all = kind === "delete-all", title = note ? "Your note" : all ? "Delete all saved items?" : `Delete this ${item.kind === "sentence" ? "sentence" : "word"}?`;
      const content = note ? `<p class="focus-workspace-action-source" lang="ja">${escape(item.japanese)}</p><label class="sr-only" for="focus-workspace-note">Your note</label><textarea id="focus-workspace-note" rows="7" maxlength="4000" spellcheck="true">${escape(draft)}</textarea><div class="focus-workspace-note-meta"><span id="focus-workspace-note-count">${draft.length} / 4000</span></div>` : all ? `<p>${keys.length} saved ${keys.length === 1 ? "item" : "items"} and their notes.</p><p>Learning progress and course downloads stay.</p>` : `<p class="focus-workspace-action-source" lang="ja">${escape(item.japanese)}</p><p>Its saved note will also be deleted.</p>`;
      return `<section class="focus-backup-dialog focus-workspace-action-dialog" role="dialog" aria-modal="true" aria-labelledby="focus-workspace-action-title" tabindex="-1"><header><h2 id="focus-workspace-action-title">${title}</h2><button class="focus-backup-close" type="button" data-workspace-action="close" aria-label="Close ${note ? "note" : "delete confirmation"}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header><div class="focus-backup-body">${content}<p class="focus-workspace-action-status" role="status" aria-live="polite"></p><footer class="focus-workspace-action-footer"><button type="button" class="quiet" data-workspace-action="close">Cancel</button><button type="button" class="${note ? "primary" : "danger"}" data-workspace-action="confirm"${note && draft === original ? " disabled" : ""}>${note ? "Save note" : all ? "Delete all" : "Delete"}</button></footer></div></section>`;
    }
    function open(type) {
      if (root) return false;
      const selected = getCurrent();
      if (type !== "delete-all" && (!selected || typeof selected.key !== "string")) return false;
      const chosen = type === "delete-all" ? [...new Set(getItems().map(record => record.key))] : [];
      if (type === "delete-all" && !chosen.length) return false;
      kind = type; item = selected ? { key: selected.key, kind: selected.kind, japanese: selected.japanese, notes: selected.notes } : null;
      keys = chosen; original = String(item?.notes || ""); draft = original; busy = false;
      returnFocus = document.activeElement; const page = container(); previousInert = Boolean(page?.inert); if (page) page.inert = true;
      root = document.createElement("div"); root.className = "focus-backup-overlay"; root.dataset.workspaceActionsRoot = ""; root.innerHTML = markup();
      root.addEventListener("click", click); root.addEventListener("input", input); root.addEventListener("keydown", keydown); document.body.append(root);
      root.querySelector(kind === "note" ? "textarea" : 'footer [data-workspace-action="close"]')?.focus({ preventScroll: true }); return true;
    }
    function setBusy(value) {
      busy = value; if (!root) return;
      for (const control of root.querySelectorAll("button,textarea")) control.disabled = value;
      const confirm = root.querySelector('[data-workspace-action="confirm"]');
      if (confirm) confirm.disabled = value || kind === "note" && draft === original;
      root.querySelector('[role="dialog"]').setAttribute("aria-busy", String(value));
    }
    async function confirm() {
      if (!root || busy || kind === "note" && draft === original) return;
      const currentRoot = root, action = kind, source = item, expected = [...keys], value = draft;
      const status = root.querySelector(".focus-workspace-action-status"); status.textContent = ""; status.dataset.error = "false"; setBusy(true);
      try {
        if (action === "note") await runtime.updateNotes(source.key, value);
        else if (action === "delete-all") await runtime.removeAll(expected);
        else await runtime.remove(source.key);
      } catch (reason) {
        if (root === currentRoot) { status.textContent = String(reason.message || "The change could not be saved. Try again."); status.dataset.error = "true"; setBusy(false); root.querySelector(action === "note" ? "textarea" : '[data-workspace-action="confirm"]')?.focus({ preventScroll: true }); }
        try { onError(reason); } catch {} return;
      }
      setBusy(false); close();
      try { await onChanged(); } catch (reason) { try { onError(reason); } catch {} }
      if (!root) restoreFocus();
    }
    function click(event) {
      event.stopPropagation(); const button = event.target.closest("[data-workspace-action]"); if (!button || button.disabled) return;
      if (button.dataset.workspaceAction === "close") close(); else if (button.dataset.workspaceAction === "confirm") void confirm();
    }
    function input(event) {
      event.stopPropagation(); if (event.target.id !== "focus-workspace-note" || busy) return;
      draft = event.target.value; root.querySelector("#focus-workspace-note-count").textContent = `${draft.length} / 4000`;
      root.querySelector('[data-workspace-action="confirm"]').disabled = draft === original;
      const status = root.querySelector(".focus-workspace-action-status"); status.textContent = ""; status.dataset.error = "false";
    }
    function keydown(event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab") return;
      const nodes = [...root.querySelectorAll("button:not(:disabled),textarea:not(:disabled)")], first = nodes[0], last = nodes.at(-1);
      if (!nodes.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return Object.freeze({ openDelete: ({ all = false } = {}) => open(all ? "delete-all" : "delete"), openNote: () => open("note"), close });
  }
  globalThis.IKnowStudyWorkspaceActions = Object.freeze({ create });
})();
