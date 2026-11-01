'use strict';
const assert=require('node:assert/strict'),L=require('../extension/study-learning.js'),P=require('../extension/study-learning-store.js'),S=require('../extension/study-store.js');
const word={kind:'word',courseId:'19053',sourceId:'personal',japanese:'本',kana:'ほん',romaji:'hon',english:'book',notes:'Keep my note'},id=S.makeKey(word),saved={...S.validate(word),key:id,createdAt:1,updatedAt:1};
(async()=>{
 let time=1000000,data={[S.KEY]:{schemaVersion:1,records:{[id]:saved}}};
 const storage={get:async names=>Object.fromEntries((Array.isArray(names)?names:[names]).map(k=>[k,structuredClone(data[k])])),set:async values=>{data={...data,...structuredClone(values)};}};
 const backend=P.createBackend(storage,{now:()=>++time}),study=S.createBackend(storage,()=>++time);
 let skill;for(let day=0;day<3;day++)skill=L.next(skill,'good',1000+day*L.DAY_MS);
 data[P.KEY]={schemaVersion:1,records:{[id]:{review:skill}},session:null};const history=structuredClone(data[P.KEY].records);
 assert.equal(L.strengthFor(id,await backend.progress()),'strong');
 for(const level of ['weak','learning','new','strong']){
  const progress=await backend.setAssessment({key:id,level});assert.equal(L.strengthFor(id,progress),level);assert.equal(L.strengthFor(id,progress,'listening'),level,'Personal level applies across exercise modes');assert.deepEqual(progress.records,history,'Personal labels never fabricate practice evidence');
 }
 const selected=[{...word,key:id}],weak=await backend.setAssessment({key:id,level:'weak'});assert.deepEqual(L.chooseWeak(selected,weak,'listening').map(x=>x.key),[id],'A manually weak unpractised listening item can be selected');
 const other='word:19053:other',mixed={...weak,assessments:{...weak.assessments,[other]:{level:'weak',updatedAt:1}}};assert.equal(L.chooseWeak([...selected,{...word,key:other}],mixed,'listening').length,2,'Multiple personal weak entries do not need invented skill histories to sort');
 const exported=await study.exportBackup();assert.equal(exported.learning.assessments[id].level,'weak');assert.equal(exported.library.records[id].notes,'Keep my note');
 const manualAt=exported.learning.assessments[id].updatedAt;const reset=await backend.setAssessment({key:id,level:'auto'});assert.ok(reset.assessments[id].updatedAt>manualAt);assert.equal(L.strengthFor(id,reset),'strong');assert.equal(L.strengthFor(id,reset,'listening'),'new');
 await study.importBackup(exported);assert.equal((await backend.progress()).assessments[id].level,'auto','Older backups cannot resurrect an override cleared later');
 const newer=structuredClone(exported);newer.learning.assessments[id]={level:'learning',updatedAt:++time};await study.importBackup(newer);assert.equal(L.strengthFor(id,await backend.progress()),'learning');assert.deepEqual((await backend.progress()).records,history);
 const old=structuredClone(exported);delete old.learning.assessments;await study.importBackup(old);assert.equal(L.strengthFor(id,await backend.progress()),'learning','Old backups remain compatible and preserve personal levels');
 for(const level of ['hacked','GOOD',null])assert.throws(()=>backend.setAssessment({key:id,level}),/valid/);
 await assert.rejects(backend.setAssessment({key:'word:19053:missing',level:'weak'}),/no longer exists/);
 for(const patch of [{level:'bad',updatedAt:1},{level:'weak',updatedAt:-1},{level:'weak',updatedAt:1,extra:true}])assert.throws(()=>P.validateProgress({records:{},assessments:{[id]:patch}}),/valid/);
 assert.deepEqual(P.validateProgress({records:{}}),{records:{}});
 await backend.setAssessment({key:id,level:'strong'});
 await backend.startSession({id:'manual-result-test',kind:'practice',mode:'review',cards:[saved],index:0,attempts:0,attemptPolicy:'single',gapPosition:'first',language:'en',createdAt:++time,targets:{}});
 await backend.commit({sessionId:'manual-result-test',index:0,outcome:'again',firstCorrect:false});
 assert.equal(L.strength((await backend.progress()).records[id].review),'weak','New exercise results still update the underlying automatic history');
 assert.equal(L.strengthFor(id,await backend.progress()),'strong','A failed result never overwrites a personal Strong label');
 await backend.endSession('manual-result-test');await backend.setAssessment({key:id,level:'auto'});assert.equal(L.strengthFor(id,await backend.progress()),'weak','Automatic reveals the latest real results, not the old pre-override value');
 let handler;global.chrome={runtime:{id:'personal-test',getURL:p=>'chrome-extension://personal-test/'+p,onMessage:{addListener:f=>handler=f}},storage:{local:storage}};P.listenBackground();
 const message=sender=>new Promise(resolve=>{if(handler({type:'ikr:learning:assessment',assessment:{key:id,level:'weak'}},sender,resolve)!==true)queueMicrotask(()=>resolve({ok:false}));});
 for(const sender of [{id:'personal-test',url:'https://iknow.jp/courses/19053',frameId:0},{id:'personal-test',url:'chrome-extension://personal-test/study.html',frameId:1},{id:'other',url:'chrome-extension://personal-test/study.html',frameId:0}])assert.equal((await message(sender)).ok,false);
 assert.equal((await message({id:'personal-test',url:'chrome-extension://personal-test/study.html',frameId:0})).ok,true);
 console.log('PASS Personal levels: separate evidence, all modes, weak selection, bounded trusted writes, new/old backups and timestamped Automatic reset');
})().catch(error=>{console.error(error);process.exitCode=1;});
