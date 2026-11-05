const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'ikr-study-display-levels-'));
 const extension=require('./fixtures/isolate-extension.cjs')(path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),origin='chrome-extension://'+new URL(worker.url()).host,errors=[];
  await worker.evaluate(async()=>{
   const words=[['本','ほん','hon','book','weak'],['猫','ねこ','neko','cat','strong'],['雨','あめ','ame','rain','learning'],['犬','いぬ','inu','dog','new'],['山','やま','yama','mountain','weak']];
   const records={},assessments={};words.forEach(([japanese,kana,romaji,english,level],index)=>{const key='word:19053:filter-'+index;records[key]={key,kind:'word',courseId:'19053',courseTitle:'Test course',sourceId:'filter-'+index,japanese,kana,romaji,english,createdAt:index+1,updatedAt:index+1};assessments[key]={level,updatedAt:100};});
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records},iknowReaderStudyLearning:{schemaVersion:1,records:{},assessments,session:null}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/study.html#study');
  const toggle=page.locator('#always-show-romaji'),tokens=page.locator('#focus-romaji [data-reading-index]');
  await toggle.waitFor({state:'visible'});assert.equal(await toggle.isChecked(),false);assert.equal(await tokens.first().innerText(),'•••');
  await page.locator('[data-action="note"]').click();const note=page.locator('#focus-note-input');await note.fill('Unsaved note stays here');
  await toggle.check();await page.waitForFunction(async()=> (await IKnowReaderStudyStore.getPreferences()).showRomaji===true);
  assert.equal(await tokens.first().innerText(),'hon');assert.equal(await tokens.first().isDisabled(),true);assert.equal(await note.inputValue(),'Unsaved note stays here');
  await page.locator('#demo-library-list [data-item="word:19053:filter-1"]').click();assert.equal(await tokens.first().innerText(),'neko');
  await page.reload();await toggle.waitFor();assert.equal(await toggle.isChecked(),true);assert.equal(await tokens.first().innerText(),'neko');
  await toggle.uncheck();await page.waitForFunction(async()=> (await IKnowReaderStudyStore.getPreferences()).showRomaji===false);assert.equal(await tokens.first().innerText(),'•••');
  await tokens.first().click();assert.equal(await tokens.first().innerText(),'neko');
  await page.evaluate(()=>IKnowReaderStudyStore.importCards({title:'Noji filter',language:'de',cards:[{kind:'word',japanese:'こんにちは',meaning:'Hallo'}]}));
  await page.locator('[data-library-source="noji"]').click();await page.locator('.focus-original-card').waitFor();assert.equal(await toggle.isVisible(),false);assert.equal(await page.locator('#demo-strength').isVisible(),true);assert.equal(await page.locator('#demo-kind').isVisible(),false);
  await page.locator('[data-library-source="iknow"]').click();
  const level=page.locator('#demo-strength');await level.selectOption('weak');assert.equal(await page.locator('#demo-library-list>.library-row').count(),2);assert.equal(await page.locator('#demo-library-list .strength[data-strength="weak"]').count(),2);
  await page.reload();await level.waitFor();assert.equal(await level.inputValue(),'weak');assert.equal(await page.locator('#demo-library-list>.library-row').count(),2);
  for(const [value,count] of [['new',1],['learning',1],['strong',1],['weak',2]]){await level.selectOption(value);assert.equal(await page.locator('#demo-library-list>.library-row').count(),count);}
  await toggle.check();
  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);
   for(const height of [720,900]){
    await page.setViewportSize({width:1280,height});
    const geometry=await page.evaluate(()=>{const input=document.querySelector('#always-show-romaji'),label=input.closest('label').getBoundingClientRect(),list=document.querySelector('#demo-library-list').getBoundingClientRect(),filter=document.querySelector('#demo-strength').getBoundingClientRect();return{label:{left:label.left,right:label.right,top:label.top,bottom:label.bottom},list:{top:list.top,bottom:list.bottom},filterBottom:filter.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};});
    assert.ok(geometry.label.left>=0&&geometry.label.right<=geometry.width&&geometry.label.bottom<=geometry.height,theme+' toggle fits');
    assert.ok(geometry.list.top>=geometry.filterBottom&&geometry.list.bottom<=geometry.height,theme+' filters leave an internally scrolling library');
    assert.ok(geometry.scrollWidth<=geometry.width&&geometry.scrollHeight<=geometry.height,theme+' page stays inside viewport');
   }
  }
  await page.setViewportSize({width:1440,height:900});
  if(process.env.IKR_STUDY_DISPLAY_SCREENSHOT)await page.screenshot({path:process.env.IKR_STUDY_DISPLAY_SCREENSHOT});
  await page.locator('[data-view="practice"]').click();await page.locator('[data-action="choose"]').click();assert.equal(await page.locator('#picker-strength').inputValue(),'weak');assert.equal(await page.locator('#picker-list>.library-row').count(),2);
  await page.locator('[data-action="select-all"]').click();assert.equal(await page.locator('#picker-count').innerText(),'2 selected');await page.locator('[data-action="close-picker"]').click();
  await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();
  const session=await page.evaluate(()=>IKnowReaderStudyLearningStore.getSession());assert.equal(session.cards.length,2);assert.deepEqual(session.cards.map(card=>card.key).sort(),['word:19053:filter-0','word:19053:filter-4']);
  assert.deepEqual(errors,[]);console.log('PASS Persistent always-on Romaji across cards/refresh without losing note drafts; Noji unchanged; all level filters and Weak-only practice selection/session');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
