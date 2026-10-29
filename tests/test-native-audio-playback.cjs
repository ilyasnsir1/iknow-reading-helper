/* Actual platform Audio playback in a 200-row iKnow-shaped page. The site's
 * reused Audio/pause/src/play handler follows the public iKnow bundle. Native
 * data and audio downloads are fixtures; no personal host or profile is used. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.join(__dirname,"native-audio-evidence");fs.mkdirSync(out,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{const at=Date.now();while(!await fn()){if(Date.now()-at>15000)throw Error("Timed out: "+label);await delay(30);}};
const instrument=`(()=>{const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;window.fixtureCalls=[];window.fixtureStates=[];window.fixtureHandling=false;
 HTMLMediaElement.prototype.play=function(...args){fixtureCalls.push({op:'play',native:!!this.fixtureNative,time:performance.now(),inside:fixtureHandling});return Reflect.apply(play,this,args)};
 HTMLMediaElement.prototype.pause=function(...args){fixtureCalls.push({op:'pause',native:!!this.fixtureNative,time:performance.now(),inside:fixtureHandling});return Reflect.apply(pause,this,args)};
 window.addEventListener('message',event=>{if(event.source===window&&event.data?.type==='IKR_NATIVE_AUDIO_STATE_V1')fixtureStates.push(event.data)});})();`;
const nativeScript=`window.fixturePlayer=new Audio();fixturePlayer.fixtureNative=true;window.fixtureClicks=[];window.fixtureFailures=[];
 document.querySelectorAll('.sentence-audio-container,.item-audio-container').forEach(button=>button.addEventListener('click',()=>{
 fixtureClicks.push(performance.now());fixtureHandling=true;fixturePlayer.pause();fixturePlayer.src=window.fixtureSource||'https://assets0.iknow.jp/assets/native-fixture.mp3';const result=fixturePlayer.play();fixtureHandling=false;
 result?.catch(error=>{if(error.name!=='AbortError')fixtureFailures.push(error.name)});
 }));`;
function wav(){const rate=16000,n=Math.round(rate*2.064),b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*210)*3000),44+i*2);return b;}
const sentence={cue:{id:246957,text:'それはとてもいい話だ。',transliterations:{Jpan:'それ は とても いい 話 だ。',Hrkt:'それ は とても いい はなし だ。',Latn:'sore ha totemo ii hanashi da.'}},response:{text:"That's a really nice story."},sound:'https://assets0.iknow.jp/assets/native-fixture.mp3'};
const rows=Array.from({length:200},(_,index)=>{const id=1000+index;return `<div class="item"><div class="item-details"><span class="item-audio-container" role="button" tabindex="0">Word speaker</span><div class="cue-response"><a class="cue" href="/items/${id}">それ</a><p class="response">that</p></div></div><div class="item-sentences"><div class="sentence"><span class="sentence-audio-container" role="button" tabindex="0">Sentence speaker</span><div class="sentence-text"><p class="text">${sentence.cue.text}</p><p class="transliteration">${sentence.cue.transliterations.Hrkt}</p><p class="translation">${sentence.response.text}</p></div></div></div></div>`}).join('');
const goal={id:19053,title:'Native audio fixture',cue_language:'ja',items_count:200,sentences_count:200,goal_items:Array.from({length:200},(_,i)=>({item:{id:1000+i,cue:{id:1000+i,text:'それ',transliterations:{Hrkt:'それ',Latn:'sore'}},response:{text:'that'}},sentences:[{...sentence,cue:{...sentence.cue,id:246957+i}}],sound:sentence.sound}))};
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(path.resolve(__dirname,'../extension'),out);
 fs.writeFileSync(path.join(extension,'native-platform-fixture.js'),instrument);
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.content_scripts.find(value=>value.world==='MAIN').js.unshift('native-platform-fixture.js');
 const scripts=manifest.content_scripts.find(value=>value.js.includes('content.js')).js;
 scripts.splice(scripts.indexOf('audio-data.js')+1,0,'native-timing-fixture.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'native-timing-fixture.js'),`IKnowReaderAudioData={schema:1,sentences:{'246957':{signature:IKnowReaderCore.signature(${JSON.stringify([sentence.cue.text,sentence.response.text,sentence.cue.transliterations.Hrkt,sentence.cue.transliterations.Latn])}),audioPath:'/assets/native-fixture.mp3',duration:2.064,tokens:${JSON.stringify(Array.from({length:6},(_,i)=>({index:i,start:i*.3,end:(i+1)*.3,ja:[]})))}}}};`);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--autoplay-policy=no-user-gesture-required'],viewport:{width:1200,height:1000}});
 const errors=[],extra=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('https://**/*',route=>{const url=new URL(route.request().url());
  if(url.hostname==='iknow.jp'&&url.pathname==='/courses/19053')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>.item{display:flex;gap:25px;min-height:190px}.item-details{width:220px}.sentence-text{width:600px}</style><div class="course-content-container"><div class="course-content"><div class="items">${rows}</div></div></div><script src="/native-fixture.js"></script>`});
  if(url.hostname==='iknow.jp'&&url.pathname==='/native-fixture.js')return route.fulfill({contentType:'application/javascript',body:nativeScript});
  if(url.hostname==='iknow.jp'&&url.pathname==='/api/v2/goals/19053')return route.fulfill({contentType:'application/json',body:JSON.stringify(goal)});
  if(url.hostname==='assets0.iknow.jp'&&['/assets/native-fixture.mp3','/assets/no-timings.mp3'].includes(url.pathname))return route.fulfill({contentType:'audio/wav',body:wav()});
  extra.push(url.href);return route.abort();
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();
 const timings=[];
 try{
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderSettings:{enabled:true,wordAudio:true,wordAudioPolicy:5,audioFollow:true,pronunciation:true,colorMode:'off'}}));
  await page.goto('https://iknow.jp/courses/19053');await until(async()=>await page.locator('.ikr-sentence-line').count()===200,'all rows enhanced');
  const configure=async(follow,words)=>{await worker.evaluate(async({follow,words})=>{const key='iknowReaderSettings',stored=await chrome.storage.local.get(key);await chrome.storage.local.set({[key]:{...stored[key],audioFollow:follow,wordAudio:words}})},{follow,words});await until(()=>page.locator('[data-setting="audioFollow"]').isChecked().then(value=>value===follow),'follow setting');await delay(100);};
  for(const [follow,words] of [[false,false],[false,true],[true,true]]){
   await configure(follow,words);
   const result=await page.evaluate(async()=>{fixtureCalls=[];fixtureClicks=[];fixtureStates=[];const button=document.querySelector('.sentence-audio-container');for(let i=0;i<24;i++){button.click();await new Promise(resolve=>setTimeout(resolve,10));}await new Promise(resolve=>setTimeout(resolve,140));return{clicks:fixtureClicks,calls:fixtureCalls,paused:fixturePlayer.paused,states:fixtureStates,failures:fixtureFailures,speaking:document.querySelectorAll('.ikr-speaking').length}});
   const calls=result.calls.filter(value=>value.native&&value.op==='play');assert.equal(calls.length,24);assert.equal(result.paused,false);assert.deepEqual(result.failures,[]);
   assert.equal(result.calls.filter(value=>value.native&&value.op==='pause'&&!value.inside).length,0,'extension must not pause native playback');
   const max=Math.max(...calls.map((value,i)=>value.time-result.clicks[i]));assert.ok(max<25,'native play must remain synchronous, not wait for model/timings');
   if(!follow)assert.equal(result.states.filter(value=>value.kind==='time'&&!value.clip).length,0,'no continuous native clock traffic with Follow off');
   else {assert.ok(result.states.some(value=>value.kind==='time'&&!value.clip),'Follow observes native progress');assert.ok(result.speaking>0,'Follow still highlights prepared sentence tokens');}
   timings.push({follow,wordAudio:words,clicks:24,maximumPlayCallOverheadMs:Math.round(max*100)/100});
  }
  console.log('PASS 72 rapid native speaker clicks start synchronously across Follow/word-audio settings in a 200-row course');
  await page.evaluate(()=>{fixtureSource='https://assets0.iknow.jp/assets/no-timings.mp3';document.querySelector('.sentence-audio-container').click()});await delay(150);
  assert.equal(await page.evaluate(()=>fixturePlayer.paused),false,'Follow must not wait for missing timing records');
  await page.evaluate(()=>{delete window.fixtureSource;});
  console.log('PASS Native playback also starts with Follow enabled when there are no prepared timings for its audio');
  await page.evaluate(()=>{document.querySelector('.sentence-audio-container').click();});await delay(70);
  const pauses=await page.evaluate(()=>fixtureCalls.filter(value=>value.native&&value.op==='pause'&&!value.inside).length);
  await page.evaluate(()=>{window.postMessage({type:'IKR_WORD_AUDIO_PREPARE_V1',requestId:'pending-model',intentTime:performance.now()},location.origin)});await delay(100);
  assert.equal(await page.evaluate(()=>fixturePlayer.paused),false,'preparing a word/model must not silence the native player');
  assert.equal(await page.evaluate(()=>fixtureCalls.filter(value=>value.native&&value.op==='pause'&&!value.inside).length),pauses);
  await page.evaluate(()=>{document.querySelector('.sentence-audio-container').click();window.postMessage({type:'IKR_WORD_AUDIO_PLAY_V1',requestId:'pending-model',intentTime:performance.now(),src:'https://assets0.iknow.jp/assets/native-fixture.mp3',start:0,end:null,duration:0,speed:1},location.origin)});await delay(150);
  assert.equal(await page.evaluate(()=>fixturePlayer.paused),false,'invalidated word result must not steal native playback');
  console.log('PASS A pending word preparation does not pause iKnow; stale results cannot interrupt a newer native speaker click');
  // Future native layouts can put the speaker inside a decorated word. Native
  // controls must still bypass word interception and retain default clicks.
  const before=await page.evaluate(()=>fixtureClicks.length);
  await page.evaluate(()=>{const parent=document.querySelector('.ikr-item-line');parent.append(document.querySelector('.sentence-audio-container'));parent.querySelector('.sentence-audio-container').click();});await delay(100);
  assert.equal(await page.evaluate(()=>fixtureClicks.length),before+1);
  assert.equal(await page.evaluate(()=>fixturePlayer.paused),false);
  await page.evaluate(()=>{const button=document.querySelector('.sentence-audio-container');button.addEventListener('keydown',event=>{if(event.key==='Enter')button.click()});button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))});await delay(100);
  assert.equal(await page.evaluate(()=>fixtureClicks.length),before+2,'keyboard native handler is not swallowed either');
  assert.equal(await page.locator('.ikr-sentence-line').first().innerText(),'sore ha totemo ii hanashi da.','course uses source spelling despite legacy pronunciation=true');
  assert.deepEqual(errors,[]);assert.deepEqual(extra,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,scope:'Real platform Audio and production extension in isolated Brave; public-site handler shape, data/audio fixtures',timings,pageErrors:errors},null,2));
  console.log('PASS Native controls keep priority even inside decorated word layouts; course Romaji preserves source ha spelling');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
