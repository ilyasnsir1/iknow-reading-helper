/* Production theme UI in an isolated Brave extension. Native/source data are
 * fixtures; no registered host, personal storage or live website is accessed. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.join(__dirname,"themes-evidence");fs.mkdirSync(out,{recursive:true});
const until=async(fn,label)=>{const start=Date.now();while(!await fn()){if(Date.now()-start>14000)throw Error("Timed out: "+label);await new Promise(resolve=>setTimeout(resolve,25));}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,180));
(async()=>{
 const extension=require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname,"../extension"),out);
 fs.writeFileSync(path.join(extension,"theme-read-fixture.js"),`if(new URL(location.href).searchParams.has('heldThemeRead')){const get=chrome.storage.local.get.bind(chrome.storage.local);let initial=true;chrome.storage.local.get=async key=>{if(initial&&key==='iknowReaderTheme'){initial=false;const snapshot=await get(key);await new Promise(resolve=>{globalThis.releaseInitialThemeRead=resolve;});return snapshot;}return get(key);};}`);
 const modelsMarkup=path.join(extension,"models.html");fs.writeFileSync(modelsMarkup,fs.readFileSync(modelsMarkup,"utf8").replace('<script src="theme.js">','<script src="theme-read-fixture.js"></script><script src="theme.js">'));
 fs.writeFileSync(path.join(extension,"theme-native-fixture.js"),`chrome.runtime.connectNative=()=>{const listeners=[],ends=[];let open=true;return{onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener:fn=>ends.push(fn)},disconnect(){open=false;ends.forEach(fn=>fn());},postMessage(message){queueMicrotask(()=>{if(open)listeners.forEach(fn=>fn({type:'components:result',requestId:message.requestId,ok:true,snapshot:{catalogVersion:'fixture',components:[{id:'audio',title:'Sentence audio timings',description:'Local model fixture',version:'test',status:'installed',downloadBytes:10}],job:null}}));});}};};`);
 const bg=path.join(extension,"background.js");fs.writeFileSync(bg,'importScripts("theme-native-fixture.js");\n'+fs.readFileSync(bg,"utf8"));
 const context=await chromium.launchPersistentContext(path.join(out,"profile-"+Date.now()),{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1200,height:1000}});
 const errors=[],external=[];context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
 const sentence={cue:{id:10001,text:"それはとてもいい話だ。",transliterations:{Hrkt:"それ は とても いい はなし だ。",Latn:"sore wa tottemo ii hanashi da."}},response:{text:"That's a really nice story."},sound:"https://assets0.iknow.jp/assets/test.mp3"};
 const goal={id:19053,title:"[Legacy] Japanese Core 2000: Step 4",cue_language:"ja",items_count:1,sentences_count:1,goal_items:[{item:{id:100,cue:{id:100,text:"それ",transliterations:{Hrkt:"それ",Latn:"sore"}},response:{text:"that"}},sentences:[sentence],sound:sentence.sound}]};
 await context.route("https://**/*",async route=>{const url=new URL(route.request().url());
  if(url.hostname==="iknow.jp"&&/^\/api\/v2\/goals\/(19053|19054)$/.test(url.pathname))return route.fulfill({contentType:"application/json",body:JSON.stringify({...goal,id:Number(url.pathname.split('/').at(-1))})});
  if(url.hostname==="iknow.jp"&&url.pathname==="/series/3318")return route.fulfill({contentType:"text/html",body:'<!doctype html><h1>Japanese course series</h1><div class="series_list"><a href="/courses/19053">Step 1</a><a href="/courses/19054">Step 2</a></div>'});
  if(url.hostname==="iknow.jp"&&/^\/courses\/(19053|19054)$/.test(url.pathname))return route.fulfill({contentType:"text/html",body:`<!doctype html><meta charset="utf-8"><style>.item{display:flex;gap:40px;padding:20px;min-height:200px}.item-details{width:250px}.item-sentences{width:600px}</style><div class="course-content-container"><div class="course-content"><div class="items"><div class="item"><div class="item-details"><div class="cue-response"><a class="cue" href="/items/100">それ</a><p class="response">that</p></div></div><div class="item-sentences"><div class="sentence"><div class="sentence-text"><p class="text">${sentence.cue.text}</p><p class="transliteration">${sentence.cue.transliterations.Hrkt}</p><p class="translation">${sentence.response.text}</p></div></div></div></div></div></div></div>`});
  external.push(url.href);await route.abort();
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker"),id=new URL(worker.url()).host;
 try{
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderTheme:"tokyo",testLearningSentinel:{value:"kept"},iknowReaderStudyLibrary:{schemaVersion:1,records:{
   "sentence:19053:10001":{kind:"sentence",courseId:"19053",courseTitle:"[Legacy] Japanese Core 2000: Step 4",sourceId:"10001",japanese:"それはとてもいい話だ。",kana:"それ は とても いい はなし だ。",romaji:"sore wa tottemo ii hanashi da.",english:"That's a really nice story.",german:"Das ist eine wirklich schöne Geschichte.",createdAt:1,updatedAt:2},
   "word:19054:10002":{kind:"word",courseId:"19054",courseTitle:"[Legacy] Japanese Core 2000: Step 5 — Everyday Japanese",sourceId:"10002",japanese:"それ",kana:"それ",romaji:"sore",english:"that",german:"das",createdAt:1,updatedAt:1}
  }}}));
  const study=await context.newPage();await study.goto(`chrome-extension://${id}/study.html`);await study.locator("#japanese").waitFor();await study.evaluate(()=>IKnowReaderTheme.ready);
  const models=await context.newPage();await models.goto(`chrome-extension://${id}/models.html`);await models.locator(".component").waitFor();
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator("#settings").waitFor();
  const course=await context.newPage();await course.goto("https://iknow.jp/courses/19053");await course.locator(".ikr-toolbar").waitFor();await course.locator(".ikr-study-tools button").first().waitFor();
  await until(async()=>await popup.locator('html').getAttribute('data-ikr-theme')==='tokyo','existing app theme');
  assert.equal(await course.locator('html').getAttribute('data-ikr-theme'),'paper','new panel preference must not inherit an existing app theme');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderPanelTheme')).iknowReaderPanelTheme),undefined);
  await study.evaluate(()=>IKnowReaderTheme.choose('paper'));await until(async()=>await popup.locator('html').getAttribute('data-ikr-theme')==='paper','original app palette before comparison');
  await study.evaluate(()=>{const set=chrome.storage.local.set.bind(chrome.storage.local);globalThis.testThemeWrites=[];chrome.storage.local.set=value=>{testThemeWrites.push(Object.keys(value));return set(value);};});
  const themedPages=[study,models,popup],originalBackgrounds=await Promise.all(themedPages.map(page=>page.locator("body").evaluate(e=>getComputedStyle(e).backgroundColor)));
  const palettes={paper:null,midnight:"rgb(18, 21, 28)",tokyo:"rgb(21, 17, 31)",forest:"rgb(17, 27, 24)"};
  for(const [theme,bg] of Object.entries(palettes)){
   await study.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);
   await until(async()=>{for(const page of[study,models,popup])if(await page.locator("html").getAttribute("data-ikr-theme")!==theme)return false;return true;},"app cross-page "+theme);
   assert.equal(await course.locator('html').getAttribute('data-ikr-theme'),'paper','app choice must not recolor the course panels');
   for(const [index,page]of themedPages.entries())assert.equal(await page.locator("body").evaluate(e=>getComputedStyle(e).backgroundColor),theme==="paper"?originalBackgrounds[index]:bg,theme+" page background");
   assert.notEqual(await course.locator(".ikr-toolbar").evaluate(e=>getComputedStyle(e).backgroundColor),"rgba(0, 0, 0, 0)");
  }
  const before=await worker.evaluate(async()=>{const d=await chrome.storage.local.get(["iknowReaderStudyLibrary","iknowReaderSettings","testLearningSentinel"]);return JSON.stringify(d);});
  await study.evaluate(()=>Promise.all(["midnight","forest","paper","tokyo"].map(theme=>IKnowReaderTheme.choose(theme))));
  await until(async()=>await study.evaluate(()=>IKnowReaderTheme.current)==="tokyo"&&await popup.locator("html").getAttribute("data-ikr-theme")==="tokyo"&&await worker.evaluate(async()=>(await chrome.storage.local.get("iknowReaderTheme")).iknowReaderTheme)==="tokyo","rapid last choice");
  assert.equal(await study.evaluate(()=>IKnowReaderTheme.current),"tokyo");assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get("iknowReaderTheme")).iknowReaderTheme),"tokyo");
  assert.deepEqual(await study.evaluate(()=>testThemeWrites.flat()),Array(8).fill("iknowReaderTheme"));
  assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(["iknowReaderStudyLibrary","iknowReaderSettings","testLearningSentinel"]))),before);
  await models.reload();await models.evaluate(()=>IKnowReaderTheme.ready);assert.equal(await models.locator("html").getAttribute("data-ikr-theme"),"tokyo");
  console.log("PASS All four app palettes synchronize Study, Models and popup while course panels default to Original; reload persists and rapid choices touch only the app preference");
  const choosePanel=async(page,theme)=>{await page.locator('.ikr-theme-trigger').first().click();await page.locator(`.ikr-theme-option[data-theme-value="${theme}"]`).first().click();await until(async()=>await page.locator('html').getAttribute('data-ikr-theme')===theme,'panel choice '+theme);};
  await choosePanel(course,'forest');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderPanelTheme')).iknowReaderPanelTheme),'forest');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('iknowReaderTheme')).iknowReaderTheme),'tokyo');
  for(const page of[study,models,popup])assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),'tokyo');
  const secondCourse=await context.newPage();await secondCourse.goto('https://iknow.jp/courses/19054');await secondCourse.locator('.ikr-toolbar').waitFor();
  const series=await context.newPage();await series.goto('https://iknow.jp/series/3318');await series.locator('.ikr-series-card').waitFor();
  await until(async()=>await secondCourse.locator('html').getAttribute('data-ikr-theme')==='forest'&&await series.locator('html').getAttribute('data-ikr-theme')==='forest','shared panel preference on a fresh course and series');
  await course.reload();await course.locator('.ikr-toolbar').waitFor();await until(async()=>await course.locator('html').getAttribute('data-ikr-theme')==='forest','panel reload persistence');
  await study.evaluate(()=>IKnowReaderTheme.choose('midnight'));await until(async()=>await popup.locator('html').getAttribute('data-ikr-theme')==='midnight','changed app choice');
  for(const page of[course,secondCourse,series])assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),'forest');
  await choosePanel(series,'tokyo');await until(async()=>await course.locator('html').getAttribute('data-ikr-theme')==='tokyo'&&await secondCourse.locator('html').getAttribute('data-ikr-theme')==='tokyo','series picker updates only website panels');
  assert.equal(await study.locator('html').getAttribute('data-ikr-theme'),'midnight');
  assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(["iknowReaderStudyLibrary","iknowReaderSettings","testLearningSentinel"]))),before,'panel choices must not mutate learning data or settings');
  await secondCourse.close();await series.close();await study.evaluate(()=>IKnowReaderTheme.choose('tokyo'));await until(async()=>await popup.locator('html').getAttribute('data-ikr-theme')==='tokyo','restore app palette');
  console.log('PASS App and website-panel themes have separate preferences; a panel choice persists across reload, fresh courses and series without changing app pages');
  const late=await context.newPage();await late.goto(`chrome-extension://${id}/models.html?heldThemeRead=1`);
  await until(()=>late.evaluate(()=>typeof releaseInitialThemeRead==="function"),"held initial preference snapshot");
  await study.evaluate(()=>IKnowReaderTheme.choose("forest"));await until(async()=>await late.locator("html").getAttribute("data-ikr-theme")==="forest","new authoritative theme during held snapshot");
  await late.evaluate(()=>releaseInitialThemeRead());await late.evaluate(()=>IKnowReaderTheme.ready);assert.equal(await late.locator("html").getAttribute("data-ikr-theme"),"forest");
  await late.close();await study.evaluate(()=>IKnowReaderTheme.choose("tokyo"));await until(async()=>await popup.locator("html").getAttribute("data-ikr-theme")==="tokyo","restore reviewed palette");
  console.log("PASS A delayed initial preference snapshot cannot overwrite a newer cross-page theme event");
  await popup.locator('.ikr-theme-trigger').click();
  const swatches=await popup.locator('.ikr-theme-options svg.ikr-theme-swatch').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),circle=node.querySelector('circle');return{width:r.width,height:r.height,round:circle?.getAttribute('r'),background:getComputedStyle(node).backgroundImage};}));
  assert.equal(swatches.length,4);for(const swatch of swatches){assert.equal(swatch.width,swatch.height);assert.ok(swatch.width>=18);assert.equal(swatch.round,'9');assert.equal(swatch.background,'none');}
  await popup.keyboard.press('Escape');
  const divider=popup.locator('.colors-card>.setting-row').last();
  assert.equal(await divider.evaluate(e=>getComputedStyle(e).borderTopColor),await popup.locator('.colors-card').evaluate(e=>getComputedStyle(e).borderTopColor),'Understanding divider uses the theme border instead of an original white separator');
  await course.mouse.move(0,0);await tick();
  for(const handle of await course.locator('.ikr-panel-handle').all())assert.equal(await handle.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','idle drag handles remain transparent');
  await study.locator('#reveal-all').hover();assert.equal(await study.locator('#reveal-all').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.ok(await study.locator('#reveal-all').evaluate(e=>parseFloat(getComputedStyle(e).paddingLeft)>=6),'Romaji reveal text has breathing room without a filled pill');
  console.log('PASS Theme dots are round SVG artwork, the Understanding divider uses the dark palette, idle drag handles are transparent, and Romaji reveal remains a spacious text action');
  await study.locator("#search").click();assert.equal(await study.locator("#search").evaluate(e=>getComputedStyle(e).outlineStyle),"none");assert.match(await study.locator("#search").evaluate(e=>getComputedStyle(e).boxShadow),/inset/);
  await study.locator("#remove-item").hover();const center=await study.locator("#remove-item").evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector("svg").getBoundingClientRect();return Math.max(Math.abs(a.x+a.width/2-b.x-b.width/2),Math.abs(a.y+a.height/2-b.y-b.height/2));});assert.ok(center<=.5);
  await study.locator("#course-filter-trigger").click();const option=study.locator('#course-filter-options [role="option"]').nth(1);assert.match(await option.innerText(),/Step 4/);
  assert.ok(await option.evaluate(e=>{const s=getComputedStyle(e),r=document.createRange();r.selectNodeContents(e);const a=e.getBoundingClientRect(),b=r.getBoundingClientRect();return parseFloat(s.paddingLeft)>=9&&parseFloat(s.paddingRight)>=9&&b.right<=a.right-8&&b.left>=a.left+8;}));
  assert.ok(await study.locator('#course-filter-options').evaluate(e=>e.getBoundingClientRect().width<=300),'course menu should remain compact');
  await study.evaluate(()=>{globalThis.testCourseChanges=0;document.getElementById("course-filter").addEventListener("change",()=>testCourseChanges++);});
  await study.keyboard.press("End");await study.keyboard.press("Enter");assert.equal(await study.locator("#course-filter").inputValue(),"19054");assert.equal(await study.evaluate(()=>testCourseChanges),1);
  console.log("PASS Search uses inset focus, the close SVG is centered, and the padded course menu displays full long titles with keyboard changes passed to the native select");
  const snapshot=locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return[s.backgroundColor,s.borderColor,s.color,s.opacity];});
  await tick();const disabled=study.locator("#play-take"),disabledBefore=await snapshot(disabled);await disabled.hover();await tick();assert.deepEqual(await snapshot(disabled),disabledBefore);
  const bookmark=course.locator(".ikr-study-tools button").first();await course.mouse.move(0,0);const rest=await snapshot(bookmark),opacity=await bookmark.evaluate(e=>getComputedStyle(e.parentElement).opacity);
  await course.locator(".sentence-text .text").first().hover();await tick();assert.deepEqual(await snapshot(bookmark),rest);assert.equal(await bookmark.evaluate(e=>getComputedStyle(e.parentElement).opacity),opacity);
  console.log("PASS Disabled controls have no hover change, and merely hovering a course row never brightens its bookmark buttons");
  await study.setViewportSize({width:390,height:844});await study.bringToFront();assert.equal(await study.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await study.screenshot({path:path.join(out,"study-tokyo-mobile.png"),fullPage:true});
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderTheme:"unrecognized"}));await until(async()=>await study.locator("html").getAttribute("data-ikr-theme")==="paper","invalid value fallback");
  await study.reload();await study.evaluate(()=>IKnowReaderTheme.ready);assert.equal(await study.locator("html").getAttribute("data-ikr-theme"),"paper");
  assert.equal(await course.locator('html').getAttribute('data-ikr-theme'),'tokyo','invalid app values must not reset the panel choice');
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderPanelTheme:'unrecognized'}));await until(async()=>await course.locator('html').getAttribute('data-ikr-theme')==='paper','invalid panel value fallback');
  assert.equal(await study.locator('html').getAttribute('data-ikr-theme'),'paper');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,themes:Object.keys(palettes),crossPageSync:true,separateAppPanelPreferences:true,panelOriginalDefault:true,freshCourseSeriesPersistence:true,rapidWritesIsolated:true,delayedInitialReadSafe:true,roundSwatches:true,themedDivider:true,transparentDragHandles:true,revealTextAction:true,focusInside:true,closeCentered:true,longMenuKeyboard:true,hoverIsolated:true,mobileWidth:390,noExternalRequests:true,scope:"Real isolated extension pages/content; native metadata and public-course responses are fixtures. No installed profile or model is used."},null,2));
  console.log("PASS A 390px study page has no horizontal overflow; invalid stored themes fall back to Original across reload without errors");
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
