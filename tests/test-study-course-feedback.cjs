/* Course feedback in the actual extension, with isolated storage and delayed HTTP failures. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-course-feedback-evidence');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
(async()=>{
 const extension=path.join(out,'run-'+Date.now(),'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
 const staged=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(staged.status,0,staged.stderr||staged.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],observations=[];let release;
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await context.route('https://iknow.jp/api/v2/goals/*',async route=>{
   if(route.request().url().endsWith('/19053'))return route.fulfill({contentType:'application/json',body:JSON.stringify(source)});
   await new Promise(resolve=>{release=resolve;});
   return route.fulfill({status:404,contentType:'application/json',body:'{"error":"not found"}'});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(async({source,theme})=>chrome.storage.local.set({iknowReaderTheme:theme,iknowReaderStudyCatalog:{schemaVersion:1,entries:{'19053':{at:Date.now(),source}}}}),{source,theme});
   await page.goto(`chrome-extension://${id}/study.html#test`);
   await page.locator('[data-action="start"]:not([disabled])').waitFor();
   for(const kind of ['test','practice']){
    if(kind==='practice'){
     await page.locator('[data-view="practice"]').click();
     await page.locator('[data-practice-source="course"]').click();
     await page.locator('[data-action="start"]:not([disabled])').waitFor();
     assert.equal(await page.locator('[data-mode="cloze"] svg').count(),1,'Fill the gap has its own icon');
    }
    const input=page.locator(`#demo-${kind}-course`),load=page.locator(`[data-action="load-${kind}-course"]`),status=page.locator(`#demo-${kind}-source-status`);
    assert.equal(await load.isVisible(),false,'Ready is an indicator, not a disabled Loaded button');
    assert.equal(await page.locator('.course-source-ready').innerText(),'Ready');
    assert.equal(await page.locator('.course-source-ready svg').count(),0,`${theme}/${kind}: Ready is text only`);
    const readyGeometry=await page.locator('.course-source-fields').evaluate(node=>{const entry=node.querySelector('.course-input-action').getBoundingClientRect(),content=node.querySelector('.focus-choice-stepper').getBoundingClientRect();return{left:entry.left,right:entry.right,contentLeft:content.left,contentRight:content.right,contentTop:content.top,inputBottom:entry.bottom};});
    assert.ok(Math.abs(readyGeometry.left-readyGeometry.contentLeft)<1&&Math.abs(readyGeometry.right-readyGeometry.contentRight)<1,'Course input and Content form two aligned full-width rows');
    assert.ok(readyGeometry.contentTop>readyGeometry.inputBottom,'Content has its own row');
    await input.fill('999999');await load.click();
    const loading=page.locator('.course-feedback[data-state="loading"]');await loading.waitFor();
    assert.equal(await input.isDisabled(),true);assert.equal(await load.isDisabled(),true);assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
    assert.equal(await page.locator('.setup-course').getAttribute('aria-busy'),'true');
    assert.match(await status.innerText(),/Loading course/);assert.equal(await status.getAttribute('role'),'status');
    assert.equal(await status.evaluate(node=>getComputedStyle(node,'::before').content),'""','A loading indicator accompanies the text');
    assert.equal(await loading.evaluate(node=>getComputedStyle(node,'::after').animationName),'none','Reduced motion uses a static loading track');
    const before=await page.locator('.setup-start').boundingBox();
    for(let i=0;!release&&i<40;i++)await page.waitForTimeout(25);assert.ok(release,'The requested course reached the isolated network boundary');
    const finish=release;release=null;finish();
    await page.locator('.course-feedback[data-state="error"]').waitFor();
    assert.match(await status.innerText(),/404/);assert.equal(await status.getAttribute('role'),'alert');assert.equal(await input.getAttribute('aria-invalid'),'true');
    assert.equal(await page.locator('.setup-course').getAttribute('aria-busy'),'false');assert.equal(await load.isEnabled(),true);
    const metrics=await status.evaluate(node=>{const box=node.getBoundingClientRect(),controls=node.closest('.setup-course').querySelector('.setup-fields').getBoundingClientRect();return{gap:box.top-controls.bottom,color:getComputedStyle(node).color,danger:getComputedStyle(document.documentElement).getPropertyValue('--ikr-danger').trim(),text:getComputedStyle(document.body).color};});
    assert.ok(metrics.gap>=19,`${theme}/${kind}: error has clear space below controls`);assert.notEqual(metrics.color,metrics.text,'Errors use the theme danger color');
    assert.equal(await status.evaluate(node=>getComputedStyle(node).color===(()=>{const x=document.createElement('span');x.style.color='var(--ikr-danger)';node.append(x);const color=getComputedStyle(x).color;x.remove();return color;})()),true);
    const after=await page.locator('.setup-start').boundingBox();assert.ok(Math.abs(before.y-after.y)<1,'Loading and error keep Start at the same position');
    observations.push({theme,kind,metrics});
    await page.screenshot({path:path.join(out,`${theme}-${kind}-error.png`)});
    await input.fill('19053');assert.equal(await input.getAttribute('aria-invalid'),'false');assert.equal(await status.getAttribute('role'),'status');
    await load.click();await page.locator('[data-action="start"]:not([disabled])').waitFor();
    assert.equal(await page.locator('.course-feedback').isVisible(),false,'A successful course leaves no loading or error message');
    await page.setViewportSize({width:390,height:860});
    assert.ok(await page.locator('.setup-course').evaluate(node=>node.scrollWidth<=node.clientWidth),'Course controls fit a narrow screen without horizontal overflow');
    await page.setViewportSize({width:1440,height:900});
   }
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(observations,null,2)+'\n');
  console.log('PASS Test and Practice course feedback: delayed loading, reduced motion, separated red 404 alerts, disabled Start, stable geometry, correction/recovery in four themes');
 }finally{release?.();await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
