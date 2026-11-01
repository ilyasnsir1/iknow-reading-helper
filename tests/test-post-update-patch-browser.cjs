"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source = path.resolve(__dirname, "../extension"), out = path.join(__dirname, "post-update-patch-browser-evidence", "run-" + Date.now());
const KEY = "iknowReaderUpdateState", hash = value => createHash("sha256").update(value).digest("hex");
fs.mkdirSync(out, { recursive: true });
const until = async (fn, label) => { const start = Date.now(); while (!await fn()) { if (Date.now() - start > 20000) throw Error("Timed out: " + label); await new Promise(resolve => setTimeout(resolve, 35)); } };
(async () => {
  const extension = require("./fixtures/isolate-extension.cjs")(source, out);
  const notesPath = path.join(extension, "changelog.json"), originalNotes = fs.readFileSync(notesPath);
  assert.equal(JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8")).version, "1.41.2");
  assert.equal(JSON.parse(originalNotes).entries[0].version, "1.41.1", "Use the actual patch package's previous release notes without changing their JSON");

  fs.writeFileSync(path.join(extension, "patch-reader-native-fixture.js"), `chrome.runtime.connectNative=()=>{const listeners=[];let open=true;return{onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener(){}},disconnect(){open=false;},postMessage(message){(async()=>{const previous=(await chrome.storage.local.get("testNativeCalls")).testNativeCalls||[];await chrome.storage.local.set({testNativeCalls:[...previous,{type:message.type,action:message.action}]});if(open)listeners.forEach(fn=>fn({type:"changelog:author:result",requestId:message.requestId,ok:true,available:false,role:"reader"}));})();}};};`);
  const background = path.join(extension, "background.js");
  fs.writeFileSync(background, 'importScripts("patch-reader-native-fixture.js");\n' + fs.readFileSync(background, "utf8"));
  const context = await chromium.launchPersistentContext(path.join(out, "profile"), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true,
    ignoreDefaultArgs: ["--disable-extensions"], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1200, height: 900 }, reducedMotion: "reduce"
  });
  const errors = [], loads = new Map(), external = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route("https://**/*", async route => {
    const request = route.request(), url = request.url();
    if (["https://iknow.jp/courses/19053", "https://ja.iknow.jp/series/3318", "https://example.test/"].includes(url) && request.isNavigationRequest()) {
      const count = (loads.get(url) || 0) + 1; loads.set(url, count);
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><h1>Local website fixture</h1><p>${count}</p></body></html>` });
    }
    external.push(url); return route.abort();
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  try {
    await worker.evaluate(() => chrome.storage.local.set({ iknowReaderSettings: { enabled: false } }));
    const developer = await context.newPage(); await developer.goto("chrome://extensions/");
    const toggle = developer.locator("#devMode");
    if (!await toggle.evaluate(element => element.checked)) await toggle.click();
    await until(() => toggle.evaluate(element => element.checked), "isolated Developer mode"); await developer.close();
    const urls = ["https://iknow.jp/courses/19053", "https://ja.iknow.jp/series/3318", "https://example.test/"];
    for (const url of urls) { const page = await context.newPage(); await page.goto(url); }
    assert.deepEqual(urls.map(url => loads.get(url)), [1, 1, 1]);
    const retained = { theme: "forest", audio: 37, course: { saved: true, sentences: 200 }, word: "word:19053:fixture" };
    await worker.evaluate(async ({ KEY, retained }) => {
      await chrome.storage.local.set({
        [KEY]: { status: "current", currentVersion: "1.41.2", latestVersion: "1.41.2", autoRefreshTarget: "1.41.2", autoRefreshCompleteVersion: "1.41.2", changelogTarget: "1.41.2", refreshTabs: false, lastAttemptAt: Date.now() },
        testRetainedSettings: retained, iknowReaderSettings: { enabled: false }, iknowReaderTheme: "forest"
      });
    }, { KEY, retained });
    let opened = 0; context.on("page", () => opened++);
    const next = context.waitForEvent("serviceworker", { timeout: 15000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {}); worker = await next;
    const id = new URL(worker.url()).host, notesURL = `chrome-extension://${id}/changelog.html#study-refinements`;
    await until(() => context.pages().some(page => page.url() === notesURL), "recovered patch notes tab");
    const notes = context.pages().find(page => page.url() === notesURL);
    await until(() => notes.locator("#study-refinements .release-version").textContent().then(value => value === "Version 1.41.2"), "installed patch version");
    assert.equal(await notes.locator("#changelog-installed").textContent(), "Installed · 1.41.2");
    assert.equal(await notes.locator("#study-refinements .release-date").getAttribute("datetime"), "2026-11-01", "The original notes keep their historical date");
    assert.equal(await notes.locator("#edit-changelog").isHidden(), true);
    assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url), notesURL, "Recovered notes are focused");
    assert.equal(opened, 1);
    const state = await worker.evaluate(async KEY => (await chrome.storage.local.get(KEY))[KEY], KEY);
    assert.equal(state.changelogOpenedVersion, "1.41.2", "Claim the installed patch rather than its fallback notes version");
    assert.equal(state.autoRefreshCompleteVersion, "1.41.2"); assert.equal(state.refreshTabs, false);
    assert.deepEqual(urls.map(url => loads.get(url)), [1, 1, 1], "Already-refreshed iKnow and unrelated tabs never reload");
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("testRetainedSettings")).testRetainedSettings), retained);
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderSettings")).iknowReaderSettings.enabled), false);
    await notes.screenshot({ path: path.join(out, "patch-changelog-range.png") });
    console.log("PASS Real worker restart recovers completed 1.41.2 notes with a focused 1.41.2 Changelog card, no page refresh and retained settings");
    const beforeSecond = opened, again = context.waitForEvent("serviceworker", { timeout: 15000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {}); worker = await again;
    await until(() => worker.evaluate(async KEY => (await chrome.storage.local.get(KEY))[KEY]?.changelogOpenedVersion === "1.41.2", KEY), "persisted patch notes claim");
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(opened, beforeSecond, "A second actual worker restart creates no duplicate Changelog");
    assert.deepEqual(urls.map(url => loads.get(url)), [1, 1, 1]);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("testRetainedSettings")).testRetainedSettings), retained);
    const native = await worker.evaluate(async () => (await chrome.storage.local.get("testNativeCalls")).testNativeCalls || []);
    assert.ok(native.every(call => call.type === "changelog:author" && call.action === "status"), "Only a fixture-local read-only author availability probe is allowed");
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    assert.equal(hash(fs.readFileSync(notesPath)), hash(originalNotes), "The historical bundled JSON remains byte-for-byte unchanged");
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: true, actualWorkerRestarts: 2, focusedFallbackNotes: true, installedVersion: "1.41.2", notesVersion: "1.41.1", noIKnowRefresh: true, noRepeatedNotes: true, settingsRetained: true, notesJSONUnchanged: true, realNativeConnections: 0, externalRequests: external, nativeFixtureCalls: native, pageErrors: errors }, null, 2));
    console.log("PASS A second real restart preserves the once-only installed-version claim; historical notes, settings and page loads stay unchanged with no real native/network access");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
