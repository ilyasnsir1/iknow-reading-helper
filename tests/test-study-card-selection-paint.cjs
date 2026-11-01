/* A vocabulary click must not replace the hovered library row or Study surface. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-card-selection-paint-evidence','run-'+Date.now());fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],viewport:{width:1280,height:720}});
 const errors=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
   const records={};for(let i=1;i<=28;i++){const kind=i%2?'word':'sentence',key=`${kind}:19053:paint${i}`;records[key]={kind,key,courseId:'19053',courseTitle:'Selection test',sourceId:'paint'+i,japanese:i%2?'本'+i:'本を読みます。'+i,kana:'ほん',romaji:'hon',english:'book '+i,german:'Buch '+i,notes:i===2?'A saved note.':'',audioUrl:'',createdAt:i,updatedAt:i};}await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const row=n=>page.locator(`#demo-library-list>.library-row[data-item="${n%2?'word':'sentence'}:19053:paint${n}"]`);
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);await page.goto(`chrome-extension://${id}/study.html?paint=${theme}#study`);await row(1).waitFor();
   await page.evaluate(()=>{
    window.steadyStudy={header:document.querySelector('.app-header'),frame:document.querySelector('.app-frame'),list:document.getElementById('demo-library-list'),rows:[...document.querySelectorAll('#demo-library-list>.library-row')],card:document.querySelector('.focus-card'),top:document.querySelector('.focus-top'),footer:document.querySelector('.focus-bottom'),removed:[]};
    const observed=new Set([steadyStudy.header,steadyStudy.frame,steadyStudy.list,...steadyStudy.rows,steadyStudy.card]);
    new MutationObserver(entries=>{for(const entry of entries)for(const node of entry.removedNodes)if(observed.has(node))steadyStudy.removed.push(node.className);}).observe(document.getElementById('demo'),{childList:true,subtree:true});
   });
   await row(2).click();await page.locator('.focus-note-text').waitFor();assert.equal(await page.locator('.focus-bottom>[data-action=practise-item]').innerText(),'Practice this sentence');
   await page.locator('[data-action=edit-note]').click();await page.locator('#focus-note-input').fill('Keep this unsaved draft.');
   await row(1).click();await row(2).click();assert.equal(await page.locator('#focus-note-input').inputValue(),'Keep this unsaved draft.');
   await row(1).click();await page.locator('[data-action=compare]').click();await page.locator('#focus-compare').waitFor({state:'visible'});await page.waitForTimeout(300);
   await page.locator('[data-compare-action=record]').click();await page.locator('.focus-audio-idle-mode').waitFor({state:'hidden'});
   await page.evaluate(()=>{steadyStudy.compare=document.getElementById('focus-compare');steadyStudy.mic=document.querySelector('[data-microphone-meter]');});
   await row(1).click();assert.equal(await page.evaluate(()=>steadyStudy.compare===document.getElementById('focus-compare')&&steadyStudy.mic===document.querySelector('[data-microphone-meter]')),true,'Clicking the selected card is a no-op even during capture');assert.equal(await page.locator('#focus-compare').getAttribute('data-state'),'recording');
   await row(3).click();assert.equal(await page.locator('#focus-compare').getAttribute('data-state'),'idle');assert.equal(await page.locator('#focus-compare').isHidden(),true,'Changing vocabulary stops and closes its old recording');
   await page.evaluate(()=>{const list=document.getElementById('demo-library-list');list.scrollTop=240;steadyStudy.scroll=list.scrollTop;});
   // Programmatic rapid clicks avoid Playwright scrolling a target into view;
   // the application itself must retain the library position and row identity.
   await page.evaluate(()=>{for(const index of [7,8,9,8,7,8]){const row=steadyStudy.rows[index-1];row.click();} });
   assert.equal(await page.locator('#demo-library-list').evaluate(node=>node.scrollTop),await page.evaluate(()=>steadyStudy.scroll));
   const identity=await page.evaluate(()=>({header:steadyStudy.header===document.querySelector('.app-header'),frame:steadyStudy.frame===document.querySelector('.app-frame'),list:steadyStudy.list===document.getElementById('demo-library-list'),card:steadyStudy.card===document.querySelector('.focus-card'),top:steadyStudy.top===document.querySelector('.focus-top'),footer:steadyStudy.footer===document.querySelector('.focus-bottom'),rows:steadyStudy.rows.every(row=>row.isConnected),removed:steadyStudy.removed}));
   assert.deepEqual(identity,{header:true,frame:true,list:true,card:true,top:true,footer:true,rows:true,removed:[]});
   assert.equal(await page.locator('.library-row[aria-current=true]').count(),1);
   await page.locator('[data-action=next]').click();assert.equal(await page.locator('.library-row[aria-current=true]').getAttribute('data-item'),'word:19053:paint9');await page.locator('[data-action=previous]').click();assert.equal(await page.locator('.library-row[aria-current=true]').getAttribute('data-item'),'sentence:19053:paint8');
   assert.equal(await page.evaluate(()=>steadyStudy.header===document.querySelector('.app-header')&&steadyStudy.card===document.querySelector('.focus-card')),true,'Previous and Next also retain the Study surface');
   const frames=await page.evaluate(async()=>{const result=[];for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);const card=document.querySelector('.focus-card'),style=getComputedStyle(card);result.push({connected:steadyStudy.card===card,opacity:Number(style.opacity),visible:style.visibility,background:style.backgroundColor});}return result;});assert.ok(frames.every(frame=>frame.connected&&frame.opacity===1&&frame.visible==='visible'));
   await page.screenshot({path:path.join(out,theme+'-stable-selection.png')});
  }
  assert.deepEqual(errors,[]);console.log('PASS Study selection retains header/library/rows/card/focus controls, no same-card recorder reset, preserved note drafts and scroll, stable rapid/Previous/Next selection in four themes');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
