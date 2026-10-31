/* Deterministic recorder lifecycle checks. No real microphone or audio requests. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const output = path.resolve(__dirname, "../../tests/study-focus-audio-evidence"); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } }), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => requests.push(request.url()));
    await page.route("**/*", route => route.request().url() === "http://127.0.0.1/focus-audio-test" ? route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="panel"></div>' }) : route.abort());
    await page.goto("http://127.0.0.1/focus-audio-test");
    await page.evaluate(() => {
      const fixture = window.fixture = { permission: "grant", pending: [], streams: [], recorders: [], plays: [], created: [], revoked: [], stops: 0, fastLimit: false, hidden: false };
      Object.defineProperty(document, "hidden", { configurable: true, get: () => fixture.hidden });
      const timeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, milliseconds, ...args) => timeout(callback, fixture.fastLimit && milliseconds === 20000 ? 30 : milliseconds, ...args);
      HTMLMediaElement.prototype.play = function () { fixture.plays.push(this.src); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { fixture.stops++; };
      HTMLMediaElement.prototype.load = function () {};
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); fixture.created.push(url); return url; };
      URL.revokeObjectURL = url => { fixture.revoked.push(url); revoke(url); };
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => {
        if (fixture.permission === "deny") return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        const track = { stopped: false, stop() { this.stopped = true; } }, stream = { getTracks: () => [track], track };
        fixture.streams.push(stream);
        return fixture.permission === "pending" ? new Promise(resolve => fixture.pending.push(() => resolve(stream))) : Promise.resolve(stream);
      } } });
      window.MediaRecorder = class extends EventTarget {
        static isTypeSupported() { return true; }
        constructor(stream) { super(); this.stream = stream; this.mimeType = "audio/webm"; this.state = "inactive"; fixture.recorders.push(this); }
        start() { this.state = "recording"; }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          queueMicrotask(() => {
            const event = new Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob(["fixture audio"]) });
            this.dispatchEvent(event); this.dispatchEvent(new Event("stop"));
          });
        }
      };
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "study-focus-audio.js"), "utf8") });
    const mount = key => page.evaluate(key => IKnowFocusAudio.mount(document.getElementById("panel"), { key, audioUrl: "https://assets0.iknow.jp/test.mp3" }), key);
    const action = name => page.locator(`[data-compare-action="${name}"]`);
    const recording = () => page.waitForFunction(() => document.getElementById("panel").dataset.state === "recording");
    const ready = () => page.waitForFunction(() => !document.querySelector('[data-compare-action="take"]').disabled);
    const metrics = () => page.evaluate(() => ({ acquired: fixture.streams.length, released: fixture.streams.filter(s => s.track.stopped).length, recordings: fixture.recorders.length, created: [...fixture.created], revoked: [...fixture.revoked], plays: [...fixture.plays] }));
    await mount("word:1"); assert.equal((await metrics()).acquired, 0); assert.equal(await action("take").isDisabled(), true);
    // Cancel a permission prompt, then resolve it late. It must not start recording.
    await page.evaluate(() => fixture.permission = "pending"); await action("record").click(); await action("record").click();
    await page.evaluate(() => fixture.pending.shift()()); await page.waitForFunction(() => fixture.streams[0].track.stopped);
    assert.equal((await metrics()).recordings, 0);
    // Record, stop, play both sources and retain only a finished take across rerender.
    await page.evaluate(() => fixture.permission = "grant"); await action("record").click(); await recording();
    assert.equal(await action("original").isDisabled(), true); await action("stop").click(); await ready();
    assert.equal((await metrics()).acquired, (await metrics()).released);
    await action("take").click(); assert.match((await metrics()).plays.at(-1), /^blob:/);
    await action("original").click(); assert.equal((await metrics()).plays.at(-1), "https://assets0.iknow.jp/test.mp3");
    const takeUrl = (await metrics()).created.at(-1);
    await page.evaluate(() => IKnowFocusAudio.unmount()); await mount("word:1");
    assert.equal(await action("take").isDisabled(), false); assert.equal((await metrics()).revoked.includes(takeUrl), false);
    // A hidden page finishes a recording and releases the mic, without restarting.
    await action("record").click(); await recording();
    assert.equal(await page.evaluate(() => { fixture.hidden = true; document.dispatchEvent(new Event("visibilitychange")); IKnowFocusAudio.stopMedia(); return document.getElementById("panel").dataset.state; }), "finishing", "Repeated stops keep finishing controls locked until onstop"); await ready();
    assert.equal((await metrics()).acquired, (await metrics()).released); assert.equal((await metrics()).revoked.includes(takeUrl), true);
    const acquisitions = (await metrics()).acquired;
    await page.evaluate(() => { fixture.hidden = false; document.dispatchEvent(new Event("visibilitychange")); }); assert.equal((await metrics()).acquired, acquisitions);
    // Item changes revoke takes and invalidate permission callbacks from old items.
    await page.evaluate(() => fixture.permission = "pending"); await action("record").click(); await mount("word:2");
    await page.evaluate(() => fixture.pending.shift()()); await page.waitForFunction(() => fixture.streams.every(s => s.track.stopped));
    assert.equal(await action("take").isDisabled(), true); assert.equal((await metrics()).created.length, (await metrics()).revoked.length);
    // Denial and recorder errors recover controls and do not leak tracks.
    await page.evaluate(() => fixture.permission = "deny"); await action("record").click(); await page.locator(".focus-compare-status").filter({ hasText: "denied" }).waitFor();
    await page.evaluate(() => fixture.permission = "grant"); await action("record").click(); await recording();
    await page.evaluate(() => fixture.recorders.at(-1).dispatchEvent(new Event("error")));
    await page.locator(".focus-compare-status").filter({ hasText: "Recording failed" }).waitFor(); assert.equal((await metrics()).acquired, (await metrics()).released);
    // Twenty-second cap uses the same normal finishing path.
    await page.evaluate(() => fixture.fastLimit = true); await action("record").click(); await ready();
    assert.equal((await metrics()).acquired, (await metrics()).released);
    await action("discard").click(); assert.equal(await action("take").isDisabled(), true); assert.equal((await metrics()).created.length, (await metrics()).revoked.length);
    // Browser support failure is visible rather than a broken active control.
    await page.evaluate(() => { IKnowFocusAudio.reset(); window.MediaRecorder = undefined; }); await mount("word:3");
    assert.equal(await action("record").isDisabled(), true); assert.match(await page.locator(".focus-compare-status").innerText(), /unavailable/);
    await page.evaluate(() => IKnowFocusAudio.reset());
    assert.deepEqual(errors, []); assert.deepEqual(requests, ["http://127.0.0.1/focus-audio-test"]);
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ passed: true, metrics: await metrics(), pageErrors: errors }, null, 2));
    console.log("PASS Focus compare: explicit microphone access, late permission cancellation, local take/original playback, 20s cap, item/visibility/unmount cleanup, denied/error/support recovery and no uploads");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
