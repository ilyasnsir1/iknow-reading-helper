/* One retry is two graded attempts; unfinished failures cannot become unanswered. */
"use strict";
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const origin="http://127.0.0.1:52332";
const controller=fs.readFileSync(path.join(__dirname,"study-focus.js"),"utf8");
const cases=[];
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 const errors=[];
 try{
  async function start(mode,attempts="retry"){
   const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:"reduce"});
   const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
   await page.route("**/study-focus.js",route=>route.fulfill({contentType:"application/javascript",body:controller}));
   await page.goto(origin+"/study-focus.html?review=one-retry#study");await page.locator(".focus-card").waitFor();
   const record=await page.evaluate(async kind=>Object.values((await(await fetch("/library.json")).json()).records).find(record=>record.kind===kind),mode==="review"?"word":"sentence");
   const correct=await page.evaluate(({mode,record})=>mode==="cloze"?IKnowReaderStudyPractice.buildCloze(record,{gapPosition:"first",romajiStyle:"source"}).answerRomaji:record.romaji,{mode,record});
   await page.locator('.focus-rail [data-view="practice"]').click();await page.locator('[data-mode="'+mode+'"]').click();
   assert.equal(await page.locator('#demo-attempts').innerText(),"One retry","The visible setting states the actual allowance");
   await chooseWorkspaceOption(page, "#demo-attempts", attempts);if(mode==="cloze")await chooseWorkspaceOption(page, "#demo-gap-position", "first");
   await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row[data-item="'+record.key+'"]').click();await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();
   const submitted=[];
   async function answer(right,index=0){
    if(mode==="review"){
     const choice=page.locator(right?'[data-review="'+record.key+'"]':'.session-review button:not([disabled]):not([data-review="'+record.key+'"])').first();
     submitted.push(await choice.innerText());await choice.click();
    }else{const value=right?correct:index?" second wrong <answer> ":" first wrong <answer> ";submitted.push(value);await page.locator("#listening-answer").fill(value);await page.locator('#demo-answer button[type="submit"]').click();}
   }
   async function report(expected,{early=false,draft=""}={}){
    await page.locator(early?'[data-action="end-session"]':'[data-action="next-question"]').click();await page.locator(".focus-results").waitFor();
    const expectedCounts={good:0,hard:0,again:0,unanswered:0};expectedCounts[expected]=1;
    for(const [outcome,count] of Object.entries(expectedCounts))assert.equal(await page.locator('.focus-result-stat[data-result="'+outcome+'"] strong').innerText(),String(count),mode+" grades "+expected+" without double-counting attempts");
    assert.equal(await page.locator(".focus-result-score>strong").innerText(),expected==="good"?"100%":"0%");
    const final=await page.locator(".focus-result-selected .focus-result-comparison>div:first-child dd").textContent();
    assert.equal(final,submitted.at(-1)||draft||"Not answered","Only a submitted answer can replace earlier submitted text");
    if(submitted.length===2)assert.equal(await page.locator(".focus-result-selected .focus-attempt-text").textContent(),submitted[0],"The actual first answer remains visible verbatim");
   }
   return{page,context,record,correct,submitted,answer,report};
  }
  for(const mode of ["review","cloze","listening"]){
   for(const scenario of ["first-correct","retry-correct","two-wrong","early-wrong","untouched","single-wrong",...(mode==="review"?[]:["draft-only","show-answer"])]){
    const test=await start(mode,scenario==="single-wrong"?"single":"retry"),{page,context,answer,report,submitted}=test;
    try{
     if(scenario==="first-correct"){await answer(true);await report("good");}
     else if(scenario==="retry-correct"){await answer(false);assert.equal(await page.locator("#demo-solution").isHidden(),true);await answer(true);await report("hard");}
     else if(scenario==="two-wrong"){
      await answer(false);assert.equal(await page.locator("#demo-solution").isHidden(),true);await answer(false,1);assert.equal(await page.locator("#demo-solution").isVisible(),true,"The second incorrect attempt reveals the answer and ends the question");
      if(mode==="review")assert.equal(await page.locator(".session-review button:not([disabled])").count(),0);
      else{assert.equal(await page.locator("#listening-answer").isDisabled(),true);await page.locator("#demo-answer").evaluate(form=>form.requestSubmit());}
      await report("again");
     }else if(scenario==="early-wrong"){
      await answer(false);if(mode!=="review")await page.locator("#listening-answer").fill("unsubmitted changed draft");await report("again",{early:true});
     }else if(scenario==="untouched")await report("unanswered",{early:true});
     else if(scenario==="single-wrong"){await answer(false);assert.equal(await page.locator("#demo-solution").isVisible(),true);await report("again");}
     else if(scenario==="draft-only"){await page.locator("#listening-answer").fill("unsubmitted draft");await report("unanswered",{early:true,draft:"unsubmitted draft"});}
     else if(scenario==="show-answer"){await answer(false);await page.locator('[data-action="show-answer"]').click();await report("again");}
     cases.push(mode+"/"+scenario);
    }finally{await context.close();}
   }
  }
  assert.deepEqual(errors,[]);console.log("PASS One retry: "+cases.length+" review/gap/listening scenarios, two-attempt limits, exact attempt history, early failed attempts versus unsubmitted drafts, one-attempt and reveal grading");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
