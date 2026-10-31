/* Full refresh checks text, controls and early theme paint, not just the box. */
"use strict";
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));
const otherSource={...structuredClone(source),id:19055,title:"Japanese Core 2000: Step 2"};
const read=name=>fs.readFileSync(path.join(__dirname,name),"utf8");
const base="http://127.0.0.1:52332/study-focus.html?review=refresh-stability#test";
const colors={paper:"rgb(250, 248, 244)",midnight:"rgb(18, 21, 28)",tokyo:"rgb(21, 17, 31)",forest:"rgb(17, 27, 24)"};
const out=path.resolve(__dirname,"../../tests/study-focus-refresh-stability-evidence");fs.mkdirSync(out,{recursive:true});

async function geometry(page){return page.evaluate(()=>{
 const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 const course=document.querySelector(".setup-course"),load=document.querySelector('[data-action="load-test-course"]'),start=document.querySelector('.setup-start [data-action="start"]');
 return{title:document.getElementById("demo-test-title").textContent,load:load.textContent,start:start.textContent,input:document.getElementById("demo-test-course").value,content:document.getElementById("demo-test-content").dataset.value,course:rect(course),inputBox:rect(document.getElementById("demo-test-course")),contentBox:rect(document.getElementById("demo-test-content")),loadBox:rect(load),startBox:rect(start),bottom:innerHeight-document.querySelector(".app-frame").getBoundingClientRect().bottom};
 });}
function sameGeometry(left,right,context){for(const name of ["course","inputBox","contentBox","loadBox","startBox"])for(const field of ["x","y","width","height"])assert.ok(Math.abs(left[name][field]-right[name][field])<=1,`${context}: ${name}.${field} moves no more than 1px (${left[name][field]} → ${right[name][field]})`);}

