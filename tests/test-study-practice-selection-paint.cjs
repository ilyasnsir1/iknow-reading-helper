'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const choose=require('./fixtures/choose-workspace-option.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-practice-selection-paint-evidence','run-'+Date.now());
fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
const second={...structuredClone(source),id:19057,title:'Selection paint: another course'};
(async()=>{
 const isolated=require('./fixtures/isolate-extension.cjs')(path.join(root,'extension'),out),extension=path.join(out,'extension');fs.renameSync(isolated,extension);
 const staged=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(staged.status,0,staged.stderr||staged.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900}});
 const errors=[],evidence=[];let requests=0,releaseLoad;
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await context.route('https://iknow.jp/api/v2/goals/*',async route=>{requests++;await new Promise(resolve=>{releaseLoad=resolve;});await route.fulfill({contentType:'application/json',body:JSON.stringify(second)});});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>sessionStorage.clear());
  const button=value=>page.locator(`[data-mode="${value}"]`),sourceButton=value=>page.locator(`[data-practice-source="${value}"]`);
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(async({source,theme})=>{
    const records={};for(let i=1;i<=6;i++){const kind=i%2?'word':'sentence',key=`${kind}:19053:paint${i}`;records[key]={kind,key,courseId:'19053',courseTitle:'Selection test',sourceId:'paint'+i,japanese:kind==='word'?'本'+i:'本を読みます。'+i,kana:'ほん',romaji:'hon',english:'book '+i,german:'Buch '+i,audioUrl:'https://assets0.iknow.jp/test.mp3',createdAt:i,updatedAt:i};}
    await chrome.storage.local.set({iknowReaderTheme:theme,iknowReaderStudyLibrary:{schemaVersion:1,records},iknowReaderStudyCatalog:{schemaVersion:1,entries:{'19053':{at:Date.now(),source}}}});
   },{source,theme});
   await page.goto(`chrome-extension://${id}/study.html?paint=${theme}#practice`);await sourceButton('saved').waitFor();
   await page.evaluate(()=>{
    const selectors=['.app-header','.app-frame','.focus-rail','.focus-desk','.activity-pane','.activity-inner','.practice-sources','.mode-grid','[data-practice-options]','[data-choice="attempts"]','[data-choice="practice-order"]',...['saved','course'].map(value=>`[data-practice-source="${value}"]`),...['review','cloze','listening'].map(value=>`[data-mode="${value}"]`)];
    window.paintState={nodes:selectors.map(selector=>({selector,node:document.querySelector(selector)})),removed:[],events:0};const tracked=new Set(paintState.nodes.map(entry=>entry.node));
    new MutationObserver(entries=>{paintState.events+=entries.length;for(const entry of entries)for(const removed of entry.removedNodes)if(tracked.has(removed))paintState.removed.push(removed.className);}).observe(document.getElementById('demo'),{subtree:true,childList:true,attributes:true,characterData:true});
   });
   const assertSteady=async label=>assert.deepEqual(await page.evaluate(()=>({identity:paintState.nodes.filter(entry=>entry.node!==document.querySelector(entry.selector)).map(entry=>entry.selector),removed:paintState.removed})),{identity:[],removed:[]},theme+': '+label);
   const assertNoop=async locator=>{const before=await page.evaluate(()=>paintState.events);await locator.click();assert.equal(await page.evaluate(()=>paintState.events),before,theme+': a selected choice does not mutate the setup');};
   await assertNoop(sourceButton('saved'));await assertNoop(button('review'));
   await sourceButton('course').click();await page.locator('[data-action="start"]:not([disabled])').waitFor();assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (200)');assert.equal(requests,evidence.length,'The first Course choice is a cache hit');
   assert.equal(await page.locator('#demo-practice-order').innerText(),'Course order');
   await page.evaluate(()=>{paintState.input=document.getElementById('demo-practice-course');paintState.heading=document.getElementById('demo-practice-title');paintState.content=document.querySelector('[data-choice="practice-content"]');});
   await choose(page,'#demo-practice-content','both');assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (400)');
   await button('cloze').click();await page.locator('[data-choice="gap-position"]').waitFor();await assertSteady('Gap insertion preserves Attempts and Order');
   await button('listening').click();assert.equal(await page.locator('[data-choice="gap-position"]').count(),0);await assertSteady('Gap removal preserves Attempts and Order');
   await button('review').click();await button('cloze').click();await button('review').click();
   assert.equal(await page.evaluate(()=>paintState.input===document.getElementById('demo-practice-course')&&paintState.heading===document.getElementById('demo-practice-title')&&paintState.content===document.querySelector('[data-choice="practice-content"]')),true,'Modes preserve the loaded course controls');
   await page.locator('#demo-practice-course').fill('19057');const beforeRequests=requests;await page.locator('[data-action="load-practice-course"]').click();await page.waitForFunction(()=>document.querySelector('.practice-course')?.getAttribute('aria-busy')==='true');
   await button('listening').click();await button('cloze').click();assert.equal(await page.locator('#demo-practice-course').isDisabled(),true);
   assert.equal(typeof releaseLoad,'function');releaseLoad();await page.waitForFunction(title=>document.getElementById('demo-practice-title')?.textContent===title&&document.querySelector('.practice-course')?.getAttribute('aria-busy')==='false',second.title);
   assert.equal(requests,beforeRequests+1,'Only the explicit load fetches a new course');
   assert.equal(await page.evaluate(()=>paintState.input===document.getElementById('demo-practice-course')&&paintState.heading===document.getElementById('demo-practice-title')&&paintState.content===document.querySelector('[data-choice="practice-content"]')),true,'Async load preserves input, title and Content controls');
   assert.equal(await page.locator('#demo-practice-course').inputValue(),'19057');assert.equal(await page.locator('#demo-practice-content').getAttribute('data-value'),'both');assert.equal(await button('cloze').getAttribute('aria-pressed'),'true');
   await sourceButton('saved').click();assert.equal(await page.locator('#demo-practice-order').innerText(),'Library order');await sourceButton('course').click();assert.equal(await page.locator('#demo-practice-order').innerText(),'Course order');
   await page.evaluate(()=>{for(const [kind,value] of [['mode','listening'],['practice-source','saved'],['mode','review'],['practice-source','course'],['mode','cloze'],['practice-source','saved'],['practice-source','course'],['mode','listening']])document.querySelector(`[data-${kind}="${value}"]`).click();});
   assert.equal(await sourceButton('course').getAttribute('aria-pressed'),'true');assert.equal(await button('listening').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (400)');assert.equal(await page.locator('#demo-practice-order').innerText(),'Course order');await assertSteady('rapid source and mode changes retain their painted controls');
   await assertNoop(sourceButton('course'));await assertNoop(button('listening'));await assertNoop(page.locator('.focus-rail [data-view="practice"]'));
   const frames=await page.evaluate(async()=>{const result=[];for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);const pane=document.querySelector('.activity-pane'),style=getComputedStyle(pane);result.push({opacity:Number(style.opacity),visibility:style.visibility,connected:paintState.nodes.every(entry=>entry.node===document.querySelector(entry.selector))});}return result;});assert.ok(frames.every(frame=>frame.opacity===1&&frame.visibility==='visible'&&frame.connected));
   await page.screenshot({path:path.join(out,theme+'-stable-practice.png')});evidence.push({theme,frames});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,requests,evidence},null,2)+'\n');console.log('PASS Practice paint: stable header/frame/rail/activity/source/mode/Attempts/Order; no-op active choices; stable course input through modes and async load; correct counts/order and rapid changes in four themes');
 }finally{releaseLoad?.();await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
