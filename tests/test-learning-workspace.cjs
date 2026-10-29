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
 const sentence={cue:{id:10001,text:"それはとてもいい話だ。",transliterations:{Hrkt:"それ は とても いい はなし だ。",Latn:"sore ha totemo ii hanashi da."}},response:{text:"That's a really nice story."},sound:"https://assets0.iknow.jp/assets/test.mp3"};
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
  const Core=require("../extension/core.js"),expected=Core.expectedSource(goal);
  const germanPack={format:"iknow-reader-course",schemaVersion:1,course:{id:19053,title:goal.title,wordCount:1,sentenceCount:1},alignments:{10001:{signature:expected.sentences["10001"].signature,groups:[]}},germanItems:{100:{signature:expected.items["100"],text:"das"}},audio:{}};
  await worker.evaluate(pack=>chrome.storage.local.set({iknowReaderSettings:{translationLanguage:"both"},iknowReaderCoursePacks:{19053:pack}}),germanPack);
  const course=await context.newPage();await course.goto("https://iknow.jp/courses/19053");
  try { await course.locator(".sentence .ikr-study-tools button").first().waitFor({timeout:10000}); }
  catch(error){ console.log("Course fixture debug",JSON.stringify({errors,external,body:await course.locator("body").innerText(),html:await course.locator("html").getAttribute("class"),worker:await worker.evaluate(()=>Object.keys(globalThis).filter(name=>name.startsWith('IKnowReader')))}));throw error; }
  const checkWordActions=async(mode,label)=>{
   await course.locator('[data-setting="translationLanguage"]').selectOption(mode);
   await until(async()=>await course.locator("html").evaluate((node,mode)=>node.classList.contains("ikr-language-"+mode),mode),label+" language");
   const layout=await course.locator(".item-details .cue-response").evaluate(node=>{
    const tools=node.querySelector(".ikr-study-tools"),visibleGlosses=[...node.querySelectorAll(".response,.ikr-item-german")].filter(gloss=>getComputedStyle(gloss).display!=="none");
    return {buttons:tools?.querySelectorAll("button").length,groups:node.querySelectorAll(".ikr-study-tools").length,glosses:visibleGlosses.map(gloss=>gloss.textContent),after:visibleGlosses.every(gloss=>Boolean(gloss.compareDocumentPosition(tools)&Node.DOCUMENT_POSITION_FOLLOWING)),below:visibleGlosses.every(gloss=>tools.getBoundingClientRect().top>=gloss.getBoundingClientRect().bottom)};
   });
   assert.equal(layout.buttons,2,label+" has save and practice");assert.equal(layout.groups,1,label+" has no duplicate controls");assert.equal(layout.after,true,label+" controls follow every visible gloss in DOM");assert.equal(layout.below,true,label+" controls are visually below every visible gloss");
   assert.deepEqual(layout.glosses,mode==="both"?["that","das"]:mode==="de"?["das"]:["that"]);
  };
  for(const mode of ["both","en","de","both"])await checkWordActions(mode,"Initially prepared "+mode);
  await course.screenshot({path:path.join(out,"00-both-word-actions.png"),fullPage:true});
  await worker.evaluate(pack=>chrome.storage.local.set({iknowReaderCoursePacks:{19053:{...pack,germanItems:{}}}}),germanPack);
  await until(async()=>await course.locator(".item-details .ikr-item-german").count()===0,"German gloss removed without recreating word controls");
  await worker.evaluate(pack=>chrome.storage.local.set({iknowReaderCoursePacks:{19053:pack}}),germanPack);
  await until(async()=>await course.locator(".item-details .ikr-item-german").count()===1,"German gloss arrives after existing word controls");
  for(const mode of ["both","de","en","both"])await checkWordActions(mode,"Late prepared "+mode);
  console.log("PASS Word controls stay below all visible English/German glosses across language switches and late cache arrival, without duplicates");
  await course.locator(".sentence .ikr-study-tools button").first().click();
  await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary?.records||{}).length===1),"course bookmark");
  const next=context.waitForEvent("page");await course.locator(".sentence .ikr-study-tools button").nth(1).click();const study=await next;await study.waitForLoadState();
  await study.locator("#japanese").waitFor();assert.equal(await study.locator("#japanese").innerText(),sentence.cue.text);
  assert.match(study.url(),/study\.html\?course=19053&item=/);
  assert.equal(await study.locator("#romaji button[aria-pressed=false]").count(),6);await study.locator("#romaji button").first().click();assert.equal(await study.locator("#romaji button").first().innerText(),"sore");
  await study.locator("#reveal-all").click();assert.equal(await study.locator("#romaji button[aria-pressed=true]").count(),6);
  assert.deepEqual(await study.locator("#romaji button").allTextContents(),["sore","ha","totemo","ii","hanashi","da."]);
  assert.equal(await study.locator("#pitch-section").count(),0);assert.equal(await study.locator('script[src="study-pitch.js"],script[src="study-reading.js"]').count(),0);
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records["sentence:19053:10001"].romaji),sentence.cue.transliterations.Latn);
  await study.screenshot({path:path.join(out,"01-study.png"),fullPage:true});
  console.log("PASS The real course saves a sentence, opens its study tab through the background, and reveals Romaji per word or together");
  await course.locator(".item-details .ikr-study-tools button").first().click();
  await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records).length===2),"word bookmark");
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get("iknowReaderStudyLibrary")).iknowReaderStudyLibrary.records["word:19053:100"].german),"das");
  const wordTab=context.waitForEvent("page");await course.locator(".item-details .ikr-study-tools button").nth(1).click();const wordStudy=await wordTab;await wordStudy.waitForLoadState();
  await wordStudy.locator("#japanese").waitFor();assert.equal(await wordStudy.locator("#japanese").innerText(),"それ");assert.match(wordStudy.url(),/study\.html\?course=19053&item=word/);await wordStudy.close();
  assert.equal(await course.locator(".item-details .ikr-study-tools button").count(),2);
  await study.locator("#kind-filter").selectOption("word");await until(async()=>await study.locator("#japanese").innerText()==="それ","word filter");
  await study.locator("#kind-filter").selectOption("");await study.locator('[data-key="sentence:19053:10001"]').click();
  console.log("PASS Vocabulary bookmarks are saved independently and the study library switches correctly between words and sentences");
  await study.locator("#repeat-count").selectOption("2");await study.locator("#pause-duration").selectOption("1");await study.locator("#start-loop").click();await until(async()=>/Practice complete/.test(await study.locator("#audio-status").innerText()),"repeat and pause loop");
  await study.locator("#start-loop").click();await study.locator("#stop-loop").click();assert.match(await study.locator("#audio-status").innerText(),/stopped/);
  await study.locator("#record").click();await until(async()=>await study.locator("#record").innerText()==="Stop recording","microphone capture");await new Promise(resolve=>setTimeout(resolve,330));await study.locator("#record").click();
  await until(async()=>await study.locator("#play-take").isEnabled(),"local take");assert.equal(await study.evaluate(()=>testStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))),true);
  assert.match(await study.locator(".record-section .assessment-note").innerText(),/not an automatic pronunciation score/);
  for(const theme of ["paper","midnight","tokyo","forest"]){
   await study.evaluate(theme=>IKnowReaderTheme.choose(theme),theme);await new Promise(resolve=>setTimeout(resolve,180));
   for(const selector of ["#discard-take","#reveal-all"]){const action=study.locator(selector);await action.hover();await new Promise(resolve=>setTimeout(resolve,180));const style=await action.evaluate(node=>{const css=getComputedStyle(node);return{background:css.backgroundColor,padding:parseFloat(css.paddingLeft),border:parseFloat(css.borderTopWidth)};});assert.equal(style.background,"rgba(0, 0, 0, 0)",theme+selector+" remains a transparent text action");assert.ok(style.padding>=6);assert.equal(style.border,0);}
  }
  await study.evaluate(()=>IKnowReaderTheme.choose("paper"));
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
