/* Closing the popup never cancels an update. */
(() => {
  "use strict";
  const KEY = "iknowReaderUpdateState", panel = document.getElementById("app-updates");
  if (!panel) return;
  const text = document.getElementById("update-status"), current = document.getElementById("update-version");
  const check = document.getElementById("check-updates"), install = document.getElementById("install-update");
  const refresh = document.getElementById("refresh-updated-tabs"), progress = document.getElementById("update-progress");
  const notice = document.getElementById("update-notice"), noticeText = document.getElementById("update-notice-text");
  const noticeWrap = document.getElementById("update-notice-wrap");
  let sending = false, last = { status: "idle" };
  current.textContent = "Version " + chrome.runtime.getManifest().version;
  function render(state) {
    last = state || last;
    const busy = ["checking", "downloading", "installing", "complete"].includes(last.status), available = last.status === "available";
    panel.dataset.state = last.status;
    panel.setAttribute("aria-busy", String(busy));
    notice.hidden = !available && !["downloading", "installing", "complete"].includes(last.status) && last.refreshTabs !== true;
    noticeWrap.hidden = notice.hidden; noticeWrap.dataset.state = last.status;
    globalThis.IKnowReaderUpdateFox?.setState(last.status, !notice.hidden);
    const refreshing = last.status === "current" && last.refreshTabs && last.autoRefreshTarget === chrome.runtime.getManifest().version;
    noticeText.textContent = available ? `Update available · ${last.latestVersion}` : refreshing ? "Update installed · Finishing page refresh…" : last.refreshTabs && last.status === "current" ? "Update installed · Refresh iKnow pages" : last.status === "complete" ? "Update installed · Reloading…" : "Installing update…";
    text.textContent = last.message || (available ? `Version ${last.latestVersion} is available.` : last.status === "current" ? "You are up to date." : "");
    text.hidden = !text.textContent;
    check.disabled = sending || busy;
    check.textContent = last.status === "checking" ? "Checking…" : "Check for updates";
    install.hidden = !available;
    install.disabled = sending || busy;
    install.textContent = available ? `Install ${last.latestVersion}` : "Install update";
    refresh.hidden = last.refreshTabs !== true || busy;
    refresh.disabled = sending;
    progress.hidden = !["downloading", "installing"].includes(last.status);
    if (Number.isFinite(last.progress)) progress.value = last.progress;
    else progress.removeAttribute("value");
  }
  async function send(action) {
    if (sending) return;
    sending = true; render(last);
    try {
      const result = await chrome.runtime.sendMessage({ type: "ikr:update:" + action });
      if (result?.state) render(result.state);
      else if (!result?.ok) render({ ...last, status: "error", message: "Update status is unavailable. Reload Reading Helper and try again." });
    } catch { render({ ...last, status: "error", message: "Reading Helper is reloading. Open this popup again in a moment." }); }
    finally { sending = false; render(last); }
  }
  check.addEventListener("click", () => { void send("check"); });
  install.addEventListener("click", () => { void send("install"); });
  refresh.addEventListener("click", () => { void send("refresh"); });
  notice.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.replaceState(null, "", "#app-updates");
    panel.focus({ preventScroll: true });
    let scroller = panel.parentElement;
    while (scroller && scroller !== document.documentElement) {
      if (scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY)) break;
      scroller = scroller.parentElement;
    }
    scroller = scroller && scroller !== document.body && scroller !== document.documentElement ? scroller : document.scrollingElement;
    const top = panel.getBoundingClientRect().top - (scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top) + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[KEY]?.newValue) render(changes[KEY].newValue); });
  void send("status").then(() => send("auto-check"));
})();
