/* Canonical iKnow scene: no hidden layout/animation-tree work on tab exit. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const ext=path.resolve(__dirname,'../extension'),out=path.join(__dirname,'tab-switch-performance-evidence');fs.mkdirSync(out,{recursive:true});
const read=name=>fs.readFileSync(path.join(ext,name),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://fixture.invalid/assets/*',route=>route.fulfill({path:path.join(ext,'assets',route.request().url().split('/').pop())}));
  await page.setContent('<!doctype html><html><head><style>body{margin:30px}#anchor{width:960px;height:1px}</style></head><body><div id="anchor"></div></body></html>');
  await page.addStyleTag({content:read('automation.css')+'\n'+read('companion.css')});
  await page.addScriptTag({content:read('core.js')});await page.addScriptTag({content:read('scene-motion.js')});
  await page.evaluate(()=>{
   crypto.randomUUID=()=>"fixture-scene-id";globalThis.fixtureHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixtureHidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixtureHidden?'hidden':'visible'});
   globalThis.chrome={runtime:{getURL:name=>'http://fixture.invalid/'+name,sendMessage:async()=>({ok:true}),connect:()=>({onMessage:{addListener:fn=>globalThis.receiveState=fn},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}})}};
  });
  await page.addScriptTag({content:read('automation.js')});
  await page.evaluate(()=>{
   globalThis.sceneOptions={courseId:'19053',course:{id:19053,title:'Fixture',goal_items:[{item:{id:1,cue:{text:'猫'},response:{text:'cat'}},sentences:[]}]},enabled:true,complete:true,features:{german:false,colors:false,audio:false},availability:{complete:true,modules:Object.fromEntries(['german','colors','audio'].map(key=>[key,{status:'ready',ready:1,total:1,wordsReady:1,wordsTotal:1}]))}};
   globalThis.sceneApi=IKnowReaderAutomation.create({anchor:document.getElementById('anchor')});sceneApi.update(sceneOptions);
  });
  await page.locator('.ikr-preparation[data-saved="true"][data-scene-ready="true"]').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(async()=>{
   const scene=document.querySelector('.ikr-saved-scene'),card=scene.closest('.ikr-preparation');
   globalThis.audit={hiddenGeometry:0,hiddenAnimationQueries:0,cardRenderMutations:0,visibleGeometry:0};
   globalThis.savedAnimations=scene.getAnimations({subtree:true});const journey=savedAnimations.find(a=>a.animationName==='ikr-loop-journey');
   if(!journey)throw Error('Fixture needs the real walking animation');
   const get=Element.prototype.getAnimations;Element.prototype.getAnimations=function(...args){if(fixtureHidden&&(this===scene||scene.contains(this)))audit.hiddenAnimationQueries++;return get.apply(this,args);};
   for(const prop of ['clientWidth','clientHeight','offsetLeft','offsetTop']){
    const owner=prop.startsWith('client')?Element.prototype:HTMLElement.prototype,descriptor=Object.getOwnPropertyDescriptor(owner,prop);
    Object.defineProperty(owner,prop,{...descriptor,get(){if(this===scene||scene.contains(this)){if(fixtureHidden)audit.hiddenGeometry++;else audit.visibleGeometry++;}return descriptor.get.call(this);}});
   }
   new MutationObserver(records=>{for(const r of records)if(r.target===card&&r.attributeName==='data-status')audit.cardRenderMutations++;}).observe(card,{attributes:true});
   const started=performance.now();fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));const handlerMs=performance.now()-started;
   await new Promise(r=>setTimeout(r,60));const paused=journey.currentTime;await new Promise(r=>setTimeout(r,80));
   const held=journey.currentTime,states=savedAnimations.map(a=>a.playState);
   for(let i=0;i<30;i++)document.dispatchEvent(new Event('visibilitychange'));
   await new Promise(r=>setTimeout(r,20));
   const before={...audit},pauseDelta=Math.abs(held-paused),pendingVisibleReads=audit.visibleGeometry;
   fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('ikr:panels-reordered'));document.dispatchEvent(new Event('visibilitychange'));
   const immediateReads=audit.visibleGeometry-pendingVisibleReads;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const current=scene.getAnimations({subtree:true}),sameClocks=savedAnimations.every(a=>current.includes(a));
   return{handlerMs,before,pauseDelta,states,sameClocks,immediateReads,visibleGeometry:audit.visibleGeometry,journeyAfter:journey.currentTime,held};
  });
  assert.equal(result.before.hiddenGeometry,0,'Leaving an iKnow tab never measures the hidden fox scene');assert.equal(result.before.hiddenAnimationQueries,0,'Leaving a tab does not query its animation subtree');assert.equal(result.before.cardRenderMutations,0,'Hidden visibility does not rebuild the preparation card');assert.ok(result.states.every(s=>s==='paused'||s==='finished'));assert.ok(result.pauseDelta<2,'The same animation clocks remain paused while hidden');assert.equal(result.sameClocks,true,'Returning resumes the original animation objects');assert.equal(result.immediateReads,0,'Visible work is deferred into one frame rather than blocking the visibility event');assert.ok(result.visibleGeometry>0);assert.ok(result.journeyAfter>=result.held,'Returning does not reset the fox timeline');
  // The same hidden guard covers ResizeObserver and explicit background progress updates.
  await page.evaluate(()=>{fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));sceneApi.update({...sceneOptions,enabled:true});});await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(50);
  const hidden=await page.evaluate(()=>({...audit}));assert.equal(hidden.hiddenGeometry,0);assert.equal(hidden.hiddenAnimationQueries,0);assert.equal(hidden.cardRenderMutations,0);
  await page.evaluate(()=>{fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(40);
  await page.evaluate(async()=>{
   const missing={...sceneOptions,complete:false,features:{german:true,colors:false,audio:false},availability:{...sceneOptions.availability,complete:false}};
   sceneApi.update(missing);receiveState({type:'state',state:{courseId:'19053',status:'running',stage:'language',completed:0,total:1,features:missing.features}});
   sceneApi.update({...sceneOptions,features:missing.features});
   if(!document.querySelector('.ikr-preparation').dataset.completion)throw Error('Expected preparation completion transition');
   await Promise.resolve();audit.hiddenGeometry=audit.hiddenAnimationQueries=audit.cardRenderMutations=0;fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(80);const completionHidden=await page.evaluate(()=>({...audit}));assert.equal(completionHidden.hiddenGeometry,0);assert.equal(completionHidden.hiddenAnimationQueries,0);assert.equal(completionHidden.cardRenderMutations,0,'Cancelling completion while leaving a tab defers the full render');
  await page.evaluate(()=>{fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.locator('.ikr-preparation[data-saved="true"]').waitFor();assert.equal(await page.locator('.ikr-preparation[data-completion]').count(),0,'Returning presents the completed scene without replaying completion');
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(40);
  assert.deepEqual(errors,[]);
  // Destroying a panel cancels queued restoration work and listeners.
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));sceneApi.destroy();});await page.waitForTimeout(40);assert.equal(await page.locator('.ikr-preparation').count(),0);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({result,hidden,completionHidden,errors},null,2)+'\n');console.log('PASS iKnow tab visibility: no hidden geometry/animation queries/full render; paused clocks retained, visible work deferred/coalesced, resize/reduced-motion/destroy guards');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
