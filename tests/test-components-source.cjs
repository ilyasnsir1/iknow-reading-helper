"use strict";
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{webcrypto}=require("node:crypto");
(async()=>{
 const handlers=[],calls=[],store={},timers=new Set();let busy=false,mode="missing",fail=false;
 const chrome={runtime:{id:"fixture",getURL:name=>"chrome-extension://fixture/"+name,onMessage:{addListener:fn=>handlers.push(fn)},connectNative(){const listeners=[],disconnected=[];let ended=false;return{onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener:fn=>disconnected.push(fn)},disconnect(){ended=true;disconnected.forEach(fn=>fn());},postMessage(message){calls.push(message);queueMicrotask(()=>{if(!ended)listeners.forEach(fn=>fn({type:"components:result",requestId:message.requestId,ok:!fail,message:fail?"fixture failed":"",snapshot:{catalogVersion:"fixture",components:[{id:"voices",status:mode}],job:mode==="running"?{componentId:"voices",status:"running"}:null}}));});}};}},storage:{local:{get:async key=>({[key]:store[key]}),set:async patch=>Object.assign(store,structuredClone(patch))}}};
 const context=vm.createContext({chrome,URL,crypto:webcrypto,console,Date,Promise,queueMicrotask,setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout:id=>{clearTimeout(id);timers.delete(id);},IKnowReaderUpdateActivity:async()=>busy});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../extension/components-source.js"),"utf8"),context);
 const send=(action,extra={},sender={id:"fixture",url:"chrome-extension://fixture/models.html",frameId:0})=>new Promise(resolve=>handlers[0]({type:"ikr:components:"+action,...extra},sender,resolve));
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls.length,0);
 for(const sender of [{id:"foreign",url:"chrome-extension://fixture/models.html"},{id:"fixture",url:"https://iknow.jp/courses/19053",frameId:0},{id:"fixture",url:"chrome-extension://fixture/popup.html"},{id:"fixture",url:"chrome-extension://fixture/models.html",frameId:2}])assert.equal((await send("start",{manual:true,componentId:"voices"},sender)).code,"component_forbidden");
 assert.equal((await send("start",{componentId:"voices"})).code,"component_forbidden");assert.equal((await send("start",{manual:true,componentId:"../evil"})).code,"component_forbidden");assert.equal(calls.length,0);
 assert.equal((await send("status")).ok,true);assert.equal(calls[0].type,"components:status");
 busy=true;assert.equal((await send("start",{manual:true,componentId:"voices"})).code,"preparation_active");assert.equal(calls.length,1);busy=false;
 mode="running";await send("start",{manual:true,componentId:"voices"});assert.equal(context.IKnowReaderComponents.busy,true);assert.equal(calls[1].manual,true);
 await send("pause");assert.equal(calls[2].manual,true);assert.equal(calls[2].type,"components:pause");
 mode="installed";await send("status");assert.equal(context.IKnowReaderComponents.busy,false);assert.equal(store.iknowReaderComponentState.components[0].status,"installed");
 for(const timer of timers)clearTimeout(timer);
 console.log("PASS Component controls are own-page-only, explicit, idle on startup, preparation-protected, and send manual pause/start while clearing completed activity");
})().catch(error=>{console.error(error);process.exitCode=1;});
