/* Isolated production extension: particle display changes without rewriting
 * source text, prepared records, existing audio targets or Study reveal state. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const Core = require("../extension/core.js");
const out = path.join(__dirname, "romaji-style-browser-evidence"); fs.mkdirSync(out, { recursive: true });
const until = async (fn, label) => { const started = Date.now(); while (!await fn()) { if (Date.now() - started > 14000) throw Error("Timed out: " + label); await new Promise(resolve => setTimeout(resolve, 30)); } };
const sentences = [
  { cue: { id: 991001, text: "それはとてもいい話だ。", transliterations: { Jpan: "それ は とても いい 話 だ 。", Hrkt: "それ は とても いい はなし だ。", Latn: "sore ha totemo ii hanashi da." } }, response: { text: "That's a really nice story." }, sound: "https://assets0.iknow.jp/assets/romaji-fixture.wav" },
  { cue: { id: 991002, text: "私は学校へ行きます。", transliterations: { Jpan: "私 は 学校 へ 行きます 。", Hrkt: "わたし は がっこう へ いきます。", Latn: "watashi ha gakkou he ikimasu." } }, response: { text: "I go to school." }, sound: "https://assets0.iknow.jp/assets/romaji-fixture.wav" },
  { cue: { id: 991003, text: "歯を磨く。", transliterations: { Jpan: "歯 を 磨く 。", Hrkt: "は を みがく。", Latn: "ha wo migaku." } }, response: { text: "Brush your teeth." }, sound: "https://assets0.iknow.jp/assets/romaji-fixture.wav" }
];
const goal = { id: 19053, title: "Particle spelling fixture", cue_language: "ja", items_count: 1, sentences_count: sentences.length, goal_items: [{ item: { id: 99100, cue: { id: 99100, text: "歯", transliterations: { Jpan: "歯", Hrkt: "は", Latn: "ha" } }, response: { text: "tooth" } }, sentences, sound: sentences[0].sound }] };
const sentenceHTML = sentence => `<div class="sentence"><button class="sentence-audio-container" type="button">Sentence speaker</button><div class="sentence-text"><p class="text">${sentence.cue.text}</p><p class="transliteration">${sentence.cue.transliterations.Hrkt}</p><p class="translation">${sentence.response.text}</p></div></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.5 Arial;margin:20px}.item{display:grid;grid-template-columns:220px 1fr}.sentence{margin:0 0 20px;padding:10px}.sentence p{margin:4px 0}.item-details{padding:10px}</style><div class="course-content-container"><div class="course-content"><div class="items"><div class="item"><div class="item-details"><div class="cue-response"><a class="cue" href="/items/99100">歯</a><p class="response">tooth</p></div></div><div class="item-sentences">${sentences.map(sentenceHTML).join("")}</div></div></div></div></div><script>window.nativeClicks=0;document.querySelectorAll('.sentence-audio-container').forEach(node=>node.addEventListener('click',()=>{window.nativeClicks++}));</script>`;

(async () => {
  const extension = require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname, "../extension"), out);
  const context = await chromium.launchPersistentContext(path.join(out, "profile-" + Date.now()), { executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`], viewport: { width: 1200, height: 1050 } });
  const errors = [], external = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route("https://**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "iknow.jp" && url.pathname === "/courses/19053") return route.fulfill({ contentType: "text/html", body: html });
    if (url.hostname === "iknow.jp" && url.pathname === "/api/v2/goals/19053") return route.fulfill({ contentType: "application/json", body: JSON.stringify(goal) });
    external.push(url.href); return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
  try {
    const expected = Core.expectedSource(goal);
    const pack = { format: "iknow-reader-course", schemaVersion: 1, course: { id: 19053, title: goal.title, wordCount: 1, sentenceCount: sentences.length }, alignments: Object.fromEntries(sentences.map(sentence => [sentence.cue.id, { signature: expected.sentences[sentence.cue.id].signature, groups: [{ ja: [[0, 1]], en: [[0, 1]], tokens: [0] }] }])), germanItems: {}, audio: {} };
    await worker.evaluate(pack => chrome.storage.local.set({ iknowReaderSettings: { pronunciation: true, colorMode: "all", groupInfo: true }, iknowReaderCoursePacks: { 19053: pack } }), pack);
    const course = await context.newPage(); await course.goto("https://iknow.jp/courses/19053");
    await course.locator('[data-setting="romajiStyle"]').waitFor();
    await until(async () => await course.locator(".ikr-sentence-line").count() === sentences.length, "sentence render");
    const readings = () => course.locator(".ikr-sentence-line").allTextContents().then(values => values.map(value => value.trim()));
    assert.equal(await course.locator('[data-setting="romajiStyle"]').inputValue(), "source", "legacy pronunciation flag must not opt into the new mode");
    assert.deepEqual(await readings(), sentences.map(sentence => sentence.cue.transliterations.Latn));
    const originalJapanese = await course.locator(".sentence-text>.text").allTextContents(), originalKana = await course.locator(".transliteration").allTextContents();
    await course.evaluate(() => { window.originalReadingSpans = [...document.querySelectorAll(".ikr-sentence-line>span")]; window.originalSpeakers = [...document.querySelectorAll(".sentence-audio-container")]; window.originalGroupNodes = [...document.querySelectorAll(".ikr-group")]; });
    await course.locator('[data-setting="romajiStyle"]').selectOption("spoken");
    await until(async () => (await readings())[0] === "sore wa totemo ii hanashi da.", "spoken particle display");
    assert.deepEqual(await readings(), ["sore wa totemo ii hanashi da.", "watashi wa gakkou e ikimasu.", "ha o migaku."]);
    assert.equal(await course.locator(".ikr-item-line").innerText(), "ha", "vocabulary ha remains a tooth reading");
    assert.deepEqual(await course.locator(".sentence-text>.text").allTextContents(), originalJapanese);
    assert.deepEqual(await course.locator(".transliteration").allTextContents(), originalKana);
    assert.equal(await course.evaluate(() => originalReadingSpans.every((node, index) => node === document.querySelectorAll(".ikr-sentence-line>span")[index]) && originalSpeakers.every((node, index) => node === document.querySelectorAll(".sentence-audio-container")[index]) && originalGroupNodes.every((node, index) => node === document.querySelectorAll(".ikr-group")[index])), true, "mode switch updates existing display nodes");
    await course.locator(".sentence-audio-container").first().click(); assert.equal(await course.evaluate(() => nativeClicks), 1, "native speaker receives the click");
    await until(() => worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderSettings")).iknowReaderSettings.romajiStyle === "spoken"), "course preference persisted");
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderCoursePacks")).iknowReaderCoursePacks), { 19053: pack }, "display choice does not rewrite prepared source/cache");
    await course.screenshot({ path: path.join(out, "01-spoken-course.png"), fullPage: true });
    console.log("PASS Course particle readings switch in place; Japanese, Kana, lexical readings, cache and native speaker controls stay intact");

    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await until(async () => await popup.locator("#romajiStyle").isEnabled(), "popup settings loaded"); assert.equal(await popup.locator("#romajiStyle").inputValue(), "spoken");
    await popup.locator("#romajiStyle").selectOption("source"); await until(async () => (await readings())[0] === sentences[0].cue.transliterations.Latn, "popup choice reaches course");
    await course.locator(".sentence .ikr-study-tools button").first().click();
    await until(() => worker.evaluate(async () => Boolean((await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary?.records?.["sentence:19053:991001"])), "sentence saved");
    const saved = await worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records["sentence:19053:991001"]);
    assert.equal(saved.romaji, sentences[0].cue.transliterations.Latn); assert.equal(saved.jpan, sentences[0].cue.transliterations.Jpan);
    const study = await context.newPage(); await study.goto(`chrome-extension://${id}/study.html?course=19053&item=sentence%3A19053%3A991001`); await study.locator("#romaji button").first().waitFor();
    await study.locator("#romaji button").nth(1).click();
    assert.equal(await study.locator("#romaji button").nth(1).innerText(), "ha");
    const revealed = await study.locator("#romaji button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-pressed")));
    await popup.locator("#romajiStyle").selectOption("spoken");
    await until(async () => await study.locator("#romaji button").nth(1).innerText() === "wa", "Study preference synchronization");
    assert.deepEqual(await study.locator("#romaji button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-pressed"))), revealed, "style switch retains individual revealed/hidden choices");
    assert.equal(await study.locator("#romaji button").first().innerText(), "•••");
    await study.locator("#reveal-all").click(); assert.deepEqual(await study.locator("#romaji button").allTextContents(), ["sore", "wa", "totemo", "ii", "hanashi", "da."]);
    await popup.locator("#romajiStyle").selectOption("source");
    await until(async () => await study.locator("#romaji button").nth(1).innerText() === "ha", "Study source restoration");
    await course.reload(); await course.locator('[data-setting="romajiStyle"]').waitFor(); assert.equal(await course.locator('[data-setting="romajiStyle"]').inputValue(), "source");
    await until(async () => (await readings())[0] === sentences[0].cue.transliterations.Latn, "source style survives refresh");
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records["sentence:19053:991001"].romaji), sentences[0].cue.transliterations.Latn);
    await study.screenshot({ path: path.join(out, "02-source-study.png"), fullPage: true });
    console.log("PASS Popup/course/Study share the preference, refresh retains it, Study keeps reveal choices and stored source Romaji remains untouched");
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: true, scope: "Real isolated extension with explicit course/cache fixtures; no native host or model", externalRequests: external, pageErrors: errors }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
