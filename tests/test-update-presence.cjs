"use strict";
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const source=fs.readFileSync(path.resolve(__dirname,"../extension/update-presence.js"),"utf8");
const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
function fixture(visibility="visible",hold=false){
 const timers=new Map(),events={},calls=[];let id=0,resolve,reply={ok:true};const clock={now:1800000000000};
 const document={visibilityState:visibility,addEventListener:(name,fn)=>events[name]=fn};
 class Clock extends Date{static now(){return clock.now;}}
 const sandbox={document,Date:Clock,window:{addEventListener:(name,fn)=>events[name]=fn},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key),chrome:{runtime:{sendMessage:message=>{calls.push(message);return hold?new Promise(done=>{resolve=done;}):Promise.resolve(reply);}}}};
 vm.runInNewContext(source,sandbox);
 return{document,events,calls,timers,sandbox,clock,reply:value=>{reply=value;},release:value=>resolve(value),delay:()=>[...timers.values()][0]?.delay,fire:()=>[...timers.values()][0].fn()};
}
(async()=>{
 const f=fixture();await settle();assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);assert.equal(f.delay(),45000);
 await f.fire();assert.equal(f.calls.length,2);assert.equal(f.timers.size,1);
 f.document.visibilityState="hidden";f.events.visibilitychange();assert.equal(f.timers.size,0);assert.equal(f.calls.length,2);
 f.document.visibilityState="visible";f.events.visibilitychange();await settle();assert.equal(f.calls.length,3);assert.equal(f.timers.size,1);
 f.events.pagehide();assert.equal(f.timers.size,0);f.events.pageshow();await settle();assert.equal(f.calls.length,4);assert.equal(f.timers.size,1);
 assert.deepEqual([...new Set(f.calls.map(message=>message.type))],["ikr:update:presence"]);
 const hidden=fixture("hidden");await settle();assert.equal(hidden.calls.length,0);assert.equal(hidden.timers.size,0);
 console.log("PASS Visible course presence uses a 45-second wake, pauses while hidden/leaving, and resumes on visibility/back navigation with no permanent port");
 f.reply({ok:true,nextCheckAt:f.clock.now+20000});await f.fire();assert.equal(f.delay(),20000);
 f.reply({ok:true,nextCheckAt:f.clock.now+1});await f.fire();assert.equal(f.delay(),1000);
 f.reply({ok:true,nextCheckAt:f.clock.now+3600000});await f.fire();assert.equal(f.delay(),45000);
 f.reply({ok:true,nextCheckAt:f.clock.now-1});await f.fire();assert.equal(f.delay(),45000);
 f.reply({ok:true,nextCheckAt:Infinity});await f.fire();assert.equal(f.delay(),45000);
 console.log("PASS The next shared due time aligns a shifted timer instead of adding another interval; malformed, expired and excessive delays cannot create a tight loop");
 const pending=fixture("visible",true);assert.equal(pending.calls.length,1);assert.equal(pending.timers.size,0);
 pending.events.visibilitychange();pending.events.pageshow();assert.equal(pending.calls.length,1);
 pending.events.pagehide();pending.release({ok:true});await settle();assert.equal(pending.timers.size,0);
 pending.events.pageshow();assert.equal(pending.calls.length,2);pending.document.visibilityState="hidden";pending.events.visibilitychange();
 pending.release({ok:true});await settle();assert.equal(pending.timers.size,0);
 f.sandbox.chrome.runtime.sendMessage=()=>{throw Error("Extension reloading");};f.events.visibilitychange();await settle();assert.equal(f.delay(),45000);
 console.log("PASS In-flight messages are single-flight; late replies after hiding/pagehide never resurrect timers, and extension invalidation remains quiet");
})().catch(error=>{console.error(error);process.exitCode=1;});
