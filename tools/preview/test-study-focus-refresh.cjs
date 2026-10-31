/* Refresh returns to the current workspace without flashing another view. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));
const read=name=>fs.readFileSync(path.join(__dirname,name),"utf8");
const base="http://127.0.0.1:52332/study-focus.html?review=refresh-workspace";
const themes=["paper","midnight","tokyo","forest"],out=path.resolve(__dirname,"../../tests/study-focus-refresh-evidence");
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 const errors=[],evidence=[];
 try{
  for(const theme of themes){
   const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:"reduce"}),page=await context.newPage();
   page.on("pageerror",error=>errors.push(error.message));
   await page.addInitScript(theme=>{
    localStorage.setItem("ikr-layout-review:theme",theme);
    globalThis.renderedViews=[];
    new MutationObserver(()=>{const value=document.querySelector('.focus-rail [aria-pressed="true"]')?.dataset.view;if(value&&globalThis.renderedViews.at(-1)!==value)globalThis.renderedViews.push(value);}).observe(document,{subtree:true,childList:true});
   },theme);
   await page.route("**/study-focus.js",route=>route.fulfill({contentType:"application/javascript",body:read("study-focus.js")}));
   await page.route("**/study-focus.css",route=>route.fulfill({contentType:"text/css",body:read("study-focus.css")}));
   let releaseCourse=null;
   await page.route("**/catalog-source.json",async route=>{
    if(releaseCourse!==false)await new Promise(resolve=>{releaseCourse=resolve;});
    await route.fulfill({contentType:"application/json",body:JSON.stringify(source)});
   });
   await page.goto(base);await page.locator(".focus-card").waitFor();
   assert.equal(new URL(page.url()).hash,"#study");
   for(const view of ["practice","kana","study"]){
    await page.locator(`.focus-rail [data-view="${view}"]`).click();
    assert.equal(new URL(page.url()).hash,"#"+view);
    await page.reload();await page.locator(`.focus-rail [data-view="${view}"][aria-pressed="true"]`).waitFor();
    assert.deepEqual(await page.evaluate(()=>renderedViews),[view],`Reload renders only ${view}, never a temporary Study screen`);
    assert.equal(new URL(page.url()).search,"?review=refresh-workspace");
   }
   await page.locator('.focus-rail [data-view="test"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.textContent==="Loading…");
   async function geometry(){return page.locator(".setup-course").evaluate(node=>{const box=node.getBoundingClientRect(),start=document.querySelector('.setup-start').getBoundingClientRect();return{top:box.top,height:box.height,bottom:box.bottom,startTop:start.top,statusHeight:document.getElementById('demo-test-source-status').getBoundingClientRect().height};});}
   const pending=await geometry();await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.disabled);
   await page.waitForTimeout(20);assert.ok(releaseCourse instanceof Function);releaseCourse();releaseCourse=false;
   await page.locator('[data-action="start"]:not([disabled])').waitFor();const ready=await geometry();
   for(const name of ["top","height","bottom","startTop","statusHeight"])assert.ok(Math.abs(pending[name]-ready[name])<=1,`${theme}: course ${name} stays stable as loading completes`);
   await page.reload();await page.locator('[data-action="start"]:not([disabled])').waitFor();
   assert.deepEqual(await page.evaluate(()=>renderedViews),["test"],"Test reload does not flash Study");
   const restored=await geometry();for(const name of ["top","height","bottom","startTop"])assert.ok(Math.abs(ready[name]-restored[name])<=1);
   await page.screenshot({path:path.join(out,`${theme}-test.png`)});
   evidence.push({theme,pending,ready,restored});
   await page.goto(base+"#invalid-workspace");await page.locator('.focus-rail [data-view="study"][aria-pressed="true"]').waitFor();
   assert.equal(new URL(page.url()).hash,"#study","Unknown routes fall back safely");
   await context.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,"geometry.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log("PASS Workspace refresh: Study/Practice/Test/Kana restore directly, safe unknown routes, query retained; Test loading/loaded geometry stable in all four themes");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
