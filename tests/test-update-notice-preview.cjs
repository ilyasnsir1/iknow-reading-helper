/* Local web preview only: production popup/discovery renderers with explicit
 * simulated API replies. No installed extension, native host or release push. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const address = process.env.IKNOW_PREVIEW_URL || "http://127.0.0.1:52328/";
const origin = new URL(address).origin, out = path.join(__dirname, "update-notice-preview-evidence");
fs.mkdirSync(out, { recursive: true });
const until = async (predicate, label, limit = 10000) => {
  const at = Date.now();
  while (!await predicate()) {
    if (Date.now() - at > limit) throw Error("Timed out: " + label);
    await new Promise(resolve => setTimeout(resolve, 35));
  }
};
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1250, height: 1050 } });
  const errors = [], external = [], badResponses = [], passed = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { external.push(url.href); await route.abort(); }
    else await route.continue();
  });
  const pass = value => { passed.push(value); console.log("PASS", value); };
  try {
    await page.goto(address + (address.includes("?") ? "&" : "?") + "review=notice-test", { waitUntil: "networkidle" });
    const popup = page.frameLocator("#frame"), badge = page.locator("#toolbar-badge");
    const state = () => popup.locator("body").evaluate(() => chrome.runtime.sendMessage({ type: "ikr:update:status" })).then(result => result.state);
    await until(async () => await badge.isVisible() && (await badge.innerText()).trim() === "NEW", "available toolbar badge");
    assert.match(await page.locator("#toolbar-action").getAttribute("title"), /1\.36\.1.*available/i);
    assert.equal(await page.locator("#preview").isVisible(), false);
    await page.locator("#toolbar-action").click();
    await popup.locator("#update-notice").waitFor({ state: "visible" });
    assert.match(await popup.locator("#update-notice-text").innerText(), /Update available.*1\.36\.1/);
    assert.equal(await popup.locator("#update-notice-wrap img, #update-notice-wrap canvas, #update-notice-wrap [class*=fox]").count() > 0, true);
    await page.mouse.move(30, 30);
    await until(async () => await popup.locator(".update-fox-peek").getAttribute("data-phase") === "peek", "fox visibly peeking from the notice");
    await page.screenshot({ path: path.join(out, "01-available.png"), fullPage: true });
    await popup.locator("#update-notice").click();
    await until(() => popup.locator("#app-updates").evaluate(element => document.activeElement === element), "Updates section focus");
    assert.equal((await state()).status, "available");
    assert.equal(await popup.locator("#install-update").isEnabled(), true);
    pass("The local simulated toolbar shows NEW and its version tooltip; opening it shows the production fox notice, whose click focuses Updates without installing");

    await popup.locator("#install-update").click();
    await until(async () => ["downloading", "installing"].includes((await state()).status), "simulated download start");
    await until(async () => { const current = await state(); return current.status === "current" && current.currentVersion === "1.36.1" && current.refreshTabs === false; }, "simulated automatic completion");
    await until(async () => !await badge.isVisible() && !await popup.locator("#update-notice").isVisible(), "notice and badge clear");
    await until(async () => await page.locator('[data-state="installed"]').getAttribute("aria-pressed") === "true", "parent finished-state control");
    assert.equal(await popup.locator("#refresh-updated-tabs").isVisible(), false);
    await page.screenshot({ path: path.join(out, "02-complete.png"), fullPage: true });
    pass("Simulated installation reaches automatic page-refresh completion, clears NEW and the notice, and needs no manual refresh button");

    await page.locator('[data-state="available"]').click();
    await until(async () => await badge.isVisible(), "reset available notice");
    assert.equal((await state()).currentVersion, "1.36.0");
    await page.locator('[data-state="current"]').click();
    await until(async () => !await badge.isVisible(), "current has no badge");
    assert.equal((await state()).currentVersion, "1.36.0");
    await page.locator('[data-state="refreshing"]').click();
    await until(async () => (await state()).refreshTabs === true, "refreshing state");
    assert.equal((await state()).currentVersion, "1.36.1");
    assert.match(await popup.locator("#update-notice-text").innerText(), /Finishing page refresh/);
    await page.locator('[data-state="installed"]').click();
    await until(async () => (await state()).refreshTabs === false, "installed state");
    assert.equal((await state()).currentVersion, "1.36.1");
    assert.equal(await popup.locator("#refresh-updated-tabs").isVisible(), false);
    await page.locator("#play").click();
    await until(async () => { const current = await state(); return current.status === "current" && current.currentVersion === "1.36.1" && current.refreshTabs === false; }, "whole simulated update flow");
    pass("Preview controls reset safely, distinguish loaded/current versus refreshing/installed versions, and replay the complete local flow");

    assert.deepEqual(external, []); assert.deepEqual(badResponses, []); assert.deepEqual(errors, []);
    pass("All requests stay on the local preview origin and the preview has no browser page errors");
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed, externalRequests: external, badResponses, pageErrors: errors, scope: "Web preview of production renderers using simulated toolbar/native replies; no actual notification discovery or installation claimed" }, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
