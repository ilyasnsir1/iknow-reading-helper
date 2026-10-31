/* Inline notes use the real extension stores; all data and profiles are disposable. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-workspace-inline-notes-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],evidence=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
   const record=(sourceId,courseId,japanese,english,notes,at)=>({kind:'word',courseId,courseTitle:'Saved source '+courseId,sourceId,japanese,kana:'ほん',romaji:'hon',english,german:'Buch',audioUrl:'',notes,key:`word:${courseId}:${sourceId}`,createdAt:at,updatedAt:at});
   const one=record('one','19053','本','book','First line\nA saved reminder.',2),two=record('two','19055','書','writing','',1);
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records:{[one.key]:one,[two.key]:two}},iknowReaderTheme:'paper',iknowReaderSettings:IKnowReaderCore.normalizeSettings({translationLanguage:'en'})});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${id}/study.html`);await page.locator('.library-row').first().waitFor();
  const one='.library-row[data-item="word:19053:one"]',two='.library-row[data-item="word:19055:two"]';
  await page.locator(one).click();assert.equal(await page.locator('.focus-note-text').innerText(),'First line\nA saved reminder.','A saved note is visible without opening Note');assert.equal(await page.locator('[role="dialog"]').count(),0);
  await page.locator(two).click();assert.equal(await page.locator('#focus-note').isHidden(),true,'A word without a note does not show an empty note box');
  await page.locator('[data-action="note"]').click();await page.locator('#focus-note-input').waitFor();assert.equal(await page.locator('[role="dialog"]').count(),0,'The Note button opens an inline editor');assert.equal(await page.locator('[data-action="save-note"]').isDisabled(),true);
  const raw='  My own note\nA second line.  ';await page.locator('#focus-note-input').fill(raw);await page.locator('[data-action="save-note"]').click();await page.locator('#focus-note[data-note-state="read"]').waitFor();assert.equal(await page.locator('.focus-note-text').textContent(),raw,'Saved note preserves whitespace and line breaks');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLibrary')).iknowReaderStudyLibrary.records['word:19055:two'].notes),raw);
  await page.locator('[data-action="edit-note"]').click();await page.locator('#focus-note-input').fill('Discard this draft');await page.locator('[data-action="cancel-note"]').click();assert.equal(await page.locator('.focus-note-text').textContent(),raw,'Cancel restores the saved note');
  await page.locator('[data-action="edit-note"]').click();await page.locator('#focus-note-input').fill('Keep this unsaved draft');await page.locator(one).click();assert.equal(await page.locator('.focus-note-text').innerText(),'First line\nA saved reminder.');await page.locator(two).click();assert.equal(await page.locator('#focus-note-input').inputValue(),'Keep this unsaved draft','Switching vocabulary keeps the draft for its own word');
  await page.locator('[data-action="compare"]').click();await page.locator('#focus-compare:not([hidden])').waitFor();
  await page.locator('#focus-note-input').evaluate(input=>{input.focus({preventScroll:true});input.setSelectionRange(3,7);window.noteIdentity={input,card:document.querySelector('.focus-card'),compare:document.getElementById('focus-compare')};});
  await page.evaluate(()=>IKnowReaderStudyStore.save({kind:'word',courseId:'19053',courseTitle:'Saved source19053',sourceId:'unrelated',japanese:'猫',kana:'ねこ',romaji:'neko',english:'cat',german:'Katze',audioUrl:''}));await page.locator('.library-row[data-item="word:19053:unrelated"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>({input:noteIdentity.input===document.getElementById('focus-note-input'),card:noteIdentity.card===document.querySelector('.focus-card'),compare:noteIdentity.compare===document.getElementById('focus-compare'),start:document.getElementById('focus-note-input').selectionStart,end:document.getElementById('focus-note-input').selectionEnd})),{input:true,card:true,compare:true,start:3,end:7},'A live unrelated save retains editor, caret, card and comparison panel');
  await page.evaluate(()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);let fail=true;chrome.runtime.sendMessage=(...args)=>{if(fail&&args[0]?.type==='ikr:study:notes'){fail=false;return Promise.resolve({ok:false,message:'Simulated note write failure'});}return send(...args);};});
  await page.locator('[data-action="save-note"]').click();await page.locator('.focus-note-status[data-error="true"]').waitFor();assert.match(await page.locator('.focus-note-status').innerText(),/Simulated note write failure/);assert.equal(await page.locator('#focus-note-input').inputValue(),'Keep this unsaved draft');assert.equal(await page.locator('#focus-note-input').isEnabled(),true);assert.equal(await page.locator('[data-action="save-note"]').isEnabled(),true);
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLibrary')).iknowReaderStudyLibrary.records['word:19055:two'].notes),raw,'A failed write does not alter the saved note');
  await page.locator('[data-action="save-note"]').click();await page.locator('#focus-note[data-note-state="read"]').waitFor();assert.equal(await page.locator('.focus-note-text').innerText(),'Keep this unsaved draft');
  await page.locator('[data-action="edit-note"]').click();await page.locator('#focus-note-input').fill('');assert.equal(await page.locator('[data-action="save-note"]').isEnabled(),true,'An empty changed value can remove an existing note');await page.locator('[data-action="save-note"]').click();await page.locator('#focus-note').waitFor({state:'hidden'});assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLibrary')).iknowReaderStudyLibrary.records['word:19055:two'].notes),'');
  await page.locator(one).click();
  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);await page.waitForFunction(theme=>document.documentElement.dataset.ikrTheme===theme,theme);
   for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844}]){
    await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Notes never create horizontal page overflow');
    const readGeometry=await page.locator('#focus-note').evaluate(note=>{const card=note.closest('.focus-card').getBoundingClientRect(),box=note.getBoundingClientRect(),text=note.querySelector('.focus-note-text');return{cardWidth:card.width,width:box.width,textAlign:getComputedStyle(text).textAlign,whiteSpace:getComputedStyle(text).whiteSpace};});assert.ok(readGeometry.width<=readGeometry.cardWidth);assert.equal(readGeometry.textAlign,'left');assert.equal(readGeometry.whiteSpace,'pre-wrap');
    await page.locator('[data-action="edit-note"]').click();const editor=await page.locator('#focus-note-input').evaluate(input=>{const box=input.getBoundingClientRect(),note=input.closest('.focus-note').getBoundingClientRect();return{width:box.width,noteWidth:note.width,radius:getComputedStyle(input).borderRadius};});assert.ok(editor.width<=editor.noteWidth+1);assert.equal(editor.radius,'4px');assert.equal(await page.locator('[role="dialog"]').count(),0);
    evidence.push({theme,viewport,readGeometry,editor});await page.locator('[data-action="cancel-note"]').click();
   }
   await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,`${theme}-inline.png`)});
  }
  await page.reload();await page.locator(one).waitFor();await page.locator(one).click();assert.equal(await page.locator('.focus-note-text').innerText(),'First line\nA saved reminder.','Original saved notes survive reload');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS Inline notes: saved text visible, inline edit/save/cancel/remove, per-word drafts, live editor/caret retention, failed write retry, actual storage and four-theme desktop/mobile geometry');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
