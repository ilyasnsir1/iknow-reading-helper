/* Exercise the shipped Study controller with real storage in a disposable extension. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-steppers-evidence'),run=path.join(out,'run-'+Date.now()),extension=path.join(run,'extension');
fs.mkdirSync(run,{recursive:true});fs.cpSync(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.join(root,'extension'),extension,{recursive:true});
const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
const python=process.env.IKR_PYTHON||path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe');
const stage=spawnSync(python,[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});
assert.equal(stage.status,0,stage.stderr||stage.stdout);
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
(async()=>{
 const context=await chromium.launchPersistentContext(path.join(run,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];let releaseSlow,slowRequested;
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await context.route('https://iknow.jp/api/v2/goals/*',async route=>{
   const courseId=route.request().url().split('/').pop();
   if(courseId==='19055'){slowRequested?.();await new Promise(resolve=>{releaseSlow=resolve;});}
   await route.fulfill({contentType:'application/json',body:JSON.stringify({...source,id:Number(courseId)})});
  });
  await worker.evaluate(async()=>{
   const records={};for(let i=0;i<6;i++){const kind=i<3?'word':'sentence',key=`${kind}:19053:seed${i}`;records[key]={kind,courseId:'19053',courseTitle:'Saved source 19053',sourceId:'seed'+i,japanese:i<3?'語'+i:'私が行きます。',kana:i<3?'ご':'わたし が いきます。',romaji:i<3?'go':'watashi ga ikimasu.',english:'meaning '+i,german:'Bedeutung '+i,audioUrl:'https://assets.iknow.jp/test.mp3',key,createdAt:1,updatedAt:i+1};}
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records},iknowReaderTheme:'paper',iknowReaderSettings:{translationLanguage:'en'}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.goto(`chrome-extension://${id}/study.html`);await page.locator('#demo-library-list .library-row').first().waitFor();
  assert.equal(await page.locator('select#demo-course').count(),1,'Saved course filter stays native');
  assert.equal(await page.locator('select#demo-kind').count(),1,'Saved type filter stays native');
  await page.locator('.focus-rail [data-view="practice"]').click();
  const group=name=>page.locator(`.focus-choice-stepper[data-choice="${name}"]`);
  const value=name=>group(name).locator('output').getAttribute('data-value');
  const step=async(name,direction='next')=>group(name).locator(`[data-choice-step="${direction}"]`).click();
  assert.equal(await page.locator('.activity-pane select').count(),0,'Practice settings have no dropdown controls');
  assert.equal(await value('attempts'),'retry');await step('attempts');assert.equal(await value('attempts'),'single');
  const nextAttempt=group('attempts').locator('[data-choice-step="next"]');await nextAttempt.press('ArrowRight');assert.equal(await value('attempts'),'retry');assert.equal(await nextAttempt.evaluate(node=>node===document.activeElement),true,'Stepping keeps keyboard focus');
  await nextAttempt.press('ArrowLeft');assert.equal(await value('attempts'),'single');await nextAttempt.press('ArrowRight');
  assert.equal(await value('practice-order'),'course');await step('practice-order');assert.equal(await value('practice-order'),'shuffle');await step('practice-order','previous');assert.equal(await value('practice-order'),'course');
  await page.locator('[data-mode="cloze"]').click();assert.equal(await value('gap-position'),'random');await step('gap-position');assert.equal(await value('gap-position'),'first');await step('gap-position','previous');assert.equal(await value('gap-position'),'random');
  await page.locator('[data-mode="review"]').click();
  await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();
  for(let i=0;i<3;i++)await page.locator(`.picker-list [data-item="word:19053:seed${i}"]`).click();
  await page.locator('[data-action="close-picker"]').click();assert.match(await page.locator('.activity-selection').innerText(),/3 selected/);
  await page.locator('[data-practice-source="course"]').click();await page.locator('[data-action="load-practice-course"]:disabled').filter({hasText:'Loaded'}).waitFor();
  assert.equal(await value('practice-content'),'word');assert.match(await page.locator('[data-action="start"]').innerText(),/\(200\)/);
  await step('practice-content');assert.equal(await value('practice-content'),'sentence');assert.match(await page.locator('[data-action="start"]').innerText(),/\(200\)/);
  await step('practice-content');assert.equal(await value('practice-content'),'both');assert.match(await page.locator('[data-action="start"]').innerText(),/\(400\)/);
  const dimensions=[];
  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.evaluate(theme=>{document.documentElement.dataset.ikrTheme=theme;},theme);
   dimensions.push(await group('practice-content').evaluate(node=>{const output=node.querySelector('output'),box=node.getBoundingClientRect();return{width:box.width,height:box.height,outputWidth:output.clientWidth,textWidth:output.scrollWidth};}));
   assert.ok(dimensions.at(-1).outputWidth>=dimensions.at(-1).textWidth,'The complete content label is visible');
   await page.screenshot({path:path.join(out,`practice-${theme}.png`)});
  }
  assert.ok(dimensions.every(box=>box.width===dimensions[0].width&&box.height===dimensions[0].height),'All themes share control geometry');
  for(const width of [900,640,390]){
   await page.setViewportSize({width,height:900});
   const boxes=await page.locator('.focus-choice-stepper').evaluateAll(nodes=>nodes.map(node=>{const output=node.querySelector('output'),box=node.getBoundingClientRect();return{left:box.left,right:box.right,outputWidth:output.clientWidth,textWidth:output.scrollWidth};}));
   assert.ok(boxes.every(box=>box.left>=0&&box.right<=width&&box.outputWidth>=box.textWidth),`Every label remains visible at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#demo-practice-course').fill('19055');const requested=new Promise(resolve=>{slowRequested=resolve;});await page.locator('[data-action="load-practice-course"]').click();await requested;
  assert.equal(await group('practice-content').getAttribute('aria-disabled'),'true');
  for(const button of await group('practice-content').locator('button').all())assert.equal(await button.isDisabled(),true);
  const disabled=group('practice-content').locator('button').first(),before=await disabled.evaluate(node=>({background:getComputedStyle(node).backgroundColor,transform:getComputedStyle(node).transform}));await disabled.hover();
  assert.deepEqual(await disabled.evaluate(node=>({background:getComputedStyle(node).backgroundColor,transform:getComputedStyle(node).transform})),before,'Disabled arrows have no hover animation');
  releaseSlow();await page.locator('[data-action="load-practice-course"]:disabled').filter({hasText:'Loaded'}).waitFor();
  await page.locator('.focus-rail [data-view="test"]').click();await page.locator('[data-action="start"]:not([disabled])').waitFor();
  assert.equal(await page.locator('.activity-pane select').count(),0,'Test settings have no dropdown controls');
  assert.equal(await value('test-content'),'word');assert.equal(await page.locator('#demo-test-total').innerText(),'(200)');
  await step('test-content');assert.equal(await value('test-content'),'sentence');assert.equal(await page.locator('#demo-test-total').innerText(),'(200)');
  await group('test-content').locator('[data-choice-step="next"]').press('ArrowRight');assert.equal(await value('test-content'),'both');assert.equal(await page.locator('#demo-test-total').innerText(),'(400)');
  await step('test-content');assert.equal(await value('test-content'),'word');await step('test-content','previous');assert.equal(await value('test-content'),'both');
  await page.reload();await page.locator('[data-action="start"]:not([disabled])').waitFor();assert.equal(await value('test-content'),'both','The retained test setup reads the output setting');assert.equal(await page.locator('#demo-test-total').innerText(),'(400)');
  await page.locator('.focus-rail [data-view="study"]').click();assert.equal(await page.locator('select#demo-course').count(),1);assert.equal(await page.locator('select#demo-kind').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS Real Study steppers: pointer/keyboard wrapping, saved selection, course/test counts, loading guards, unchanged library filters, complete labels and identical geometry in four themes.');
 }finally{releaseSlow?.();await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
