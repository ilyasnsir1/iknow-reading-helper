/* Sample the chosen card-flip transition in a generated, isolated extension. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'study-recording-switch-motion-evidence','run-'+Date.now());
const spread=values=>Math.max(...values)-Math.min(...values);
const record={key:'word:19053:switch-motion',kind:'word',courseId:'19053',courseTitle:'Japanese Core 2000: Step 1',sourceId:'switch-motion',japanese:'能力',kana:'のうりょく',romaji:'nouryoku',english:'capability, capacity, ability',german:'Fähigkeit, Leistungsvermögen',audioUrl:'',notes:'',createdAt:1,updatedAt:1};
const geometryStable=(frames,label)=>{
 for(const name of ['card','panel','row'])for(const dimension of ['x','y','width','height']){
  assert.ok(spread(frames.map(frame=>frame[name][dimension]))<1,`${label}: ${name} ${dimension} stays fixed`);
 }
};
function assertTransition(frames,incomingName,outgoingName,label){
 const motion=frames.filter(frame=>frame.switching==='flip');
 assert.ok(motion.length>=5,`${label}: rendered frames contain the real card turn`);
 assert.ok(motion.some(frame=>Math.abs(frame.idle.angle)>10&&Math.abs(frame.idle.angle)<170),`${label}: idle controls visibly rotate through intermediate angles`);
 assert.ok(motion.some(frame=>Math.abs(frame.recording.angle)>10&&Math.abs(frame.recording.angle)<170),`${label}: recording controls visibly rotate through intermediate angles`);
 const idleAngles=motion.map(frame=>frame.idle.angle),direction=incomingName==='recording'?1:-1;
 for(let index=1;index<idleAngles.length;index++)assert.ok((idleAngles[index]-idleAngles[index-1])*direction>=-.8,`${label}: the turn progresses in one direction without snapping`);
 for(const frame of motion){
  assert.ok(Math.abs(Math.abs(frame.idle.angle-frame.recording.angle)-180)<1,`${label}: faces remain on opposite sides of one turn`);
  assert.ok(!(frame.idle.front&&frame.recording.front),`${label}: both labels are never front-facing together`);
  for(const layer of [frame.idle,frame.recording]){
   assert.equal(layer.backface,'hidden',`${label}: reversed labels are hidden`);
   assert.equal(layer.opacity,1,`${label}: the chosen flip does not fade both control layers`);
   assert.ok(Math.abs(layer.scaleX-1)<.001,`${label}: the turn does not squash controls horizontally`);
  }
  assert.equal(frame[incomingName].inert,false,`${label}: incoming controls are active`);
  assert.equal(frame[incomingName].ariaHidden,'false');
  assert.equal(frame[outgoingName].inert,true,`${label}: outgoing controls cannot receive input`);
  assert.equal(frame[outgoingName].ariaHidden,'true');
 }
 for(const frame of frames.filter(frame=>frame.state==='requesting')){assert.notEqual(frame.switching,'flip');assert.equal(frame.recording.hidden,true,'A permission request must not show recording feedback prematurely');}
 const final=frames.at(-1);
 assert.equal(final[incomingName].hidden,false);assert.equal(final[outgoingName].hidden,true);
 assert.equal(final[incomingName].opacity,1);assert.ok(Math.abs(final[incomingName].angle)<.01,'The settled visible face is untransformed');
 assert.equal(final.switching,null);assert.equal(final.animations,0,`${label}: completed flip animations are released`);
 geometryStable(frames,label);
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const extension=path.join(out,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
 const config=path.join(extension,'update-config.json');fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),enabled:false}));
 const generated=spawnSync(path.join(process.env.LOCALAPPDATA,'iKnowLesehilfe/runtime/python/python.exe'),[path.join(root,'tools/preview/stage-study-workspace.py'),'--output',extension],{encoding:'utf8'});
 assert.equal(generated.status,0,generated.stderr||generated.stdout);
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],viewport:{width:1440,height:900}});
 const errors=[],evidence=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async record=>chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records:{[record.key]:record}},iknowReaderSettings:IKnowReaderCore.normalizeSettings({translationLanguage:'both'})}),record);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   window.recordingSwitchFixture={delay:180,streams:[],recorders:[]};
   navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await get(constraints);recordingSwitchFixture.streams.push(stream);await new Promise(resolve=>setTimeout(resolve,recordingSwitchFixture.delay));return stream;};
   window.MediaRecorder=class extends EventTarget{
    static isTypeSupported(){return true;}
    constructor(stream,options){super();this.stream=stream;this.options=options;this.state='inactive';this.mimeType='audio/webm';recordingSwitchFixture.recorders.push(this);}
    start(){this.state='recording';}
    stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{const event=new Event('dataavailable');Object.defineProperty(event,'data',{value:new Blob(['isolated take'])});this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));},120);}
   };
   window.snapshotRecordingSwitch=()=>{
    const box=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};};
    const layer=selector=>{const node=document.querySelector(selector),style=getComputedStyle(node),matrix=new DOMMatrixReadOnly(style.transform==='none'?undefined:style.transform),b=node.getBoundingClientRect();return{hidden:node.hidden,inert:node.inert,ariaHidden:node.getAttribute('aria-hidden'),opacity:Number(style.opacity),scaleX:matrix.m11,angle:Math.atan2(matrix.m23,matrix.m22)*180/Math.PI,front:matrix.m22>.02,backface:style.backfaceVisibility,x:b.x,y:b.y,width:b.width,height:b.height};};
    const host=document.getElementById('focus-compare');return{time:performance.now(),state:host.dataset.state,switching:host.dataset.recordingSwitch||null,card:box('.focus-card'),panel:box('#focus-compare'),row:box('.focus-compare-controls'),idle:layer('.focus-audio-idle-mode'),recording:layer('.focus-recording-mode'),animations:document.getAnimations().filter(animation=>animation.effect?.target?.matches?.('.focus-audio-idle-mode,.focus-recording-mode')).length};
   };
  });
  const sample=(action,duration)=>page.evaluate(async({action,duration})=>{
   const frames=[],start=performance.now(),collect=()=>frames.push({...snapshotRecordingSwitch(),elapsed:performance.now()-start});
   collect();document.querySelector(`[data-compare-action="${action}"]`).click();
   await new Promise(resolve=>{const frame=()=>{collect();if(performance.now()-start<duration)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});return frames;
  },{action,duration});
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);
   for(const viewport of [{width:1440,height:900},{width:1280,height:720}]){
    await page.setViewportSize(viewport);await page.goto(`chrome-extension://${id}/study.html?switch-motion=${theme}-${viewport.height}#study`);
    await page.locator('[data-action="compare"]').click();await page.waitForTimeout(320);
    const entering=await sample('record',950);
    assert.ok(entering.filter(frame=>frame.state==='requesting').length>=3,'The delayed permission request has real rendered frames');
    assertTransition(entering,'recording','idle',`${theme}/${viewport.height} start`);
    await page.locator('[data-compare-action="stop"]').click({trial:true});
    assert.equal(await page.locator('[data-compare-action="stop"]').evaluate(button=>{const box=button.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===button;}),true,'The turned recording face receives real pointer input');
    const finishing=await sample('stop',800);
    assert.ok(finishing.filter(frame=>frame.state==='finishing').length>=3,'The delayed MediaRecorder stop has real finishing frames');
    assertTransition(finishing,'idle','recording',`${theme}/${viewport.height} stop`);
    assert.equal(await page.locator('[data-compare-action="take"]').isEnabled(),true);
    assert.equal(await page.evaluate(()=>recordingSwitchFixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'Completed captures release all microphone tracks');
    evidence.push({theme,viewport,entering,finishing});
   }
  }
  // Pause only the two face turns so visual review can compare
  // exact points in the same real capture rather than racing screenshots.
  await worker.evaluate(()=>chrome.storage.local.set({iknowReaderTheme:'midnight'}));
  await page.setViewportSize({width:1440,height:900});await page.goto(`chrome-extension://${id}/study.html?switch-filmstrip#study`);
  await page.locator('[data-action="compare"]').click();await page.waitForTimeout(320);
  await page.locator('[data-compare-action="record"]').click();await page.waitForFunction(()=>document.getElementById('focus-compare').dataset.state==='recording');
  await page.evaluate(()=>{window.flipVisualAnimations=document.getAnimations().filter(animation=>animation.effect?.target?.matches?.('.focus-audio-idle-mode,.focus-recording-mode'));flipVisualAnimations.forEach(animation=>{animation.pause();animation.currentTime=0;});});
  const shots=[];
  for(const time of [0,100,220,340,480]){
   await page.evaluate(time=>flipVisualAnimations.forEach(animation=>{animation.currentTime=time;if(time===480)animation.finish();}),time);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   shots.push({time,image:(await page.locator('.focus-compare-controls').screenshot()).toString('base64')});
  }
  await page.locator('[data-compare-action="stop"]').click();await page.locator('.focus-recording-mode').waitFor({state:'hidden'});
  const filmstrip=await context.newPage();await filmstrip.setViewportSize({width:1000,height:440});
  await filmstrip.setContent('<!doctype html><html><head><style>body{margin:0;padding:20px;background:#11151d;color:#dce0ed;font:13px system-ui}h1{font-size:16px;font-weight:500;margin:0 0 16px}.frame{display:grid;grid-template-columns:70px 1fr;align-items:center;margin:8px 0;border:1px solid #363d4c;border-radius:5px;overflow:hidden}.frame span{padding-left:14px}.frame img{width:100%;height:54px;object-fit:contain;background:#242424}</style></head><body><h1>Record my voice → Recording</h1>'+shots.map(shot=>'<div class="frame"><span>'+shot.time+' ms</span><img src="data:image/png;base64,'+shot.image+'"></div>').join('')+'</body></html>');
  await filmstrip.screenshot({path:path.join(out,'recording-flip-filmstrip.png')});await filmstrip.close();
  const rapid=await page.evaluate(async()=>{
   recordingSwitchFixture.delay=20;
   const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
   const phase=async expected=>{for(let attempt=0;attempt<200&&document.getElementById('focus-compare').dataset.state!==expected;attempt++)await delay(10);if(document.getElementById('focus-compare').dataset.state!==expected)throw Error('Timed out waiting for '+expected);};
   const click=action=>document.querySelector(`[data-compare-action="${action}"]`).click(),frames=[];
   for(let index=0;index<3;index++){
    click('record');await phase('recording');await delay(35);click('stop');await phase('idle');await delay(35);click('record');await phase('recording');await delay(600);frames.push(snapshotRecordingSwitch());
    click('stop');await phase('idle');await delay(600);frames.push(snapshotRecordingSwitch());
   }
   return frames;
  });
  for(let index=0;index<rapid.length;index++){
   const frame=rapid[index],capturing=index%2===0;assert.equal(frame.state,capturing?'recording':'idle');assert.equal(frame.recording.hidden,!capturing);assert.equal(frame.idle.hidden,capturing);assert.equal(frame.switching,null);assert.equal(frame.animations,0,'Rapid reversals cannot leave animation effects or stale visibility callbacks');
  }
  evidence.push({rapid});
  const remounted=await page.evaluate(async()=>{
   const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
   document.querySelector('[data-compare-action="record"]').click();
   for(let attempt=0;attempt<200&&document.getElementById('focus-compare').dataset.state!=='recording';attempt++)await delay(10);
   await delay(35);const detachedLayers=[...document.querySelectorAll('.focus-audio-idle-mode,.focus-recording-mode')];
   IKnowFocusAudio.unmount({discard:true});IKnowFocusAudio.mount(document.getElementById('focus-compare'),{key:'word:19053:remounted-switch-motion',audioUrl:''});
   const initial=snapshotRecordingSwitch();await delay(380);return{initial,final:snapshotRecordingSwitch(),detachedAnimations:detachedLayers.reduce((sum,node)=>sum+node.getAnimations().length,0),tracksReleased:recordingSwitchFixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))};
  });
  assert.equal(remounted.initial.idle.hidden,false);assert.equal(remounted.final.idle.hidden,false);assert.equal(remounted.final.recording.hidden,true);assert.equal(remounted.final.switching,null);assert.equal(remounted.final.state,'idle');assert.equal(remounted.final.animations,0);assert.equal(remounted.detachedAnimations,0);assert.equal(remounted.tracksReleased,true);evidence.push({remounted});
  await page.emulateMedia({reducedMotion:'reduce'});
  const reducedStart=await sample('record',500),reducedStop=await sample('stop',400);
  for(const frame of [...reducedStart,...reducedStop]){
   assert.equal(frame.animations,0,'Reduced motion uses immediate layer changes');
   assert.equal(frame.switching,null,'Reduced motion never starts a 3D turn');
   assert.equal(Number(!frame.idle.hidden)+Number(!frame.recording.hidden),1,'Reduced motion never leaves overlapping layers');
  }
  assert.equal(reducedStart.at(-1).recording.hidden,false);assert.equal(reducedStop.at(-1).idle.hidden,false);geometryStable(reducedStart,'Reduced-motion start');geometryStable(reducedStop,'Reduced-motion stop');evidence.push({reducedStart,reducedStop});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS Recording flip: real opposed 3D face turns, hidden backfaces and clickable Stop, stable geometry, rapid reversal/unmount cleanup, reduced motion, four themes and two desktop sizes');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
