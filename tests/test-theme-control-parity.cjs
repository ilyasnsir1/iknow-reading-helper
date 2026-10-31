/* Theme controls keep one shape, palette and selection mark on the shipped pages. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'theme-control-parity-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=path.join(out,'run-'+Date.now(),'extension');fs.mkdirSync(extension,{recursive:true});fs.cpSync(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.join(root,'extension'),extension,{recursive:true});
 const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
 const staged=spawnSync(process.env.IKR_PYTHON||path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});assert.equal(staged.status,0,staged.stderr);
 fs.writeFileSync(path.join(extension,'theme-native-fixture.js'),`chrome.runtime.connectNative=()=>{const listeners=[],ends=[];let open=true;return{onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener:fn=>ends.push(fn)},disconnect(){open=false;ends.forEach(fn=>fn());},postMessage(message){queueMicrotask(()=>{if(open)listeners.forEach(fn=>fn({type:'components:result',requestId:message.requestId,ok:true,snapshot:{catalogVersion:'fixture',components:[],job:null}}));});}};};`);
 const bg=path.join(extension,'background.js');fs.writeFileSync(bg,'importScripts("theme-native-fixture.js");\n'+fs.readFileSync(bg,'utf8'));
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];
 try{
  await context.route('https://**/*',route=>route.abort());
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderTheme:'paper',iknowReaderStudyLibrary:{schemaVersion:1,records:{'word:19053:fox':{key:'word:19053:fox',kind:'word',courseId:'19053',courseTitle:'Test course',sourceId:'fox',japanese:'狐',kana:'きつね',romaji:'kitsune',english:'fox',german:'Fuchs',audioUrl:'',createdAt:1,updatedAt:1}}}}));
  const pages=new Map();
  for(const name of ['study','changelog','models','queue','popup']){const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(name+': '+error.message));await page.goto(`chrome-extension://${id}/${name}.html`);await page.locator(name==='study'?'#focus-theme-trigger':'.ikr-theme-trigger').waitFor();pages.set(name,page);}
  const study=pages.get('study');
  const geometry=locator=>locator.evaluate(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return{width:r.width,height:r.height,radius:s.borderRadius,padding:s.padding,fontSize:s.fontSize,lineHeight:s.lineHeight,background:s.backgroundColor};});
  for(const theme of ['paper','midnight','tokyo','forest']){
   await study.bringToFront();
   const previousTheme=await study.locator('html').getAttribute('data-ikr-theme');
   await study.evaluate(()=>{globalThis.fixturePreviousThemeHeader=document.querySelector('.app-header');});
   await study.locator('#focus-theme-trigger').click();await study.locator(`.focus-menu-theme [data-menu-value="${theme}"]`).click();
   for(const page of pages.values())await page.waitForFunction(theme=>document.documentElement.dataset.ikrTheme===theme,theme);
   // The shared theme service paints the root immediately. The workspace
   // replaces its header after the durable storage snapshot arrives; opening
   // the previous header's menu before that update would inspect detached DOM.
   if(previousTheme!==theme)await study.waitForFunction(theme=>document.querySelector('.app-header')!==globalThis.fixturePreviousThemeHeader&&document.querySelector('[data-focus-menu="theme"]')?.dataset.value===theme,theme);
   const expected=await geometry(study.locator('#focus-theme-trigger'));assert.deepEqual({width:expected.width,height:expected.height,radius:expected.radius},{width:136,height:34,radius:'4px'});
   for(const [name,page] of pages){
    const isStudy=name==='study',trigger=page.locator(isStudy?'#focus-theme-trigger':'.ikr-theme-trigger');
    await page.bringToFront();assert.deepEqual(await geometry(trigger),expected,theme+' '+name+' trigger matches Study');
    await page.evaluate(selector=>document.querySelector(selector)?.scrollIntoView({block:'nearest'}),isStudy?'#focus-theme-trigger':'.ikr-theme-trigger');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await trigger.click();
    const menu=page.locator(isStudy?'#focus-theme-list':'.ikr-theme-options'),option=page.locator(isStudy?'.focus-menu-theme .focus-menu-option':'.ikr-theme-option'),swatches=menu.locator(isStudy?'.focus-menu-swatch':'.ikr-theme-swatch'),check=menu.locator(isStudy?'.focus-menu-check':'.ikr-theme-check');
    assert.equal(await swatches.count(),4,name+' contains four palette swatches');
    const cells=await swatches.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height,circle:node.querySelector('circle')?.getAttribute('r'),fill:node.querySelector('circle')?.getAttribute('fill'),stroke:getComputedStyle(node).stroke};}));
    for(const cell of cells){assert.equal(cell.width,20,theme+' '+name+' '+JSON.stringify(cell));assert.equal(cell.height,20);assert.equal(cell.circle,'9');assert.match(cell.fill,/^#[a-f\d]{6}$/);assert.equal(cell.stroke,'none');}
    assert.equal(await check.count(),4,name+' uses explicit checkmarks');assert.equal(await check.evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).opacity==='1').length),1,name+' exactly one visible check');
    const pseudo=await option.first().evaluate(node=>getComputedStyle(node,'::after').content);assert.ok(['none','normal'].includes(pseudo),name+' has no selection dot');
    const bounds=await menu.boundingBox();assert.equal(bounds.width,184);assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1440);
    if(theme==='midnight'&&['study','changelog'].includes(name))await page.screenshot({path:path.join(out,name+'-midnight.png')});
    await page.keyboard.press('Escape');assert.equal(await menu.isHidden(),true);
   }
  }
  const changelog=pages.get('changelog');await changelog.locator('.ikr-theme-trigger').click();await changelog.locator('[data-theme-value="midnight"]').click();await changelog.waitForFunction(()=>document.documentElement.dataset.ikrTheme==='midnight');
  assert.equal(await changelog.locator('[data-theme-value="midnight"] .ikr-theme-check').evaluate(node=>getComputedStyle(node).opacity),'1');
  assert.equal(await changelog.locator('.ikr-theme-trigger').evaluate(node=>getComputedStyle(node).boxShadow),'none','Mouse selection leaves no focus ring');
  assert.deepEqual(errors,[]);
  console.log('PASS Theme control parity: Study, Changelog, Models, Queue and popup; matching rectangular trigger, split swatches and one checkmark in all four themes; no selected dot or mouse focus ring.');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
