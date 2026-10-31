/* Newly saved vocabulary and sentences append below existing saved entries. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-saved-order-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1280,height:900},reducedMotion:'reduce'});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records:{}}}));
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/study.html`);await page.locator('.focus-empty').waitFor();
  const order=()=>page.locator('#demo-library-list .library-row').evaluateAll(nodes=>nodes.map(node=>node.dataset.item));
  async function add(kind,n,time){const key=`${kind}:19053:${n}`;await worker.evaluate(async({kind,n,time,key})=>{const data=await chrome.storage.local.get('iknowReaderStudyLibrary'),library=data.iknowReaderStudyLibrary;library.records[key]={key,kind,courseId:'19053',sourceId:String(n),courseTitle:'Source',japanese:'語'+n,kana:'ご',romaji:'go',english:'word '+n,german:'Wort '+n,audioUrl:'',createdAt:time,updatedAt:time};await chrome.storage.local.set({iknowReaderStudyLibrary:library});},{kind,n,time,key});await page.locator(`.library-row[data-item="${key}"]`).waitFor();return key;}
  const expected=[];expected.push(await add('word',1,1));expected.push(await add('word',2,1));
  await page.locator(`.library-row[data-item="${expected[0]}"]`).click();
  for(let n=3;n<=5;n++)expected.push(await add('sentence',n,2));
  assert.deepEqual(await order(),expected,'Stable same-time additions retain insertion order');
  assert.equal(await page.locator('.library-row[aria-current=true]').getAttribute('data-item'),expected[0],'Appending records does not change the selected word');
  await worker.evaluate(async key=>{const data=await chrome.storage.local.get('iknowReaderStudyLibrary');data.iknowReaderStudyLibrary.records[key].notes='Edited note';data.iknowReaderStudyLibrary.records[key].updatedAt=Date.now();await chrome.storage.local.set(data);},expected[1]);
  await page.waitForFunction(()=>document.querySelectorAll('.library-row').length===5);await page.locator(`.library-row[data-item="${expected[1]}"]`).click();await page.locator('.focus-note-text').filter({hasText:'Edited note'}).waitFor();
  assert.deepEqual(await order(),expected,'A note edit cannot move an entry');
  await page.reload();await page.locator('.library-row').first().waitFor();assert.deepEqual(await order(),expected,'Refresh keeps the same order');
  await page.locator('#demo-kind').selectOption('sentence');assert.deepEqual(await order(),expected.slice(2));
  await page.locator('#demo-kind').selectOption('');await page.locator(`.library-row[data-item="${expected[0]}"]`).click();await page.locator('[data-action="next"]').click();assert.equal(await page.locator('.library-row[aria-current=true]').getAttribute('data-item'),expected[1]);
  console.log('PASS Saved order: oldest first, new words/sentences appended, stable same-time ties, note edits, selection, filters, refresh and Next navigation');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
