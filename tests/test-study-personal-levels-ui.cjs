'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-personal-levels-evidence','run-'+Date.now());fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
   const first={kind:'word',courseId:'19053',courseTitle:'Test course',sourceId:'one',japanese:'本',kana:'ほん',romaji:'hon',english:'book',german:'Buch',notes:'A note to delete.',audioUrl:'',key:'word:19053:one',createdAt:1,updatedAt:1},second={...first,sourceId:'two',japanese:'猫',kana:'ねこ',romaji:'neko',english:'cat',notes:'Keep this note.',key:'word:19053:two',createdAt:2,updatedAt:2};
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records:{[first.key]:first,[second.key]:second}},iknowReaderStudyLearning:{schemaVersion:1,records:{},session:null}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/study.html#study`);
  const row=()=>page.locator('#demo-library-list>.library-row[data-item="word:19053:one"]'),level=()=>row().locator('.strength'),menu=()=>page.locator('.focus-strength-menu');
  await row().waitFor();assert.equal(await level().innerText(),'New');const original=await page.locator('.focus-card').boundingBox();
  await row().click({button:'right'});await menu().waitFor();assert.equal(await menu().getAttribute('role'),'menu');assert.equal(await menu().locator('[data-level=auto]').getAttribute('aria-checked'),'true');assert.deepEqual(await page.locator('.focus-card').boundingBox(),original,'Opening the menu does not move the study card');
  await menu().locator('[data-level=weak]').click();await page.waitForFunction(()=>document.querySelector('[data-item="word:19053:one"] .strength')?.dataset.strength==='weak');assert.equal(await level().getAttribute('data-manual'),'true');assert.equal(await page.locator('.focus-card .japanese').innerText(),'本');
  let progress=await page.evaluate(()=>IKnowReaderStudyLearningStore.progress());assert.deepEqual(progress.records,{});assert.equal(progress.assessments['word:19053:one'].level,'weak');
  await page.reload();await row().waitFor();assert.equal(await level().innerText(),'Weak');
  await level().click();assert.equal(await menu().count(),0,'Left clicking a learning label only selects the vocabulary');await row().click({button:'right'});await menu().waitFor();await menu().locator('[data-level=strong]').click();await page.waitForFunction(()=>document.querySelector('[data-item="word:19053:one"] .strength')?.dataset.strength==='strong');
  await row().focus();await page.keyboard.press('Shift+F10');await menu().waitFor();await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-item="word:19053:one"] .strength')?.dataset.strength==='new');assert.equal(await level().getAttribute('data-manual'),'false');
  await row().click();await page.locator('[data-action=delete-note]').waitFor();
  await page.evaluate(()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);let fail=true;chrome.runtime.sendMessage=(...args)=>{if(fail&&args[0]?.type==='ikr:study:notes'){fail=false;return Promise.resolve({ok:false,message:'Simulated delete failure'});}return send(...args);};});
  await page.locator('[data-action=delete-note]').click();await page.locator('.focus-note-status[data-error=true]').waitFor();assert.equal(await page.locator('.focus-note-text').innerText(),'A note to delete.');
  await page.locator('[data-action=delete-note]').click();await page.locator('#focus-note').waitFor({state:'hidden'});let library=await page.evaluate(()=>IKnowReaderStudyStore.list());assert.equal(library.length,2);assert.equal(library.find(x=>x.sourceId==='one').notes,'');assert.equal(library.find(x=>x.sourceId==='two').notes,'Keep this note.');
  await page.reload();await row().waitFor();assert.equal(await page.locator('#focus-note').isHidden(),true);await page.locator('[data-action=note]').click();await page.locator('#focus-note-input').fill('Delete from edit mode');await page.locator('[data-action=save-note]').click();await page.locator('[data-action=edit-note]').click();await page.locator('[data-action=delete-note]').click();await page.locator('#focus-note').waitFor({state:'hidden'});
  await page.evaluate(()=>IKnowReaderStudyStore.updateNotes('word:19053:one','A note for style checks.'));
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);await page.reload();await row().waitFor();
   await page.evaluate(()=>IKnowReaderStudyLearningStore.setAssessment({key:'word:19053:one',level:'weak'}));await page.waitForFunction(()=>document.querySelector('[data-item="word:19053:one"] .strength')?.dataset.manual==='true');
   await level().hover();const style=await level().evaluate(node=>({decoration:getComputedStyle(node).textDecorationLine,after:getComputedStyle(node,'::after').content}));
   assert.equal(style.decoration,'none');assert.ok(['none','normal','""'].includes(style.after),'No Yours text is painted beside personal levels');
   await page.locator('[data-action=delete-note]').hover();assert.equal(await page.locator('[data-action=delete-note]').evaluate(node=>getComputedStyle(node).textDecorationLine),'none','Delete note never inherits the quiet action underline');
   await page.screenshot({path:path.join(out,theme+'-manual-label-note.png')});
   await level().click();assert.equal(await menu().count(),0);await row().click({button:'right'});await menu().waitFor();const bounds=await menu().boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1440&&bounds.y+bounds.height<=900);await page.screenshot({path:path.join(out,theme+'-levels.png')});await page.keyboard.press('Escape');assert.equal(await menu().count(),0);
  }
  await page.setViewportSize({width:390,height:760});await row().click({button:'right'});await menu().waitFor();const bounds=await menu().boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=760);await page.screenshot({path:path.join(out,'mobile-levels.png')});
  assert.deepEqual(errors,[]);console.log('PASS Personal-level menu: right click and keyboard only, no Yours suffix, persistence, Automatic reset, four-theme/mobile geometry, note deletion read/edit/failure/reload without deleting vocabulary');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
