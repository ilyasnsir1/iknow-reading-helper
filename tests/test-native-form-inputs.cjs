'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const source=path.resolve(__dirname,'../extension');
(async()=>{
  for(const name of fs.readdirSync(source).filter(name=>name.endsWith('.html'))){
    const html=fs.readFileSync(path.join(source,name),'utf8');
    assert.equal((html.match(/src="form-inputs.js"/g)||[]).length,1,name);
    assert.doesNotMatch(html,/note-writing/);
  }
  assert.equal(fs.existsSync(path.join(source,'note-writing.js')),false);
  assert.equal(fs.existsSync(path.join(source,'note-writing.css')),false);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ikr-native-inputs-'));
  const extension=require('./fixtures/isolate-extension.cjs')(source,temporary);
  const context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,viewport:{width:1440,height:900},ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/study.html`);
    await page.getByRole('button',{name:'Import Noji',exact:true}).waitFor();
    await page.evaluate(()=>IKnowReaderStudyStore.save({kind:'word',courseId:'19053',sourceId:'native-inputs',japanese:'能力',kana:'のうりょく',romaji:'nouryoku',english:'capability, capacity, ability'}));
    await page.locator('#demo-library-list .library-row').first().click();
    await page.locator('[data-action="note"]').click();
    const note=page.locator('#focus-note-input');
    for(const theme of ['paper','midnight','tokyo','forest']){
      await page.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);
      await note.click();await note.fill('Native note');await note.press('End');await note.pressSequentially('!');
      assert.equal(await note.inputValue(),'Native note!');
      await note.press('Control+z');assert.equal(await note.inputValue(),'Native note');
      await note.evaluate(input=>input.setSelectionRange(2,6));
      assert.equal(await note.evaluate(input=>input.value.slice(input.selectionStart,input.selectionEnd)),'tive');
      const native=await note.evaluate(input=>{const style=getComputedStyle(input);return{caret:style.caretColor,fill:style.webkitTextFillColor,color:style.color,spellcheck:input.spellcheck,correct:input.getAttribute('autocorrect'),effect:globalThis.IKnowWritingEffects||globalThis.IKnowNoteWriting||null};});
      assert.notEqual(native.caret,'rgba(0, 0, 0, 0)');assert.equal(native.fill,native.color);assert.equal(native.spellcheck,false);assert.equal(native.correct,'off');assert.equal(native.effect,null);
      assert.equal(await page.locator('[class*="note-writing"]').count(),0);
    }
    await note.fill('Saved without animation');await page.locator('[data-action="save-note"]').click();
    await page.getByText('Saved without animation',{exact:true}).waitFor();
    const search=page.locator('#demo-search');await search.fill('能力');assert.equal(await page.locator('#demo-library-list>.library-row').count(),1);await search.fill('absent');assert.equal(await page.locator('#demo-library-list>.library-row').count(),0);await search.fill('');
    await page.getByRole('button',{name:'Import Noji',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Import Noji cards'});
    await dialog.getByLabel('CSV file').setInputFiles({name:'Native.csv',mimeType:'text/csv',buffer:Buffer.from('Front;Back\r\nHallo;こんにちは\r\n')});
    await dialog.getByRole('button',{name:'Edit card 1',exact:true}).click();
    const front=dialog.getByLabel('Front for card 1',{exact:true});await front.click();await front.pressSequentially('!');
    assert.equal(await front.evaluate(input=>input.spellcheck),false);
    assert.notEqual(await front.evaluate(input=>getComputedStyle(input).caretColor),'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('[class*="note-writing"]').count(),0);assert.deepEqual(errors,[]);
    console.log('PASS Native search, note editing/undo/selection/save and dynamic import fields across four themes; no typing layers or custom cursor; spelling corrections stay off');
  }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
