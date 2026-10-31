/* Independent checks for the spacious report, using the real 400-answer course. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const Results = require("./study-focus-results.js");
const Catalog = require("../../extension/study-catalog.js");
const Examples = require("./study-result-examples.js");
const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../native-audio-audit/goal-19053.json"), "utf8"));
const catalog = Catalog.normalizeSource(raw, { courseId: "19053" }).records;
const example = Examples.create(catalog, 400);
const unanswered = { ...example.fixture, courseTitle: raw.title, complete: false, pool: catalog, results: [] };
const read = name => fs.readFileSync(path.resolve(__dirname, name), "utf8");
const css = [fs.readFileSync(path.resolve(__dirname, "../../extension/theme.css"), "utf8"), read("study-layouts.css"), read("study-focus.css"), read("study-focus-results.css")].join("\n").replace(/@import[^;]*;/g, "");
const out = path.resolve(__dirname, "../../tests/study-focus-result-space-evidence");
fs.mkdirSync(out, { recursive: true });
const themes = ["paper", "midnight", "tokyo", "forest"];
const viewports = [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }];

async function mount(page, session, options = {}) {
  await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"><style>' + css + '.app-frame{height:calc(100vh - 48px);width:calc(100% - 48px);margin:24px;position:relative;flex:none}</style></head><body><div class="app-frame">' + Results.render(session, options) + '</div></body></html>');
  await page.addScriptTag({ content: read("study-focus-results.js") });
  await page.evaluate(({ session, options }) => {
    globalThis.reportSession = session;
    globalThis.disposeReport = IKnowFocusResults.mount(document.querySelector(".focus-results"), session, options);
  }, { session, options });
}

async function select(page, key) {
  await page.locator(`[data-result-pick="${key}"]`).click();
  assert.equal(await page.locator(".focus-result-selected").getAttribute("data-selected-key"), key);
}

async function metrics(page) {
  return page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const root = document.querySelector(".focus-results");
    const grid = root.querySelector(".focus-result-map-grid");
    const main = root.querySelector(".focus-result-map-main");
    const label = root.querySelector(".focus-result-map-node span");
    const style = getComputedStyle(label);
    return {
      root: rect(root), grid: rect(grid), selected: rect(root.querySelector(".focus-result-selected")),
      actions: [...root.querySelectorAll(".focus-results-actions button")].map(rect),
      tile: rect(root.querySelector(".focus-result-map-node")),
      label: { font: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace, clamp: style.webkitLineClamp },
      gridHorizontalOverflow: grid.scrollWidth - grid.clientWidth,
      mainOverflow: main.scrollHeight - main.clientHeight,
      pageHorizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      visibleRows: Math.floor(grid.clientHeight / root.querySelector(".focus-result-map-node").getBoundingClientRect().height),
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: viewports[0], reducedMotion: "reduce" });
    const errors = [], evidence = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await mount(page, unanswered);
    const snapshot = JSON.stringify(unanswered);
    assert.equal(await page.locator(".focus-result-map-node").count(), 50, "Only 50 of the 400 real answers are mounted per page");
    const selectedRecord = catalog[17];
    await select(page, selectedRecord.key);
    assert.equal(await page.locator(".focus-result-selected h3").innerText(), selectedRecord.japanese, "The selected answer retains the complete source sentence");
    assert.equal(await page.locator(".focus-result-selected .focus-expected-answer dd").innerText(), selectedRecord.english);
    assert.equal((await page.locator(".focus-result-selected").innerText()).match(/not answered/gi)?.length, 1, "The selected unanswered card has one status, without a duplicate in its heading");
    assert.equal(await page.locator(".focus-result-selected-context").innerText(), "Answer 18 of 400", "The selected card does not repeat Word or Sentence");
    assert.equal(await page.locator('.focus-result-stat[data-result="unanswered"] strong').innerText(), "400");

    for (const theme of themes) {
      await page.locator("html").evaluate((node, value) => { node.dataset.ikrTheme = value; }, theme);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.locator(".focus-result-map-main").evaluate(node => { node.scrollTop = 0; });
        const measure = await metrics(page), name = `${theme}-${viewport.width}x${viewport.height}`;
        evidence.push({ name, ...measure });
        assert.ok(measure.pageHorizontalOverflow <= 1, `${name}: the page has no horizontal overflow`);
        assert.ok(measure.gridHorizontalOverflow <= 1, `${name}: larger tiles stay inside the map`);
        assert.ok(measure.tile.height >= 78, `${name}: answer tiles are meaningfully taller than the old 60px tiles`);
        assert.ok(measure.label.font >= 11.5, `${name}: Japanese labels are readable, rather than the old 9px text`);
        assert.notEqual(measure.label.whiteSpace, "nowrap", `${name}: sentence labels can wrap`);
        assert.ok(["2", "3"].includes(measure.label.clamp), `${name}: labels allow two or three lines`);
        if (viewport.width > 760) {
          assert.ok(measure.mainOverflow <= 2, `${name}: a normal selected answer fits without an extra main scrollbar`);
          assert.ok(measure.selected.bottom <= measure.root.bottom + 1, `${name}: selected answer is visible`);
          for (const button of measure.actions) assert.ok(button.top >= measure.root.top && button.bottom <= measure.root.bottom + 1, `${name}: result actions remain visible`);
          const minimumMap = viewport.height >= 1080 ? 340 : viewport.height >= 900 ? 240 : 140;
          assert.ok(measure.grid.height >= minimumMap, `${name}: answer map uses the available screen height`);
          assert.ok(measure.grid.bottom < measure.selected.top, `${name}: the map and selected detail do not overlap`);
        } else {
          assert.ok(measure.columns >= 2 && measure.columns <= 4, `${name}: mobile tiles use a readable column count`);
          assert.ok(measure.grid.height <= 360, `${name}: the mobile map remains bounded`);
          await page.locator('[data-action="result-back-study"]').scrollIntoViewIfNeeded();
          assert.ok(await page.locator('[data-action="result-back-study"]').isVisible(), `${name}: mobile footer is reachable`);
          await page.locator(".focus-result-selected").scrollIntoViewIfNeeded();
          assert.ok(await page.locator(".focus-result-selected h3").isVisible(), `${name}: mobile selected detail is reachable`);
        }
        assert.equal(await page.locator(".focus-result-map-node").count(), 50);
        assert.equal(await page.locator(".focus-result-selected h3").innerText(), selectedRecord.japanese);
        await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: viewport.width <= 760 });
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".focus-result-map-main").evaluate(node => { node.scrollTop = 0; });
    const commonSentence = page.locator(`[data-result-pick="${catalog[1].key}"] span`);
    const wrapped = await commonSentence.evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight, line: parseFloat(getComputedStyle(node).lineHeight) }));
    assert.ok(wrapped.client >= wrapped.line * 1.8, "A complete common Japanese sentence now uses two readable lines");
    assert.ok(wrapped.scroll <= wrapped.client + 1, "The common sentence fits its tile instead of being cut after its first words");
    const keys = [];
    while (true) {
      keys.push(...await page.locator(".focus-result-map-node").evaluateAll(nodes => nodes.map(node => node.dataset.resultPick)));
      if (await page.locator('[data-result-page="next"]').isDisabled()) break;
      await page.locator('[data-result-page="next"]').click();
    }
    assert.deepEqual(keys, unanswered.keys, "All 400 source answers remain in order, with eight pages of 50");
    await select(page, keys.at(-1));
    assert.equal(await page.locator(".focus-result-selected h3").innerText(), catalog.find(record => record.key === keys.at(-1)).japanese);
    assert.equal(await page.evaluate(() => JSON.stringify(reportSession)), snapshot, "Resizing, themes, selection and paging do not rewrite stored answers");
    await page.evaluate(() => disposeReport());

    const mixed = structuredClone({ ...example.fixture, courseTitle: raw.title, pool: catalog });
    mixed.results[1] = { ...mixed.results[1], outcome: "again", submitted: "  unexpected <answer>  ", attempts: 2, attemptsHistory: [{ submitted: "  first try  ", correct: false }, { submitted: "  unexpected <answer>  ", correct: false }] };
    const mixedSnapshot = JSON.stringify(mixed), summary = Results.summarize(mixed);
    await mount(page, mixed);
    await select(page, mixed.keys[1]);
    assert.equal(await page.locator(".focus-result-selected .focus-result-comparison>div:first-child dd").textContent(), "  unexpected <answer>  ", "Submitted text remains verbatim, with whitespace and escaped markup");
    assert.equal(await page.locator(".focus-result-selected .focus-attempt-text").textContent(), "  first try  ", "Earlier attempts remain verbatim");
    assert.equal(await page.locator(".focus-result-selected .focus-result-label").innerText(), "Incorrect");
    for (const [outcome, count] of [["good", summary.firstTry], ["again", summary.missed], ["hard", summary.retried], ["unanswered", summary.unanswered]]) assert.equal(await page.locator(`.focus-result-stat[data-result="${outcome}"] strong`).innerText(), String(count));
    assert.equal(await page.locator(".focus-result-score>strong").innerText(), summary.percent + "%");
    assert.equal(await page.evaluate(() => JSON.stringify(reportSession)), mixedSnapshot);
    await page.evaluate(() => disposeReport());

    await mount(page, { keys: ["kana:a"], results: [], pool: [{ key: "kana:a", japanese: "あ", english: "a" }] }, { rowKind: "Hiragana", showAnswerList: false });
    assert.equal(await page.locator(".focus-result-selected-context").innerText(), "Answer 1 of 1", "Kana uses the same clean selected-card heading");
    assert.equal((await page.locator(".focus-result-selected").innerText()).match(/not answered/gi)?.length, 1);
    assert.deepEqual(errors, [], "No browser errors");
    fs.writeFileSync(path.join(out, "geometry.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log("PASS Spacious reports: real 400-answer course, readable multiline tiles, adaptive map, 50/page, full selected answers, one unanswered status, preserved scores/raw attempts, four themes and desktop/mobile geometry");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
