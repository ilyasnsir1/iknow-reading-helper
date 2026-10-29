/* Real course controls and production preparation states in isolated Brave.
 * Availability/jobs are fixture metadata; no personal profile/native job used. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.join(__dirname,"panel-controls-evidence");fs.mkdirSync(out,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{const at=Date.now();while(!await fn()){if(Date.now()-at>12000)throw Error("Timed out: "+label);await delay(35);}};
const sentence={cue:{id:10001,text:"それはとてもいい話だ。",transliterations:{Hrkt:"それ は とても いい はなし だ。",Latn:"sore ha totemo ii hanashi da."}},response:{text:"That's a really nice story."},sound:"https://assets0.iknow.jp/assets/test.mp3"};
const goal={id:19053,title:"Panel layout fixture",cue_language:"ja",items_count:1,sentences_count:1,goal_items:[{item:{id:100,cue:{id:100,text:"それ",transliterations:{Hrkt:"それ",Latn:"sore"}},response:{text:"that"}},sentences:[sentence],sound:sentence.sound}]};
(async()=>{
 const extension=require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname,"../extension"),out);
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,"manifest.json")));
 const scripts=manifest.content_scripts.find(entry=>entry.js.includes("content.js")).js;
 scripts.splice(scripts.indexOf("automation.js")+1,0,"panel-state-fixture.js");fs.writeFileSync(path.join(extension,"manifest.json"),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,"panel-state-fixture.js"),`(()=>{
  const originalCreate=IKnowReaderAutomation.create,originalConnect=chrome.runtime.connect.bind(chrome.runtime);let receive=null,last=null,controller=null,current='partial';
  chrome.runtime.connect=options=>{if(options?.name!=='ikr:auto')return originalConnect(options);return{onMessage:{addListener:fn=>{receive=fn}},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}}};
  const availability=()=>{const ready=current==='saved'?200:current==='ready'?0:60;const status=ready===200?'ready':ready?'partial':'missing';return{complete:ready===200,modules:Object.fromEntries(['german','colors','audio'].map(key=>[key,{status,ready,total:200,wordsReady:ready,wordsTotal:200}]))}};
  const override=value=>({...value,availability:availability(),complete:false,features:{german:true,colors:false,audio:false},displayFeatures:{german:false,colors:false,audio:false}});
  globalThis.IKnowReaderAutomation=Object.freeze({create(options){controller=originalCreate(options);return{update(value){last=value;controller.update(override(value))},destroy(){controller.destroy()}}}});
  globalThis.fixtureSetPanelState=name=>{current=name;controller.update(override(last));receive?.({type:'state',state:{courseId:'19053',status:name==='running'?'running':name==='paused'?'cancelled':'idle',stage:'language',completed:name==='running'?60:0,total:200,features:{german:true,colors:false,audio:false}}})};
  document.addEventListener('fixture-panel-state',event=>fixtureSetPanelState(event.detail));
 })();`);
 const context=await chromium.launchPersistentContext(path.join(out,"profile-"+Date.now()),{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1100,height:1000},reducedMotion:"reduce"});
 const errors=[],external=[],measurements=[];context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
 await context.route("https://**/*",route=>{const url=new URL(route.request().url());
  if(url.hostname==='iknow.jp'&&url.pathname==='/api/v2/goals/19053')return route.fulfill({contentType:'application/json',body:JSON.stringify(goal)});
  if(url.hostname==='iknow.jp'&&url.pathname==='/courses/19053')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;box-sizing:border-box}.course-content-container{max-width:980px;margin:auto}.item{display:flex;gap:30px;min-height:140px}.item-details{width:220px}.item-sentences{flex:1;min-width:0}p{overflow-wrap:anywhere}</style><div class="course-content-container"><div class="course-content"><div class="items"><div class="item"><div class="item-details"><div class="cue-response"><a class="cue" href="/items/100">それ</a><p class="response">that</p></div></div><div class="item-sentences"><div class="sentence"><div class="sentence-text"><p class="text">${sentence.cue.text}</p><p class="transliteration">${sentence.cue.transliterations.Hrkt}</p><p class="translation">${sentence.response.text}</p></div></div></div></div></div></div></div>`});
  external.push(url.href);return route.abort();
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 try{
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderSettings:{enabled:true,colorMode:'off'},iknowReaderPanelOrder:'reading-first'}));
  const page=await context.newPage();await page.goto('https://iknow.jp/courses/19053');await page.locator('.ikr-preparation:not([hidden])').waitFor();
  const setState=async state=>{await page.evaluate(state=>document.dispatchEvent(new CustomEvent('fixture-panel-state',{detail:state})),state);await until(async()=>await page.locator('.ikr-preparation').getAttribute('data-saved')===(state==='saved'?'true':'false'),state+' availability');await delay(100);};
  const checkGrip=async(state,collapsed,width,theme)=>{
   const value=await page.locator('.ikr-preparation').evaluate(panel=>{const r=panel.getBoundingClientRect(),h=panel.querySelector('.ikr-panel-handle').getBoundingClientRect();return{top:h.top-r.top,left:h.left-r.left,right:h.right<=r.right,bottom:h.bottom<=r.bottom}});
   assert.ok(value.top>=0&&value.top<=20,`${state}/${collapsed}/${width}/${theme}: grip top ${value.top}`);
   assert.ok(value.left>=0&&value.left<=20,`${state}: grip left ${value.left}`);assert.ok(value.right&&value.bottom);
   measurements.push({state,collapsed,width,theme,...value});
  };
  for(const width of [1100,390]){
   await page.setViewportSize({width,height:1000});
   for(const theme of ['paper','midnight','tokyo','forest']){
    await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderPanelTheme:theme}),theme);await until(async()=>await page.locator('html').getAttribute('data-ikr-theme')===theme,'theme '+theme);
    for(const state of ['ready','partial','running','paused','saved']){
     await setState(state);
     const collapsed=await page.locator('.ikr-preparation').getAttribute('data-minimized')==='true';if(collapsed)await page.locator('.ikr-preparation-minimize').click();
     await checkGrip(state,false,width,theme);
     if(width===1100&&theme==='paper'&&state==='partial')await page.screenshot({path:path.join(out,'1100-paper-partial-expanded.png'),fullPage:true});
     await page.locator('.ikr-preparation-minimize').click();await checkGrip(state,true,width,theme);
     if(width===1100&&theme==='paper'&&state==='partial')await page.screenshot({path:path.join(out,'1100-paper-partial-collapsed.png'),fullPage:true});
     await page.locator('.ikr-preparation-minimize').click();
    }
    const bounds=await page.locator('.ikr-toolbar').evaluate(toolbar=>{const picker=toolbar.querySelector('.ikr-theme-trigger'),r=toolbar.getBoundingClientRect(),p=picker.getBoundingClientRect();const siblings=[...toolbar.querySelectorAll('label,strong')].map(node=>node.getBoundingClientRect());return{outsideMenus:!picker.closest('.ikr-toolbar-selects'),gap:r.right-p.right,left:p.left>=r.left,right:p.right<=r.right,overlap:siblings.some(b=>Math.min(b.right,p.right)>Math.max(b.left,p.left)&&Math.min(b.bottom,p.bottom)>Math.max(b.top,p.top))}});
    assert.equal(bounds.outsideMenus,true,'Theme is separate from Language/settings menus');assert.ok(bounds.left&&bounds.right&&!bounds.overlap,'Theme stays inside toolbar without overlaps');if(width===1100)assert.ok(bounds.gap>=0&&bounds.gap<=26,'Desktop theme button aligns with right padding');
    await page.screenshot({path:path.join(out,`${width}-${theme}.png`),fullPage:true});
   }
  }
  console.log('PASS Preparation grips stay top-left in five states, expanded/collapsed, all four themes and desktop/mobile widths');
  console.log('PASS Theme picker is separate from Language, right-aligned on desktop, and contained without overlaps on mobile');
  await page.setViewportSize({width:1100,height:1000});await setState('partial');
  await page.locator('.ikr-preparation .ikr-panel-handle').focus();await page.keyboard.press('Home');await until(async()=>await page.locator('.ikr-panel-stack').getAttribute('data-order')==='course-first','keyboard reorder');
  await page.locator('.ikr-preparation .ikr-panel-handle').focus();await page.keyboard.press('End');await until(async()=>await page.locator('.ikr-panel-stack').getAttribute('data-order')==='reading-first','keyboard reorder back');
  await page.locator('.ikr-toolbar .ikr-theme-trigger').click();await page.locator('.ikr-theme-options [data-theme-value="tokyo"]').click();await until(async()=>await page.locator('html').getAttribute('data-ikr-theme')==='tokyo','theme choice');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,measurements,pageErrors:errors},null,2));
  console.log('PASS Reorder keyboard controls and the moved theme menu remain functional');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
