/* Real isolated Brave extension UI; local report fixture, no native/model work. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const extension=path.resolve(__dirname,"../extension"),out=path.join(__dirname,"diagnostics-evidence");fs.mkdirSync(out,{recursive:true});
(async()=>{
 const context=await chromium.launchPersistentContext(path.join(out,"profile-"+Date.now()),{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,acceptDownloads:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1000,height:850}});
 const errors=[],requests=[];context.on("page",p=>p.on("pageerror",error=>errors.push(error.message)));context.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker"),id=new URL(worker.url()).host;
  await worker.evaluate(()=>{chrome.runtime.connectNative=()=>{throw Error("Unexpected native call in UI fixture");};});
  const page=await context.newPage();await page.addInitScript(()=>{
   window.fixture={calls:[],delay:200,mode:"ready",report:{format:"iknow-reader-diagnostics",schemaVersion:1,diagnosticFormatVersion:2,collection:{helperExtended:true},helper:{status:"ready",report:{helperVersion:"1.17.0",events:{events:[]},updates:{activeCheck:{status:"complete"}}}},history:{events:[]},example:'<img src="https://example.invalid/leak" onerror="window.injected=true">'}};
   chrome.runtime.sendMessage=async message=>{fixture.calls.push(message);await new Promise(resolve=>setTimeout(resolve,fixture.delay));if(fixture.mode==="fail")throw Error("PRIVATE C:\\Users\\Secret");if(fixture.mode==="large")return{ok:true,report:{padding:"x".repeat(2200000)}};return{ok:true,report:fixture.report};};
  });
  await page.goto(`chrome-extension://${id}/diagnostics.html`);const button=page.locator("#export-diagnostics"),status=page.locator("#diagnostics-status");
  assert.equal(await page.evaluate(()=>fixture.calls.length),0);
  let download=page.waitForEvent("download");await button.click();assert.equal(await button.isDisabled(),true);await page.evaluate(()=>document.querySelector("#export-diagnostics").click());
  let file=await download;assert.match(file.suggestedFilename(),/^iKnow-Reading-Helper-diagnostics-\d{8}-\d{6}\.json$/);await file.saveAs(path.join(out,"complete-report.json"));
  assert.equal(await page.evaluate(()=>fixture.calls.length),1);await page.locator('#diagnostics-status[data-state="success"]').waitFor();
  await page.locator("#report-preview summary").click();assert.equal(await page.locator("#report-text").textContent(),JSON.stringify(await page.evaluate(()=>fixture.report),null,2)+"\n");assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator("img").count(),1);
  await page.screenshot({path:path.join(out,"complete.png"),fullPage:true});
  console.log("PASS Real diagnostic page exports inert JSON exactly once, retains nested evidence, shows completion and does not execute report content");
  await page.evaluate(()=>{fixture.report.helper={status:"missing",lastKnown:{stale:true,capturedAt:Date.now(),report:{helperVersion:"1.17.0"}}};fixture.report.collection.helperExtended=false;});
  download=page.waitForEvent("download");await button.click();await download;await page.locator('#diagnostics-status[data-state="partial"]').waitFor();assert.ok((await status.textContent()).includes("last-known"));
  await page.evaluate(()=>{fixture.report.helper={status:"ready",report:{helperVersion:"1.16.0"}};});download=page.waitForEvent("download");await button.click();await download;await page.locator('#diagnostics-status[data-state="partial"]').waitFor();assert.ok((await status.textContent()).includes("older report format"));
  console.log("PASS Missing and older helpers still download usable reports and expose the actual coverage limitation in the UI");
  await page.evaluate(()=>{fixture.report.helper={status:"ready",report:{updates:{activeCheck:{status:"partial",reason:"metadata_fetch_failed"}}}};fixture.report.collection.helperExtended=true;});
  download=page.waitForEvent("download");await button.click();await download;await page.locator('#diagnostics-status[data-state="partial"]').waitFor();assert.ok((await status.textContent()).includes("Some checks were unavailable"));
  for(const mode of["fail","large"]){await page.evaluate(mode=>{fixture.mode=mode;},mode);await button.click();await page.locator('#diagnostics-status[data-state="error"]').waitFor();assert.ok(!(await status.textContent()).includes("PRIVATE"));assert.equal(await button.isEnabled(),true);assert.equal(await page.locator("#report-preview").isVisible(),false);}
  await page.bringToFront();await page.evaluate(()=>{fixture.mode="ready";fixture.delay=6500;fixture.report.helper={status:"ready"};fixture.report.collection.helperExtended=true;});
  download=page.waitForEvent("download");await button.click();await page.waitForFunction(()=>document.querySelector("#diagnostics-status").textContent.includes("Checking Windows update verification"));await download;await page.locator('#diagnostics-status[data-state="success"]').waitFor();
  await page.setViewportSize({width:390,height:844});await page.keyboard.press("Tab");await button.focus();assert.equal(await button.evaluate(node=>getComputedStyle(node).outlineColor),"rgb(150, 155, 168)");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));await page.screenshot({path:path.join(out,"narrow.png"),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log("PASS Failed/oversized exports allow safe retry; extended-check waiting text is visible;390px layout and neutral focus remain clean without network/model work");
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
