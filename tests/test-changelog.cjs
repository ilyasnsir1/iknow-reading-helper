/* Read-only production changelog in isolated Brave; no native host or personal
 * browser storage. Adversarial entries replace only the local JSON boundary. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source = path.resolve(__dirname, "../extension"), out = path.join(__dirname, "changelog-evidence"); fs.mkdirSync(out, { recursive: true });
const until = async (fn, label) => { const start = Date.now(); while (!await fn()) { if (Date.now() - start > 12000) throw Error("Timed out: " + label); await new Promise(resolve => setTimeout(resolve, 25)); } };
const entry = changes => ({ schemaVersion: 1, entries: [{ id: "test-entry", version: null, status: "unreleased", date: null, title: "A deliberate preview", summary: "Only the owner publishes these notes.", changes }] });
const change = extra => ({ type: "fixed", title: "Buttons below both translations", description: "English and German stay together.", ...extra });
(async () => {
  const bundled = JSON.parse(fs.readFileSync(path.join(source, "changelog.json"), "utf8"));
  assert.equal(bundled.schemaVersion, 1);
  assert.equal(bundled.entries.length, 2, "history starts with the requested button fix and Romaji choice");
  assert.equal(bundled.entries[0].status, "released");
  assert.equal(bundled.entries[0].version, JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")).version, "the finalized newest notes match the release");
  assert.equal(bundled.entries[1].version, "1.40.4");
  assert.equal(bundled.entries[1].status, "released");
  const extension = require("./fixtures/isolate-extension.cjs")(source, out);
  fs.mkdirSync(path.join(extension, "changelog-media"), { recursive: true });
  fs.copyFileSync(path.join(extension, "icons/icon128.png"), path.join(extension, "changelog-media/test-fixture.png"));
  fs.writeFileSync(path.join(extension, "changelog-reader-fixture.js"), `globalThis.changelogNativeCalls=[];globalThis.changelogFixtureMaintainer=false;globalThis.changelogFixtureDraft=${JSON.stringify(bundled)};globalThis.changelogFixtureRevision=1;const fixtureImages=new Map();
  chrome.runtime.connectNative=()=>{const messages=[];let open=true;return{onMessage:{addListener:fn=>messages.push(fn)},onDisconnect:{addListener(){}},disconnect(){open=false;},postMessage(value){changelogNativeCalls.push(value);let result={ok:true,available:changelogFixtureMaintainer,role:changelogFixtureMaintainer?'maintainer':'reader'};
  if(changelogFixtureMaintainer){const snapshot=()=>({draft:structuredClone(changelogFixtureDraft),revision:'fixture-'+changelogFixtureRevision,images:[...fixtureImages.keys()].map(src=>({src}))});
   if(value.action==='load')result={ok:true,...snapshot()};
   if(value.action==='save'||value.action==='image:add'||value.action==='image:remove'){
    if(value.manual!==true||value.expectedRevision!=='fixture-'+changelogFixtureRevision)result={ok:false,error:'Fixture revision conflict.'};
    else{changelogFixtureRevision++;if(value.action==='save')changelogFixtureDraft=structuredClone(value.draft);
     if(value.action==='image:add'){const src='changelog-media/owner-image.png';fixtureImages.set(src,{src,mime:value.mime,base64:value.base64});result.image={src,alt:'Uploaded preview'};}
     if(value.action==='image:remove')fixtureImages.delete(value.src);result={...result,...snapshot()};}}
   if(value.action==='image:get')result={ok:true,image:fixtureImages.get(value.src)};}
  queueMicrotask(()=>{if(open)messages.forEach(fn=>fn({type:'changelog:author:result',requestId:value.requestId,...result}));});}};};`);
  const background = path.join(extension, "background.js");
  fs.writeFileSync(background, 'importScripts("changelog-reader-fixture.js");\n' + fs.readFileSync(background, "utf8"));
  const context = await chromium.launchPersistentContext(path.join(out, "profile-" + Date.now()), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true,
    ignoreDefaultArgs: ["--disable-extensions"], args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`], viewport: { width: 1200, height: 1000 }
  });
  const errors = [], external = [], writes = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  context.on("request", request => { if (/^https?:/.test(request.url())) external.push(request.url()); if (!["GET", "HEAD"].includes(request.method())) writes.push({ method: request.method(), url: request.url() }); });
  await context.route("https://**/*", route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
  const load = async ({ payload, raw } = {}) => {
    const page = await context.newPage();
    if (payload !== undefined || raw !== undefined) await page.addInitScript(({ payload, raw }) => {
      const original = fetch.bind(globalThis);
      globalThis.fetch = (input, options) => String(input).split(/[?#]/)[0].endsWith("changelog.json")
        ? Promise.resolve(new Response(raw === undefined ? JSON.stringify(payload) : raw, { status: 200, headers: { "Content-Type": "application/json" } }))
        : original(input, options);
    }, { payload, raw });
    await page.goto(`chrome-extension://${id}/changelog.html`);
    await until(async () => (await page.locator("#changelog-entries").innerText()).trim() || /could not|unavailable|try again|invalid|unable/i.test(await page.locator("#changelog-status").innerText()), "changelog loaded or error");
    return page;
  };
  try {
    const page = await load();
    assert.match(await page.locator("#changelog-entries").innerText(), /1\.40\.4/);
    assert.match(await page.locator("#changelog-entries").innerText(), /Romaji/i);
    assert.equal(await page.locator("[contenteditable=true]:visible,textarea:visible,input[type=file]:visible,form:visible").count(), 0, "reader has no visible content editing/upload surface");
    assert.equal(await page.locator("#edit-changelog:visible").count(), 0, "a normal installation has no edit action");
    const missingManual = await page.evaluate(() => chrome.runtime.sendMessage({ type: "ikr:changelog:author", action: "save", draft: { schemaVersion: 1, entries: [] } }));
    assert.equal(missingManual?.code, "author_forbidden", "mutating author requests require explicit manual action before reaching native code");
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["paper", "midnight", "tokyo", "forest"]) {
        await page.evaluate(theme => IKnowReaderTheme.choose(theme), theme);
        await until(() => page.locator("html").getAttribute("data-ikr-theme").then(value => value === theme), "theme applied");
        await page.waitForTimeout(220); // Inspect the final paint after the existing palette transition.
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}/${theme} has no horizontal overflow`);
        assert.equal(await page.locator("#changelog-entries").isVisible(), true);
        const paint = await page.locator("#changelog-entries").evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(document.body).backgroundColor }));
        assert.notEqual(paint.color, paint.background, `${width}/${theme} text remains distinguishable`);
        const contrast = await page.locator(".ikr-theme-trigger").evaluate(node => {
          const channels = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const luminance = values => values.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
          const css = getComputedStyle(node), a = luminance(channels(css.color)), b = luminance(channels(css.backgroundColor));
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
        assert.ok(contrast >= 4.5, `${width}/${theme} theme control text contrast is ${contrast.toFixed(2)}`);
        if ((width === 1200 && theme === "paper") || (width === 390 && theme === "midnight")) await page.screenshot({ path: path.join(out, `${width}-${theme}.png`), fullPage: true });
      }
    }
    await page.close();
    const preview = await load({ payload: entry([change()]) });
    assert.equal(await preview.locator('.release-status').innerText(), "Preview", "draft entries remain clearly distinct from published notes");
    assert.equal(await preview.locator('.release-version').innerText(), "Next update"); await preview.close();
    console.log("PASS Changelog starts at 1.40.4, matches the release version, distinguishes previews, stays read-only, and fits all four themes on desktop/mobile");

    const injection = '<img src="https://invalid.example/steal" onerror="window.changelogInjected=true">';
    const inert = await load({ payload: entry([change({ title: injection, description: '<script>window.changelogInjected=true</script>', details: ["<b>Literal detail</b>"] })]) });
    assert.ok((await inert.locator("#changelog-entries").innerText()).includes(injection));
    assert.equal(await inert.locator('#changelog-entries script,#changelog-entries img[src^="https:"]').count(), 0);
    assert.equal(await inert.evaluate(() => window.changelogInjected), undefined);
    await inert.close();
    console.log("PASS Changelog titles, descriptions and details render as inert plain text");

    const withImage = await load({ payload: entry([change({ images: [{ src: "changelog-media/test-fixture.png", alt: "Example button layout", caption: "A local image with a readable caption." }] })]) });
    await withImage.locator(".changelog-image-button").first().click();
    const dialog = withImage.locator("#changelog-image-dialog"); await until(() => dialog.isVisible(), "image dialog opened");
    assert.equal(await dialog.locator("img").getAttribute("alt"), "Example button layout");
    assert.match(await dialog.innerText(), /local image/);
    await withImage.keyboard.press("Escape"); await until(async () => !await dialog.isVisible(), "Escape closes image dialog");
    assert.equal(await withImage.locator(".changelog-image-button").first().evaluate(node => node === document.activeElement), true, "image close restores focus");
    await withImage.locator(".changelog-image-button").first().click(); await withImage.getByRole("button", { name: "Close image", exact: true }).click();
    assert.equal(await dialog.isVisible(), false);
    await withImage.close();
    console.log("PASS Bundled raster images open accessibly, close with Escape/button, and return keyboard focus");

    const unsafe = ["https://invalid.example/image.png", "//invalid.example/image.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "../icons/icon128.png", "changelog-media/../icons/icon128.png", "changelog-media/%2e%2e.png", "changelog-media/image.svg", "changelog-media/folder/image.png", "changelog-media\\image.png"];
    const failures = unsafe.map(src => ({ payload: entry([change({ images: [{ src, alt: "Unsafe" }] })]), label: src }));
    failures.push({ payload: { schemaVersion: 900, entries: [] }, label: "unsupported schema" });
    failures.push({ payload: { schemaVersion: 1, entries: new Array(101).fill(entry([change()]).entries[0]) }, label: "entry count" });
    failures.push({ payload: entry([change({ title: "x".repeat(161) })]), label: "oversized title" });
    failures.push({ raw: " ".repeat(512 * 1024 + 1) + JSON.stringify(entry([change()])), label: "oversized JSON" });
    failures.push({ raw: "{broken", label: "malformed JSON" });
    for (const test of failures) {
      const broken = await load(test);
      assert.equal((await broken.locator("#changelog-entries").innerText()).trim(), "", test.label + " does not partially render");
      assert.match(await broken.locator("#changelog-status").innerText(), /could not|unavailable|try again|invalid|unable/i, test.label + " has a readable failure");
      assert.equal(await broken.locator('#changelog-entries img').count(), 0, test.label + " never loads a content image");
      await broken.close();
    }
    console.log("PASS Unsupported/oversized/malformed data and remote, active, SVG or traversing image paths fail closed");
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    assert.equal(await popup.locator("#open-changelog").getAttribute("href"), "changelog.html");
    assert.equal(await popup.locator("#open-changelog").getAttribute("target"), "_blank");
    const denied = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "ikr:changelog:author", action: "save", manual: true, draft: { schemaVersion: 1, entries: [] } }));
    assert.equal(denied?.code, "author_forbidden", "a different extension page cannot call the author bridge");
    await popup.close();
    const calls = await worker.evaluate(() => changelogNativeCalls);
    assert.ok(calls.every(call => call.type === "changelog:author" && call.action === "status"), "normal reading only checks authorization; it never mutates or loads a maintainer draft");
    const bundledImages = bundled.entries.flatMap(entry => entry.changes.flatMap(change => change.images || []));
    const originalFirstImages = bundled.entries[0].changes[0].images || [];
    await worker.evaluate(() => { changelogFixtureMaintainer = true; });
    const owner = await load(); await owner.locator("#edit-changelog:visible").waitFor();
    await owner.locator("#edit-changelog").click(); const editor = owner.locator("#changelog-editor"); await editor.waitFor();
    for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
      await owner.setViewportSize(viewport);
      for (const theme of ["paper", "midnight", "tokyo", "forest"]) {
        await owner.evaluate(theme => IKnowReaderTheme.choose(theme), theme); await owner.waitForTimeout(220);
        const layout = await editor.evaluate(dialog => {
          const footer = dialog.querySelector(".editor-footer").getBoundingClientRect(), head = dialog.querySelector(".editor-head").getBoundingClientRect(), box = dialog.getBoundingClientRect();
          return { footer: { top: footer.top, bottom: footer.bottom, left: footer.left, right: footer.right }, headBottom: head.bottom, dialog: { top: box.top, bottom: box.bottom }, width: innerWidth, height: innerHeight, overflow: dialog.scrollWidth > dialog.clientWidth + 1 };
        });
        assert.ok(layout.dialog.top >= -1 && layout.dialog.bottom <= viewport.height + 1, `${viewport.width}/${theme} editor fits the viewport`);
        assert.ok(layout.footer.bottom <= viewport.height + 1 && layout.footer.left >= -1 && layout.footer.right <= viewport.width + 1, `${viewport.width}/${theme} save footer remains inside the viewport`);
        assert.equal(layout.overflow, false, `${viewport.width}/${theme} editor does not overflow horizontally`);
        for (const selector of ["#save-changelog-draft", ".editor-close"]) {
          const contrast = await editor.locator(selector).evaluate(node => {
            const rgba = value => { const result = (value.match(/[\d.]+/g) || []).map(Number); return [result[0] || 0, result[1] || 0, result[2] || 0, result[3] === undefined ? 1 : result[3]]; };
            const blend = (top, bottom) => [0, 1, 2].map(index => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1);
            const luminance = values => values.slice(0, 3).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
            const style = getComputedStyle(node), ancestors = []; for (let parent = node; parent; parent = parent.parentElement) ancestors.push(parent);
            let background = [255, 255, 255, 1]; for (const parent of ancestors.reverse()) background = blend(rgba(getComputedStyle(parent).backgroundColor), background);
            const a = luminance(rgba(style.color)), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
          assert.ok(contrast >= 4.5, `${viewport.width}/${theme}/${selector} contrast ${contrast.toFixed(2)}`);
        }
        const lastAction = editor.getByRole("button", { name: "Add note", exact: true });
        await lastAction.scrollIntoViewIfNeeded(); await lastAction.focus();
        const target = await lastAction.evaluate(node => { const box = node.getBoundingClientRect(), footer = node.closest("dialog").querySelector(".editor-footer").getBoundingClientRect(), found = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return { top: box.top, bottom: box.bottom, footerTop: footer.top, clear: found === node || node.contains(found) }; });
        assert.ok(target.top >= layout.headBottom - 1 && target.bottom <= target.footerTop + 1, `${viewport.width}/${theme} last form action scrolls fully above footer`);
        assert.equal(target.clear, true, `${viewport.width}/${theme} last form action is not covered`);
        if (viewport.width === 390 && theme === "midnight") await owner.screenshot({ path: path.join(out, "390-midnight-editor.png"), fullPage: true });
      }
    }
    await owner.setViewportSize({ width: 1200, height: 1000 }); await owner.evaluate(() => IKnowReaderTheme.choose("paper"));
    console.log("PASS Maintainer editor footer and last form action stay usable on desktop/mobile with readable Save/Close controls in every theme");
    await editor.getByLabel("Title", { exact: true }).fill("Your Romaji choice, refined");
    await editor.getByLabel("Notes · one bullet per line", { exact: true }).first().fill("Choose source spelling or particle pronunciation.\nThe choice stays synchronized across your study pages.");
    await editor.locator('input[type="file"]').first().setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(extension, "icons/icon128.png")) });
    const firstChange = editor.locator(".editor-change").first();
    await until(async () => await firstChange.locator(".editor-image").count() === originalFirstImages.length + 1, "owner upload returns an additional image");
    const uploaded = firstChange.locator(".editor-image").last();
    await uploaded.getByLabel("Image description", { exact: true }).fill("Romaji control preview");
    await uploaded.getByLabel("Caption", { exact: true }).fill("The display changes; Japanese stays the same.");
    await editor.locator("#save-changelog-draft").click(); await until(async () => !await editor.isVisible(), "owner saves local draft");
    assert.match(await owner.locator("#changelog-entries").innerText(), /Your Romaji choice, refined/);
    assert.equal(await owner.locator('.changelog-image-button img[alt="Romaji control preview"]').count(), 1);
    assert.match(await owner.locator("#changelog-draft-status").innerText(), /only to you|draft/i);
    const saved = await worker.evaluate(() => structuredClone(changelogFixtureDraft));
    assert.equal(saved.entries[0].title, "Your Romaji choice, refined");
    assert.equal(saved.entries[0].changes[0].details[0], "The choice stays synchronized across your study pages.");
    assert.equal(saved.entries[0].changes[0].images.find(image => image.src === "changelog-media/owner-image.png").caption, "The display changes; Japanese stays the same.");
    assert.deepEqual(saved.entries.flatMap(entry => entry.changes.flatMap(change => change.images || [])).filter(image => image.src !== "changelog-media/owner-image.png"), bundledImages, "adding an image preserves all existing bundled image metadata");
    assert.equal(await owner.locator(".changelog-image-button").count(), bundledImages.length + 1);
    await owner.locator("#edit-changelog").click(); await editor.waitFor();
    await editor.locator(".editor-change").first().locator(".editor-image").last().getByRole("button", { name: "Remove image", exact: true }).click();
    await editor.locator("#save-changelog-draft").click(); await until(async () => !await editor.isVisible(), "owner saves image removal");
    assert.equal(await owner.locator(".changelog-image-button").count(), bundledImages.length);
    assert.deepEqual(await worker.evaluate(() => changelogFixtureDraft.entries.flatMap(entry => entry.changes.flatMap(change => change.images || []))), bundledImages, "removing the uploaded image leaves every bundled image in the draft");
    await owner.locator("#edit-changelog").click(); await editor.waitFor();
    await editor.getByLabel("Title", { exact: true }).fill("Unsaved title"); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await editor.isVisible(), false);
    assert.equal(await worker.evaluate(() => changelogFixtureDraft.entries[0].title), "Your Romaji choice, refined", "cancel never saves pending text");
    const authorCalls = await worker.evaluate(() => changelogNativeCalls);
    assert.ok(authorCalls.filter(call => ["save", "image:add", "image:remove"].includes(call.action)).every(call => call.manual === true && /^fixture-\d+$/.test(call.expectedRevision)), "all author mutations carry explicit action and the current revision");
    assert.ok(authorCalls.every(call => call.type === "changelog:author"), "editing a draft never calls publication/update installation");
    await owner.close();
    console.log("PASS Maintainer edits local notes, adds/captions/removes an image, saves revisions and cancels unsaved text without publishing");
    assert.deepEqual(external, []); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: true, themes: 4, widths: [1200, 390], unsafeImageCases: unsafe.length, malformedCases: 5, readerActions: calls.map(call => call.action), authorActions: authorCalls.map(call => call.action), externalRequests: external, writes, pageErrors: errors }, null, 2));
    console.log("PASS Popup opens the read-only changelog; the reader makes no external requests or network writes");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
