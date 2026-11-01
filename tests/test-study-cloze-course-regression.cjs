'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../extension/core.js'),Catalog=require('../extension/study-catalog.js');
const Practice=require('../extension/study-practice.js'),Study=require('../extension/study-store.js');
const LearningStore=require('../extension/study-learning-store.js');
const root=path.resolve(__dirname,'..'),NOW=Date.UTC(2026,10,1,12),clone=structuredClone;
const defaults=[path.resolve(root,'../native-audio-audit/goal-19057.json'),path.resolve(root,'../study-preview/catalog-source.json')];
const inputs=process.argv.slice(2).length?process.argv.slice(2).map(value=>path.resolve(value)):defaults;
function storageFixture(initial={}){
 let data=clone(initial);const writes=[];
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,clone(data[key])])),set:async patch=>{writes.push(clone(patch));data={...data,...clone(patch)};}};
 return{storage,writes,get data(){return clone(data);}};
}
function legacyRecord(record){const value=clone(record);if(value.context)delete value.context.clozeTarget;delete value.clozeTarget;return value;}
function saved(record,personal=false){const value=Study.validate(record);return{...value,key:Study.makeKey(value),createdAt:NOW-1000,updatedAt:NOW-500,...(personal?{notes:'My own reminder.',review:Practice.nextReview(undefined,'good',NOW-500)}:{})};}
function counts(records){
 return{
  words:records.filter(record=>record.kind==='word').length,sentences:records.filter(record=>record.kind==='sentence').length,
  vocabularyCloze:records.filter(record=>record.kind==='word'&&Practice.buildCloze(record)).length,
  sentenceCloze:records.filter(record=>record.kind==='sentence'&&Practice.buildCloze(record)).length,
  review:records.filter(record=>Practice.buildReviewQuestion(record,records)).length,
  listening:records.filter(record=>Practice.buildListening(record)).length
 };
}
function exerciseSnapshot(record,romajiStyle='source'){
 const question=Practice.buildCloze(record,{targetIndex:0,gapPosition:'random',romajiStyle});
 assert.ok(question,record.japanese+' has a durable source target');
 return{before:question.before,after:question.after,answerJapanese:question.answerJapanese,answerKana:question.answerKana,answerRomaji:question.answerRomaji,acceptedAnswers:question.acceptedAnswers,targetIndex:question.targetIndex};
}
(async()=>{
 for(const file of inputs)assert.ok(fs.existsSync(file),'Raw course fixture is required: '+file+' (pass public course JSON paths as arguments)');
 const courses=inputs.map(file=>{const source=JSON.parse(fs.readFileSync(file,'utf8'));return{source,catalog:Catalog.normalizeSource(source,{now:NOW})};});
 const target=courses.find(course=>String(course.source.id)==='19057');assert.ok(target,'Include course19057 to audit the reported48 exclusions');
 const observations=[];
 for(const {source,catalog} of courses){
  const legacy=catalog.records.map(legacyRecord),before=counts(legacy),after=counts(catalog.records);
  assert.equal(after.words,source.items_count||source.goal_items.length);
  assert.equal(after.vocabularyCloze,after.words,'Every vocabulary question has its own usable sentence form in course'+source.id);
  assert.equal(after.sentenceCloze,before.sentenceCloze,'Random sentence cloze eligibility is unchanged');
  assert.equal(after.review,before.review,'Source targets do not change Review/Test eligibility');
  assert.equal(after.listening,before.listening,'Source targets do not change original Listening eligibility');
  for(const record of catalog.records.filter(record=>record.kind==='word')){
   const question=Practice.buildCloze(record);assert.ok(question);
   assert.equal(question.before+question.answerJapanese+question.after,record.context.japanese,'A cloze reconstructs its own unmodified source sentence');
   assert.ok(Practice.checkAnswer(question,question.answerJapanese),'The exact missing Japanese form is accepted');
   if(record.context.clozeTarget)assert.equal(Core.validateClozeTarget(record.context.clozeTarget,record.context,record.japanese)?.vocabulary,record.japanese);
  }
  observations.push({courseId:catalog.courseId,before,after});
 }
 const main=target.catalog,words=main.records.filter(record=>record.kind==='word');
 const recovered=words.filter(record=>!Practice.buildCloze(legacyRecord(record)));
 assert.equal(words.length,200);assert.equal(recovered.length,48,'The audit includes exactly the48 previously excluded words');
 assert.equal(observations.find(value=>value.courseId==='19057').before.vocabularyCloze,152);
 assert.equal(main.records.filter(record=>record.kind==='sentence'&&Practice.buildCloze(record)).length,200);
 let inflected=0;
 for(const record of recovered){
  for(const romajiStyle of ['source','spoken']){
   const question=Practice.buildCloze(record,{gapPosition:'random',romajiStyle});assert.ok(question);
   assert.equal(question.targetIndex,0,'An anchored vocabulary question has one stable checkpoint target');
   assert.ok(question.answerKana,'Recovered questions retain the marked Kana answer');assert.ok(question.answerRomaji,'Recovered questions retain the marked Romaji answer');
   for(const form of [question.answerJapanese,question.answerKana,question.answerRomaji])assert.ok(Practice.checkAnswer(question,form),record.japanese+': accepted surface form '+form);
   assert.equal(Practice.checkAnswer(question,'definitely-not-this-word'),false);
   if(Practice.normalizeAnswer(question.answerJapanese)!==Practice.normalizeAnswer(record.japanese)){
    assert.equal(Practice.checkAnswer(question,record.japanese),false,'A dictionary form cannot replace the conjugated form required by the sentence');
    if(Practice.normalizeAnswer(question.answerKana)!==Practice.normalizeAnswer(record.kana))assert.equal(Practice.checkAnswer(question,record.kana),false);
    if(Practice.normalizeAnswer(question.answerRomaji)!==Practice.normalizeAnswer(record.romaji))assert.equal(Practice.checkAnswer(question,record.romaji),false);
   }
   assert.equal(Practice.buildCloze(record,{targetIndex:1}),null,'A changed checkpoint cannot redirect a vocabulary question to another word');
  }
  if(Practice.buildCloze(record).answerJapanese!==record.japanese)inflected++;
 }
 assert.ok(inflected>20,'The recovered corpus exercises real surface-form differences, not only identical compound spans');

 const cached=storageFixture();let clock=NOW,calls=0;
 const online=Catalog.createBackend(cached.storage,{now:()=>clock,fetchImpl:async()=>{calls++;return new Response(JSON.stringify(target.source),{headers:{'content-type':'application/json'}});}});
 const initial=await online.load('19057');assert.equal(calls,1);assert.equal(counts(initial.records).vocabularyCloze,200);
 assert.match(cached.data[Catalog.KEY].entries['19057'].source.goal_items[0].sentences[0].cue.text,/<b>/i);
 let offlineCalls=0;
 const offline=Catalog.createBackend(cached.storage,{now:()=>clock,fetchImpl:async()=>{offlineCalls++;throw Error('offline fixture');}});
 const warm=await offline.load('19057');assert.equal(offlineCalls,0);assert.equal(warm.stale,false);assert.equal(warm.fingerprint,initial.fingerprint);
 clock+=Catalog.TTL+1;
 const stale=await offline.load('19057');assert.equal(offlineCalls,1);assert.equal(stale.stale,true);assert.equal(counts(stale.records).vocabularyCloze,200);assert.equal(stale.fingerprint,initial.fingerprint);

 const originals=Object.fromEntries(words.map(record=>{const value=saved(record,true);return[value.key,value];}));
 const sourceStore=storageFixture({[Study.KEY]:{schemaVersion:1,records:originals}}),sourceBackend=Study.createBackend(sourceStore.storage,()=>NOW);
 const backup=await sourceBackend.exportBackup();
 const restoredStore=storageFixture(),restoredBackend=Study.createBackend(restoredStore.storage,()=>NOW);
 assert.equal((await restoredBackend.previewBackup(JSON.stringify(backup))).newItems,200);
 await restoredBackend.importBackup(backup);
 const restored=(await restoredBackend.read()).records;assert.equal(Object.keys(restored).length,200);
 for(const record of recovered)for(const style of ['source','spoken'])assert.deepEqual(exerciseSnapshot(restored[record.key],style),exerciseSnapshot(record,style),'Backup round trip preserves the exact gap and accepted forms');
 const legacyBackup=clone(backup);for(const value of Object.values(legacyBackup.library.records))delete value.context.clozeTarget;
 const oldStore=storageFixture(),oldBackend=Study.createBackend(oldStore.storage,()=>NOW+100);
 await oldBackend.importBackup(legacyBackup);assert.equal(counts(Object.values((await oldBackend.read()).records)).vocabularyCloze,152);
 const oldBefore=(await oldBackend.read()).records;
 await oldBackend.enrich(words);
 const enriched=(await oldBackend.read()).records;assert.equal(counts(Object.values(enriched)).vocabularyCloze,200);
 for(const [key,record] of Object.entries(enriched)){assert.equal(record.notes,oldBefore[key].notes);assert.deepEqual(record.review,oldBefore[key].review);assert.equal(record.createdAt,oldBefore[key].createdAt);}
 const mismatch=legacyRecord(saved(recovered[0],true));mismatch.context.kana='べつ '+mismatch.context.kana;
 const mismatchStore=storageFixture({[Study.KEY]:{schemaVersion:1,records:{[mismatch.key]:mismatch}}}),mismatchBackend=Study.createBackend(mismatchStore.storage,()=>NOW);
 await mismatchBackend.enrich([recovered[0]]);
 const guarded=(await mismatchBackend.read()).records[mismatch.key];
 assert.equal(guarded.context.kana,mismatch.context.kana);assert.equal(guarded.context.clozeTarget,undefined,'Mismatched existing readings cannot receive an invalid target');assert.equal(guarded.notes,mismatch.notes);assert.deepEqual(guarded.review,mismatch.review);
 const poisoned=clone(backup),badKey=recovered[0].key;poisoned.library.records[badKey].context.clozeTarget.japanese.start++;
 const writesBefore=restoredStore.writes.length;await assert.rejects(async()=>restoredBackend.importBackup(poisoned));assert.equal(restoredStore.writes.length,writesBefore,'A shifted imported target is rejected without partial writes');

 const checkpoint=storageFixture(),learning=LearningStore.createBackend(checkpoint.storage,{now:()=>NOW+200});
 const cards=recovered.map(record=>saved(record));
 const draft={id:'source-gap-course-regression',kind:'practice',mode:'cloze',cards,pool:cards,index:0,attemptPolicy:'retry',gapPosition:'random',language:'en',createdAt:NOW,targets:Object.fromEntries(cards.map(record=>[record.key,Practice.buildCloze(record).targetIndex])),courseId:'19057',sourceFingerprint:main.fingerprint,label:main.title};
 const started=await learning.startSession(draft),resumed=await LearningStore.createBackend(checkpoint.storage,{now:()=>NOW+300}).getSession();
 assert.deepEqual(resumed,started);
 for(const record of resumed.cards){assert.equal(resumed.targets[record.key],0);for(const style of ['source','spoken'])assert.deepEqual(exerciseSnapshot(record,style),exerciseSnapshot(main.records.find(value=>value.key===record.key),style));}
 await learning.checkpointAttempt({sessionId:started.id,index:0,attempt:1});
 await learning.commit({sessionId:started.id,index:0,outcome:'good',firstCorrect:true});
 const advanced=await LearningStore.createBackend(checkpoint.storage,{now:()=>NOW+400}).getSession();assert.equal(advanced.index,1);assert.equal(advanced.results.length,1);assert.equal(advanced.targets[advanced.cards[1].key],0);assert.ok(Practice.buildCloze(advanced.cards[1],{targetIndex:advanced.targets[advanced.cards[1].key]}));
 console.log('PASS Source cloze course regression:19057 recovers48/48(200/200 vocabulary), source/Kana/Romaji answers and wrong-form rejection, cross-course modes, offline cache, old/new backups, guarded enrichment and durable checkpoints');
 console.log(JSON.stringify(observations));
})().catch(error=>{console.error(error);process.exitCode=1;});
