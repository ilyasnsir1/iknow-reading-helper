/* Actual canonical background/export/history; bounded native/storage fixtures. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const ext=path.resolve(__dirname,"../extension");
const tick=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const plain=value=>JSON.parse(JSON.stringify(value));
const helper=()=>({schemaVersion:1,diagnosticFormatVersion:2,helperVersion:"1.17.0",platform:{system:"Windows"},
 localChecks:{application:{helperVersion:"1.17.0"},managedFiles:{status:"modified",files:[{component:"helper/engine.py",status:"modified"}]},registration:{folderMatch:true}},
 events:{status:"available",events:Array.from({length:160},(_,i)=>({at:1700000000+i,component:"model",event:i===159?"inference_failed":"progress",completed:i,details:{nested:{failure:{chain:[{exceptionType:"TimeoutError",frames:[{module:"engine.py",function:"generate",line:330}]}]}}}}))},
 jobs:[{status:"error",code:"model_request_timeout",stage:"language",completed:41,total:200}],
 updates:{activeCheck:{status:"complete",providers:{windowsCng:{result:"valid"},legacyCsp:{result:"runtime_error",hresult:-2146893802}}}},
 logs:[{name:"logs/llama.previous.log",lines:["ERROR test context"]}]});
async function fixture(initial={},mode="ready") {
 const data=structuredClone(initial),messages=[],listeners=[],events={},timers=new Set();let connections=0,writes=0,disconnections=0;
 const sandbox={URL,TextEncoder,structuredClone,AbortController,crypto:require("node:crypto").webcrypto,Date,
  setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=45000?30:ms);timer.unref?.();timers.add(timer);return timer;},clearTimeout(timer){timers.delete(timer);clearTimeout(timer);},
  addEventListener(name,fn){events[name]=fn;},navigator:{userAgent:"TestBrowser/1",language:"en",onLine:true},fetch:async()=>({ok:true,json:async()=>({enabled:false})})};
 sandbox.chrome={runtime:{id:"fixture",getURL:file=>"chrome-extension://fixture/"+file,getManifest:()=>({version:"1.35.1",permissions:["storage","nativeMessaging"],host_permissions:["https://iknow.jp/*"]}),getPlatformInfo:async()=>({os:"win",arch:"x86-64"}),
 onMessage:{addListener:fn=>listeners.push(fn)},onConnect:{addListener(){}},connectNative(){connections++;const handlers={},port={onMessage:{addListener:fn=>handlers.message=fn},onDisconnect:{addListener:fn=>handlers.disconnect=fn},disconnect(){disconnections++;},postMessage(message){messages.push(message);if(mode==="missing"){queueMicrotask(()=>{sandbox.chrome.runtime.lastError={message:"Native host not found C:\\Users\\Secret\\host.cmd"};handlers.disconnect();delete sandbox.chrome.runtime.lastError;});return;}if(mode==="timeout")return;queueMicrotask(()=>handlers.message({type:"diagnostics-result",requestId:message.requestId,ok:true,report:mode==="old"?{schemaVersion:1,helperVersion:"1.16.0"}:helper()}));}};return port;}},
 storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{writes++;Object.assign(data,structuredClone(value));},getBytesInUse:async key=>Buffer.byteLength(JSON.stringify(key?data[key]||{}:data))}},tabs:{create:async()=>{}}};
 vm.createContext(sandbox);sandbox.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(ext,file),"utf8"),sandbox,{filename:file}));
 sandbox.importScripts("background.js");await tick();
 const api=sandbox.IKnowReaderDiagnostics,history=sandbox.IKnowReaderDiagnosticHistory;
 const command=(message,sender={id:"fixture",url:"chrome-extension://fixture/diagnostics.html"})=>new Promise(resolve=>{for(const listener of listeners)listener(message,sender,resolve);});
 return {api,history,sandbox,events,data,messages,command,get connections(){return connections;},get writes(){return writes;},close(){for(const timer of timers)clearTimeout(timer);}};
}
(async()=>{
 let f=await fixture();assert.equal(f.connections,0);assert.equal(f.writes,0);
 const one=f.api.exportReport({states:[{courseId:"19053",status:"error",stage:"language",completed:41,total:200,message:"timeout",stageTotals:{language:200},stageProgress:{language:{completed:41,total:200}}}]}),two=f.api.exportReport({});
 assert.equal(one,two);let {report}=await one;
 assert.equal(f.connections,1);assert.equal(f.messages[0].extended,true);assert.equal(report.diagnosticFormatVersion,2);assert.equal(report.collection.helperExtended,true);
 assert.equal(report.helper.report.events.events.length,160);assert.equal(report.helper.report.events.events.at(-1).event,"inference_failed");
 assert.equal(report.helper.report.events.events[159].details.nested.failure.chain[0].frames[0].function,"generate");
 assert.equal(report.helper.report.localChecks.managedFiles.status,"modified");assert.equal(report.helper.report.updates.activeCheck.providers.legacyCsp.hresult,-2146893802);
 assert.equal(report.preparation.courses[0].stageProgress.language.completed,41);assert.equal(f.disconnections,undefined);
 console.log("PASS One explicit export requests extended checks, shares concurrent requests and retains all160 helper events, nested exception frames, integrity facts and Windows verifier evidence");
 f.history.state({courseId:"19053",requestId:"fixture-request",status:"running",stage:"language",completed:0,total:200});
 for(let i=1;i<100;i++)f.history.state({courseId:"19053",requestId:"fixture-request",status:"running",stage:"language",completed:i,total:200});
 f.history.exception("course-preparation",{name:"TimeoutError",message:"failed C:\\Users\\Secret\\private.txt",stack:"Error\n at fn (chrome-extension://fixture/engine.js:12:4)"},{courseId:"19053",code:"model_request_timeout"});
 report=(await f.api.exportReport()).report;
 assert.ok(report.history.events.length>=20&&report.history.events.length<30);assert.equal(report.history.events.at(-1).event,"exception");
 assert.equal(report.history.events.at(-1).frames[0],"engine.js:12:4");assert.ok(!JSON.stringify(report).includes("Secret"));
 assert.equal(report.history.events.find(event=>event.stage==="language").requestKey,require("node:crypto").createHash("sha256").update("fixture-request").digest("hex").slice(0,20));
 const copied=structuredClone(f.data);f.close();f=await fixture(copied,"missing");
 report=(await f.api.exportReport()).report;
 assert.equal(report.helper.status,"missing");assert.equal(report.helper.lastKnown.stale,true);assert.equal(report.helper.lastKnown.report.events.events.length,160);
 assert.ok(report.history.events.some(event=>event.code==="model_request_timeout"));assert.ok(!JSON.stringify(report).includes("Secret"));
 console.log("PASS Sampled durable browser history survives a new worker and missing helper; stale helper evidence is explicitly labelled and personal path text is removed");
 f.close();f=await fixture({iknowReaderCoursePacks:{"19053":{course:{wordCount:2,sentenceCount:2},germanItems:{1:{text:"SECRET learning data"}},alignments:{1:{german:{text:"SECRET translation"},groups:[{}]}},audio:{1:{data:"SECRET audio"}}}}});
 report=(await f.api.exportReport()).report;
 assert.equal(report.storage.courses[0].germanWords,1);assert.equal(report.storage.courses[0].germanSentences,1);assert.equal(report.storage.courses[0].audioSentences,1);
 assert.ok(!JSON.stringify(report).includes("SECRET"));assert.equal(f.data.iknowReaderCoursePacks["19053"].germanItems[1].text,"SECRET learning data");
 for(let i=0;i<300;i++)f.history.record("helper-connection","error",{code:"fixture_error",courseId:"19053",password:"SECRET",request:"SECRET",at:i});
 report=(await f.api.exportReport()).report;assert.equal(report.history.events.length,240);assert.equal(report.history.truncated,true);assert.ok(report.history.dropped>=60);
 console.log("PASS Stored course inventory exports counts without learning/audio content or changing packs; event retention is bounded with explicit truncation");
 const before=f.connections;
 const denied=await f.command({type:"ikr:diagnostics:export"},{id:"fixture",url:"https://iknow.jp/courses/19053"});assert.equal(denied.ok,false);assert.equal(f.connections,before);
 const rejected=await f.command({type:"ikr:diagnostics:page-error",frames:["content.js:1:2"]},{id:"foreign",url:"https://iknow.jp/courses/19053"});assert.equal(rejected.ok,false);
 const accepted=await f.command({type:"ikr:diagnostics:page-error",frames:["content.js:1:2","C:/Users/Secret/x.js:1"],errorType:"TypeError",text:"SECRET"},{id:"fixture",url:"https://iknow.jp/courses/19053"});assert.equal(accepted.ok,true);
 report=(await f.api.exportReport()).report;assert.equal(report.history.events.at(-1).frames.length,1);
 console.log("PASS Export is restricted to the diagnostic page; authenticated extension page errors retain only project frames and never start native checks themselves");
 f.close();f=await fixture({},"timeout");const keeper=setTimeout(()=>{},1000);report=(await f.api.exportReport()).report;clearTimeout(keeper);
 assert.equal(report.helper.status,"timeout");assert.equal(report.collection.helperAvailable,false);f.close();
 f=await fixture({},"old");report=(await f.api.exportReport()).report;assert.equal(report.helper.status,"ready");assert.equal(report.collection.helperExtended,false);f.close();
 console.log("PASS Unresponsive and older helpers produce usable partial reports with explicit coverage instead of failing the export");
})().catch(error=>{console.error(error);process.exitCode=1;});
