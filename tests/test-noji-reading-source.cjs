const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const callbacks=[],sent=[],timers=new Map(),diagnostics=[];let handler,id=0;
const runtime={id:'a'.repeat(32),onMessage:{addListener(fn){handler=fn;}},connectNative(){return {onMessage:{addListener(fn){callbacks.push(fn);}},onDisconnect:{addListener(){}},postMessage(message){sent.push(message);}};}};
const scope={chrome:{runtime},URL,crypto:{randomUUID:()=>String(++id)},setTimeout(fn,delay){const key=++id;timers.set(key,{fn,delay});return key;},clearTimeout(key){timers.delete(key);},IKnowReaderCore:{neuralSentenceText:text=>text},IKnowReaderDiagnostics:{record(...value){diagnostics.push(value);}}};
scope.globalThis=scope;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../extension/neural-speech-source.js'),'utf8'),scope);
const sender={id:runtime.id,url:'chrome-extension://'+runtime.id+'/study.html'};
function request(text,origin=sender){return new Promise(resolve=>handler({type:'ikr:noji:reading',text},origin,resolve));}
function result(message){for(const callback of callbacks)callback(message);}
(async()=>{
  const first=request('写真');assert.equal(sent.length,1);
  const duplicate=request('写真');assert.equal(sent.length,1);
  result({type:'noji-reading-result',requestId:sent.at(-1).requestId,ok:true,romaji:'shashin'});
  assert.equal((await first).romaji,'shashin');assert.equal((await duplicate).romaji,'shashin');
  assert.equal((await request('写真')).cached,true);assert.equal(sent.length,1);
  assert.equal((await request('写真',{...sender,url:'https://iknow.jp/courses/19053'})).ok,false);assert.equal(sent.length,1);
  const pending=request('漢字');const delayed=sent.at(-1);
  assert.equal(scope.IKnowReaderNeuralActivity(),true);
  const deadline=[...timers.values()].find(timer=>timer.delay===14000);assert.ok(deadline);deadline.fn();
  assert.equal((await pending).code,'noji_reading_timeout');assert.equal(scope.IKnowReaderNeuralActivity(),false);
  assert.deepEqual(diagnostics.at(-1),['word-audio','noji_reading_timeout',undefined]);
  result({type:'noji-reading-result',requestId:delayed.requestId,ok:true,romaji:'kanji'});
  const retry=request('漢字');assert.equal(sent.length,3);
  result({type:'noji-reading-result',requestId:sent.at(-1).requestId,ok:false,code:'PRIVATE_TEXT'});
  assert.equal((await retry).code,'noji_reading_failed');
  assert.equal(JSON.stringify(diagnostics).includes('PRIVATE_TEXT'),false);
  console.log('PASS Noji background reading cache, in-flight deduplication, origin checks, bounded timeout, stale suppression and private error redaction');
})().catch(error=>{console.error(error);process.exitCode=1;});
