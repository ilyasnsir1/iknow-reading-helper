/* Persistent independent playback levels, with no media/network dependency. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../extension/core.js'),'utf8');
function fixture(seed={}){
 const data={...seed},events=new Set(),writes=[];let fail=false;
 const storage={local:{async get(keys){return Object.fromEntries(keys.map(key=>[key,data[key]]));},async set(value){writes.push(value);await new Promise(resolve=>setTimeout(resolve,2));if(fail)throw Error('storage unavailable');const changes={};for(const[key,next]of Object.entries(value)){changes[key]={oldValue:data[key],newValue:next};data[key]=next;}events.forEach(fn=>fn(changes,'local'));}},onChanged:{addListener:fn=>events.add(fn)}};
 const context=vm.createContext({chrome:{storage},setTimeout});vm.runInContext(code,context);return{volume:context.IKnowReaderCore.audioVolume(),data,writes,storage,setFail:value=>{fail=value;}};
}
(async()=>{
 const first=fixture({iknowReaderVolumeOriginal:45,iknowReaderVolumeWord:-20,iknowReaderVolumeRecording:'70'}),v=first.volume;await v.ready;
 assert.equal(v.get('original'),45);assert.equal(v.get('word'),100);assert.equal(v.get('recording'),100);
 const player={volume:1},dispose=v.bind(player,'original');assert.equal(player.volume,.45);
 await Promise.all([v.set('original',20),v.set('original',0),v.set('recording',65),v.set('word',80)]);
 assert.equal(player.volume,0);assert.equal(first.data.iknowReaderVolumeOriginal,0);assert.equal(first.data.iknowReaderVolumeWord,80);assert.equal(first.data.iknowReaderVolumeRecording,65);
 await first.storage.local.set({iknowReaderVolumeOriginal:55});assert.equal(player.volume,.55,'Another page updates an already bound player');
 first.setFail(true);await assert.rejects(v.set('original',90));assert.equal(v.get('original'),55,'Failed persistence restores the last confirmed level');
 for(const bad of [-1,101,NaN,Infinity,'20'])await assert.rejects(v.set('original',bad));
 await assert.rejects(v.set('unknown',20));dispose();first.setFail(false);await v.set('original',10);assert.equal(player.volume,.55,'Unbound players no longer receive updates');
 const second=fixture(first.data);await second.volume.ready;assert.equal(second.volume.get('original'),10);assert.equal(second.volume.get('recording'),65);
 assert.ok(first.writes.every(value=>Object.keys(value).length===1),'Independent keys cannot overwrite another slider');
 console.log('PASS Audio volume: bounded independent channels, mute, persistent levels, live player updates, ordered rapid changes, cross-page events and failed-write rollback');
})().catch(error=>{console.error(error);process.exitCode=1;});
