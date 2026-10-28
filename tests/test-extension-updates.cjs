/* Actual isolated Brave / production popup. Explicit bounded native fixtures;
 * no user registry, installation folder, network release, models or caches. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
let playwright;
try { playwright = require(process.env.IKNOW_PLAYWRIGHT || "playwright"); }
catch (error) {
  const local = path.join(process.env.USERPROFILE || process.env.HOME || "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
  if (!fs.existsSync(local)) throw error;
  playwright = require(local);
}
const { chromium } = playwright;
const root = path.resolve(__dirname, ".."), ext = fs.existsSync(path.join(root, "extension/manifest.json")) ? path.join(root, "extension") : path.join(root, "outputs/iknow-lesehilfe/extension");
const out = path.join(__dirname, "extension-updates-evidence"); fs.mkdirSync(out, { recursive: true });
const passed = [], errors = [], pass = value => { passed.push(value); console.log("PASS", value); };
const until = async (predicate, message, timeout = 20000) => { const at = Date.now(); while (!await predicate()) { if (Date.now() - at > timeout) throw Error("Timed out: " + message); await new Promise(done => setTimeout(done, 25)); } };
(async () => {
  const context = await chromium.launchPersistentContext(path.join(out, "profile-" + Date.now()), {
    executablePath: process.env.IKNOW_BROWSER_PATH || path.join(process.env.PROGRAMFILES || "C:/Program Files", "BraveSoftware/Brave-Browser/Application/brave.exe"), headless: true,
    ignoreDefaultArgs: ["--disable-extensions"], args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], viewport: { width: 700, height: 1000 }
  });
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    await worker.evaluate(() => {
      const fixture = globalThis.__updateTest = { calls: [], active: 0, mode: "current", busy: false, installed: false, statusCalls: 0, reloads: 0, refreshes: [] };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (url, ...args) => String(url).endsWith("/update-config.json") ? Promise.resolve({ ok: true, json: async () => ({ enabled: false }) }) : originalFetch(url, ...args);
      globalThis.IKnowReaderUpdateActivity = async () => fixture.busy;
      chrome.runtime.reload = () => { fixture.reloads++; };
      chrome.tabs.reload = async id => { fixture.refreshes.push(id); };
      chrome.runtime.connectNative = () => {
        fixture.active++;
        const messages = [], disconnects = []; let open = true;
        const current = { onMessage: { addListener: callback => messages.push(callback) }, onDisconnect: { addListener: callback => disconnects.push(callback) },
          disconnect() { if (!open) return; open = false; fixture.active--; for (const callback of disconnects) callback(); },
          postMessage(message) {
            fixture.calls.push(message.type);
            let delay = 50, status = fixture.mode, latestVersion = "9.0.0", ok = true;
            if (message.type === "update:install") { delay = 3500; status = "installing"; fixture.installed = true; }
            if (message.type === "update:status") {
              fixture.statusCalls++;
              status = fixture.installed && fixture.statusCalls >= 2 ? "complete" : "downloading";
            }
            if (fixture.mode === "invalid") status = "not_a_status";
            if (fixture.mode === "error") ok = false;
            setTimeout(() => {
              if (!open) return;
              for (const callback of messages) callback({ type: "update:result", requestId: message.requestId, ok,
                state: { status, latestVersion, progress: status === "downloading" ? .4 : null,
                  message: status === "error" ? "The release signature could not be verified." : status === "unconfigured" ? "Updates have not been configured yet." : status === "current" ? "You are up to date." : status === "available" ? "Version 9.0.0 is available." : status === "complete" ? "Update installed." : "Verifying update…" } });
            }, delay);
          } };
        return current;
      };
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`); await popup.locator("#enabled:not([disabled])").waitFor();
    await until(async () => !await popup.locator("#check-updates").isDisabled(), "initial local status");
    assert.equal(await worker.evaluate(() => __updateTest.calls.length), 0);
    await popup.locator("#check-updates").click();
    await until(async () => await popup.locator("#app-updates").getAttribute("data-state") === "current", "current state");
    assert.equal(await popup.locator("#install-update").isVisible(), false);
    assert.equal(await worker.evaluate(() => __updateTest.active), 0);
    pass("Opening the real popup performs no network/native check; explicit current-version check closes its dedicated native port");

    await worker.evaluate(() => { __updateTest.mode = "available"; });
    await popup.locator("#check-updates").click();
    await until(async () => await popup.locator("#install-update").isVisible(), "available update");
    await worker.evaluate(() => { __updateTest.busy = true; });
    const before = await worker.evaluate(() => __updateTest.calls.length);
    await popup.locator("#install-update").click();
    await until(async () => await popup.locator("#app-updates").getAttribute("data-state") === "busy", "busy refusal");
    assert.equal(await worker.evaluate(() => __updateTest.calls.length), before);
    await worker.evaluate(() => { __updateTest.busy = false; });
    pass("Install is refused before any native download while course/voice preparation is active");

    for (const mode of ["error", "unconfigured", "invalid"]) {
      await worker.evaluate(mode => { __updateTest.mode = mode; }, mode);
      await popup.locator("#check-updates").click();
      await until(async () => await popup.locator("#app-updates").getAttribute("data-state") === (mode === "unconfigured" ? "unconfigured" : "error"), mode + " state");
      assert.equal(await popup.locator("#install-update").isVisible(), false);
      assert.equal(await popup.locator("#check-updates").isEnabled(), true);
    }
    pass("Bad signature, disabled configuration and unknown helper statuses are readable recoverable errors and never enable installation");

    // Another extension page is not the popup; content and foreign senders are
    // additionally verified through a captured listener in the VM test below.
    const other = await context.newPage(); await other.goto(`chrome-extension://${id}/queue.html`);
    assert.deepEqual(await other.evaluate(() => chrome.runtime.sendMessage({ type: "ikr:update:install" })), { ok: false, code: "update_forbidden" });
    await other.close();
    pass("A genuine extension queue page cannot invoke update actions reserved for the popup");

    await worker.evaluate(() => { __updateTest.mode = "available"; });
    await popup.locator("#check-updates").click(); await popup.locator("#install-update").waitFor({ state: "visible" });
    await popup.locator("#app-updates").screenshot({ path: path.join(out, "update-available.png") });
    await popup.evaluate(() => { window.__updateSettings = JSON.stringify(document.querySelector("#settings").innerHTML); });
    await popup.locator("#install-update").click();
    await until(async () => await popup.locator("#app-updates").getAttribute("data-state") === "downloading", "install starting");
    await popup.locator("#app-updates").screenshot({ path: path.join(out, "update-downloading.png") });
    assert.equal(await popup.evaluate(() => JSON.stringify(document.querySelector("#settings").innerHTML) === __updateSettings), true);
    await popup.close();
    const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/popup.html`);
    await until(async () => ["downloading", "installing", "complete", "current"].includes(await reopened.locator("#app-updates").getAttribute("data-state")), "reopened transaction");
    await until(async () => await worker.evaluate(() => __updateTest.reloads === 1), "one completed reload");
    assert.equal(await worker.evaluate(() => __updateTest.calls.filter(type => type === "update:install").length), 1);
    await new Promise(done => setTimeout(done, 2300));
    assert.equal(await worker.evaluate(() => __updateTest.reloads), 1);
    assert.equal(await worker.evaluate(() => __updateTest.active), 0);
    pass("Verified installation continues after the popup closes, reopening restores progress, settings DOM stays untouched, and completion disconnects ports/reloads exactly once");

    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed, errors, fixture: "Production popup and background in isolated Brave; bounded native responses and mocked runtime.reload, no disk installation" }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
