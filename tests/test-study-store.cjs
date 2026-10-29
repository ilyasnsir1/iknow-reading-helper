"use strict";
const assert=require("node:assert/strict"),Store=require("../extension/study-store.js");
(async()=>{
 let data={},writes=0;const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async patch=>{writes++;await new Promise(resolve=>setTimeout(resolve,1));data={...data,...structuredClone(patch)};}};
 const backend=Store.createBackend(storage,()=>123);
 const record={kind:"sentence",courseId:"19053",sourceId:"100",japanese:"それはとてもいい話だ。",romaji:"sore wa tottemo ii hanashi da.",english:"That's a really nice story.",audioUrl:"https://assets0.iknow.jp/assets/test.mp3"};
 assert.equal(Store.makeKey(record),"sentence:19053:100");
 for(const bad of [{audioUrl:"javascript:alert(1)"},{audioUrl:"https://assets0.iknow.jp.evil/x.mp3"},{audioUrl:"https://evil.test/x.mp3"},{courseId:"../1"},{kind:"other"},{sourceId:"__proto__"},{sourceId:"x/y"}]){
  assert.throws(()=>Store.validate({...record,...bad}));
 }
 await Promise.all(Array.from({length:30},(_,i)=>backend.save({...record,sourceId:String(i)})));
 assert.equal(Object.keys((await backend.read()).records).length,30);
 await backend.remove("sentence:19053:5");assert.equal(Object.keys((await backend.read()).records).length,29);
 const inert=await backend.save({...record,japanese:'<img src=x onerror="alert(1)">'});assert.match(inert.japanese,/<img/);
 data[Store.KEY]={schemaVersion:2,records:{personal:"retained"}};const saved=structuredClone(data);await assert.rejects(backend.save(record));assert.deepEqual(data,saved);
 console.log("PASS Study records have stable identities and bounded text/audio validation; serialized writes preserve simultaneous saves, removal and unrecognized existing library formats");
})().catch(error=>{console.error(error);process.exitCode=1;});
