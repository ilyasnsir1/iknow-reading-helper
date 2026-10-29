/* Real isolated extension UI. Native model replies, iKnow data and microphone
 * hardware are explicit fixtures; no registered host or installed model used. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.join(__dirname,"learning-workspace-evidence");fs.mkdirSync(out,{recursive:true});
const until=async(fn,label)=>{const at=Date.now();while(!await fn()){if(Date.now()-at>14000)throw Error("Timed out: "+label);await new Promise(resolve=>setTimeout(resolve,30));}};
const wav=()=>{const b=Buffer.alloc(44+8820);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(8820,40);return b;};
(async()=>{
 const extension=require("./fixtures/isolate-extension.cjs")(path.resolve(__dirname,"../extension"),out);
 fs.writeFileSync(path.join(extension,"component-fixture.js"),`globalThis.fixtureComponentCalls=[];let job=null,installed=false;
 chrome.runtime.connectNative=()=>{const listeners=[],ends=[];let open=true;return{onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener:fn=>ends.push(fn)},disconnect(){open=false;ends.forEach(fn=>fn());},postMessage(message){fixtureComponentCalls.push(message);if(message.type==='components:start'||message.type==='components:resume')job={componentId:'audio',status:'running',message:'Fixture download',progress:.2};if(message.type==='components:pause')job={...job,status:'paused'};queueMicrotask(()=>{if(open)listeners.forEach(fn=>fn({type:'components:result',requestId:message.requestId,ok:true,snapshot:{catalogVersion:'fixture',components:[{id:'audio',title:'Sentence audio timings',description:'Local model fixture',version:'test',status:installed?'installed':'missing',downloadBytes:500000000}],job}}));});}};};globalThis.finishComponentFixture=()=>{installed=true;job={componentId:'audio',status:'complete',progress:1,message:'Ready'};};`);
 const bg=path.join(extension,"background.js");fs.writeFileSync(bg,'importScripts("component-fixture.js");\n'+fs.readFileSync(bg,"utf8"));
 const context=await chromium.launchPersistentContext(path.join(out,"profile-"+Date.now()),{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,"--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"],viewport:{width:1200,height:1050}});
 const errors=[],external=[];context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
 await context.addInitScript(()=>{
  const get=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);globalThis.testStreams=[];globalThis.testHoldMicrophone=false;globalThis.testGrant=null;globalThis.testRevoked=[];
  if(get) navigator.mediaDevices.getUserMedia=async args=>{const stream=await get(args);testStreams.push(stream);if(testHoldMicrophone)await new Promise(resolve=>{testGrant=resolve;});return stream;};
  const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{testRevoked.push(url);revoke(url);};
 });
 const sentence={cue:{id:10001,text:"それはとてもいい話だ。",transliterations:{Hrkt:"それ は とても いい はなし だ。",Latn:"sore wa tottemo ii hanashi da."}},response:{text:"That's a really nice story."},sound:"https://assets0.iknow.jp/assets/test.mp3"};
 const goal={id:19053,title:"Japanese Core · Fixture",cue_language:"ja",items_count:1,sentences_count:1,goal_items:[{item:{id:100,cue:{id:100,text:"それ",transliterations:{Hrkt:"それ",Latn:"sore"}},response:{text:"that"}},sentences:[sentence],sound:sentence.sound}]};
 await context.route("https://**/*",async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==="iknow.jp"&&url.pathname==="/api/v2/goals/19053")return route.fulfill({contentType:"application/json",body:JSON.stringify(goal)});
  if(url.hostname==="assets0.iknow.jp"&&url.pathname==="/assets/test.mp3")return route.fulfill({contentType:"audio/wav",body:wav(),headers:{"Access-Control-Allow-Origin":"*"}});
  if(url.hostname==="iknow.jp"&&url.pathname==="/courses/19053")return route.fulfill({contentType:"text/html",body:`<!doctype html><meta charset="utf-8"><div class="course-content-container"><div class="course-content"><div class="items"><div class="item"><div class="item-details"><div class="cue-response"><a class="cue" href="/items/100">それ</a><p class="response">that</p></div></div><div class="item-sentences"><div class="sentence"><div class="sentence-text"><p class="text">${sentence.cue.text}</p><p class="transliteration">${sentence.cue.transliterations.Hrkt}</p><p class="translation">${sentence.response.text}</p></div></div></div></div></div></div></div>`});
  external.push(url.href);await route.abort();
 });
 let worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");const id=new URL(worker.url()).host;
 try{
  const course=await context.newPage();await course.goto("https://iknow.jp/courses/19053");
  try { await course.locator(".sentence .ikr-study-tools button").first().waitFor({timeout:10000}); }
  catch(error){ console.log("Course fixture debug",JSON.stringify({errors,external,body:await course.locator("body").innerText(),html:await course.locator("html").getAttribute("class"),worker:await worker.evaluate(()=>Object.keys(globalThis).filter(name=>name.startsWith('IKnowReader')))}));throw error; }
  await course.locator(".sentence .ikr-study-tools button").first().click();
  await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary?.records||{}).length===1),"course bookmark");
  const next=context.waitForEvent("page");await course.locator(".sentence .ikr-study-tools button").nth(1).click();const study=await next;await study.waitForLoadState();
  await study.locator("#japanese").waitFor();assert.equal(await study.locator("#japanese").innerText(),sentence.cue.text);
  assert.match(study.url(),/study\.html\?course=19053&item=/);
  assert.equal(await study.locator("#romaji button[aria-pressed=false]").count(),6);await study.locator("#romaji button").first().click();assert.equal(await study.locator("#romaji button").first().innerText(),"sore");
  await study.locator("#reveal-all").click();assert.equal(await study.locator("#romaji button[aria-pressed=true]").count(),6);
  await study.screenshot({path:path.join(out,"01-study.png"),fullPage:true});
  console.log("PASS The real course saves a sentence, opens its study tab through the background, and reveals Romaji per word or together");
  await course.locator(".item-details .ikr-study-tools button").first().click();
  await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records).length===2),"word bookmark");
  await study.locator("#kind-filter").selectOption("word");await until(async()=>await study.locator("#japanese").innerText()==="それ","word filter");
  await study.locator("#kind-filter").selectOption("");await study.locator('[data-key="sentence:19053:10001"]').click();
  console.log("PASS Vocabulary bookmarks are saved independently and the study library switches correctly between words and sentences");
  await study.locator("#repeat-count").selectOption("2");await study.locator("#pause-duration").selectOption("1");await study.locator("#start-loop").click();await until(async()=>/Practice complete/.test(await study.locator("#audio-status").innerText()),"repeat and pause loop");
  await study.locator("#start-loop").click();await study.locator("#stop-loop").click();assert.match(await study.locator("#audio-status").innerText(),/stopped/);
  await study.locator("#record").click();await until(async()=>await study.locator("#record").innerText()==="Stop recording","microphone capture");await new Promise(resolve=>setTimeout(resolve,330));await study.locator("#record").click();
  await until(async()=>await study.locator("#play-take").isEnabled(),"local take");assert.equal(await study.evaluate(()=>testStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))),true);
  assert.match(await study.locator(".assessment-note").innerText(),/not an automatic pronunciation score/);
  await study.locator("#discard-take").click();assert.ok(await study.evaluate(()=>testRevoked.length)>0);assert.equal(await study.locator("#play-take").isDisabled(),true);
  console.log("PASS Original-repeat practice completes/stops; the fake-device microphone records locally, stops tracks, releases its take and never claims a pronunciation grade");
  await study.evaluate(()=>{testHoldMicrophone=true;});await study.locator("#record").click();await until(()=>study.evaluate(()=>!!testGrant),"delayed microphone fixture");await study.locator("#record").click();await study.evaluate(()=>testGrant());await until(()=>study.evaluate(()=>testStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))),"late grant tracks stopped");
  console.log("PASS Cancelling a delayed microphone grant releases the subsequently acquired stream");
  const models=await context.newPage();await models.goto(`chrome-extension://${id}/models.html`);await models.locator(".component").waitFor();assert.equal(await worker.evaluate(()=>fixtureComponentCalls.filter(value=>value.type==='components:start').length),0);
  await models.locator(".component button").click();await until(async()=>await models.locator("#pause").isEnabled(),"download starts");await models.locator("#pause").click();await until(async()=>await models.locator("#pause").innerText()==="Resume","pause reflected");
  await models.locator("#pause").click();await until(async()=>await models.locator("#pause").innerText()==="Pause","resume reflected");await worker.evaluate(()=>finishComponentFixture());await models.locator("#refresh").click();await until(async()=>await models.locator(".status").innerText()==="Installed","component completion");
  assert.equal(await worker.evaluate(()=>IKnowReaderComponents.busy),false);await models.screenshot({path:path.join(out,"02-models.png"),fullPage:true});
  const requests=await worker.evaluate(()=>fixtureComponentCalls);assert.ok(requests.filter(value=>value.type==='components:pause').every(value=>value.manual));
  console.log("PASS Models stay idle on opening, explicitly start/pause/resume, show completed installation, and release the background busy gate");
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,scope:"Real isolated extension course/study/models UI; native jobs, source/audio and microphone are fixtures",externalRequests:external,pageErrors:errors},null,2));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
