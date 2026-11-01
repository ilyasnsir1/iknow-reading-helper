'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const choose=require('./fixtures/choose-workspace-option.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-practice-course-fit-evidence','run-'+Date.now());fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
const sizes=[{width:1920,height:1080},{width:1440,height:900},{width:1536,height:864},{width:1366,height:768},{width:1280,height:720}];
(async()=>{
 const fixture=require('./fixtures/isolate-extension.cjs')(path.join(root,'extension'),out),extension=path.join(out,'extension');fs.renameSync(fixture,extension);
 const stage=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(stage.status,0,stage.stderr||stage.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:sizes[0],reducedMotion:'reduce'});
 const evidence=[],errors=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>sessionStorage.clear());
  const measure=()=>{
   const pane=document.querySelector('.activity-pane'),root=document.scrollingElement,box=pane.getBoundingClientRect();
   const controls=[...pane.querySelectorAll('button,input,select,textarea')].filter(node=>node.getClientRects().length&&!node.hidden).map(node=>{
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return{label:node.getAttribute('aria-label')||node.dataset.action||node.dataset.mode||node.dataset.practiceSource||node.id,enabled:!node.disabled,visible:r.top>=-.5&&r.left>=-.5&&r.bottom<=innerHeight+.5&&r.right<=innerWidth+.5,hittable:hit===node||node.contains(hit)};
   });
   return{pane:{height:pane.clientHeight,scrollHeight:pane.scrollHeight,width:pane.clientWidth,scrollWidth:pane.scrollWidth,top:pane.scrollTop,bottom:box.bottom},document:{height:innerHeight,scrollHeight:root.scrollHeight,width:innerWidth,scrollWidth:root.scrollWidth,top:root.scrollTop},controls,scrolls:[...document.querySelectorAll('.activity-pane,.focus-desk,.focus-body,.app-frame')].map(node=>node.scrollTop)};
  };
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(async({source,theme})=>chrome.storage.local.set({iknowReaderTheme:theme,iknowReaderStudyLibrary:{schemaVersion:1,records:{}},iknowReaderStudyCatalog:{schemaVersion:1,entries:{'19053':{at:Date.now(),source}}}}),{source,theme});
   await page.setViewportSize(sizes[0]);await page.goto(`chrome-extension://${id}/study.html?fit=${theme}#practice`);await page.locator('[data-practice-source="course"]').click();await page.locator('[data-action="start"]:not([disabled])').waitFor();
   for(const size of sizes){
    await page.setViewportSize(size);
    for(const mode of ['review','cloze','listening']){
     await page.locator(`[data-mode="${mode}"]`).click();
     for(const content of ['word','sentence','both']){
      await choose(page,'#demo-practice-content',content);await page.mouse.move(0,0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const label=`${theme} ${size.width}x${size.height} ${mode}/${content}`,metrics=await page.evaluate(measure);
      assert.ok(metrics.pane.scrollHeight<=metrics.pane.height+1,label+': Practice has no unwanted vertical overflow '+JSON.stringify(metrics.pane));
      assert.ok(metrics.document.scrollHeight<=metrics.document.height+1,label+': the document fits the viewport');
      assert.ok(metrics.pane.scrollWidth<=metrics.pane.width+1&&metrics.document.scrollWidth<=metrics.document.width+1,label+': no horizontal overflow');
      assert.ok(metrics.controls.length>=11,label+': all setup controls are present');
      assert.deepEqual(metrics.controls.filter(control=>!control.visible||!control.hittable),[],label+': all controls, including Start, are visible and hittable');
      const start=metrics.controls.find(control=>control.label==='start');assert.ok(start?.enabled,label+': Start remains enabled');
      const pane=await page.locator('.activity-pane').boundingBox();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await page.mouse.wheel(0,480);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const after=await page.evaluate(measure);assert.deepEqual({pane:after.pane.top,document:after.document.top,scrolls:after.scrolls},{pane:metrics.pane.top,document:metrics.document.top,scrolls:metrics.scrolls},label+': mouse wheel cannot move an already fitting desktop panel');
      evidence.push({theme,...size,mode,content,pane:metrics.pane,document:metrics.document});
     }
    }
    await page.screenshot({path:path.join(out,`${theme}-${size.width}x${size.height}.png`)});
   }
   await page.setViewportSize({width:390,height:844});await page.locator('[data-mode="cloze"]').click();await choose(page,'#demo-practice-content','both');
   const mobile=await page.evaluate(()=>{const root=document.scrollingElement;return{root:root.scrollHeight>innerHeight+1,containers:[...document.querySelectorAll('.activity-pane,.focus-desk,.focus-body,.app-frame')].filter(node=>node.scrollHeight>node.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(node).overflowY)).length,horizontal:root.scrollWidth<=innerWidth+1};});
   assert.ok(mobile.root||mobile.containers>0,theme+': mobile uses genuine scrolling instead of clipping content');assert.ok(mobile.horizontal,theme+': mobile has no horizontal overflow');
   await page.locator('[data-action="start"]').scrollIntoViewIfNeeded();
   const reached=await page.locator('[data-action="start"]').evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{visible:r.top>=0&&r.bottom<=innerHeight,hittable:hit===node||node.contains(hit),scrolled:document.scrollingElement.scrollTop>0||[...document.querySelectorAll('.activity-pane,.focus-desk,.focus-body,.app-frame')].some(node=>node.scrollTop>0)};});
   assert.deepEqual(reached,{visible:true,hittable:true,scrolled:true},theme+': mobile scrolling reaches Start without clipping');
   await page.locator('[data-practice-source="saved"]').scrollIntoViewIfNeeded();assert.ok(await page.locator('[data-practice-source="saved"]').isVisible(),theme+': mobile can return to the source controls');
   await page.screenshot({path:path.join(out,theme+'-mobile.png')});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,desktopCases:evidence.length,evidence},null,2)+'\n');console.log('PASS Practice Course fits all controls without vertical/horizontal overflow or wheel scrolling in 180 desktop cases (four themes, five viewports, three modes and contents); mobile remains genuinely scrollable and reachable');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
