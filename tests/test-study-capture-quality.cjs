'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-capture-quality-evidence');fs.mkdirSync(out,{recursive:true});
const rate=48000,seconds=8,amplitude=.23,frequency=440;
const wav=Buffer.alloc(44+rate*seconds*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*seconds;i++)wav.writeInt16LE(Math.round(32767*amplitude*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
const file=path.join(out,'microphone-440hz.wav');fs.writeFileSync(file,wav);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${file}`]});
 const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1000,height:720}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="panel"></div>'}));
  await page.goto('http://127.0.0.1/capture-quality');
  await page.evaluate(()=>{
   globalThis.captureFixture={streams:[],requests:[],recorderOptions:[],recorders:[],blobs:[]};
   const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async request=>{captureFixture.requests.push(structuredClone(request));const stream=await get(request);captureFixture.streams.push(stream);return stream;};
   const NativeRecorder=MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(stream,options){super(stream,options);captureFixture.recorderOptions.push(structuredClone(options));captureFixture.recorders.push(this);}};
   const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{captureFixture.blobs.push(blob);return create(blob);};
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'tools/preview/study-focus-audio.js'),'utf8')});
  await page.evaluate(()=>IKnowFocusAudio.mount(document.getElementById('panel'),{key:'word:quality'}));
  await page.locator('[data-compare-action="record"]').click();await page.waitForFunction(()=>document.getElementById('panel').dataset.state==='recording');
  await page.waitForTimeout(2200);await page.locator('[data-compare-action="stop"]').click();await page.locator('[data-compare-action="take"]:not([disabled])').waitFor();
  const metrics=await page.evaluate(async frequency=>{
   const fixture=captureFixture,blob=fixture.blobs.at(-1),context=new AudioContext(),decoded=await context.decodeAudioData(await blob.arrayBuffer()),data=decoded.getChannelData(0),rate=decoded.sampleRate;
   const windowAt=(start,length)=>{const first=Math.round(start*rate),end=Math.min(data.length,first+Math.round(length*rate));let energy=0,sine=0,cosine=0;for(let i=first;i<end;i++){const value=data[i];energy+=value*value;sine+=value*Math.sin(2*Math.PI*frequency*i/rate);cosine+=value*Math.cos(2*Math.PI*frequency*i/rate);}const count=end-first;return{rms:Math.sqrt(energy/count),tone:2*Math.hypot(sine,cosine)/count};};
   const result={request:fixture.requests.at(-1),options:fixture.recorderOptions.at(-1),direct:fixture.recorders.at(-1).stream===fixture.streams.at(-1),settings:fixture.streams.at(-1).getAudioTracks()[0].getSettings(),allTracksStopped:fixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),mime:blob.type,bytes:blob.size,decoded:{duration:decoded.duration,sampleRate:rate,channels:decoded.numberOfChannels},early:windowAt(.15,.3),later:windowAt(1.15,.3)};
   await context.close();return result;
  },frequency);
  assert.deepEqual(metrics.request,{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  assert.equal(metrics.options.audioBitsPerSecond,128000);assert.equal(metrics.direct,true,'MediaRecorder uses the untouched acquired stream');assert.equal(metrics.allTracksStopped,true);
  for(const flag of ['echoCancellation','noiseSuppression','autoGainControl'])if(flag in metrics.settings)assert.equal(metrics.settings[flag],false,'The browser disabled '+flag);
  assert.ok(metrics.decoded.duration>1.8);assert.ok(metrics.early.rms>.08,'Audio is audible within the first half second');assert.ok(metrics.early.tone>.1,'The first half second retains the input tone');
  const rmsRatio=metrics.early.rms/metrics.later.rms,toneRatio=metrics.early.tone/metrics.later.tone;
  assert.ok(rmsRatio>.85&&rmsRatio<1.15,'Input level stays stable from early recording to later recording');assert.ok(toneRatio>.85&&toneRatio<1.15,'The early tone is not suppressed relative to later audio');
  await page.evaluate(()=>IKnowFocusAudio.reset());assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify({...metrics,rmsRatio,toneRatio},null,2)+'\n');
  console.log('PASS Actual Brave Opus capture: browser speech DSP disabled, direct microphone stream,128kbps, clean audible early signal, stable tone/level, decoded take and released tracks');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
