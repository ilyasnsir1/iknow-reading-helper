"use strict";
const assert = require("node:assert/strict");
const { parse } = require("../extension/study-noji-import.js");
const Store = require("../extension/study-store.js");
const Practice = require("../extension/study-practice.js");
const Learning = require("../extension/study-learning-store.js");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function memoryStorage() {
  const data = {};
  return {
    get: async keys => Object.fromEntries([keys].flat().map(key => [key, structuredClone(data[key])])),
    set: async patch => Object.assign(data, structuredClone(patch))
  };
}

async function browserTest(source) {
  const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ikr-noji-"));
  const extension = require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname, "../extension"), fixture);
  const background = path.join(extension, "background.js");
  fs.writeFileSync(path.join(extension, "test-noji-reading.js"), `chrome.runtime.connectNative = () => {
    const listeners = [];
    return { onMessage: { addListener: callback => listeners.push(callback) }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage({ type, requestId, text }) {
        if (type === "noji-reading") queueMicrotask(() => listeners.forEach(callback => callback({
          type: "noji-reading-result", requestId, ok: text === "トイレはどこですか?", romaji: "toirewa dokodesuka?"
        })));
      }
    };
  };`);
  fs.writeFileSync(background, 'importScripts("test-noji-reading.js");\n' + fs.readFileSync(background, "utf8"));
  const browser = await chromium.launchPersistentContext(path.join(fixture, "profile"), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]
  });
  try {
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/study.html`);
    const dialog = page.getByRole("dialog", { name: "Import Noji cards" });
    const importButton = page.getByRole("button", { name: "Import Noji", exact: true });
    await importButton.click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    for (let index = 0; index < 2; index++) {
      await importButton.click();
      assert.equal(await dialog.getByRole("button", { name: "Import cards" }).isDisabled(), true);
      await dialog.getByLabel("CSV file").setInputFiles({ name: "Begrüßung.csv", mimeType: "text/csv", buffer: Buffer.from(source + "Guten Abend;こんばんは\r\nWo ist die Toilette?;トイレはどこですか？\r\nIch gehe zur Schule.;学校に行きます\r\n") });
      await dialog.getByText("5 ready to import.", { exact: false }).waitFor();
      const header = dialog.getByRole("checkbox", { name: "Skip the first row (column headings)" });
      assert.equal(await header.isChecked(), true);
      await header.uncheck();
      assert.equal(await dialog.getByLabel("Back for card 1", { exact: true }).inputValue(), "Back");
      await header.check();
      assert.equal(await dialog.getByLabel("Back for card 1", { exact: true }).inputValue(), "はじめまして");
      assert.equal(await dialog.getByRole("listitem").count(), 7);
      const scrollbar = element => [getComputedStyle(element).scrollbarWidth, getComputedStyle(element).scrollbarColor];
      assert.deepEqual(await dialog.getByRole("list", { name: "Cards to review" }).evaluate(scrollbar),
        await page.locator("#demo-library-list").evaluate(scrollbar));
      const translation = dialog.getByLabel("Front for card 2", { exact: true });
      await dialog.getByRole("button", { name: "Edit card 2", exact: true }).click();
      const height = await translation.evaluate(input => input.clientHeight);
      await translation.fill("Ein längerer Beispielsatz, der in der Vorschau vollständig sichtbar sein soll. ".repeat(5));
      const size = await translation.evaluate(input => ({ height: input.clientHeight, content: input.scrollHeight, resize: getComputedStyle(input).resize }));
      assert.equal(size.resize, "none");
      assert.ok(size.height > height && size.content <= size.height + 1);
      await dialog.getByRole("checkbox", { name: "Import card 5" }).uncheck();
      await translation.fill("Hallo zusammen");
      await dialog.getByRole("checkbox", { name: "Import card 3" }).uncheck();
      await dialog.getByRole("button", { name: "Swap columns", exact: true }).click();
      assert.equal(await dialog.getByLabel("Back for card 2", { exact: true }).inputValue(), "Hallo zusammen");
      await dialog.locator('[data-column="japanese"]').dragTo(dialog.locator('[data-column="meaning"]'));
      assert.equal(await dialog.getByLabel("Front for card 2", { exact: true }).inputValue(), "Hallo zusammen");
      assert.equal(await dialog.getByRole("checkbox", { name: "Import card 5" }).isChecked(), false);
      await dialog.getByText("4 ready to import.", { exact: false }).waitFor();
      if (index === 0 && process.env.IKR_NOJI_SCREENSHOT) await page.screenshot({ path: process.env.IKR_NOJI_SCREENSHOT });
      await dialog.getByRole("button", { name: "Import cards" }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    const first = page.locator("#demo-library-list .library-row").first();
    await first.waitFor();
    assert.equal(await page.locator("#demo-library-list .library-row").count(), 4);
    await page.locator('[data-library-source="noji"]').click();
    assert.equal(await page.locator("#demo-kind").isVisible(), false);
    assert.equal(await page.locator("#demo-kind").isDisabled(), true);
    const deckBounds=await page.locator('#demo-course').boundingBox(),filterBounds=await page.locator('.focus-library .library-filters').boundingBox();
    assert.ok(Math.abs(deckBounds.width-filterBounds.width)<2);
    await page.locator("#demo-library-list .library-row").filter({ hasText: "トイレはどこですか" }).click();
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    await page.getByRole("button", { name: "Romaji", exact: true }).click();
    const visibleText = page.locator('[data-original-side][data-visible=true] .focus-flashcard-text');
    assert.equal(await visibleText.innerText(), "toirehadokodesuka?");
    assert.equal(await page.locator("#focus-romaji").count(), 0);
    await page.getByRole("button", { name: "Japanese", exact: true }).click();
    assert.equal(await visibleText.innerText(), "トイレはどこですか？");
    assert.equal(await page.locator("#demo-library-list .library-row").count(), 4);
    assert.match(await page.locator("#demo-library-list").innerText(), /Hallo zusammen/);
    const greeting=page.locator('#demo-library-list .library-row').filter({hasText:'Freut mich'});
    await greeting.click();
    assert.equal(await page.locator(".focus-card .focus-source-link").count(), 0);
    await page.locator('[data-action="practise-item"]').click();
    await page.locator('[data-action="start"]').click();
    await page.locator(".session-review").waitFor();
    await page.getByRole("button", { name: "はじめまして", exact: true }).click();
    await page.locator("#demo-solution").waitFor();
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page.locator(".focus-results").waitFor();
    await page.locator('[data-action="result-back-study"]').click();
    await page.evaluate(async()=>{
      await IKnowReaderStudyStore.save({kind:'word',courseId:'19053',sourceId:'filter-word',japanese:'猫',kana:'ねこ',romaji:'neko',english:'cat'});
      await IKnowReaderStudyStore.save({kind:'sentence',courseId:'19053',sourceId:'filter-sentence',japanese:'猫がいます。',kana:'ねこがいます。',romaji:'neko ga imasu.',english:'There is a cat.'});
    });
    await page.locator('[data-library-source="iknow"]').click();
    await page.locator('#demo-kind').waitFor({state:'visible'});
    await page.locator('#demo-kind').selectOption('sentence');
    assert.equal(await page.locator('#demo-library-list .library-row').count(),1);
    await page.locator('[data-library-source="noji"]').click();
    assert.equal(await page.locator('#demo-kind').isVisible(),false);
    assert.equal(await page.locator('#demo-library-list .library-row').count(),4);
    const nojiDeck=await page.locator('#demo-course option').nth(1).getAttribute('value');
    await page.locator('#demo-course').selectOption(nojiDeck);
    await page.reload();await page.locator('#demo-library-list .library-row').first().waitFor();
    assert.equal(await page.locator('#demo-kind').isVisible(),false);
    assert.equal(await page.locator('#demo-library-list .library-row').count(),4);
    await page.locator('[data-library-source="all"]').click();
    assert.equal(await page.locator('#demo-kind').isVisible(),false);
    assert.equal(await page.locator('#demo-library-list .library-row').count(),4);
    await page.locator('#demo-course').selectOption('');
    assert.equal(await page.locator('#demo-kind').isVisible(),true);
    assert.equal(await page.locator('#demo-kind').inputValue(),'sentence');
    assert.equal(await page.locator('#demo-library-list .library-row').count(),1);
    await importButton.click();
    await dialog.getByLabel('CSV file').setInputFiles({name:'without-headings.csv',mimeType:'text/csv',buffer:Buffer.from('Hallo;こんにちは\nDanke;ありがとう\n')});
    await dialog.getByText('2 ready to import.',{exact:false}).waitFor();
    assert.equal(await dialog.getByRole('checkbox',{name:'Skip the first row (column headings)'}).isChecked(),false);
    assert.equal(await dialog.getByLabel('Front for card 1',{exact:true}).inputValue(),'Hallo');
    assert.equal(await dialog.getByLabel('Back for card 1',{exact:true}).inputValue(),'こんにちは');
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    assert.deepEqual(errors, []);
    console.log("PASS Noji import, Review and deck-only filters preserve mixed cards and iKnow type selection across refresh");
  } finally {
    await browser.close();
  }
}

(async () => {
  const source = '\uFEFFFront;Back\r\n"Freut mich, Sie kennenzulernen";はじめまして\r\n"Guten ""Tag""";こんにちは\r\n"Guten ""Tag""";こんにちは\r\nNur Deutsch;\r\n';
  const { rows, width } = parse(source);
  assert.equal(width, 2);
  assert.deepEqual(rows.slice(1, 3), [["Freut mich, Sie kennenzulernen", "はじめまして"], ['Guten "Tag"', "こんにちは"]]);
  assert.deepEqual(parse('日,"first\nsecond"').rows, [["日", "first\nsecond"]]);
  assert.throws(() => parse('日,"first'));

  const storage = memoryStorage(), backend = Store.createBackend(storage, () => 123);
  const deck = { title: "Begrüßung", kind: "word", language: "de", cards: rows.slice(1, 3).map(([meaning, japanese]) => ({ japanese, meaning })) };
  const simultaneous = await Promise.all([backend.importCards(deck), backend.importCards(deck)]);
  assert.deepEqual(simultaneous.map(result => result.added).sort(), [0, 2]);
  assert.equal(simultaneous[0].courseId, simultaneous[1].courseId);
  assert.ok(Store.isImportedDeck(simultaneous[0].courseId));
  const cards = Object.values((await backend.read()).records);
  const review = Practice.buildReviewQuestion(cards[0], cards, { language: "en" });
  assert.equal(review.language, "de");
  assert.equal(review.choices.length, 2);
  await backend.updateNotes(cards[0].key, "Keep my note");
  const progress = Learning.createBackend(storage, () => 456);
  await progress.setAssessment({ key: cards[0].key, level: "strong" });
  assert.deepEqual(await backend.importCards(deck), { courseId: simultaneous[0].courseId, added: 0, skipped: 2 });
  assert.deepEqual(await backend.importCards({ title: deck.title, language: deck.language,
    cards: deck.cards.map(card => ({ ...card, kind: "sentence" })) }), { courseId: simultaneous[0].courseId, added: 0, skipped: 2 });

  const invalid = { ...deck, cards: [...deck.cards, { japanese: "Not Japanese", meaning: "Ignore this" }] };
  await assert.rejects(backend.importCards(invalid));
  const backup = await backend.exportBackup();
  const restored = Store.createBackend(memoryStorage(), () => 789);
  await restored.importBackup(backup);
  assert.equal((await restored.read()).records[cards[0].key].notes, "Keep my note");
  assert.equal((await restored.exportBackup()).learning.assessments[cards[0].key].level, "strong");
  assert.equal(Object.keys((await restored.read()).records).length, 2);
  console.log("PASS Noji CSV mapping, review, concurrent duplicate detection, validation and backup round-trip");
  if (process.argv.includes("--browser")) await browserTest(source);
})().catch(error => { console.error(error); process.exitCode = 1; });
