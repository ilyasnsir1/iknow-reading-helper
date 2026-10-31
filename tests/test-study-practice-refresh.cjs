/* A saved Practice course is validated before its first visible warm frame. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const choose=require('./fixtures/choose-workspace-option.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-practice-refresh-evidence');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
const second={...structuredClone(source),id:19055,title:'Japanese Core 2000: Step 2'};
(async()=>{
 const extension=path.join(out,'run-'+Date.now(),'extension');fs.mkdirSync(extension,{recursive:true});fs.cpSync(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.join(root,'extension'),extension,{recursive:true});const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
 const staged=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(staged.status,0,staged.stderr||staged.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];let requests=0,offline=false;
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await context.route('https://iknow.jp/api/v2/goals/*',route=>{requests++;const number=Number(route.request().url().split('/').pop());return route.fulfill(offline?{status:503,contentType:'application/json',body:'{"error":"offline"}'}:{contentType:'application/json',body:JSON.stringify(number===19055?second:source)});});
  const evidence=[];
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(async({source,second,theme})=>{await chrome.storage.local.set({iknowReaderTheme:theme,iknowReaderStudyCatalog:{schemaVersion:1,entries:{'19053':{at:Date.now(),source},'19055':{at:Date.now(),source:second}}}});},{source,second,theme});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{globalThis.practiceFrames=[];const sample=()=>{const title=document.getElementById('demo-practice-title'),load=document.querySelector('[data-action="load-practice-course"]'),start=document.querySelector('.setup-start [data-action="start"]');if(!title||!load||!start)return;const frame={title:title.textContent,input:document.getElementById('demo-practice-course').value,content:document.getElementById('demo-practice-content').dataset.value,order:document.getElementById('demo-practice-order').dataset.value,mode:document.querySelector('[data-mode][aria-pressed=true]')?.dataset.mode,source:document.querySelector('[data-practice-source][aria-pressed=true]')?.dataset.practiceSource,load:load.textContent,start:start.textContent,ready:!start.disabled,status:document.getElementById('demo-practice-source-status').textContent};if(JSON.stringify(frame)!==JSON.stringify(practiceFrames.at(-1)))practiceFrames.push(frame);};new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});});
   await page.goto(`chrome-extension://${id}/study.html#practice`);await page.locator('[data-practice-source="course"]').click();await page.locator('[data-action="start"]:not([disabled])').waitFor();
   assert.ok((await page.evaluate(()=>practiceFrames)).every(frame=>frame.ready&&frame.load==='Loaded'&&frame.title===source.title),'Entering Course with fresh saved data has no loading/zero-count frame');
   await page.locator('#demo-practice-course').fill('https://iknow.jp/courses/19055');await page.locator('[data-action="load-practice-course"]').click();await page.waitForFunction(title=>document.getElementById('demo-practice-title')?.textContent===title,second.title);
   await choose(page,'#demo-practice-content','both');await choose(page,'#demo-practice-order','shuffle');
   assert.equal(await page.locator('[data-action="start"]').innerText(),'Start practice (400)');
   const before=await page.evaluate(()=>practiceFrames.at(-1)),requestCount=requests;offline=true;
   await page.reload();await page.locator('[data-action="start"]:not([disabled])').waitFor();
   const frames=await page.evaluate(()=>practiceFrames);assert.ok(frames.length>0);for(const frame of frames)assert.deepEqual(frame,before,theme+': every first warm frame retains the actual course, content, order and enabled count');assert.equal(requests,requestCount,'A fresh validated cache does not request a download');
   assert.deepEqual(await page.locator('.app-actions').evaluate(node=>[...node.children].map(child=>child.dataset.action||child.dataset.focusMenu)),['backup','language','theme'],'Backup precedes adjacent language and theme controls');
   const rects=await page.locator('.app-actions').evaluate(node=>[...node.children].map(child=>{const box=child.getBoundingClientRect();return{left:box.left,right:box.right,cy:box.y+box.height/2};}));assert.ok(rects[0].right<rects[1].left&&rects[1].right<rects[2].left);assert.ok(Math.max(...rects.map(r=>r.cy))-Math.min(...rects.map(r=>r.cy))<1);
   evidence.push({theme,frames});
   if(theme==='paper'){
    // A different requested ID must not reuse the previously loaded course.
    await page.locator('#demo-practice-course').fill('19057');await page.locator('[data-action="load-practice-course"]').click();await page.waitForFunction(()=>document.getElementById('demo-practice-source-status')?.textContent.includes('503'));assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);assert.notEqual(await page.locator('#demo-practice-title').innerText(),second.title);
    // Restored input is checked against the stored source ID before painting.
    await worker.evaluate(async source=>{await chrome.storage.local.set({iknowReaderStudyCatalog:{schemaVersion:1,entries:{'19055':{at:Date.now(),source:{...source,id:19053,title:'WRONG SAVED COURSE'}}}}});},second);
    await page.reload();await page.waitForFunction(()=>document.getElementById('demo-practice-source-status')?.textContent.includes('503'));assert.ok((await page.evaluate(()=>practiceFrames)).every(frame=>!frame.ready&&frame.title!=='WRONG SAVED COURSE'),'A malformed source cannot enable practice or paint another course');
   }
   await page.close();offline=false;
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'warm-frames.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS Practice warm refresh: validated cached source before paint, retained source/title/input/content/order/count, no download/loading flash, invalid/offline guards and Backup→Language→Theme in four themes');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
