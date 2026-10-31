/* Approved C result map uses actual session records and retains the test result. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const Results=require("./study-focus-results.js");
const Catalog=require("../../extension/study-catalog.js");
const Examples=require("./study-result-examples.js");
const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));
const catalog=Catalog.normalizeSource(raw,{courseId:"19053"}).records;
const out=path.resolve(__dirname,"../../tests/study-focus-map-evidence");fs.mkdirSync(out,{recursive:true});
const read=name=>fs.readFileSync(path.resolve(__dirname,name),"utf8");
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:"reduce"}),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",r=>r.abort());
  const css=[fs.readFileSync(path.resolve(__dirname,"../../extension/theme.css"),"utf8"),read("study-layouts.css"),read("study-focus.css"),read("study-focus-results.css")].join("\n").replace(/@import[^;]*;/g,"");
  for(const size of [200,400]){
   const example=Examples.create(catalog,size),session={...example.fixture,courseTitle:raw.title,pool:catalog};
   const snapshot=JSON.stringify(session);
   await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"><style>'+css+'.app-frame{height:calc(100vh - 48px);width:calc(100% - 48px);margin:24px;position:relative;flex:none}</style></head><body><div class="app-frame">'+Results.render(session)+'</div></body></html>');
   await page.addScriptTag({content:read("study-focus-results.js")});
   await page.evaluate(s=>{globalThis.session=s;globalThis.dispose=IKnowFocusResults.mount(document.querySelector('.focus-results'),s,{items:[]});},session);
   assert.equal(await page.locator('.focus-result-score>strong').innerText(),'67%');
   assert.equal(await page.locator('.focus-result-map-node').count(),50);
   const initial=await page.locator('.focus-result-selected').innerText(),all=[];
   while(true){all.push(...await page.locator('.focus-result-map-node').evaluateAll(ns=>ns.map(n=>n.dataset.resultPick)));if(await page.locator('[data-result-page=next]').isDisabled())break;await page.locator('[data-result-page=next]').click();}
   assert.deepEqual(all,session.keys);assert.equal(await page.locator('.focus-result-selected').innerText(),initial);
   await page.locator('.focus-result-map-node').last().click();assert.equal(await page.locator('.focus-result-selected').getAttribute('data-selected-key'),session.keys.at(-1));
   assert.equal(await page.locator('.focus-result-selected h3').innerText(),catalog.find(r=>r.key===session.keys.at(-1)).japanese);
   const selected=await page.locator('.focus-result-selected').innerText();
   await page.locator('[data-result-filter-step=next]').click();assert.equal(await page.locator('.focus-result-map-node:not([data-result=again])').count(),0);assert.equal(await page.locator('.focus-result-selected').innerText(),selected);
   await page.locator('[data-result-search]').fill('zzzz-no-result');assert.equal(await page.locator('.focus-result-map-node').count(),0);assert.equal(await page.locator('.focus-result-selected').innerText(),selected);
   assert.equal(await page.locator('.focus-result-score>strong').innerText(),'67%');
   await page.locator('[data-result-search]').fill('');await page.locator('[data-result-filter-step=next]').click();
   for(const theme of ['paper','midnight','tokyo','forest']){
    await page.locator('html').evaluate((n,t)=>n.dataset.ikrTheme=t,theme);
    let previousDesktopMapHeight=0;
    for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080},{width:390,height:844}]){
     await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     const geometry=await page.evaluate(()=>{const map=document.querySelector('.focus-result-map-grid'),main=document.querySelector('.focus-result-map-main'),tile=map.querySelector('button'),detail=main.querySelector('.focus-result-selected');return{mapHeight:map.clientHeight,tileWidth:tile.getBoundingClientRect().width,tileHeight:tile.getBoundingClientRect().height,detailBottom:detail.getBoundingClientRect().bottom,mainBottom:main.getBoundingClientRect().bottom};});
     if(viewport.width>760){assert.ok(geometry.mapHeight>=168);assert.ok(geometry.tileWidth>=116);assert.ok(geometry.mapHeight>previousDesktopMapHeight);previousDesktopMapHeight=geometry.mapHeight;}else assert.ok(geometry.mapHeight<=280);
     assert.equal(geometry.tileHeight,88);
     await page.screenshot({path:path.join(out,`${size}-${theme}-${viewport.width}.png`),fullPage:viewport.width===390});
    }
   }
   assert.equal(await page.evaluate(()=>JSON.stringify(session)),snapshot,'Navigation must not rewrite the submitted answers');
   await page.evaluate(()=>dispose());
   const oldDetail=await page.locator('.focus-result-selected').innerText();await page.locator('.focus-result-map-node').first().click();assert.equal(await page.locator('.focus-result-selected').innerText(),oldDetail,'Cleanup removes old event handlers');
  }
  assert.deepEqual(errors,[]);console.log('PASS Approved C: real 200/400 session answers, source pool lookup, pages/filter/search, stable selected answer and score, cleanup, four themes and mobile');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
