const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { convert } = require("../extension/romaji-kana.js");
const { draftCard } = require("../extension/study-noji-import.js");
const Store = require("../extension/study-store.js");

async function main() {
  for (const [roman, kana] of Object.entries({ "kuru (kimasu)": "くる （きます）", "ryouri o tsukuru": "りょうり お つくる", "ike ike!": "いけ いけ！", "gakkou": "がっこう", "kin'youbi": "きんようび", "shashin": "しゃしん", "matcha": "まっちゃ" })) {
    assert.equal(convert(roman).kana, kana);
  }
  assert.equal(convert("kinoo").needsReview, true);
  assert.equal(convert("Geh! oder Los! Los!").ok, false);
  const mixed = draftCard("iku Befehlsform (Geh! oder Los! Los!) - ike ike!");
  assert.equal(mixed.text, "iku Befehlsform (Geh! oder Los! Los!) - ike ike!");
  assert.equal(mixed.notes, undefined);
  assert.equal(draftCard("tsukuru (Ryouri o tsukuru)").text, "tsukuru (Ryouri o tsukuru)");
  const Reading = require("../extension/noji-card-reading.js");
  assert.equal(Reading.analyze("chiisai").hiragana, "ちいさい");
  assert.equal(Reading.analyze("chiisai").katakana, "チイサイ");
  assert.equal(Reading.analyze("これは例です。").speech, "これは例です。");
  assert.equal(Reading.analyze("これは例です。 Ein Beispiel.").speech, "これは例です。");
  assert.equal(Reading.analyze(mixed.text), null);
  assert.equal(Reading.faces({german:"I",japanese:"私"}).front,null);
  const stored = {};
  const backend = Store.createBackend({ get: async keys => Object.fromEntries([keys].flat().map(key => [key, structuredClone(stored[key])])), set: async patch => Object.assign(stored, structuredClone(patch)) });
  const deck = { title: "Romaji", language: "de", cards: [
    { kind: "word", script: "romaji", japanese: "kuru (kimasu)", meaning: "kommen", kana: "くる（きます）", notes: "Zwei Formen" },
    { kind: "word", script: "romaji", japanese: "iku", meaning: "gehen", notes: "Befehlsform (Geh! oder Los! Los!) - ike ike!" }
  ] };
  await backend.importCards(deck);
  const records = Object.values((await backend.read()).records);
  assert.equal(records[0].script, "romaji");
  assert.equal(records[0].romaji, "kuru (kimasu)");
  assert.equal(records[1].kana, "");
  const backup = await backend.exportBackup();
  const restoredData = {};
  const restored = Store.createBackend({ get: async keys => Object.fromEntries([keys].flat().map(key => [key, structuredClone(restoredData[key])])), set: async patch => Object.assign(restoredData, structuredClone(patch)) });
  await restored.importBackup(backup);
  assert.equal((await restored.read()).records[records[1].key].notes, deck.cards[1].notes);
  assert.deepEqual(await backend.importCards(deck), { courseId: records[0].courseId, added: 0, skipped: 2 });
  const extraReading = await backend.importCards({ ...deck, cards: [{ ...deck.cards[1], kana: "いく" }] });
  assert.equal(extraReading.updated, 1);
  assert.equal((await backend.read()).records[records[1].key].kana, "いく");
  assert.equal((await backend.read()).records[records[1].key].notes, deck.cards[1].notes);
  await assert.rejects(backend.importCards({ ...deck, cards: [{ ...deck.cards[0], kana: "German words" }] }));
  await assert.rejects(backend.importCards({ ...deck, cards: [{ ...deck.cards[0], script: "unknown" }] }));
  const originalDeck = { title: "Original sides", language: "de", cards: [
    { kind: "sentence", cardMode: "original", japanese: "ji (sanji desu) Es ist 3 Uhr.", meaning: "... Uhr" },
    { kind: "sentence", cardMode: "original", japanese: mixed.text, meaning: "gehen" },
    { kind: "word", cardMode: "original", japanese: "neko", meaning: "Katze" }
  ] };
  await backend.importCards(originalDeck);
  const originalRecords = Object.values((await backend.read()).records).filter(record => record.cardMode === "original");
  assert.equal(originalRecords.length, 3);
  assert.equal(originalRecords[0].japanese, originalDeck.cards[0].japanese);
  assert.equal(originalRecords[0].german, "... Uhr");
  assert.equal(originalRecords[0].notes, undefined);
  await restored.importBackup(await backend.exportBackup());
  assert.deepEqual((await restored.read()).records[originalRecords[0].key], originalRecords[0]);
  const Practice = require("../extension/study-practice.js");
  const question = Practice.buildReviewQuestion(originalRecords[0], originalRecords, { language: "de" });
  assert.equal(question.prompt, "... Uhr");
  assert.equal(question.choices.find(choice => choice.id === question.correctId).label, originalDeck.cards[0].japanese);
  assert.equal(Practice.buildListening(originalRecords[0], { canSynthesize: () => true }), null);
  assert.equal(Practice.buildCloze(originalRecords[0]), null);
  const changeDeck = { ...originalDeck, cards: [{ kind: "word", script: "romaji", japanese: "neko", meaning: "Katze", kana: "ねこ" }] };
  await backend.updateNotes(originalRecords[2].key, "My existing note");
  assert.equal((await backend.importCards(changeDeck)).updated, 1);
  const changed = (await backend.read()).records[originalRecords[2].key];
  assert.equal(changed.cardMode, undefined);
  assert.equal(changed.notes, "My existing note");
  assert.equal(changed.kana, "ねこ");
  assert.equal((await backend.importCards({ ...originalDeck, cards: [originalDeck.cards[2]] })).updated, 1);
  assert.equal((await backend.read()).records[changed.key].romaji, "neko");
  assert.equal((await backend.read()).records[changed.key].kana, "ねこ");
  const dictation = Practice.buildListening(originalRecords[2], { canSynthesize: () => true });
  assert.equal(dictation.details.japanese, "ねこ");
  assert.equal(Practice.checkListening(dictation, "neko"), true);
  await assert.rejects(backend.importCards({ ...originalDeck, cards: [{ ...originalDeck.cards[0], kana: "じ" }] }));
  await assert.rejects(backend.importCards({ ...originalDeck, cards: [{ ...originalDeck.cards[0], cardMode: "unknown" }] }));

  const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ikr-romaji-noji-"));
  const extension = require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname, "../extension"), fixture);
  const background = path.join(extension, "background.js");
  fs.writeFileSync(path.join(extension, "test-romaji-audio.js"), `chrome.runtime.connectNative = () => {
    const listeners = [];
    return { onMessage: { addListener: fn => listeners.push(fn) }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage(message) {
        if (message.type === "noji-reading") {
          chrome.storage.local.set({ testReadingText: message.text }).then(() => setTimeout(()=>listeners.forEach(fn => fn({ type: "noji-reading-result", requestId: message.requestId, ok: true, romaji: message.text.startsWith('写真')?'shashin o totte mo ii desu ka?':"toirewa dokodesuka?" })),message.text.startsWith('写真')?300:0));
          return;
        }
        if (message.type !== "word-neural") return;
        chrome.storage.local.set({ testSpokenText: message.text }).then(() => listeners.forEach(fn => fn({ type: "word-neural-result", requestId: message.requestId, ok: false })));
      }
    };
  };`);
  fs.writeFileSync(background, 'importScripts("test-romaji-audio.js");\n' + fs.readFileSync(background, "utf8"));
  const browser = await chromium.launchPersistentContext(path.join(fixture, "profile"), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true,
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"], args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]
  });
  try {
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/study.html`);
    await page.getByRole("button", { name: "Import Noji", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import Noji cards" });
    const csv = 'Vorderseite;Rückseite\n... Uhr;ji (sanji desu) Es ist 3 Uhr.\ngehen;iku Befehlsform (Geh! oder Los! Los!) - ike ike!\nmachen;tsukuru (Ryouri o tsukuru)\nGestern;kinoo\n猫;cat\nWo ist die Toilette?;トイレはどこですか？\n';
    await dialog.getByLabel("CSV file").setInputFiles({ name: "Eigene Karten.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await dialog.getByText("6 ready to import.").waitFor();
    assert.equal(await dialog.getByRole("checkbox", { name: "Skip the first row (column headings)" }).isChecked(), true);
    assert.equal(await dialog.getByRole("listitem").count(), 6);
    assert.equal(await dialog.locator('.noji-card-editor:not([hidden])').count(), 0);
    assert.equal(await dialog.locator('.noji-note,.noji-add-note,.noji-card-format,.noji-kana-review').count(), 0);
    assert.equal(await dialog.getByLabel("Back for card 1", { exact: true }).inputValue(), "ji (sanji desu) Es ist 3 Uhr.");
    assert.equal(await dialog.getByLabel("Front for card 1", { exact: true }).inputValue(), "... Uhr");
    await dialog.getByRole("button", { name: "Edit card 1", exact: true }).click();
    await dialog.getByRole("button", { name: "Edit card 4", exact: true }).click();
    assert.equal(await dialog.locator('.noji-card-editor:not([hidden])').count(), 1);
    await dialog.getByLabel("Back for card 4", { exact: true }).fill("kinou");
    if (process.env.IKR_ROMAJI_IMPORT_SCREENSHOT) {
      await page.evaluate(() => IKnowReaderTheme.choose("midnight"));
      await page.getByRole("button", { name: "Theme, Midnight", exact: true }).waitFor();
      await page.screenshot({ path: process.env.IKR_ROMAJI_IMPORT_SCREENSHOT });
    }
    await dialog.getByRole("button", { name: "Import cards", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const originals = await page.evaluate(async () => (await IKnowReaderStudyStore.list()));
    assert.equal(originals.length, 6);
    assert.equal(originals.every(record => record.cardMode === "original"), true);
    const clock = originals.find(record => record.german === "... Uhr");
    assert.equal(clock.japanese, "ji (sanji desu) Es ist 3 Uhr.");
    assert.equal(clock.notes, undefined);
    const list = page.locator("#demo-library-list"), visibleText = page.locator('[data-original-side][data-visible=true] .focus-flashcard-text');
    const selectText=async(start,end)=>{
      const points=await visibleText.evaluate((element,[start,end])=>{
        const range=document.createRange();range.setStart(element.firstChild,start);range.collapse(true);const from=range.getBoundingClientRect();
        range.setStart(element.firstChild,end);range.collapse(true);const to=range.getBoundingClientRect();
        return {from:{x:from.x+0.5,y:from.y+from.height/2},to:{x:to.x+0.5,y:to.y+to.height/2}};
      },[start,end]);
      await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:12});await page.mouse.up();
    };
    const lastSpeech = async expected => {
      await page.getByRole("button", { name: "Listen with Mao Plain", exact: true }).click();
      await page.waitForFunction(async text => (await chrome.storage.local.get("testSpokenText")).testSpokenText === text, expected);
    };
    await list.locator(".library-row").filter({ hasText: "... Uhr" }).click();
    assert.equal(await visibleText.innerText(), "... Uhr");
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    assert.equal(await visibleText.innerText(), "ji (sanji desu) Es ist 3 Uhr.");
    assert.equal(await page.locator('[data-action="play"]').count(), 0);
    await selectText(4,14);
    assert.equal(await page.evaluate(()=>getSelection().toString()),'sanji desu');
    assert.equal(await page.locator('[data-action="card-whole-side"],[data-card-writing]').count(),0,'Copying a fragment never changes the card processing');
    assert.equal(await visibleText.innerText(), "ji (sanji desu) Es ist 3 Uhr.");
    assert.equal(await page.locator('[data-action="play"]').count(), 0);
    await list.locator(".library-row").filter({ hasText: "kinou" }).click();
    assert.equal(await visibleText.innerText(), "Gestern");
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    await lastSpeech("きのう");
    await page.getByRole("button", { name: "Hiragana", exact: true }).click();
    assert.equal(await visibleText.innerText(), "きのう");
    await page.getByRole("button", { name: "Katakana", exact: true }).click();
    assert.equal(await visibleText.innerText(), "キノウ");
    await page.getByRole("button", { name: "Romaji", exact: true }).click();
    assert.equal(await visibleText.innerText(), "kinou");
    await list.locator(".library-row").filter({ hasText: "猫" }).click();
    assert.equal(await visibleText.innerText(), "猫");
    await lastSpeech("猫");
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    assert.equal(await visibleText.innerText(), "cat");
    assert.equal(await page.locator('[data-action="play"]').count(), 0);
    await list.locator(".library-row").filter({ hasText: "トイレ" }).click();
    const faceBounds=await page.locator('[data-original-side][data-visible=true]').boundingBox(),textBounds=await visibleText.boundingBox();
    assert.ok(textBounds.width<faceBounds.width-50,'Selectable area wraps the actual sentence');
    await visibleText.dblclick({position:{x:8,y:textBounds.height/2}});
    assert.equal(await page.locator('[data-action="card-whole-side"],[data-card-writing="hiragana"],[data-card-writing="katakana"]').count(),0,'Double-click copying does not reinterpret German fragments');
    const blank={x:faceBounds.x+faceBounds.width-8,y:textBounds.y+textBounds.height/2};
    for(let index=0;index<12;index++)await page.mouse.click(blank.x,blank.y);
    assert.equal(await visibleText.innerText(),'Wo ist die Toilette?');
    assert.equal(await page.locator('[data-action="card-whole-side"],[data-card-writing="hiragana"],[data-card-writing="katakana"]').count(),0);
    assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);
    const cardBounds=await page.locator('.focus-original-card').boundingBox();
    await page.mouse.click(cardBounds.x+6,blank.y);
    assert.equal(await visibleText.innerText(),'トイレはどこですか？','Card padding also flips the card');
    await page.mouse.click(cardBounds.x+6,blank.y);
    assert.equal(await visibleText.innerText(),'Wo ist die Toilette?');
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    await selectText(0,3);
    assert.equal(await page.locator('[data-action="card-whole-side"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'Romaji',exact:true}).count(),1);
    await page.mouse.click(blank.x,blank.y);
    assert.equal(await visibleText.innerText(),'Wo ist die Toilette?');
    assert.equal(await page.locator('[data-action="card-whole-side"]').count(),0);
    assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);
    await page.getByRole('button',{name:'Show back',exact:true}).press('Enter');
    await page.getByRole("button", { name: "Romaji", exact: true }).click();
    assert.equal(await visibleText.innerText(), "toirehadokodesuka?");
    await page.getByRole("button", { name: "Japanese", exact: true }).click();
    assert.equal(await visibleText.innerText(), "トイレはどこですか？");
    await page.evaluate(async()=>IKnowReaderStudyStore.importCards({title:'Reading race',language:'de',cards:[{kind:'sentence',cardMode:'original',japanese:'写真を撮ってもいいですか？',meaning:'Darf ich ein Foto machen?'}]}));
    const photo=list.locator('.library-row').filter({hasText:'写真'});await photo.waitFor();await photo.click();
    await page.getByRole('button',{name:'Show back',exact:true}).press('Enter');
    await page.getByRole('button',{name:'Romaji',exact:true}).click();
    await page.waitForFunction(async()=>(await chrome.storage.local.get('testReadingText')).testReadingText?.startsWith('写真'));
    const photoCard=await page.locator('.focus-original-card').boundingBox();
    await page.mouse.click(photoCard.x+6,photoCard.y+photoCard.height/2);
    assert.equal(await visibleText.innerText(),'Darf ich ein Foto machen?');
    await page.waitForTimeout(400);
    assert.equal(await visibleText.innerText(),'Darf ich ein Foto machen?','Late Romaji result never replaces the opposite face');
    assert.equal(await page.locator('.noji-writing-tools button').count(),0);
    await page.getByRole('button',{name:'Show back',exact:true}).press('Enter');
    await page.getByRole('button',{name:'Romaji',exact:true}).click();
    assert.match(await visibleText.innerText(),/^shashin/,'A later deliberate retry uses the cached reading');
    if (process.env.IKR_ROMAJI_IMPORT_SCREENSHOT) await page.screenshot({ path: process.env.IKR_ROMAJI_IMPORT_SCREENSHOT.replace(/\.png$/u, "-study-back.png") });
    await page.reload();
    await list.locator(".library-row").filter({ hasText: "... Uhr" }).click();
    assert.equal(await visibleText.innerText(), "... Uhr");
    await page.locator('[data-action="practise-item"]').click();
    await page.locator('[data-action="start"]').click();
    await page.locator('.session-review').waitFor();
    assert.equal(await page.locator('.session-word').innerText(), "... Uhr");
    await page.reload();
    await page.locator('.session-review').getByRole("button", { name: "ji (sanji desu) Es ist 3 Uhr.", exact: true }).click();
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page.locator('.focus-results').waitFor();
    assert.match(await page.locator('.focus-result-score').innerText(), /100/);
    await page.getByRole("button", { name: "Back to study", exact: true }).click();
    await page.getByRole("button", { name: "Import Noji", exact: true }).click();
    const many = 'Vorderseite;Rückseite\n' + Array.from({ length: 250 }, (_, index) => `${index ? "Karte " + (index + 1) : "... Uhr"};${index === 249 ? "<img src=x onerror=window.nojiInjected=1>" : "ji (sanji desu) Es ist 3 Uhr." + (index ? " " + index : "")}`).join('\n');
    await dialog.getByLabel("CSV file").setInputFiles({ name: "250 cards.csv", mimeType: "text/csv", buffer: Buffer.from(many) });
    await dialog.getByText("250 ready to import.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Edit card 1", exact: true }).click();
    assert.equal(await dialog.locator('img').count(), 0);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 768 }, { width: 500, height: 740 }]) {
      await page.setViewportSize(viewport);
      const geometry = await dialog.evaluate(element => ({ client: element.clientHeight, content: element.scrollHeight, width: element.clientWidth, contentWidth: element.scrollWidth }));
      assert.ok(geometry.content <= geometry.client + 1, JSON.stringify(geometry));
      assert.ok(geometry.contentWidth <= geometry.width + 1, JSON.stringify(geometry));
      const scrolls = await dialog.locator('.noji-preview').evaluate(element => element.scrollHeight > element.clientHeight && element.clientHeight > 50);
      assert.equal(scrolls, true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    if (process.env.IKR_ROMAJI_IMPORT_SCREENSHOT) await page.screenshot({ path: process.env.IKR_ROMAJI_IMPORT_SCREENSHOT.replace(/\.png$/u, "-250.png") });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    assert.deepEqual(errors, []);
    console.log("PASS Noji blank-area flipping, copy-only text selection, no fragment controls, whole-card readings/audio, Review/refresh, backups and 250-card single scrolling");
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
