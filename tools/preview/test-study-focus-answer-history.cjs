/* Submitted answers remain verbatim, including wrong retries and ended drafts. */
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const Results=require("./study-focus-results.js");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-focus-answer-history-evidence");fs.mkdirSync(out,{recursive:true});
const session={mode:"cloze",test:false,complete:false,keys:["a","b","c"],pool:[
 {key:"a",kind:"sentence",japanese:"それはとてもいい話だ。"},
 {key:"b",kind:"sentence",japanese:"それをください。"},
 {key:"c",kind:"sentence",japanese:"私は行きます。"}
],exercises:[{before:"それは",after:"いい話だ。"},{before:"",after:"をください。"},{before:"私は",after:"。"}],results:[
 {key:"a",japanese:"それはとてもいい話だ。",expected:"とても · totemo",submitted:"  Totemoi  ",outcome:"again",attempts:1,attemptsHistory:[{submitted:"  Totemoi  ",correct:false}]},
 {key:"b",japanese:"それをください。",expected:"それ · sore",submitted:"sore",outcome:"hard",attempts:2,attemptsHistory:[{submitted:"watashi",correct:false},{submitted:"sore",correct:true}]},
 {key:"c",japanese:"私は行きます。",expected:"行きます · ikimasu",submitted:"unfinished draft",outcome:"unanswered",attempts:0}
]};
const snapshot=JSON.stringify(session),summary=Results.summarize(session),html=Results.render(session);
assert.equal(summary.rows[0].submitted,"  Totemoi  ");assert.deepEqual(summary.rows[1].attemptsHistory,[{submitted:"watashi",correct:false,shown:false},{submitted:"sore",correct:true,shown:false}]);
assert.match(html,/Earlier answers/);assert.match(html,/watashi/);assert.match(html,/Your draft/);assert.match(html,/unfinished draft/);assert.match(html,/それは _____ いい話だ。/);
const attack='<img src=x onerror="alert(1)">';const malicious=Results.render({...session,results:[{...session.results[0],attemptsHistory:[{submitted:attack},{submitted:"sore"}]}]});assert.doesNotMatch(malicious,/<img/);assert.match(malicious,/&lt;img/);
const empty=Results.render({...session,results:[{...session.results[0],submitted:"",attemptsHistory:[{submitted:"",shown:true}]}]});assert.match(empty,/No answer entered/);assert.match(empty,/Not answered/);
assert.equal(Results.summarize({...session,results:[{...session.results[1],attemptsHistory:Array.from({length:100},(_,i)=>({submitted:String(i)}))}]}).rows[1].attemptsHistory.length,50);
assert.equal(JSON.stringify(session),snapshot);
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:"reduce"}),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",r=>r.abort());
  const read=name=>fs.readFileSync(path.resolve(__dirname,name),"utf8");
  const css=[fs.readFileSync(path.resolve(__dirname,"../../extension/theme.css"),"utf8"),read("study-layouts.css"),read("study-focus.css"),read("study-focus-results.css")].join("\n").replace(/@import[^;]*;/g,"");
  await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"><style>'+css+'.app-frame{height:calc(100vh - 48px);width:calc(100% - 48px);margin:24px;position:relative;flex:none}</style></head><body><div class="app-frame">'+html+'</div></body></html>');
  await page.addScriptTag({content:read("study-focus-results.js")});await page.evaluate(s=>{globalThis.session=s;IKnowFocusResults.mount(document.querySelector(".focus-results"),s);},session);
  assert.equal(await page.locator('.focus-result-selected [data-wrong="true"] dd').textContent(),"  Totemoi  ");
  await page.locator('[data-result-pick="b"]').click();assert.equal(await page.locator('.focus-result-selected .focus-attempt-text').textContent(),"watashi");assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dd').textContent(),"sore");
  await page.locator('[data-result-pick="c"]').click();assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dt').innerText(),"Your draft");assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dd').innerText(),"unfinished draft");
  for(const theme of ["paper","midnight","tokyo","forest"]){
   await page.locator("html").evaluate((n,t)=>n.dataset.ikrTheme=t,theme);
   for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);const button=page.locator('[data-action="result-back-study"]');await button.scrollIntoViewIfNeeded();await button.hover();
    const geometry=await button.evaluate(node=>{const bounds=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);const label=range.getBoundingClientRect(),style=getComputedStyle(node);return{paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,left:label.left-bounds.left,right:bounds.right-label.right,centerY:(label.top+label.bottom-bounds.top-bounds.bottom)/2};});
    assert.equal(geometry.paddingLeft,geometry.paddingRight,"Result button padding is symmetric in every theme");assert.ok(Math.abs(geometry.left-geometry.right)<1.5,"Back to study text is centered inside its visible hover border");assert.ok(Math.abs(geometry.centerY)<1.5,"Back to study text is vertically centered");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,theme+"-"+viewport.width+".png"),fullPage:viewport.width===390});
   }
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(session)),snapshot);assert.deepEqual(errors,[]);
  console.log("PASS Raw submitted answers, wrong retry history, draft/empty states, question context, escaped/bounded history and centered footer buttons across four themes and three viewports");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
