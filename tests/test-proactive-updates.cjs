/* All production update modules with controlled browser/native/storage events. */
"use strict";
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{webcrypto}=require("node:crypto");
const ext=path.resolve(__dirname,"../extension"),KEY="iknowReaderUpdateState";
const signal=()=>{const callbacks=[];return{addListener:fn=>callbacks.push(fn),emit(...args){for(const fn of callbacks)fn(...args);}};};
async function fixture({initial={},version="1.36.0",mode="available",latestVersion="1.37.0",enabled=true,tabs=[],active=false,now=1800000000000}={}){
 const data=structuredClone(initial),calls=[],reloads=[],badges=[],handlers=[],events={startup:signal(),installed:signal(),activated:signal(),updated:signal()};
 let next={mode,latestVersion,ok:true},busy=active,clock=now,runtimeReloads=0;
 const manifest={version,action:{default_title:"Reading Helper settings"}};
 const chrome={runtime:{id:"fixture",getManifest:()=>manifest,getURL:name=>"chrome-extension://fixture/"+name,onStartup:events.startup,onInstalled:events.installed,
  onMessage:{addListener:fn=>handlers.push(fn)},reload(){runtimeReloads++;},connectNative(){let opened=true;const messages=[],disconnects=[];return{
   onMessage:{addListener:fn=>messages.push(fn)},onDisconnect:{addListener:fn=>disconnects.push(fn)},disconnect(){if(!opened)return;opened=false;disconnects.forEach(fn=>fn());},postMessage(message){calls.push(message.type);setTimeout(()=>{if(opened)messages.forEach(fn=>fn({type:"update:result",requestId:message.requestId,ok:next.ok,state:{status:next.mode,latestVersion:next.latestVersion,message:"Fixture signed result"}}));},1);}};}},
  storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async patch=>Object.assign(data,structuredClone(patch))}},
  action:{setBadgeText:async detail=>badges.push(detail.text),setBadgeTextColor:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
  tabs:{onActivated:events.activated,onUpdated:events.updated,query:async()=>structuredClone(tabs),get:async id=>{const tab=tabs.find(tab=>tab.id===id);if(!tab)throw Error("Closed");return structuredClone(tab);},reload:async id=>reloads.push(id)}};
 class Clock extends Date{static now(){return clock;}}
 const context=vm.createContext({chrome,crypto:webcrypto,URL,console,Date:Clock,setTimeout,clearTimeout,Promise,fetch:async()=>({ok:true,json:async()=>({enabled})}),IKnowReaderUpdateActivity:async()=>busy});
 for(const name of["update-refresh.js","update-discovery.js","updates.js"])vm.runInContext(fs.readFileSync(path.join(ext,name),"utf8"),context,{filename:name});
 const settle=()=>new Promise(resolve=>setTimeout(resolve,12));await settle();
 const send=(action,sender={id:"fixture",url:"chrome-extension://fixture/popup.html"})=>new Promise(resolve=>handlers[0]({type:"ikr:update:"+action},sender,resolve));
 return{data,calls,reloads,badges,events,context,send,settle,tabs,get runtimeReloads(){return runtimeReloads;},advance:ms=>{clock+=ms;},mode:(mode,ok=true,latestVersion="1.37.0")=>{next={mode,ok,latestVersion};},busy:value=>{busy=value;}};
}
(async()=>{
 let f=await fixture();assert.deepEqual(f.calls,["update:check"]);assert.equal(f.badges.at(-1),"NEW");assert.equal(f.data[KEY].status,"available");
 f.events.startup.emit();f.events.installed.emit();f.events.activated.emit({tabId:1});await f.settle();assert.equal(f.calls.length,1);
 const restarted=await fixture({initial:f.data});assert.equal(restarted.calls.length,0);assert.equal(restarted.badges.at(-1),"NEW");
 f.advance(60*60*1000-1);f.events.activated.emit({tabId:2});await f.settle();assert.equal(f.calls.length,1);
 f.advance(2);f.mode("error",false);const presentation=f.badges.length;f.events.startup.emit();await f.settle();assert.equal(f.calls.length,2);assert.equal(f.badges.at(-1),"NEW");assert.ok(!f.badges.slice(presentation).includes(""));
 console.log("PASS Startup discovers a verified release with no popup, restores NEW across worker restarts, enforces one-hour cooldown and keeps the badge steady through quiet failures");
 const manual=await fixture();manual.advance(3600001);await manual.send("check");manual.events.activated.emit({tabId:4});await manual.settle();assert.equal(manual.calls.length,2);
 await manual.send("check");assert.equal(manual.calls.length,3);
 console.log("PASS Explicit checks reset the automatic cooldown while remaining available on demand");
 const errorState={status:"error",latestVersion:"1.36.0",lastAttemptAt:1800000000000-3600001};f=await fixture({initial:{[KEY]:errorState}});assert.deepEqual(f.calls,["update:check"]);assert.equal(f.badges.at(-1),"NEW");
 const busy=await fixture({active:true});assert.equal(busy.calls.length,0);busy.busy(false);busy.events.activated.emit({tabId:3});await busy.settle();assert.equal(busy.calls.length,1);
 const disabled=await fixture({enabled:false});assert.equal(disabled.calls.length,0);
 console.log("PASS Old errors retry after cooldown, active preparation defers native checking, and disabled distribution never starts the helper");
 f=await fixture();f.advance(3600001);const before=f.calls.length;
 for(const sender of[{id:"foreign",url:"https://iknow.jp/courses/19053",tab:{id:1}}, {id:"fixture",url:"https://iknow.jp.evil/courses/19053",tab:{id:1}}, {id:"fixture",url:"http://iknow.jp/courses/19053",tab:{id:1}}, {id:"fixture",url:"https://iknow.jp/content/japanese",tab:{id:1}}, {id:"fixture",url:"https://iknow.jp/courses/19053"}, {id:"fixture",url:"https://iknow.jp/courses/19053",tab:{id:1},frameId:2}])assert.equal((await f.send("presence",sender)).code,"update_forbidden");
 assert.equal(f.calls.length,before);
 const sender={id:"fixture",url:"https://iknow.jp/courses/19053",tab:{id:1},frameId:0};assert.equal((await f.send("presence",sender)).ok,true);assert.equal(f.calls.length,before+1);
 for(const action of["install","check","refresh","status"])assert.equal((await f.send(action,sender)).code,"update_forbidden");
 console.log("PASS A visible-course presence can discover updates after cooldown, while forged/foreign/iframe/index-page signals and content-script install/refresh actions are rejected");
 const tabs=[{id:1,url:"https://iknow.jp/courses/19053",audible:false},{id:2,url:"https://ja.iknow.jp/series/3318"},{id:3,url:"https://example.com/"}];
 const completed={status:"complete",latestVersion:"1.36.0",reloadedVersion:"1.36.0",refreshTabs:true,installAttempted:true,lastAttemptAt:1800000000000};
 f=await fixture({initial:{[KEY]:completed},tabs});assert.deepEqual(f.reloads,[1,2]);assert.equal(f.data[KEY].autoRefreshCompleteVersion,"1.36.0");assert.equal(f.data[KEY].refreshTabs,false);assert.equal(f.calls.length,0);assert.equal(f.runtimeReloads,0);
 const resumed=await fixture({initial:f.data,tabs});assert.deepEqual(resumed.reloads,[]);
 const noIntent=await fixture({initial:{[KEY]:{status:"available",latestVersion:"1.36.0",refreshTabs:true,lastAttemptAt:1800000000000}},tabs});assert.deepEqual(noIntent.reloads,[]);
 const failed=await fixture({initial:{[KEY]:{status:"error",latestVersion:"1.36.0",refreshTabs:true,lastAttemptAt:1800000000000}},tabs});assert.deepEqual(failed.reloads,[]);
 console.log("PASS The actually loaded target automatically refreshes matching pages once, including migration from the old updater; reloads without install intent and failed installs do not refresh");
 tabs[0].audible=true;f=await fixture({initial:{[KEY]:completed},tabs});assert.deepEqual(f.reloads,[]);assert.equal(f.data[KEY].refreshTabs,true);
 tabs[0].audible=false;f.events.updated.emit(1,{audible:false},tabs[0]);await f.settle();assert.deepEqual(f.reloads,[1,2]);assert.equal(f.data[KEY].refreshTabs,false);
 console.log("PASS Active iKnow audio defers refresh, and its stopped-audio event completes refresh without reopening the popup");
 const locked=await fixture({tabs});let release;const barrier=new Promise(resolve=>{release=resolve;});
 locked.context.chrome.tabs.reload=async id=>{if(id===1)await barrier;locked.reloads.push(id);};
 const refreshing=locked.send("refresh");await locked.settle();
 assert.equal((await locked.send("check")).code,"update_busy");assert.equal((await locked.send("install")).code,"update_busy");assert.equal(locked.calls.length,1);
 release();await refreshing;
 console.log("PASS Explicit checks and installation cannot interrupt an active page-refresh transaction");
 const old=await fixture({version:"1.36.0",initial:{[KEY]:{status:"available",latestVersion:"1.37.0",lastAttemptAt:1800000000000}},tabs});old.mode("complete",true);await old.send("install");await new Promise(resolve=>setTimeout(resolve,550));
 assert.equal(old.runtimeReloads,1);assert.deepEqual(old.reloads,[]);assert.equal(old.data[KEY].autoRefreshTarget,"1.37.0");
 const loaded=await fixture({version:"1.37.0",initial:old.data,tabs,latestVersion:"1.37.0",mode:"current"});assert.deepEqual(loaded.reloads,[1,2]);assert.equal(loaded.data[KEY].refreshTabs,false);
 console.log("PASS Explicit install hands off persisted refresh intent, old worker reloads only the extension, and only the new target worker refreshes iKnow tabs");
})().catch(error=>{console.error(error);process.exitCode=1;});
