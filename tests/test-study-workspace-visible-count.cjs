/* Visible library counts match course/type/search filters, not unrelated saved records. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-workspace-visible-count-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],evidence=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
   const records={};for(let i=0;i<11;i++){const courseId=i<2?'19053':'19055',kind=i===1?'sentence':'word',key=`${kind}:${courseId}:count${i}`;records[key]={kind,courseId,courseTitle:'Course '+courseId,sourceId:'count'+i,japanese:i===0?'対象語':i===1?'対象文です。':'別語'+i,kana:i===1?'たいしょうぶんです':'たいしょうご',romaji:i===1?'taishou bun desu':'taishou go',english:i===0?'target word':i===1?'target sentence':'other '+i,german:i===1?'Zielsatz':'Zielwort',audioUrl:'',key,createdAt:1,updatedAt:i+1};}
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`chrome-extension://${id}/study.html?course=19053`);await page.locator('#demo-library-list .library-row').first().waitFor();
  async function check(count,label){
   await page.waitForFunction(expected=>document.querySelector('.focus-library-heading .count')?.textContent===String(expected),count);
   assert.equal(await page.locator('#demo-library-list .library-row').count(),count,label+': shown row count');
   assert.equal(await page.locator('.library-result-count').count(),0,'The redundant Results footer is absent');
   assert.doesNotMatch(await page.locator('.focus-top').innerText(),/\d+\s+of\s+\d+\s+saved/i,'The redundant selected-position counter is absent');
   evidence.push({label,count});
  }
  await check(2,'Initial ?course=19053 with eleven total saved records');
  await page.locator('#demo-kind').selectOption('word');await check(1,'Words only');
  await page.locator('#demo-kind').selectOption('sentence');await check(1,'Sentences only');
  await page.locator('#demo-kind').selectOption('');await page.locator('#demo-search').fill('target word');await check(1,'Search within the selected course');
  await page.locator('#demo-search').fill('unmatched search');await check(0,'Empty filtered result');
  await page.locator('#demo-search').fill('');await check(2,'Clear search');
  await worker.evaluate(async()=>{const data=await chrome.storage.local.get('iknowReaderStudyLibrary'),library=data.iknowReaderStudyLibrary,key='word:19055:outside';library.records[key]={kind:'word',courseId:'19055',courseTitle:'Course 19055',sourceId:'outside',japanese:'外',kana:'そと',romaji:'soto',english:'outside',audioUrl:'',key,createdAt:100,updatedAt:100};await chrome.storage.local.set({iknowReaderStudyLibrary:library});});
  await page.waitForTimeout(150);await check(2,'A new record outside this course does not inflate the visible count');
  await worker.evaluate(async()=>{const data=await chrome.storage.local.get('iknowReaderStudyLibrary'),library=data.iknowReaderStudyLibrary,key='word:19053:inside';library.records[key]={kind:'word',courseId:'19053',courseTitle:'Course 19053',sourceId:'inside',japanese:'内',kana:'うち',romaji:'uchi',english:'inside',audioUrl:'',key,createdAt:101,updatedAt:101};await chrome.storage.local.set({iknowReaderStudyLibrary:library});});
  await check(3,'A new record inside this course updates the visible count');
  await page.locator('.focus-rail [data-view="practice"]').click();await page.locator('.focus-rail [data-view="study"]').click();await check(3,'Returning to Study retains its course filter');
  await page.locator('#demo-course').selectOption('');await check(13,'All courses counts all thirteen records');
  await page.locator('#demo-course').selectOption('19053');await check(3,'Selecting the original course again');
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);await page.waitForFunction(theme=>document.documentElement.dataset.ikrTheme===theme,theme);await check(3,'Theme '+theme);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(evidence,null,2)+'\n');await page.screenshot({path:path.join(out,'filtered-library.png')});
  console.log('PASS Visible library count: eleven stored versus two course-filtered records, search/type/empty filters, actual live updates, view returns and all four themes; redundant counters absent');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
