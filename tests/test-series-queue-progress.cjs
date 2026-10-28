/* Actual worker, core and validated packs; explicit clock/native/source/storage
 * fixtures reproduce an active 8-course queue before its first course completes. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), ext = fs.existsSync(path.join(root, "extension/core.js")) ? path.join(root, "extension") : path.join(root, "outputs/iknow-lesehilfe/extension"), Core = require(path.join(ext, "core.js"));
const passed = [], pass = message => { passed.push(message); console.log("PASS", message); };
const makeSource = (id, count = 196, audio = true) => ({
  id, title: `Series progress fixture ${id}`, cue_language: "ja", response_language: "en",
  goal_items: Array.from({length:count}, (_, index) => ({
    item:{id:id*10000+index,cue:{text:"日本語"},response:{text:"Japanese"}},
    sentences:[{cue:{id:id*10000+index,text:"これは日本語です。",transliterations:{Hrkt:"これ は にほんご です。",Latn:"kore ha nihongo desu."}},
      response:{text:"This is Japanese."}, sound:audio ? `https://assets0.iknow.jp/assets/progress-test/${id}-${index}.mp3` : null}]
  }))
});
function packFor(source, languageCount = source.goal_items.length, audioCount = source.goal_items.length) {
  const expected = Core.expectedSource(source), count = source.goal_items.length;
  const pack = {format:"iknow-reader-course",schemaVersion:1,course:{id:source.id,title:source.title,wordCount:count,sentenceCount:count},alignments:{},germanItems:{},audio:{}};
  for (const [index, entry] of source.goal_items.entries()) {
    const id = String(entry.sentences[0].cue.id), shape = expected.sentences[id];
    if (index < languageCount) {
      const groups=[{ja:[[0,shape.jaLength]],en:[[0,shape.enLength]],tokens:Array.from({length:shape.tokens},(_,i)=>i)}];
      pack.alignments[id]={signature:shape.signature,groups,colorsReady:true,germanColorsReady:true,german:{text:"Das ist Japanisch.",groups:[[[0,17]]]}};
      pack.germanItems[String(entry.item.id)]={signature:expected.items[String(entry.item.id)],text:"Japanisch"};
    }
    if (index < audioCount && shape.audioPath) pack.audio[id]={signature:shape.signature,audioPath:shape.audioPath,duration:1,tokens:[{index:0,indices:Array.from({length:shape.tokens},(_,i)=>i),start:0,end:1,ja:[[0,shape.jaLength]]}]};
  }
  return pack;
}
async function fixture({initial = {}, count = 196, courses = 8, audio = true} = {}) {
  let clock = 1700000000000, nativeListener;
  const listeners=[], data=structuredClone(initial), requests=[], sourceMap=Object.fromEntries(Array.from({length:courses},(_,i)=>{const source=makeSource(566924+i,count,audio);return [String(source.id),source];}));
  const idleTimers=new Set(); class Clock extends Date {static now(){return clock;}}
  const sandbox={URL,TextEncoder,AbortController,structuredClone,Date:Clock,crypto:require("node:crypto").webcrypto,
    setTimeout(callback,delay){if([1000,10000].includes(delay)){const token={};idleTimers.add(token);return token;}return setTimeout(callback,delay);},
    clearTimeout(token){if(!idleTimers.delete(token))clearTimeout(token);}};
  sandbox.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(ext,file),"utf8"),sandbox));
  sandbox.fetch=async url=>{const id=String(url).match(/goals\/(\d+)/)?.[1];return {ok:!!sourceMap[id],status:sourceMap[id]?200:404,headers:{get:()=>null},text:async()=>JSON.stringify(sourceMap[id])};};
  sandbox.chrome={runtime:{id:"queue-progress",getManifest:()=>({version:"1.34.0"}),getURL:name=>"chrome-extension://queue-progress/"+name,
    onMessage:{addListener:listener=>listeners.push(listener)},onConnect:{addListener(){}},connectNative(){return {onMessage:{addListener:listener=>{nativeListener=listener;}},onDisconnect:{addListener(){}},postMessage:value=>requests.push(structuredClone(value)),disconnect(){}};}},
    storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{Object.assign(data,structuredClone(value));}}},tabs:{create:async()=>{}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(ext,"background.js"),"utf8"),sandbox);
  const command=message=>new Promise(resolve=>{for(const listener of listeners)listener(message,{id:"queue-progress",url:"https://iknow.jp/series/3423"},resolve);});
  const settle=async()=>{for(let i=0;i<50;i++)await new Promise(resolve=>setImmediate(resolve));};
  await settle();
  const status=async()=>(await command({type:"ikr:queue:status"})).queue;
  const start=async features=>{const response=await command({type:"ikr:queue:start",seriesId:"3423",courses:Object.values(sourceMap).map(source=>({id:String(source.id),title:source.title,sentenceCount:count})),features});assert.equal(response.ok,true);await settle();return status();};
  const emit=async(message,elapsed=1000,request=requests.filter(value=>value.type==="prepare").at(-1))=>{clock+=elapsed;nativeListener({courseId:request.courseId,requestId:request.requestId,...message});await settle();return status();};
  return {data,requests,sourceMap,command,status,start,emit,settle,advance:ms=>{clock+=ms;}};
}
const progress=(stage,completed,total=196)=>({type:"progress",status:"running",stage,completed,total,message:`Fixture ${stage}`});
(async()=>{
  let f=await fixture(), q=await f.start({german:true,colors:true,audio:true});
  assert.equal(q.processedCourses,0);assert.equal(q.progressFraction,0);assert.equal(q.etaSeconds,null);
  q=await f.emit(progress("language",119));const first=q.progressFraction;
  assert.ok(first>0 && first<1/8);assert.equal(q.completed,119);assert.equal(q.courses[0].stage,"language");assert.equal(q.courses[0].completed,119);assert.ok(q.courses[0].updatedAt>0);
  for(const completed of[120,121,122])q=await f.emit(progress("language",completed));
  assert.ok(q.progressFraction>first);assert.equal(q.processedCourses,0);assert.equal(q.etaScope,"measured");assert.deepEqual(q.etaStages,["language"]);assert.deepEqual(q.unestimatedStages,["audio"]);assert.equal(q.etaSeconds,8*196-122);
  q=await f.emit(progress("language",165));assert.equal(q.etaSeconds,8*196-165);assert.ok(q.progressFraction>first);
  pass("An eight-course queue advances its bar before any whole course finishes, persists active sentence diagnostics, and exposes a measured language ETA while future audio has no timing sample");

  q=await f.emit(progress("audio",0));const languageDone=q.progressFraction;
  assert.equal(q.courses[0].stageProgress.language.completed,196);
  for(const completed of[1,2,3])q=await f.emit(progress("audio",completed),500);
  assert.equal(q.etaScope,"total");assert.deepEqual(q.unestimatedStages,[]);assert.deepEqual(q.etaStages,["language","audio"]);assert.equal(q.etaSeconds,Math.ceil(7*196+(8*196-3)*.5));assert.ok(q.progressFraction>languageDone);
  q=await f.emit({type:"result",pack:packFor(f.sourceMap["566924"])});
  assert.equal(q.processedCourses,1);assert.equal(q.completedCourses,1);assert.equal(q.currentIndex,1);assert.equal(q.progressFraction,1/8);assert.equal(q.etaScope,"total");assert.ok(q.etaSeconds>0);assert.equal(f.requests.filter(value=>value.type==="prepare").length,2);
  pass("Sampling audio upgrades the partial estimate to a combined ETA; phase and course transitions retain earned progress and measured rates");

  const source=makeSource(566924), cached=packFor(source,100,80);
  f=await fixture({courses:2,initial:{iknowReaderCoursePacks:{"566924":cached}}});q=await f.start({german:true,colors:true,audio:true});
  assert.equal(q.progressFraction,(100/196+80/196)/4);assert.equal(q.courses[0].stageProgress.audio.completed,80);
  for(const completed of[100,101,102,103])q=await f.emit(progress("language",completed));
  const beforePause=q.progressFraction, measured=q.timings.language.milliseconds;
  await f.command({type:"ikr:queue:pause"});await f.settle();q=await f.status();assert.equal(q.status,"paused");assert.equal(q.etaSeconds,null);assert.equal(q.progressFraction,beforePause);
  f.advance(60*60*1000);await f.command({type:"ikr:queue:resume"});await f.settle();q=await f.status();assert.equal(q.progressFraction,beforePause);
  q=await f.emit(progress("language",103));assert.equal(q.timings.language.milliseconds,measured,"Pause time must not enter a new request's rate sample");
  q=await f.emit(progress("language",104));assert.equal(q.timings.language.milliseconds,measured+1000);
  const restored=await fixture({courses:2,initial:f.data});const restart=await restored.status();assert.equal(restart.status,"paused");assert.equal(restart.progressFraction,q.progressFraction);assert.equal(restored.requests.length,0);
  pass("Validated saved language/audio work seeds the bar before model loading; pause, an hour of idle time, resume and worker restart preserve progress without adding idle time or starting work automatically");

  const legacy={schemaVersion:1,id:"legacy-queue",seriesId:"3423",features:{german:true,colors:true,audio:true},status:"running",currentIndex:0,stage:"language",completed:119,total:196,timings:{language:{milliseconds:3000,units:3}},courses:Array.from({length:8},(_,index)=>({id:String(566924+index),title:"Legacy course",sentenceCount:196,status:index?"pending":"running"}))};
  f=await fixture({initial:{iknowReaderQueue:legacy}});q=await f.status();
  assert.equal(q.status,"paused");assert.equal(q.progressFraction,119/(196*2*8));assert.equal(q.courses[0].stageProgress.language.completed,119);assert.equal(f.requests.length,0);
  await f.command({type:"ikr:queue:resume"});await f.settle();q=await f.status();assert.equal(q.progressFraction,119/(196*2*8));
  const legacyAudio={...legacy,stage:"audio",completed:79,total:196};f=await fixture({initial:{iknowReaderQueue:legacyAudio}});q=await f.status();assert.equal(q.progressFraction,(1+79/196)/(8*2));
  pass("Queues persisted by 1.34.0 migrate active language/audio counters before restart rendering and retain their earned fraction when explicitly resumed");

  f=await fixture({courses:3,count:3});q=await f.start({german:true});
  for(const completed of[0,1,2,3])q=await f.emit(progress("language",completed,3));
  assert.equal(q.etaScope,"total");assert.deepEqual(q.unestimatedStages,[]);assert.deepEqual(q.etaStages,["language"]);
  q=await f.emit({type:"error",code:"preparation_failed",message:"Fixture failure"});assert.equal(q.failedCourses,1);assert.equal(q.processedCourses,1);assert.equal(q.courses[0].code,"preparation_failed");assert.equal(q.progressFraction,1/3);
  q=await f.emit({type:"result",pack:packFor(f.sourceMap["566925"])});q=await f.emit({type:"result",pack:packFor(f.sourceMap["566926"])});
  assert.equal(q.status,"complete");assert.equal(q.progressFraction,1);assert.equal(q.failedCourses,1);assert.equal(q.completedCourses,2);assert.equal(q.etaSeconds,null);
  await f.command({type:"ikr:queue:resume"});await f.settle();q=await f.status();assert.equal(q.status,"running");assert.equal(q.currentIndex,0);assert.equal(q.progressFraction,2/3);assert.equal(q.courses[0].stageProgress.language.completed,0);
  pass("Single-module queues estimate that module alone; failed courses remain distinct from saved courses while processed-work progress still reaches its terminal state");

  for (const code of ["model_not_installed", "model_start_failed", "model_start_timeout", "model_request_timeout", "model_connection_failed"]) {
    for (const type of ["error", "progress"]) {
      f=await fixture({courses:2,count:3});q=await f.start({german:true});
      q=await f.emit({type:"result",interim:true,pack:packFor(f.sourceMap["566924"],1,0)});
      q=await f.emit(progress("language",1,3));
      const checkpoint=q.progressFraction, original=f.requests.find(value=>value.type==="prepare");
      q=await f.emit({type,status:"error",code,stage:"language",completed:1,total:3,message:"The local language model needs another attempt. Completed additions are kept."});
      assert.equal(q.status,"error");assert.equal(q.currentIndex,0);assert.equal(q.courses[0].status,"pending");
      assert.equal(q.courses[0].code,code);assert.equal(q.progressFraction,checkpoint);assert.ok(q.error.includes("Completed additions are kept"));
      assert.equal(f.requests.filter(value=>value.type==="prepare").length,1,"A shared service failure must not cascade into the next course");
      assert.equal(Object.keys(f.data.iknowReaderCoursePacks["566924"].germanItems).length,1);
      await f.command({type:"ikr:queue:resume"});await f.settle();q=await f.status();
      const resumed=f.requests.filter(value=>value.type==="prepare").at(-1);
      assert.equal(q.status,"running");assert.equal(q.currentIndex,0);assert.equal(resumed.courseId,original.courseId);assert.notEqual(resumed.requestId,original.requestId);assert.equal(q.progressFraction,checkpoint);
      q=await f.emit({type:"result",pack:packFor(f.sourceMap["566924"])},1000,original);
      assert.equal(q.currentIndex,0,"Late failed-request data must not finish a resumed request");
      q=await f.emit({type:"result",pack:packFor(f.sourceMap["566924"])},1000,resumed);
      assert.equal(q.currentIndex,1);assert.equal(q.completedCourses,1);
    }
  }
  pass("Shared model failures interrupt both native error protocols at the current course, preserve validated checkpoints and progress, and require explicit resume without accepting stale results");

  f=await fixture({courses:2,count:3,audio:false});q=await f.start({audio:true});
  // No sentence has an audio asset, so no audio work remains; the validated
  // course still passes through final preparation rather than inventing a rate.
  assert.equal(q.courses[0].stageTotals.audio,0);assert.equal(q.etaSeconds,null);assert.equal(q.progressFraction,1);assert.deepEqual(q.unestimatedStages,[]);assert.equal(q.skippedCourses,2);
  pass("Zero-recording courses use exact audio totals instead of fabricating sentence work or an audio processing rate");

  fs.writeFileSync(path.join(__dirname,"series-queue-progress-results.json"),JSON.stringify({scope:"Actual worker/core/pack code; bounded source/native/storage/clock fixtures",passed,errors:[]},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
