/* Full-course result examples use real source identities, never real grades. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {chromium} = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out = path.resolve(__dirname, "../../tests/study-result-large-evidence");
fs.mkdirSync(out, {recursive:true});
const themes = ["paper", "midnight", "tokyo", "forest"];
const base = "http://127.0.0.1:52332";

async function summary(page) {
  return page.evaluate(() => {
    const s = IKnowResultsDesignDemo.summary();
    return {total:s.total, firstTry:s.firstTry, missed:s.missed, percent:s.percent,
      keys:s.rows.map(r => r.key), rows:s.rows};
  });
}
async function assertScore(page, size) {
  const s = await summary(page);
  assert.deepEqual({total:s.total, firstTry:s.firstTry, missed:s.missed, percent:s.percent},
    {total:size, firstTry:Math.round(size * .67), missed:size - Math.round(size * .67), percent:67});
  assert.equal((await page.locator("[data-demo-percent]").innerText()).replace(/\s/g, ""), "67%");
  return s;
}
async function chooseTheme(page, theme) {
  await page.locator("#focus-theme-trigger").click();
  await page.locator('.focus-menu-theme [data-menu-value="' + theme + '"]').click();
  assert.equal(await page.locator("html").getAttribute("data-ikr-theme"), theme);
}
async function allVisiblePages(page) {
  const keys = [];
  for (let guard = 0; guard < 12; guard++) {
    const nodes = page.locator(".map-node");
    assert.ok(await nodes.count() <= 50, "The answer map renders at most 50 cards per page");
    keys.push(...await nodes.evaluateAll(ns => ns.map(n => n.dataset.resultPick)));
    if (await page.locator('[data-map-page="next"]').isDisabled()) return keys;
    await page.locator('[data-map-page="next"]').click();
  }
  throw Error("Pagination did not finish within the complete example size");
}
async function selected(page) {
  return page.locator(".map-selected").innerText();
}

(async () => {
  const browser = await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1280,height:720}, reducedMotion:"reduce"});
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => requests.push({url:r.url(), method:r.method()}));
    await page.addInitScript(() => localStorage.setItem("ikr-results-qa:sentinel", "unchanged"));
    await page.goto(base + "/study-result-designs.html?layout=map&size=200");
    await page.locator(".map-node").first().waitFor();
    assert.equal(await page.locator("#results-example-size").inputValue(), "200");
    assert.match(await page.locator(".results-review-bar").innerText(), /EXAMPLE RESULTS/);
    const source = await page.evaluate(async () => IKnowReaderStudyCatalog.normalizeSource(await (await fetch("/catalog-source.json")).json()).records);
    const sourceByKey = new Map(source.map(r => [r.key, r]));
    const metrics = [];

    for (const size of [200,400]) {
      if (size !== 200) await page.locator("#results-example-size").selectOption(String(size));
      const stats = await assertScore(page, size);
      assert.equal(new Set(stats.keys).size, size, "Every result has its own actual source identity");
      for (const row of stats.rows) {
        assert.ok(sourceByKey.has(row.key), "Result keys come from the full real course, not cloned cards");
        assert.equal(row.japanese, sourceByKey.get(row.key).japanese);
        assert.ok(row.japanese.length > 0);
      }
      const expectedWords = source.filter(r => r.kind === "word");
      assert.equal(stats.rows.filter(r => sourceByKey.get(r.key).kind === "word").length, 200);
      if (size === 200) assert.deepEqual(stats.keys, expectedWords.map(r => r.key), "The 200 example includes all course vocabulary in source order");
      else assert.equal(stats.rows.filter(r => sourceByKey.get(r.key).kind === "sentence").length, 200);

      const originalDetail = await selected(page);
      const browsed = await allVisiblePages(page);
      assert.deepEqual(browsed, stats.keys, "Pagination exposes every answer exactly once, including the last answer");
      assert.equal(await selected(page), originalDetail, "Browsing map pages preserves the selected answer details");
      assert.match(await page.locator("#map-page-label").innerText(), new RegExp(String(size)));
      const map = page.locator(".session-map");
      await map.evaluate(n => { n.scrollTop = n.scrollHeight; });
      const beforeScroll = await map.evaluate(n => n.scrollTop);
      await page.locator(".map-node").last().click();
      const last = stats.rows[size - 1];
      assert.equal(await page.locator(".map-selected-heading h3").innerText(), last.japanese);
      assert.equal(await page.locator(".map-selected .expected dd").innerText(), last.expected);
      assert.equal(await page.locator(".map-node[aria-current=true]").getAttribute("data-result-pick"), last.key);
      assert.ok(Math.abs((await page.locator(".session-map").evaluate(n => n.scrollTop)) - beforeScroll) <= 1,
        "Picking a card preserves the map's internal scroll position");
      const retained = await selected(page);

      await page.locator("#map-filter").selectOption("review");
      assert.equal(await selected(page), retained, "A filter never silently substitutes a different selected answer");
      assert.ok(await page.locator('[data-map-page="previous"]').isDisabled(), "Changing filters starts at the first results page");
      assert.equal(await page.locator('.map-node:not([data-state="again"])').count(), 0);
      const misses = await allVisiblePages(page);
      assert.deepEqual(misses, stats.rows.filter(r => r.outcome === "again").map(r => r.key));
      assert.equal(misses.length, size === 200 ? 66 : 132);
      await assertScore(page, size);

      await page.locator("#map-filter").selectOption("all");
      const uniqueSearch = stats.rows.find(row => stats.rows.filter(r => r.japanese.includes(row.japanese)).length === 1);
      assert.ok(uniqueSearch, "The source contains a searchable unique Japanese form");
      await page.locator("#map-search").fill(uniqueSearch.japanese);
      assert.equal(await page.locator(".map-node").count(), 1);
      assert.equal(await page.locator(".map-node").getAttribute("data-result-pick"), uniqueSearch.key);
      assert.equal(await selected(page), retained, "Search preserves the selected answer details");
      await page.locator("#map-search").fill("no-matching-answer-qa-947");
      assert.equal(await page.locator(".map-node").count(), 0);
      assert.equal(await selected(page), retained);
      await assertScore(page, size);
      await page.locator("#map-search").fill("");
      assert.equal(await page.locator(".map-node").count(), 50);

      for (const theme of themes) {
        await chooseTheme(page, theme);
        for (const viewport of [{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]) {
          await page.setViewportSize(viewport);
          const geometry = await page.evaluate(() => {
            const box = sel => {const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
            return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
              map:box(".session-map"),score:box("[data-demo-percent]"),panels:[...document.querySelectorAll(".map-main,.map-sidebar,.map-selected")].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right};})};
          });
          assert.ok(geometry.scrollWidth <= geometry.width + 1, `${size}/${theme}/${viewport.width}: no horizontal page overflow`);
          assert.ok(geometry.panels.every(r => r.left >= -1 && r.right <= geometry.width + 1), "Panels do not clip off-screen on mobile");
          assert.ok(geometry.map.height <= 220, "Large maps keep a bounded viewport");
          if (viewport.width > 760) {
            assert.ok(geometry.scrollHeight <= geometry.height + 1, "Desktop results stay within the app frame");
            assert.ok(geometry.score.y >= 0 && geometry.score.bottom <= geometry.height, "The global score stays visible on desktop");
          }
          await assertScore(page, size);
          await page.screenshot({path:path.join(out, `map-${size}-${theme}-${viewport.width}.png`),fullPage:viewport.width<760});
          metrics.push({size,theme,viewport,geometry});
        }
        await page.setViewportSize({width:1280,height:720});
      }
    }

    await page.locator("#results-example-size").selectOption("9");
    for (const layout of ["report","review","map"]) {
      await page.locator('[data-result-design="' + layout + '"]').click();
      const s = await assertScore(page, 9);
      assert.equal(s.rows.length, 9);
      assert.equal(await page.locator(".result-content").getAttribute("data-layout-choice"), layout);
    }
    assert.equal(await page.evaluate(() => IKnowResultsDesignDemo.example), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("ikr-results-qa:sentinel")), "unchanged");
    const storageKeys = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(storageKeys.every(k => ["ikr-results-qa:sentinel","ikr-results-review:theme"].includes(k)), "The example creates no test/library/preparation storage");
    assert.deepEqual(requests.filter(r => r.method !== "GET"), [], "No preparation, model, or other write requests");
    assert.ok(requests.every(r => new URL(r.url).origin === base), "No external or native-helper requests");
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out,"results.json"), JSON.stringify({passed:true,scope:"Source-backed 200/400 results, bounded 50-card pagination, search/filter, stable selected detail/scroll, global counts, all four themes and three viewports, unchanged 9-item layouts and no user-data writes",metrics},null,2));
    console.log("PASS Large result C: real 200/400 course answers, 50-card pages, last-answer access, 66/132 misses, search, stable detail/scroll and global score; 4 themes × 3 viewports; no preparation jobs or grade writes");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
