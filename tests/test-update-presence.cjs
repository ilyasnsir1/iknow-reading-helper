"use strict";
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const source=fs.readFileSync(path.resolve(__dirname,"../extension/update-presence.js"),"utf8");
function fixture(visibility="visible"){
 const timers=new Map(),events={},calls=[];let id=0;
 const document={visibilityState:visibility,addEventListener:(name,fn)=>events[name]=fn};
 const sandbox={document,window:{addEventListener:(name,fn)=>events[name]=fn},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key),chrome:{runtime:{sendMessage:message=>{calls.push(message);return Promise.resolve({ok:true});}}}};
 vm.runInNewContext(source,sandbox);return{document,events,calls,timers,sandbox};
}
const f=fixture();assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,15*60*1000);
[...f.timers.values()][0].fn();assert.equal(f.calls.length,2);assert.equal(f.timers.size,1);
f.document.visibilityState="hidden";f.events.visibilitychange();assert.equal(f.timers.size,0);assert.equal(f.calls.length,2);
f.document.visibilityState="visible";f.events.visibilitychange();assert.equal(f.calls.length,3);assert.equal(f.timers.size,1);
f.events.pagehide();assert.equal(f.timers.size,0);f.events.pageshow();assert.equal(f.calls.length,4);assert.equal(f.timers.size,1);
assert.deepEqual([...new Set(f.calls.map(message=>message.type))],["ikr:update:presence"]);
const hidden=fixture("hidden");assert.equal(hidden.calls.length,0);assert.equal(hidden.timers.size,0);
f.sandbox.chrome.runtime.sendMessage=()=>{throw Error("Extension reloading");};assert.doesNotThrow(()=>f.events.visibilitychange());
console.log("PASS Visible course presence is immediate and low-frequency, pauses while hidden/leaving, resumes on visibility/back navigation, and tolerates extension reload without keeping the worker alive");