(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true}),errors=[],evidence=[];
 try{
  for(const [theme,color]of Object.entries(colors)){
   const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:"reduce"}),page=await context.newPage();
   page.on("pageerror",error=>errors.push(error.message));
   await page.addInitScript(theme=>{
    localStorage.setItem("ikr-layout-review:theme",theme);
    globalThis.coursePaints=[];
    const sample=()=>{const title=document.getElementById("demo-test-title"),load=document.querySelector('[data-action="load-test-course"]'),start=document.querySelector('.setup-start [data-action="start"]');if(!title||!load||!start)return;const state={title:title.textContent,load:load.textContent,start:start.textContent,input:document.getElementById("demo-test-course").value,content:document.getElementById("demo-test-content").dataset.value,enabled:!start.disabled};if(JSON.stringify(state)!==JSON.stringify(coursePaints.at(-1)))coursePaints.push(state);};
    new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true});
   },theme);
   await page.route("**/study-focus.html**",route=>route.fulfill({contentType:"text/html",body:read("study-focus.html")}));
   let controllerBlocked=true,releaseController,controllerRequested;
   const controllerReady=new Promise(resolve=>{controllerRequested=resolve;});
   await page.route("**/study-focus.js",async route=>{if(controllerBlocked)await new Promise(resolve=>{releaseController=resolve;controllerRequested();});await route.fulfill({contentType:"application/javascript",body:read("study-focus.js")});});
   for(const name of ["study-focus-course.js","study-focus.css","study-layouts.css"])await page.route("**/"+name,route=>route.fulfill({contentType:name.endsWith(".css")?"text/css":"application/javascript",body:read(name)}));
   let networkMode="hold",releases=[],courseRequests=0;
   await page.route("**/catalog-source.json",async route=>{courseRequests++;if(networkMode==="hold")await new Promise(resolve=>releases.push(resolve));await route.fulfill(networkMode==="fail"?{status:503,contentType:"application/json",body:'{"error":"offline"}'}:{contentType:"application/json",body:JSON.stringify(source)});});
   await page.route("**/api/courses/*",async route=>{courseRequests++;await route.fulfill(networkMode!=="fail"&&new URL(route.request().url()).pathname==="/api/courses/19055"?{contentType:"application/json",body:JSON.stringify(otherSource)}:{status:503,contentType:"application/json",body:'{"error":"unavailable"}'});});

   // Block the application controller: the correct theme must already be painted.
   await page.goto(base,{waitUntil:"commit"});
   await page.waitForFunction(({theme,color})=>document.body&&document.documentElement.dataset.ikrTheme===theme&&getComputedStyle(document.documentElement).backgroundColor===color&&getComputedStyle(document.body).backgroundColor===color,{theme,color});
   assert.ok(read("study-focus.html").indexOf("data-theme-boot")<read("study-focus.html").indexOf('<link rel="stylesheet"'),"Allowlisted theme boot precedes every external stylesheet");
   assert.equal(await page.locator(".app-frame").count(),0,"Theme restoration does not wait for the application to render");
   assert.equal(await page.locator("html").evaluate(node=>getComputedStyle(node).colorScheme),theme==="paper"?"light":"dark");
   await controllerReady;controllerBlocked=false;
   assert.ok(releaseController instanceof Function);releaseController();
   await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.textContent.includes("Loading"));
   const cold=await geometry(page);assert.ok(cold.bottom>=24,"The frame leaves a blank margin above the taskbar");
   networkMode="success";releases.splice(0).forEach(release=>release());
   await page.locator('[data-action="start"]:not([disabled])').waitFor();
   const readyWord=await geometry(page);sameGeometry(cold,readyWord,theme+" first load");
   await page.locator("#demo-test-course").fill("https://iknow.jp/courses/19055");await page.locator('[data-action="load-test-course"]').click();
   await page.waitForFunction(title=>document.getElementById("demo-test-title")?.textContent===title,otherSource.title);
   await chooseWorkspaceOption(page, "#demo-test-content", "both");
   const ready=await geometry(page);assert.ok(ready.start.includes("400"),"The full public source includes 200 words and 200 sentences");
   await page.screenshot({path:path.join(out,theme+"-ready.png")});

   // A warm refresh must not expose the generic title or shrink count/buttons.
   const beforeRequests=courseRequests;networkMode="fail";
   await page.reload();await page.locator('[data-action="start"]:not([disabled])').waitFor();
   const restored=await geometry(page),paints=await page.evaluate(()=>coursePaints);
   assert.ok(paints.length>0);
   for(const paint of paints){for(const field of ["title","load","start","input","content"])assert.equal(paint[field],ready[field],`${theme}: first visible warm frame retains ${field}`);assert.equal(paint.enabled,true,"A fresh saved course has no transient disabled Start frame");}
   assert.equal(courseRequests,beforeRequests,"A fresh validated saved course does not need a refresh download");
   sameGeometry(ready,restored,theme+" warm refresh");
   assert.ok(restored.bottom>=24);
   assert.equal(await page.locator("html").evaluate(node=>getComputedStyle(node).backgroundColor),color);
   await page.screenshot({path:path.join(out,theme+"-restored.png")});

   if(theme==="paper"){
    // A requested different course must not silently borrow the previous course.
    await page.locator("#demo-test-course").fill("19057");await page.locator('[data-action="load-test-course"]').click();
    await page.waitForFunction(()=>document.getElementById("demo-test-source-status")?.textContent.includes("503"));
    assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
    assert.notEqual(await page.locator("#demo-test-title").innerText(),otherSource.title);
    // Corrupting the isolated cache cannot paint/enable an unrelated source.
    await page.evaluate(async raw=>{await new Promise((resolve,reject)=>{const request=indexedDB.open("iknow-reading-helper-study-course-preview",1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction("cache","readwrite");tx.objectStore("cache").put({schemaVersion:1,entries:{"19055":{at:Date.now(),source:{...raw,id:19053,title:"WRONG COURSE CACHE"}}}},"iknowReaderStudyCatalog");tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});},otherSource);
    await page.reload();await page.waitForFunction(()=>document.getElementById("demo-test-source-status")?.textContent.includes("503"));
    assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
    assert.ok((await page.evaluate(()=>coursePaints)).every(paint=>paint.title!=="WRONG COURSE CACHE"&&!paint.enabled),"Invalid course IDs in saved sources are rejected before paint or Start");
   }
   await page.setViewportSize({width:390,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Mobile has no horizontal page overflow");
   assert.ok(await page.locator("#demo").evaluate(node=>parseFloat(getComputedStyle(node).paddingBottom)>=24),"Mobile retains blank bottom spacing too");
   evidence.push({theme,cold,ready,restored,warmFrames:paints,courseRequests});await context.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,"geometry.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log("PASS Full refresh stability: pre-controller theme colors, blank bottom margin, stable course title/controls/count through warm refresh, source cache validation, four themes and mobile fit");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
