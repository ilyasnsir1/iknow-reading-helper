/* Real Brave: a newer release appears while an iKnow tab stays open, without a
 * popup, navigation or manual check. Only native metadata, wall clock and the
 * wait duration of the production content-script heartbeat are fixtures.
 * No user profile, registry, real native host or external website is accessed. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source = path.resolve(__dirname, "../extension"), out = path.join(__dirname, "background-discovery-evidence");
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const started = Date.now();
  while (!await predicate()) {
    if (Date.now() - started > 20000) throw Error("Timed out: " + label);
    await pause(25);
  }
}

(async () => {
  const extension = require("./fixtures/isolate-extension.cjs")(source, out, { updatesEnabled: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")), installed = manifest.version;
  const parts = installed.split(".").map(Number); parts[1]++; parts[2] = 0;
  const newer = parts.join("."), base = 1900000000000;
  // Keep the actual background and updater modules. On the website, isolate
  // the actual production heartbeat from unrelated course rendering/model UI.
  manifest.content_scripts = [{ matches: ["https://iknow.jp/courses/*"],
    js: ["presence-clock-fixture.js", "update-presence.js"], run_at: "document_idle" }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension, "presence-clock-fixture.js"), `
    Date.now = () => Number(document.documentElement.dataset.fixtureNow || ${base});
    const fixtureSetTimeout = globalThis.setTimeout.bind(globalThis);
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      document.documentElement.dataset.fixtureInterval = String(milliseconds);
      // A changed production cadence is observable, not silently accelerated.
      return fixtureSetTimeout(() => {
        document.documentElement.dataset.fixtureHeartbeats = String(Number(document.documentElement.dataset.fixtureHeartbeats || 0) + 1);
        callback(...args);
      }, milliseconds >= 1000 && milliseconds <= 45000 ? 30 : milliseconds);
    };
  `);
  fs.writeFileSync(path.join(extension, "native-update-fixture.js"), `
    globalThis.__updateFixtureNow = ${base};
    Date.now = () => globalThis.__updateFixtureNow;
    const fixtureGet = chrome.storage.local.get.bind(chrome.storage.local);
    const fixtureClockReady = fixtureGet("testFixtureClock").then(value => {
      if (Number.isFinite(value.testFixtureClock)) globalThis.__updateFixtureNow = value.testFixtureClock;
    });
    chrome.storage.local.get = async (...args) => { await fixtureClockReady; return fixtureGet(...args); };
    chrome.runtime.connectNative = () => {
      const messages = [], disconnects = []; let open = true;
      return {
        onMessage: { addListener: callback => messages.push(callback) },
        onDisconnect: { addListener: callback => disconnects.push(callback) },
        disconnect() { if (!open) return; open = false; disconnects.forEach(callback => callback()); },
        postMessage(message) { void (async () => {
          const stored = await chrome.storage.local.get(["testRemoteRelease", "testNativeCalls"]);
          const remote = stored.testRemoteRelease || { latestVersion: ${JSON.stringify(installed)}, offline: false };
          await chrome.storage.local.set({ testNativeCalls: [...(stored.testNativeCalls || []), { type: message.type, at: Date.now(), offline: remote.offline === true, latestVersion: remote.latestVersion }] });
          if (!open) return;
          const state = remote.offline ? { status: "error", latestVersion: remote.latestVersion, message: "Fixture is offline" } :
            { status: remote.latestVersion === ${JSON.stringify(installed)} ? "current" : "available", latestVersion: remote.latestVersion, message: "Fixture verified metadata" };
          messages.forEach(callback => callback({ type: "update:result", requestId: message.requestId, ok: !remote.offline, state }));
        })(); }
      };
    };
  `);
  const bootstrap = path.join(extension, "background.js");
  fs.writeFileSync(bootstrap, 'importScripts("native-update-fixture.js");\n' + fs.readFileSync(bootstrap, "utf8"));
  const context = await chromium.launchPersistentContext(path.join(out, "profile-" + Date.now()), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true,
    ignoreDefaultArgs: ["--disable-extensions"], viewport: { width: 1000, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--disable-background-networking", "--disable-component-update", "--disable-sync"]
  });
  const errors = [], unexpected = []; let loads = 0;
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route(/^https?:\/\//, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === "https://iknow.jp/courses/19053" && request.isNavigationRequest()) {
      loads++;
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Local iKnow course fixture</h1></body></html>" });
    } else { unexpected.push(url.href); await route.abort(); }
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderUpdateState")).iknowReaderUpdateState);
  const calls = () => worker.evaluate(async () => (await chrome.storage.local.get("testNativeCalls")).testNativeCalls || []);
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  let coursePage = null;
  async function configure(elapsed, offline = false, latestVersion = newer) {
    if (coursePage) await coursePage.evaluate(now => { document.documentElement.dataset.fixtureNow = String(now); }, base + elapsed);
    await worker.evaluate(async ({ now, latestVersion, offline }) => {
      globalThis.__updateFixtureNow = now;
      await chrome.storage.local.set({ testFixtureClock: now, testRemoteRelease: { latestVersion, offline } });
    }, { now: base + elapsed, latestVersion, offline });
  }
  try {
    await until(async () => (await state())?.status === "current", "initial automatic current check");
    assert.equal((await calls()).length, 1); assert.equal(await badge(), "");
    const page = coursePage = await context.newPage(); await page.goto("https://iknow.jp/courses/19053"); await page.bringToFront();
    await until(() => page.evaluate(() => Number(document.documentElement.dataset.fixtureHeartbeats) >= 3), "production 45-second heartbeat");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fixtureInterval), "45000");
    assert.equal((await calls()).length, 1);
    const before = await page.evaluate(() => Number(document.documentElement.dataset.fixtureHeartbeats));
    await configure(45000 - 1);
    await until(() => page.evaluate(before => Number(document.documentElement.dataset.fixtureHeartbeats) >= before + 4, before), "heartbeats before persisted cooldown expires");
    assert.equal((await calls()).length, 1); assert.equal(await badge(), "");
    // Simulate ongoing preparation without starting real model work: metadata
    // discovery must still work; production installation guards are separate.
    await worker.evaluate(() => { globalThis.IKnowReaderUpdateActivity = async () => true; });
    await configure(45000 + 1);
    await until(async () => await badge() === "NEW", "new release discovered by heartbeat without popup/manual check");
    assert.equal((await calls()).length, 2);
    assert.equal((await state()).latestVersion, newer);
    assert.match(await worker.evaluate(() => chrome.action.getTitle({})), new RegExp(newer.replaceAll(".", "\\.")));
    assert.equal(loads, 1); assert.equal(page.url(), "https://iknow.jp/courses/19053");
    assert.equal(context.pages().some(value => value.url().includes("popup.html")), false);
    console.log("PASS An already-current real Brave installation discovers a newly published release from the production visible-page heartbeat, with no popup/manual check/navigation and despite preparation");

    // A normal tab activation after the cooldown resets the shared check time.
    // Forty seconds later the content timer must wait only the remaining five
    // seconds, rather than starting another whole 45-second wait.
    const other = await context.newPage(); await other.goto("about:blank");
    await configure(90002, false, installed); await page.bringToFront();
    await until(async () => (await calls()).length === 3 && (await state()).status === "current", "ordinary tab activity current check");
    assert.equal(await badge(), "");
    await configure(130002);
    await until(() => page.evaluate(() => document.documentElement.dataset.fixtureInterval === "5000"), "heartbeat aligns with five seconds remaining after tab activity");
    assert.equal((await calls()).length, 3); assert.equal(await badge(), "");
    await configure(135003);
    await until(async () => await badge() === "NEW", "aligned heartbeat discovers within one minute of shared check");
    assert.equal((await calls()).length, 4);
    assert.equal((await calls()).at(-1).at - (await calls()).at(-2).at, 45001);
    assert.equal(context.pages().some(value => value.url().includes("popup.html")), false);
    assert.equal(loads, 1); await other.close();
    console.log("PASS A tab-activity check cannot postpone visible-page discovery by an extra interval: the production timer aligns to five seconds remaining and discovers within 45 seconds");

    await configure(180004, true);
    await until(async () => (await calls()).length === 5, "quiet offline automatic retry");
    await pause(120);
    assert.equal(await badge(), "NEW"); assert.equal((await state()).status, "available");
    assert.equal((await state()).latestVersion, newer);
    assert.equal((await state()).discovery.retryIntervalMs, 60000);
    console.log("PASS A failed later background check retains the verified update state and NEW badge");

    // A real browser worker reload, with the fixture wall clock persisted, must
    // restore the cached notice without another network/native check.
    const developer = await context.newPage(); await developer.goto("chrome://extensions/");
    const toggle = developer.locator("#devMode");
    if (!await toggle.evaluate(element => element.checked)) await toggle.click();
    await until(() => toggle.evaluate(element => element.checked), "isolated Developer mode");
    await developer.close();
    const nextWorker = context.waitForEvent("serviceworker", { timeout: 10000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {}); worker = await nextWorker;
    await until(async () => await badge() === "NEW", "cached notice restored by real worker reload");
    assert.equal((await state()).latestVersion, newer); assert.equal((await calls()).length, 5);
    assert.deepEqual((await calls()).map(value => value.type), Array(5).fill("update:check"));
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.equal(loads, 1);
    const result = { installed, newer, initialCurrent: true, releaseChangedWhileTabStayedOpen: true,
      productionHeartbeatMilliseconds: 45000, productionCooldownMilliseconds: 45000,
      adaptiveRemainingMilliseconds: 5000, tabActivityToNextDiscoveryMilliseconds: 45001,
      noPopupOrManualCheck: true, metadataDuringPreparation: true, offlineNoticeRetained: true,
      realWorkerReloadRetainsNotice: true, nativeChecks: 5,
      fixtureScope: "Native metadata and matching background/content Date.now are controlled; only the real content heartbeat timeout is accelerated. All website traffic is fulfilled locally. No user profile/native host/registry is used." };
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
    console.log("PASS A real extension worker reload restores NEW offline without additional checking, page refresh or loss of saved release state");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
