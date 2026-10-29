/* Refresh open iKnow pages only after the verified update is actually loaded. */
(() => {
  "use strict";
  const URLS = ["https://iknow.jp/*", "https://en.iknow.jp/*", "https://ja.iknow.jp/*"];
  const HOSTS = new Set(["iknow.jp", "en.iknow.jp", "ja.iknow.jp"]);
  const validVersion = value => typeof value === "string" && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value);
  const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => Number.isInteger(id) && id >= 0))] : [];
  const refreshable = value => ["current", "complete", "available"].includes(value?.status);
  function eligible(tab) {
    try {
      const url = new URL(tab?.pendingUrl || tab?.url || "");
      return Number.isInteger(tab?.id) && tab.id >= 0 && url.protocol === "https:" && HOSTS.has(url.hostname) && !url.port;
    } catch { return false; }
  }
  function create({ chrome, getVersion, getState, save, getActivity = async () => false }) {
    let running = null;
    const result = (ok, extra = {}) => ({ ok, state: getState(), ...extra });
    const matchingTabs = async () => (await chrome.tabs.query({ url: URLS })).filter(eligible);
    // A subsequent release can be discovered while the previous install's page
    // refresh waits for preparation/audio. Keep that newer update's notice.
    const refreshMessage = message => getState().status === "available" ? {} : { message };
    async function fallback(code, message) {
      await save({ refreshTabs: true, ...refreshMessage(message) });
      return result(false, { code });
    }
    async function perform(manual) {
      const version = getVersion(), state = getState();
      // This target is written by updates.js after a verified, explicit install;
      // helper status payloads must never supply or overwrite it.
      if (!manual && (!validVersion(version) || state.autoRefreshTarget !== version ||
        !refreshable(state) || state.autoRefreshCompleteVersion === version)) return result(true);
      if (await getActivity()) {
        await save({ refreshTabs: true, ...refreshMessage("Updated. Pause preparation to refresh your open iKnow pages automatically.") });
        return result(false, { deferred: true, code: "preparation_active" });
      }
      const tabs = await matchingTabs(), allowed = new Set(tabs.map(tab => tab.id));
      if (!manual && tabs.some(tab => tab.audible === true)) {
        await save({ refreshTabs: true, ...refreshMessage("Updated. Your iKnow pages will refresh automatically when their audio has finished.") });
        return result(false, { deferred: true, code: "iknow_audio_active" });
      }
      const oldPlan = state.autoRefreshPlan;
      let plan = oldPlan?.version === version ? {
        version, remaining: ids(oldPlan.remaining).filter(id => allowed.has(id)), claimed: ids(oldPlan.claimed).filter(id => allowed.has(id))
      } : { version, remaining: [...allowed], claimed: [] };
      // A persisted claim may have reloaded its tab immediately before worker
      // shutdown. Avoid a second automatic reload; keep the explicit retry.
      if (manual) {
        plan.remaining = ids([...plan.remaining, ...plan.claimed]);
        plan.claimed = [];
      }
      await save({ autoRefreshPlan: plan, refreshTabs: true });
      let deferred = null;
      for (const id of [...plan.remaining]) {
        // Both the running extension and the preparation activity can change
        // while an asynchronous tab operation is pending.
        if (!manual && (getVersion() !== version || getState().autoRefreshTarget !== version ||
          !refreshable(getState()))) return result(false, { code: "refresh_target_changed" });
        if (await getActivity()) { deferred = "preparation_active"; break; }
        if (!manual && (await matchingTabs()).some(tab => tab.audible === true)) { deferred = "iknow_audio_active"; break; }
        let tab;
        try { tab = await chrome.tabs.get(id); }
        catch {
          // A vanished tab is complete. A temporary lookup failure for a tab
          // still matching the allowed hosts remains an explicit retry.
          if ((await matchingTabs()).some(value => value.id === id)) continue;
        }
        if (!eligible(tab)) {
          plan = { ...plan, remaining: plan.remaining.filter(value => value !== id) };
          await save({ autoRefreshPlan: plan });
          continue;
        }
        plan = { ...plan, remaining: plan.remaining.filter(value => value !== id), claimed: ids([...plan.claimed, id]) };
        // Persist before the side effect: a worker restart cannot automatically
        // issue the same reload again after an ambiguous acknowledgement.
        await save({ autoRefreshPlan: plan });
        const releaseClaim = async retry => {
          plan = { ...plan, remaining: retry ? ids([id, ...plan.remaining]) : plan.remaining,
            claimed: plan.claimed.filter(value => value !== id) };
          await save({ autoRefreshPlan: plan });
        };
        if (await getActivity()) {
          await releaseClaim(true);
          deferred = "preparation_active";
          break;
        }
        let latestTabs;
        try { latestTabs = await matchingTabs(); }
        catch (error) { await releaseClaim(true); throw error; }
        // Navigation and audio may begin while the persisted claim is being
        // written. Read fresh tab state before performing the actual reload.
        if (!latestTabs.some(tab => tab.id === id)) { await releaseClaim(false); continue; }
        if (!manual && latestTabs.some(tab => tab.audible === true)) {
          await releaseClaim(true);
          deferred = "iknow_audio_active";
          break;
        }
        if (!manual && (getVersion() !== version || getState().autoRefreshTarget !== version ||
          !refreshable(getState()))) {
          await releaseClaim(true);
          return result(false, { code: "refresh_target_changed" });
        }
        try { await chrome.tabs.reload(id); }
        catch { plan = { ...plan, remaining: ids([...plan.remaining, id]) }; }
        plan = { ...plan, claimed: plan.claimed.filter(value => value !== id) };
        await save({ autoRefreshPlan: plan });
      }
      await save({ autoRefreshPlan: plan });
      if (deferred) {
        await save({ refreshTabs: true, ...refreshMessage(deferred === "iknow_audio_active" ?
          "Updated. Your remaining iKnow pages will refresh automatically when their audio has finished." :
          "Updated. Pause preparation to finish refreshing your open iKnow pages automatically.") });
        return result(false, { deferred: true, code: deferred });
      }
      if (plan.remaining.length || plan.claimed.length) return fallback("refresh_incomplete", "Updated. Some iKnow pages could not be refreshed. Choose Refresh iKnow pages to retry.");
      await save({ autoRefreshPlan: null, autoRefreshCompleteVersion: version, refreshTabs: false,
        ...refreshMessage("Your open iKnow pages have been refreshed.") });
      return result(true);
    }
    function run({ manual = false } = {}) {
      // A popup, startup and activity notification share one transaction.
      if (running) return running;
      running = perform(manual).catch(async () => {
        try { return await fallback("refresh_failed", "Updated. Your iKnow pages could not be refreshed. Choose Refresh iKnow pages to retry."); }
        catch { return result(false, { code: "refresh_failed" }); }
      }).finally(() => { running = null; });
      return running;
    }
    return Object.freeze({ run, get busy() { return running !== null; } });
  }
  globalThis.IKnowReaderUpdateRefresh = Object.freeze({ create });
})();
