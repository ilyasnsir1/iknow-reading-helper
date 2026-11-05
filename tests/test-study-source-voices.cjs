const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Core = require("../extension/core.js");
const { chromium } = require(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));

async function main() {
  assert.equal(Core.normalizeSettings({ sentenceVoice: "male" }).nojiVoice, "male");
  assert.equal(Core.normalizeSettings({ sentenceVoice: "male", nojiVoice: "female" }).nojiVoice, "female");
  assert.equal(Core.normalizeSettings({ nojiVoice: "original" }).nojiVoice, "female");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ikr-source-voices-"));
  const extension = require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname, "../extension"), folder);
  const background = path.join(extension, "background.js");
  fs.writeFileSync(path.join(extension, "test-source-voices.js"), `chrome.runtime.connectNative = () => {
    const callbacks = [];
    return { onMessage: { addListener: fn => callbacks.push(fn) }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage(message) {
        if (message.type !== "word-neural") return;
        chrome.storage.local.set({ testLastVoice: { text: message.text, voice: message.voice } }).then(() => callbacks.forEach(fn => fn({ type: "word-neural-result", requestId: message.requestId, ok: false })));
      }
    };
  };`);
  fs.writeFileSync(background, 'importScripts("test-source-voices.js");\n' + fs.readFileSync(background, "utf8"));
  const context = await chromium.launchPersistentContext(path.join(folder, "profile"), {
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true,
    viewport: { width: 1280, height: 900 }, ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    await page.goto(origin + "/study.html");
    await page.getByRole("button", { name: "Import Noji", exact: true }).waitFor();
    await page.evaluate(async () => {
      await IKnowReaderStudyStore.save({ kind: "word", courseId: "19053", sourceId: "voice-word", japanese: "猫", romaji: "neko", kana: "ねこ", english: "cat", audioUrl: "https://assets.iknow.jp/audio/neko.mp3" });
      await IKnowReaderStudyStore.importCards({ title: "Noji voice", language: "de", cards: [{ kind: "word", japanese: "こんにちは", meaning: "Hallo" }] });
    });
    const library = page.locator("#demo-library-list");
    const playButton = page.locator('.focus-card [data-action="play"]');
    const chooseVoice = async (voice, label) => {
      await playButton.click({ button: "right" });
      const menu = page.getByRole("menu", { name: "Voice for " + label + " cards" });
      await menu.locator(`[data-study-voice="${voice}"]`).click();
      assert.equal(await page.locator(".focus-voice-menu").count(), 0);
    };
    const checkVolume=async label=>{await page.locator('.focus-card [data-audio-volume-menu]').click();assert.deepEqual(await page.locator('.ikr-volume-menu .ikr-volume-row>span').allTextContents(),[label,'My recording']);assert.deepEqual(await page.locator('.ikr-volume-menu [data-audio-volume]').evaluateAll(nodes=>nodes.map(node=>node.dataset.audioVolume)),[label==='iKnow audio'?'original':'word','recording']);await page.keyboard.press('Escape');};
    await library.locator(".library-row").filter({ hasText: "こんにちは" }).click();
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    await checkVolume('Local AI voice · Mao Plain');
    const checkMetrics=locator=>locator.evaluate(node=>{const css=getComputedStyle(node);return{tag:node.tagName.toLowerCase(),viewBox:node.getAttribute('viewBox'),path:node.querySelector('path')?.getAttribute('d'),width:css.width,height:css.height,fill:css.fill,stroke:css.strokeWidth,cap:css.strokeLinecap,join:css.strokeLinejoin,opacity:css.opacity};});
    for(const [theme,label] of [['paper','Original'],['midnight','Midnight'],['tokyo','Tokyo Neon'],['forest','Kyoto Forest']]){
      await page.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);
      await page.getByRole('button',{name:'Theme, '+label,exact:true}).click();
      const reference=await checkMetrics(page.locator('.focus-menu-theme [aria-selected="true"] .focus-menu-check'));
      assert.deepEqual(reference,{tag:'svg',viewBox:'0 0 16 16',path:'m3.5 8 3 3 6-6',width:'13px',height:'13px',fill:'none',stroke:'1.6px',cap:'round',join:'round',opacity:'1'});
      await playButton.click({button:'right'});
      assert.deepEqual(await checkMetrics(page.locator('.focus-voice-menu [aria-checked="true"] .focus-voice-check')),reference);
      await library.locator('.library-row').filter({hasText:'こんにちは'}).click({button:'right'});
      assert.deepEqual(await checkMetrics(page.locator('.focus-strength-menu [aria-checked="true"] .level-check')),reference);
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.locator(".focus-voice-picker,.focus-voice-options").count(), 0);
    const boundsBefore = await playButton.boundingBox();
    await playButton.click({ button: "right" });
    let options = page.getByRole("menu", { name: "Voice for Noji cards" });
    assert.equal(await options.getByRole("menuitemradio").count(), 2);
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get("testLastVoice")).testLastVoice), undefined);
    assert.deepEqual(await playButton.boundingBox(), boundsBefore);
    assert.equal(await options.locator('[data-study-voice="female"]').getAttribute("aria-checked"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".focus-voice-menu").count(), 0);
    assert.equal(await playButton.evaluate(node => node === document.activeElement), true);
    await playButton.press("Shift+F10");
    await options.waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await options.locator('[data-study-voice="male"]').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".focus-voice-menu").count(), 0);
    await page.getByRole("button", { name: "Listen with Nise", exact: true }).click();
    await page.waitForFunction(async () => (await chrome.storage.local.get("testLastVoice")).testLastVoice?.voice === "male");
    assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get("testLastVoice")).testLastVoice), { text: "こんにちは", voice: "male" });
    await checkVolume('Local AI voice · Nise');
    await library.locator(".library-row").filter({ hasText: "猫" }).click();
    await checkVolume('iKnow audio');
    assert.equal(await page.locator('.focus-card [data-action="reveal-reading"]').count(),0);
    const wordReading=page.locator('.focus-card [data-reading-index="0"]');
    await wordReading.click();assert.equal(await wordReading.innerText(),'neko');
    const readingAlignment=await wordReading.evaluate(node=>{const pill=node.getBoundingClientRect(),heading=document.querySelector('.focus-card .japanese').getBoundingClientRect();return Math.abs(pill.x+pill.width/2-heading.x-heading.width/2);});
    assert.ok(readingAlignment<=1,'The iKnow reading is centered below Japanese');
    await wordReading.click();assert.equal(await wordReading.innerText(),'•••');
    await playButton.click({ button: "right" });
    options = page.getByRole("menu", { name: "Voice for iKnow cards" });
    assert.equal(await options.getByRole("menuitemradio").count(), 3);
    assert.equal(await options.locator('[data-study-voice="original"]').getAttribute("aria-checked"), "true");
    await page.locator(".focus-top").click();
    assert.equal(await page.locator(".focus-voice-menu").count(), 0);
    for (const [voice, label] of [["female", "Mao Plain"], ["male", "Nise"]]) {
      await chooseVoice(voice, "iKnow");
      await page.getByRole("button", { name: "Listen with " + label, exact: true }).click();
      await page.waitForFunction(async voice => { const value = (await chrome.storage.local.get("testLastVoice")).testLastVoice; return value?.voice === voice && value.text === "猫"; }, voice);
      await checkVolume('Local AI voice · '+label);
    }
    await chooseVoice("original", "iKnow");
    await page.getByRole("button", { name: "Listen to original", exact: true }).waitFor();
    await library.locator(".library-row").filter({ hasText: "こんにちは" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Show back", exact: true }).press('Enter');
    await page.getByRole("button", { name: "Listen with Nise", exact: true }).waitFor();
    await playButton.click({ button: "right" });
    options = page.getByRole("menu", { name: "Voice for Noji cards" });
    await options.locator('[data-study-voice="male"][aria-checked="true"]').waitFor();
    if (process.env.IKR_SOURCE_VOICE_SCREENSHOT) {
      await page.keyboard.press("Escape");
      await page.evaluate(() => IKnowReaderTheme.choose("midnight"));
      await page.getByRole("button", { name: "Theme, Midnight", exact: true }).waitFor();
      await playButton.click({ button: "right" });
      await page.screenshot({ path: process.env.IKR_SOURCE_VOICE_SCREENSHOT });
    }
    const popup = await context.newPage(); await popup.goto(origin + "/popup.html");
    await popup.locator("#nojiVoice").selectOption("female");
    await options.locator('[data-study-voice="female"][aria-checked="true"]').waitFor();
    await page.getByRole("button", { name: "Listen with Mao Plain", exact: true }).waitFor();
    const settings = await page.evaluate(async () => (await chrome.storage.local.get("iknowReaderSettings")).iknowReaderSettings);
    assert.equal(settings.sentenceVoice, "original");
    assert.equal(settings.nojiVoice, "female");
    await page.goto(origin+'/study.html#kana');
    await page.locator('[data-kana-action="clear"]').click();
    await page.locator('[data-kana-select="basic:あ"]').click();
    await page.locator('[data-kana-action="start"]').click();
    await page.locator('[data-kana-answer]').fill('a');
    await page.locator('[data-kana-check]').click();
    assert.deepEqual(await checkMetrics(page.locator('.kana-quiz-feedback .ui-check')),{tag:'svg',viewBox:'0 0 16 16',path:'m3.5 8 3 3 6-6',width:'13px',height:'13px',fill:'none',stroke:'1.6px',cap:'round',join:'round',opacity:'1'});
    console.log("PASS Theme/voice/learning checkmark parity across four themes and Kana feedback, right-click selection, stable layout, native voice payloads, persistence and live popup synchronization");
  } finally {
    await context.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
