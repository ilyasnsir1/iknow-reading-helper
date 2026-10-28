/* Real Brave action badge, worker reload and tab reloads. Only native release
 * metadata/completion and websites use explicit fixtures; no installed profile,
 * registry, helper, model, live network or disk installation is accessed. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source=path.resolve(__dirname,"../extension"),out=path.join(__dirname,"automatic-updates-evidence");fs.mkdirSync(out,{recursive:true});
const until=async(fn,label)=>{const start=Date.now();while(!await fn()){if(Date.now()-start>20000)throw Error("Timed out: "+label);await new Promise(resolve=>setTimeout(resolve,35));}};
(async()=>{
 const extension=require("./fixtures/isolate-extension.cjs")(source,out,{updatesEnabled:true});
 fs.writeFileSync(path.join(extension,"native-update-fixture.js"),`chrome.runtime.connectNative=()=>{const messages=[],disconnects=[];let open=true;return{onMessage:{addListener:fn=>messages.push(fn)},onDisconnect:{addListener:fn=>disconnects.push(fn)},disconnect(){if(!open)return;open=false;disconnects.forEach(fn=>fn());},postMessage(message){(async()=>{const previous=(await chrome.storage.local.get("testNativeCalls")).testNativeCalls||[];await chrome.storage.local.set({testNativeCalls:[...previous,message.type]});if(!open)return;messages.forEach(fn=>fn({type:"update:result",requestId:message.requestId,ok:true,state:{status:"available",latestVersion:"9.0.0",message:"Fixture verified update available"}}));})();}};};`);
 const bootstrap=path.join(extension,"background.js");fs.writeFileSync(bootstrap,'importScripts("native-update-fixture.js");\n'+fs.readFileSync(bootstrap,"utf8"));
 const profile=path.join(out,"profile-"+Date.now());
 const context=await chromium.launchPersistentContext(profile,{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1000,height:850}});
 const errors=[],loads=new Map(),requests=[];context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
 await context.route("https://**/*",async route=>{
  const request=route.request(),url=new URL(request.url());requests.push(url.hostname);
  if(!["iknow.jp","ja.iknow.jp","example.test"].includes(url.hostname))throw Error("Unexpected request: "+url.hostname);
  if(request.isNavigationRequest()){
   const count=(loads.get(url.href)||0)+1;loads.set(url.href,count);
   await route.fulfill({contentType:"text/html",body:`<!doctype html><html><body><h1>Local website fixture</h1><p id="load">${count}</p></body></html>`});
  }else await route.fulfill({contentType:"application/json",body:JSON.stringify({goal_items:[]})});
 });
 let worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
 try{
  await until(()=>worker.evaluate(async()=>await chrome.action.getBadgeText({})==="NEW"),"NEW without a popup");
  assert.equal(context.pages().some(page=>page.url().includes("popup.html")),false);
  assert.equal(await worker.evaluate(async()=>{const d=await chrome.storage.local.get("testNativeCalls");return d.testNativeCalls.length;}),1);
  const title=await worker.evaluate(()=>chrome.action.getTitle({}));assert.match(title,/9\.0\.0 available/);
  console.log("PASS Real toolbar API shows NEW and the release tooltip after startup with no popup or manual check");
  // Match the user's unpacked-extension setup through the real browser UI.
  // Command-line loading alone starts once but cannot reload in a profile
  // whose protected Developer mode preference has never been enabled.
  const developer=await context.newPage();await developer.goto("chrome://extensions/");
  const toggle=developer.locator("#devMode");if(!await toggle.evaluate(element=>element.checked))await toggle.click();
  await until(()=>toggle.evaluate(element=>element.checked),"isolated Developer mode");await developer.close();
  const urls=["https://iknow.jp/courses/19053","https://ja.iknow.jp/series/3318","https://example.test/"];
  for(const url of urls){const page=await context.newPage();await page.goto(url);}
  const baseline=urls.map(url=>loads.get(url));assert.deepEqual(baseline,[1,1,1]);
  const installedManifest=JSON.parse(fs.readFileSync(path.join(extension,"manifest.json"),"utf8"));
  const parts=installedManifest.version.split(".").map(Number);parts[2]++;const version=parts.join(".");
  // Model the installer's actual disk version change, not just a developer
  // reload of identical files. Native transaction/signatures are separate tests.
  fs.writeFileSync(path.join(extension,"manifest.json"),JSON.stringify({...installedManifest,version}));
  await worker.evaluate(async version=>{
   await chrome.storage.local.set({iknowReaderUpdateState:{status:"complete",latestVersion:version,reloadedVersion:version,refreshTabs:true,installAttempted:true,lastAttemptAt:Date.now()},testCourseSentinel:{saved:"retained"},iknowReaderSettings:{enabled:false}});
  },version);
  const nextWorker=context.waitForEvent("serviceworker",{timeout:10000});await worker.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
  try { worker=await nextWorker; } catch(error) {
   const diagnostic=await context.newPage();await diagnostic.goto('chrome://extensions/');
   const extensions=await diagnostic.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},values=>resolve(values.map(value=>({id:value.id,state:value.state,version:value.version,disableReasons:value.disableReasons,keys:Object.keys(value),manifestErrors:value.manifestErrors,runtimeErrors:value.runtimeErrors,installWarnings:value.installWarnings}))))));
   console.log("Reload debug",JSON.stringify({workers:context.serviceWorkers().map(value=>value.url()),pages:context.pages().map(value=>value.url()),errors,loads:[...loads]}));
   console.log("Extension reload diagnostic",JSON.stringify(extensions));
   throw error;
  }
  await until(()=>worker.evaluate(async()=>{const s=(await chrome.storage.local.get("iknowReaderUpdateState")).iknowReaderUpdateState;return s?.status==="current"&&s.refreshTabs===false&&s.autoRefreshCompleteVersion===chrome.runtime.getManifest().version;}),"automatic refresh after real worker reload");
  await until(async()=>loads.get(urls[0])===2&&loads.get(urls[1])===2,"both real iKnow tabs reload");assert.equal(loads.get(urls[2]),1);
  assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})),"");
  assert.deepEqual(await worker.evaluate(async()=>(await chrome.storage.local.get("testCourseSentinel")).testCourseSentinel),{saved:"retained"});
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get("iknowReaderSettings")).iknowReaderSettings.enabled),false);
  console.log("PASS Real runtime.reload loads the target and automatically reloads both iKnow tabs without reopening the popup; unrelated pages and saved data remain unchanged");
  const again=context.waitForEvent("serviceworker");await worker.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
  await context.pages().find(page=>page.url()===urls[0]).bringToFront();worker=await again;
  await until(()=>worker.evaluate(async()=>!!(await chrome.storage.local.get("iknowReaderUpdateState")).iknowReaderUpdateState.autoRefreshCompleteVersion),"restored completion");
  await new Promise(resolve=>setTimeout(resolve,350));assert.deepEqual(urls.map(url=>loads.get(url)),[2,2,1]);assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})),"");
  assert.deepEqual(errors,[]);
  const passed={badgeWithoutPopup:true,realExtensionReload:true,automaticIKnowRefresh:true,noRepeatedPageRefresh:true,unrelatedTabUnchanged:true,storedDataRetained:true,externalRequests:"All website requests fulfilled locally; native metadata is an explicit fixture",scope:"Real browser lifecycle and tab effects; no actual release installation or user profile used"};
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(passed,null,2));
  console.log("PASS A second real extension reload preserves completion and does not reload pages again; all fixture browser checks are error-free");
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
