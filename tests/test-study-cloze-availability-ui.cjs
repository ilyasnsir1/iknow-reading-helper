/* Real setup controls: exact availability reasons and sentence-only gap choices. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const choose=require('./fixtures/choose-workspace-option.cjs'),Catalog=require('../extension/study-catalog.js'),Practice=require('../extension/study-practice.js');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-cloze-availability-ui-evidence','run-'+Date.now());
const cue=(id,text,jpan,kana,romaji)=>({id,text,transliterations:{Jpan:jpan,Hrkt:kana,Latn:romaji}});
const example=(id,text,jpan,kana,romaji,english)=>({cue:cue(id,text,jpan,kana,romaji),response:{text:english}});
const entry=(id,japanese,kana,romaji,english,sentences)=>({item:{id,cue:cue(id,japanese,japanese,kana,romaji),response:{text:english}},sentences});
const source={id:19053,title:'Cloze availability course',cue_language:'ja',goal_items:[
 entry(1,'本','ほん','hon','book',[example(101,'本を読む。','本 を 読む 。','ほん を よむ。','hon wo yomu.','Read a book.')]),
 entry(2,'魚','さかな','sakana','fish',[]),
 entry(3,'書く','かく','kaku','write',[example(103,'私は新聞を読みます。','私 は 新聞 を 読みます 。','わたし は しんぶん を よみます。','watashi ha shinbun wo yomimasu.','I read a newspaper.')]),
 entry(4,'青い','あおい','aoi','blue',[example(104,'空は青い。','空 は 青い','そら は あおい。','sora ha aoi.','The sky is blue.')])
]};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const extension=path.join(out,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
 const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
 const staged=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(staged.status,0,staged.stderr||staged.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];let courseRequests=0;
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const catalog=Catalog.normalizeSource(source),book=catalog.records.find(record=>record.kind==='word'&&record.sourceId==='1'),sentence=catalog.records.find(record=>record.kind==='sentence'&&record.sourceId==='101');
  await worker.evaluate(async({source,book,sentence})=>{const records={};for(const [index,record] of [book,sentence].entries())records[record.key]={...record,createdAt:index+1,updatedAt:index+1};await chrome.storage.local.set({iknowReaderStudyCatalog:{schemaVersion:1,entries:{19053:{at:Date.now(),source}}},iknowReaderStudyLibrary:{schemaVersion:1,records}});},{source,book,sentence});
  await context.route('https://iknow.jp/api/v2/goals/*',route=>{courseRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify(source)});});
  let page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`chrome-extension://${id}/study.html#practice`);await page.locator('[data-mode="cloze"]').click();await page.locator('[data-practice-source="course"]').click();
  await page.locator('.course-source-ready').waitFor();
  const gap=page.locator('[data-choice="gap-position"]'),status=page.locator('#demo-practice-source-status');
  assert.equal(await page.locator('.activity-heading small').innerText(),'1 available');assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (1)');
  assert.equal(await gap.count(),0,'Vocabulary always tests its own target and offers no irrelevant Random word setting');
  let message=await status.innerText();assert.match(message,/1 word has no example sentence/);assert.match(message,/1 example has no reliable word boundaries/);assert.match(message,/1 word could not be matched to its example/);assert.doesNotMatch(message,/unavailable|download/i);
  await page.evaluate(()=>{globalThis.originalCourseInput=document.getElementById('demo-practice-course');});
  await choose(page,'#demo-practice-content','sentence');assert.equal(await gap.count(),1);assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (2)');assert.match(await status.innerText(),/1 example has no reliable word boundaries/);
  await choose(page,'#demo-practice-content','both');assert.equal(await gap.count(),1);assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (3)');
  await choose(page,'#demo-gap-position','first');await choose(page,'#demo-practice-content','word');assert.equal(await gap.count(),0);
  await choose(page,'#demo-practice-content','sentence');assert.equal(await page.locator('#demo-gap-position').getAttribute('data-value'),'first','A hidden preference is retained when sentence practice returns');
  assert.equal(await page.evaluate(()=>originalCourseInput===document.getElementById('demo-practice-course')),true,'Changing content does not replace the course input or produce a loading flash');
  await choose(page,'#demo-practice-content','word');await page.locator('[data-mode="listening"]').click();assert.equal(await gap.count(),0);assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);assert.match(await status.innerText(),/4 questions have no original recording/);
  await page.locator('[data-mode="review"]').click();assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (4)');assert.equal(await page.locator('.course-feedback').isVisible(),false);
  await page.locator('[data-mode="cloze"]').click();await page.locator('[data-practice-source="saved"]').click();
  async function select(keys){await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();for(const key of keys)await page.locator(`[data-picker-row][data-item="${key}"]`).click();await page.locator('[data-action="close-picker"]').click();}
  await select([book.key]);assert.equal(await gap.count(),0);await select([sentence.key]);assert.equal(await gap.count(),1);await select([book.key,sentence.key]);assert.equal(await gap.count(),1);
  await select([book.key]);assert.equal(await gap.count(),0);await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();assert.equal(await page.locator('.session-progress span').innerText(),'1 of 1');
  await page.screenshot({path:path.join(out,'word-session.png')});
  await page.locator('[data-action="end-session"]').click();await page.close();
  const realPath=process.env.IKR_CLOZE_COURSE_SOURCE||path.resolve(__dirname,'../../native-audio-audit/goal-19057.json');
  if(fs.existsSync(realPath)){
   const realSource=JSON.parse(fs.readFileSync(realPath,'utf8')),realCatalog=Catalog.normalizeSource(realSource),word=realCatalog.records.find(record=>record.kind==='word'&&record.japanese==='集まる');
   assert.ok(word,'The real course fixture contains the previously excluded inflected word');
   const expected=Practice.buildCloze(word),oldWord=structuredClone(word),note='Keep my own note when source targets are added.';
   delete oldWord.context.clozeTarget;oldWord.notes=note;oldWord.createdAt=10;oldWord.updatedAt=10;
   await worker.evaluate(async({realSource,oldWord})=>chrome.storage.local.set({iknowReaderStudyCatalog:{schemaVersion:1,entries:{19057:{at:Date.now(),source:realSource}}},iknowReaderStudyLibrary:{schemaVersion:1,records:{[oldWord.key]:oldWord}},iknowReaderStudyLearning:{schemaVersion:1,records:{},session:null}}),{realSource,oldWord});
   const requestsBefore=courseRequests;
   page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{const key='ikr-layout-review:practice-course';if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify({schemaVersion:1,courseId:'19057',input:'19057',content:'word',order:'course',source:'course',mode:'cloze'}));});
   await page.goto(`chrome-extension://${id}/study.html#practice`);await page.locator('.course-source-ready').waitFor();
   assert.equal(await page.locator('.activity-heading small').innerText(),'200 available');assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (200)');assert.equal(await page.locator('[data-choice="gap-position"]').count(),0);assert.equal(await page.locator('.course-feedback').isVisible(),false,'The recovered real course has no skipped-question notice');
   const enriched=await worker.evaluate(async key=>(await chrome.storage.local.get('iknowReaderStudyLibrary')).iknowReaderStudyLibrary.records[key],oldWord.key);
   assert.equal(enriched.notes,note);assert.equal(enriched.createdAt,10);assert.equal(enriched.context.clozeTarget.japanese.text,'集まって');assert.equal(enriched.context.japanese,oldWord.context.japanese);assert.equal(courseRequests,requestsBefore,'A cached production course enriches the old bookmark without any HTTP request');
   await page.screenshot({path:path.join(out,'real-19057-200-available.png')});
   await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();assert.equal(await page.locator('.session-progress span').innerText(),'1 of 200');
   const fullSession=await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLearning')).iknowReaderStudyLearning.session);assert.equal(fullSession.cards.length,200);assert.ok(fullSession.cards.every(card=>card.context.clozeTarget),'All 200 real vocabulary cards retain their source target in the checkpoint');
   await page.locator('[data-action="end-session"]').click();await page.locator('[data-view="practice"]').click();await page.locator('[data-practice-source="saved"]').click();await select([oldWord.key]);
   await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();
   const prompt=expected.before+' _____ '+expected.after;assert.equal(await page.locator('.session-word').innerText(),prompt);assert.equal(expected.answerJapanese,'集まって');assert.equal(expected.answerRomaji,'atsumatte');
   const checkpointBefore=await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLearning')).iknowReaderStudyLearning.session);
   await page.locator('#listening-answer').fill('atsumaru');await page.locator('#demo-answer button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('demo-feedback')?.textContent==='Incorrect');assert.equal(await page.locator('#listening-answer').isEnabled(),true,'The dictionary form is not accepted for an inflected sentence gap');
   await page.reload();await page.locator('.session-screen').waitFor();assert.equal(await page.locator('.session-word').innerText(),prompt);assert.equal(await page.locator('.session-progress span').innerText(),'1 of 1');assert.equal(await page.locator('#listening-answer').inputValue(),'atsumaru');
   const checkpointAfter=await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderStudyLearning')).iknowReaderStudyLearning.session);assert.equal(checkpointAfter.id,checkpointBefore.id);assert.deepEqual(checkpointAfter.targets,checkpointBefore.targets);assert.deepEqual(checkpointAfter.cards[0].context.clozeTarget,checkpointBefore.cards[0].context.clozeTarget);assert.equal(checkpointAfter.attempts,1,'Reload keeps the attempt count and anchored target');
   await page.locator('#listening-answer').fill(expected.answerKana);await page.locator('#demo-answer button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('demo-feedback')?.textContent==='Correct');assert.equal(await page.locator('#demo-solution>.japanese').innerText(),'集まって');
   await page.screenshot({path:path.join(out,'real-inflection-kana-after-refresh.png')});
   await page.locator('[data-action="next-question"]').click();await page.locator('[data-view="practice"]').click();await select([oldWord.key]);await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();
   await page.locator('#listening-answer').fill(expected.answerRomaji);await page.locator('#demo-answer button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('demo-feedback')?.textContent==='Correct');assert.equal(await page.locator('#demo-solution>.japanese').innerText(),'集まって');
   assert.equal((await worker.evaluate(async key=>(await chrome.storage.local.get('iknowReaderStudyLibrary')).iknowReaderStudyLibrary.records[key],oldWord.key)).notes,note);assert.equal(courseRequests,requestsBefore);
  }else console.log('SKIP Optional real-course browser fixture: set IKR_CLOZE_COURSE_SOURCE to goal19057 JSON.');
  assert.deepEqual(errors,[]);
  console.log('PASS Course cloze reasons, sentence-only gap choices, real 200-word cached course, bookmark enrichment without HTTP, preserved notes, inflected Kana/Romaji answers and deterministic active-session reload');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
