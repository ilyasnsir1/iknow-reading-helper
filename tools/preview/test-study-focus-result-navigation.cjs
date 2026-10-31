/* Completed reports allow rail navigation; active exercises remain locked. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../native-audio-audit/goal-19053.json"), "utf8"));
fixture.goal_items = fixture.goal_items.slice(0, 3);
const controller = fs.readFileSync(path.join(__dirname, "study-focus.js"), "utf8");
const targets = ["study", "practice", "test", "kana", "library"];
const scenarios = ["practice-early", "practice-complete", "test-early", "test-complete", "targeted-complete"];

(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
  const errors = [], mutations = [], checked = [];
  try {
    for (const scenario of scenarios) for (const target of targets) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      try {
        const page = await context.newPage();
        page.on("pageerror", error => errors.push(`${scenario}/${target}: ${error.message}`));
        page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.url()); });
        // Exercise the canonical controller, independently of preview staging.
        await page.route("**/study-focus.js", route => route.fulfill({ contentType: "application/javascript", body: controller }));
        await page.route("**/catalog-source.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }));
        await page.goto("http://127.0.0.1:52332/study-focus.html?review=result-navigation");
        await page.locator(".focus-card").waitFor();
        const records = await page.evaluate(async () => IKnowReaderStudyCatalog.normalizeSource(await (await fetch("/catalog-source.json")).json(), { courseId: "19053" }).records);
        const words = records.filter(record => record.kind === "word");

        // Keep a deliberate saved selection separate from every course test.
        await page.locator('.focus-rail [data-view="practice"]').click();
        await page.locator('[data-action="choose"]').click();
        await page.locator('[data-action="clear-selection"]').click();
        const chosen = page.locator('.picker-list .library-row[data-item^="word:"]').first();
        const savedKey = await chosen.getAttribute("data-item");
        await chosen.click();
        await page.locator('[data-action="close-picker"]').click();
        if (!scenario.startsWith("practice")) await page.locator('.focus-rail [data-view="test"]').click();
        await page.locator('[data-action="start"]').click();
        await page.locator(".session-progress").waitFor();

        const progress = await page.locator(".session-progress span").innerText();
        assert.equal(await page.locator(".focus-rail").evaluate(node => node.inert), true, "Active exercises keep their rail locked");
        for (const value of targets) await page.locator(value === "library" ? '.focus-rail [data-action="browse"]' : `.focus-rail [data-view="${value}"]`).evaluate(node => node.click());
        assert.equal(await page.locator(".session-progress span").innerText(), progress, "Even scripted rail clicks cannot abandon an active question");

        async function answer(correct) {
          const japanese = await page.locator(".session-word").innerText();
          const key = words.find(record => record.japanese === japanese)?.key;
          assert.ok(key, `Expected a known review question: ${japanese}`);
          await page.locator(correct ? `[data-review="${key}"]` : `[data-review]:not([data-review="${key}"])`).first().click();
          await page.locator("#demo-solution").waitFor();
          await page.locator('[data-action="next-question"]').click();
        }
        if (scenario.endsWith("early")) await page.locator('[data-action="end-session"]').click();
        else if (scenario === "practice-complete") await answer(true);
        else for (let index = 0; index < words.length; index++) await answer(index !== 0);
        await page.locator(".focus-results").waitFor();

        if (scenario === "targeted-complete") {
          const original = await page.locator(".focus-result-score").innerText();
          await page.locator('[data-action="result-practice-mistakes"]').click();
          await answer(true);
          await page.locator('[data-action="result-test-report"]').click();
          assert.equal(await page.locator(".focus-result-score").innerText(), original, "Targeted practice retains the original test report and grades");
          await page.locator('[data-action="result-practice-mistakes"]').click();
          await answer(true);
          await page.locator(".focus-results").waitFor();
        }

        assert.equal(await page.locator(".focus-rail").evaluate(node => node.inert), false, "Completed reports expose rail navigation");
        assert.equal(await page.locator(".focus-body").evaluate(node => node.inert), true, "The report still conceals underlying exercise/library controls");
        await page.locator(target === "library" ? '.focus-rail [data-action="browse"]' : `.focus-rail [data-view="${target}"]`).click();
        assert.equal(await page.locator(".focus-results").count(), 0, `${scenario}: ${target} leaves the report`);
        assert.equal(await page.locator(".session-screen").count(), 0);
        assert.equal(await page.locator(".overlay,.drawer").count(), 0, "No stale setup or picker overlay survives");
        assert.equal(await page.locator(".focus-body").evaluate(node => node.inert), false);
        if (target === "study" || target === "library") assert.equal(await page.locator(".focus-card").isVisible(), true);
        if (target === "library") {
          assert.equal(await page.locator("#focus-library").isVisible(), true, "Library from a report always opens the library");
          assert.equal(await page.locator('.focus-rail [data-view="study"]').getAttribute("aria-pressed"), "true");
        }
        if (target === "practice") assert.equal(await page.locator(".activity-heading h2").innerText(), "Practice");
        if (target === "test") {
          assert.equal(await page.locator(".activity-heading h2").innerText(), "Course test");
          await page.locator('[data-action="start"]:not([disabled])').waitFor();
          assert.equal((await page.locator("#demo-test-total").innerText()).trim(), `(${words.length})`, "Course pool remains intact");
        }
        if (target === "kana") assert.equal(await page.locator('[data-kana-root][data-kana-mode="chart"]').isVisible(), true);

        await page.locator('.focus-rail [data-view="practice"]').click();
        await page.locator('[data-action="choose"]').click();
        assert.deepEqual(await page.locator('.picker-list .library-row:has(input:checked)').evaluateAll(nodes => nodes.map(node => node.dataset.item)), [savedKey], "Leaving reports preserves the saved practice selection");
        checked.push(`${scenario} → ${target}`);
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations, [], "Result navigation never starts preparation or writes a remote job");
    console.log(`PASS result rail navigation: ${checked.length} completed/early/targeted report routes; active locks, retained score/selection/pool, no job writes`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
