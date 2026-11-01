/* Known microphone amplitudes exercise the actual meter without recording a user. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-microphone-meter-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><section id="panel"></section>'}));
  await page.goto('http://127.0.0.1/microphone-meter-fixture');
  await page.evaluate(()=>{
   window.meterFixture={amplitude:0,offset:0,samples:0,closes:0,stopped:0,float:true,analysers:[],constraints:[],streams:[],recorders:[]};
   window.AudioContext=class{
    createAnalyser(){
     const analyser={fftSize:128,getFloatTimeDomainData(values){meterFixture.samples++;for(let i=0;i<values.length;i++)values[i]=meterFixture.offset+meterFixture.amplitude*Math.sin(2*Math.PI*i/64);},getByteTimeDomainData(values){meterFixture.samples++;for(let i=0;i<values.length;i++)values[i]=Math.max(0,Math.min(255,Math.round(128+128*meterFixture.amplitude*Math.sin(2*Math.PI*i/64))));}};
     if(!meterFixture.float)delete analyser.getFloatTimeDomainData;
     meterFixture.analysers.push(analyser);return analyser;
    }
    createMediaStreamSource(){return{connect(){},disconnect(){}};}resume(){return Promise.resolve();}close(){meterFixture.closes++;return Promise.resolve();}
   };
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async constraints=>{meterFixture.constraints.push(structuredClone(constraints));const stream={getTracks:()=>[{stop(){meterFixture.stopped++;}}]};meterFixture.streams.push(stream);return stream;}}});
   window.MediaRecorder=class extends EventTarget{
    static isTypeSupported(){return true;}
    constructor(stream,options){super();this.stream=stream;this.options=options;this.state='inactive';this.mimeType='audio/webm';meterFixture.recorders.push(this);}
    start(){this.state='recording';}
    stop(){if(this.state==='inactive')return;this.state='inactive';queueMicrotask(()=>{const event=new Event('dataavailable');Object.defineProperty(event,'data',{value:new Blob(['fixture'])});this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));});}
   };
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'tools/preview/study-focus-audio.js'),'utf8')});
  await page.evaluate(()=>IKnowFocusAudio.mount(document.getElementById('panel'),{key:'word:meter'}));
  const record=page.locator('[data-compare-action="record"]'),stop=page.locator('[data-compare-action="stop"]'),meter=page.locator('[data-microphone-meter]');
  const reading=()=>meter.evaluate(node=>({value:Number(node.getAttribute('aria-valuenow')),aura:Number(node.style.getPropertyValue('--voice-level')),hidden:node.closest('.focus-recording-mode').hidden}));
  const signal=async(amplitude,wait=180,offset=0)=>{await page.evaluate(({amplitude,offset})=>{meterFixture.amplitude=amplitude;meterFixture.offset=offset;},{amplitude,offset});await page.waitForTimeout(wait);return reading();};
  await record.click();await page.waitForFunction(()=>document.getElementById('panel').dataset.state==='recording');
  const silence=await signal(0),quiet=await signal(.003),normal=await signal(.06),loud=await signal(.3),peak=await signal(1);
  assert.equal(silence.value,0);assert.equal(silence.aura,0);
  assert.ok(quiet.value>.06&&quiet.value<.25,'Quiet speech is visible above the noise floor');
  assert.ok(normal.value>.48&&normal.value<.72,'Ordinary speech uses the middle of the meter');
  assert.ok(loud.value>.8&&loud.value<.96,'Louder speech remains distinguishable above ordinary speech');
  assert.ok(peak.value>.98&&peak.aura>.98,'Near full-scale input reaches the top');
  assert.ok(quiet.aura<normal.aura&&normal.aura<loud.aura&&loud.aura<peak.aura,'The visible aura remains ordered across actual input amplitudes');
  const decayed=await signal(0,800);assert.ok(decayed.aura<.01,'The release returns near silence instead of sticking high');
  const attack=await signal(.06,100);assert.ok(attack.value>.45,'A normal syllable is visible within100ms');
  const withOffset=await signal(.06,220,.3);assert.ok(Math.abs(withOffset.value-normal.value)<.035,'DC offset does not masquerade as louder speech');
  await stop.click();await page.locator('[data-compare-action="take"]:not([disabled])').waitFor();
  const beforeIdle=await page.evaluate(()=>meterFixture.samples);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>meterFixture.samples),beforeIdle,'Analysis stops immediately after capture');
  // The outgoing recording face remains inert during the chosen flip, then
  // hides when that transition completes. Meter sampling already stopped.
  await page.locator('.focus-recording-mode').waitFor({state:'hidden'});
  assert.equal(await meter.isHidden(),true);
  assert.deepEqual(await page.evaluate(()=>meterFixture.constraints[0]),{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  assert.equal(await page.evaluate(()=>meterFixture.recorders[0].stream===meterFixture.streams[0]),true,'Metering never replaces the recorded stream');
  assert.equal(await page.evaluate(()=>meterFixture.recorders[0].options.audioBitsPerSecond),128000);
  assert.equal(await page.evaluate(()=>meterFixture.analysers[0].fftSize),1024);
  await page.evaluate(()=>{meterFixture.float=false;meterFixture.offset=0;meterFixture.amplitude=.06;});await record.click();await page.waitForFunction(()=>document.getElementById('panel').dataset.state==='recording');
  const fallback=await signal(.06,180);assert.ok(Math.abs(fallback.value-normal.value)<.06,'Byte-only analysers retain usable voice response');
  await page.evaluate(()=>IKnowFocusAudio.reset());
  assert.ok(await page.evaluate(()=>meterFixture.closes>=2&&meterFixture.stopped>=2),'Both capture sessions release microphone and analyser resources');
  const stoppedSamples=await page.evaluate(()=>meterFixture.samples);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>meterFixture.samples),stoppedSamples);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'levels.json'),JSON.stringify({silence,quiet,normal,loud,peak,decayed,attack,withOffset,fallback},null,2)+'\n');
  console.log('PASS Speech meter: fixed logarithmic quiet/normal/loud/full-scale response, visible100ms attack, smooth silence release, DC rejection, byte fallback and no capture changes or idle sampling');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
