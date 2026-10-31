/* Header listboxes stay in the app palette. No installed extension is used. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out = path.resolve(__dirname, "../../tests/study-focus-menus-evidence"); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 520 }, reducedMotion: "reduce" }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"></head><body><header id="header"></header><button id="after">Next action</button><main id="outside">Outside</main></body></html>');
    await page.addStyleTag({ path: path.resolve(__dirname, "../../extension/theme.css") });
    await page.addStyleTag({ path: path.join(__dirname, "study-focus-menus.css") });
    await page.addStyleTag({ content: 'body{margin:0;padding:25px;background:var(--ikr-bg);color:var(--ikr-text);font:13px/1.5 system-ui}header{display:flex;gap:12px;justify-content:flex-end}button{font:inherit}main{height:250px;padding-top:100px}[hidden]{display:none!important}' });
    await page.addScriptTag({ path: path.join(__dirname, "study-focus-menus.js") });
    await page.evaluate(() => {
      window.calls = []; window.draw = disabled => {
        document.getElementById("header").innerHTML = IKnowFocusMenus.render({ theme: document.documentElement.dataset.ikrTheme, language: window.language || "en", languageDisabled: disabled });
        IKnowFocusMenus.mount(document.getElementById("header"), {
          onTheme: value => { document.documentElement.dataset.ikrTheme = value; calls.push(["theme", value]); },
          onLanguage: value => { window.language = value; calls.push(["language", value]); draw(); }
        });
      }; draw();
    });
    const trigger = kind => page.locator(`#focus-${kind}-trigger`), list = kind => page.locator(`#focus-${kind}-list`);
    assert.equal(await page.locator("select").count(), 0);
    assert.equal((await trigger("language").boundingBox()).width, 92);
    assert.equal((await trigger("theme").boundingBox()).width, 136);
    for (const theme of ["paper", "midnight", "tokyo", "forest"]) {
      await page.evaluate(theme => { document.documentElement.dataset.ikrTheme = theme; draw(); }, theme);
      await trigger("theme").click(); assert.equal(await trigger("theme").getAttribute("aria-expanded"), "true");
      const colors = await list("theme").evaluate(node => {
        const expected = document.createElement("i"); expected.style.background = "var(--ikr-elevated)"; document.body.append(expected);
        const result = { actual: getComputedStyle(node).backgroundColor, expected: getComputedStyle(expected).backgroundColor, ink: getComputedStyle(node).color }; expected.remove(); return result;
      });
      assert.equal(colors.actual, colors.expected); assert.notEqual(colors.ink, colors.actual);
      assert.equal(await list("theme").getAttribute("role"), "listbox");
      assert.equal(await list("theme").locator('[aria-selected="true"]').getAttribute("data-menu-value"), theme);
      await page.screenshot({ path: path.join(out, theme + "-theme-menu.png") });
      await page.locator("#outside").click(); assert.equal(await list("theme").isVisible(), false);
    }
    await trigger("theme").click(); await page.locator('.focus-menu-theme [data-menu-value="midnight"]').click();
    assert.equal(await trigger("theme").innerText(), "Midnight"); assert.equal(await trigger("theme").evaluate(n => getComputedStyle(n).boxShadow), "none");
    assert.equal(await page.locator("html").getAttribute("data-ikr-theme"), "midnight");
    await trigger("language").focus(); await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator(":focus").getAttribute("data-menu-value"), "en");
    await page.keyboard.press("End"); assert.equal(await page.locator(":focus").getAttribute("data-menu-value"), "both");
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    assert.equal(await trigger("language").innerText(), "German"); assert.equal(await page.locator(":focus").getAttribute("id"), "focus-language-trigger", "Redrawing keeps keyboard focus at the same control");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Escape");
    assert.equal(await list("language").isVisible(), false); assert.equal(await page.locator(":focus").getAttribute("id"), "focus-language-trigger");
    assert.match(await trigger("language").evaluate(n => getComputedStyle(n).boxShadow), /inset/);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Tab"); assert.equal(await list("language").isVisible(), false); assert.equal(await page.locator(":focus").getAttribute("id"), "focus-theme-trigger");
    await page.evaluate(() => draw(true)); assert.equal(await trigger("language").isDisabled(), true); await trigger("theme").click(); assert.equal(await list("theme").isVisible(), true);
    await page.evaluate(() => draw()); await trigger("language").click(); await page.locator('.focus-menu-language [data-menu-value="both"]').click(); assert.equal(await trigger("language").innerText(), "Both");
    const priorCalls = await page.evaluate(() => calls.length); await page.evaluate(() => { draw(); draw(); draw(); }); await trigger("theme").click(); await page.locator('.focus-menu-theme [data-menu-value="forest"]').click(); assert.equal(await page.evaluate(() => calls.length), priorCalls + 1, "Remounts do not multiply listeners");
    await page.setViewportSize({ width: 320, height: 640 }); await trigger("theme").click(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, "mobile-theme-menu.png") });
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: true, scope: "Custom compact header menus, four theme palettes, mouse/keyboard focus, disabled language, redraw cleanup, mobile" }, null, 2));
    console.log("PASS Header menus: compact sizes, four-theme popup colors, mouse/keyboard focus, redraw cleanup, disabled language and mobile fit");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
