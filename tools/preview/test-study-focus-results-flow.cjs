/* Full answer-to-results flow in the isolated C1 preview. */
"use strict";
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-focus-results-flow-evidence");fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:"reduce"}),errors=[];page.on("pageerror",e=>errors.push(e.message));
  // A deliberately small complete course fixture keeps this completion test
  // short. test-study-focus-course.cjs separately verifies the full200/400 pool.
  const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));fixture.goal_items=fixture.goal_items.slice(0,9);
  await page.route("**/catalog-source.json",route=>route.fulfill({contentType:"application/json",body:JSON.stringify(fixture)}));
  await page.goto("http://127.0.0.1:52332/study-focus.html?review=results-regression");await page.locator(".focus-card").waitFor();
  const records=await page.evaluate(async()=>IKnowReaderStudyCatalog.normalizeSource(await(await fetch("/catalog-source.json")).json(),{courseId:"19053"}).records);
  const wordCount=records.filter(r=>r.kind==="word").length;
  async function correctKey(){const jp=await page.locator(".session-word").innerText();return records.find(r=>r.kind==="word"&&r.japanese===jp).key;}
  async function answerReview(correct){const key=await correctKey();await page.locator(correct?`[data-review="${key}"]`:`[data-review]:not([data-review="${key}"])`).first().click();await page.locator("#demo-solution").waitFor();await page.locator('[data-action="next-question"]').click();}
  await page.locator('[data-view="test"]').click();await page.locator('[data-action="start"]').click();
  for(let i=0;i<wordCount;i++)await answerReview(i<6);
  await page.locator(".focus-results").waitFor();assert.equal(await page.locator(".focus-results-heading h2").innerText(),"Test complete");
  assert.equal(await page.locator(".focus-result-score strong").innerText(),"67%");assert.equal(await page.locator('.focus-result-stat[data-result="good"] strong').innerText(),"6");assert.equal(await page.locator('.focus-result-stat[data-result="again"] strong').innerText(),"3");
  assert.equal(await page.locator(".focus-result-item").count(),wordCount);assert.equal(await page.locator('.focus-result-item[data-result="again"]').count(),3);
  await page.locator('.focus-result-item[data-result="again"] summary').first().click();const detail=await page.locator('.focus-result-item[data-result="again"]').first().innerText();assert.match(detail,/Your answer/);assert.match(detail,/Expected answer/);
  await page.screenshot({path:path.join(out,"test-summary.png")});
  for(const theme of ["paper","midnight","tokyo","forest"]){await page.locator("#focus-theme-trigger").click();await page.locator(`.focus-menu-theme [data-menu-value="${theme}"]`).click();assert.equal(await page.locator(".focus-result-score strong").innerText(),"67%");assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,theme+"-results.png")});}
  await page.locator('[data-action="result-practice-mistakes"]').click();assert.equal(await page.locator(".session-progress span").count(),1,JSON.stringify({errors,toasts:await page.locator('.toast').allTextContents()}));assert.equal(await page.locator(".session-progress span").innerText(),"1 of 3");
  for(let i=0;i<3;i++)await answerReview(true);
  await page.locator(".focus-results").waitFor();assert.equal(await page.locator(".focus-result-score strong").innerText(),"100%");await page.locator('[data-action="result-test-report"]').click();assert.equal(await page.locator(".focus-result-score strong").innerText(),"67%","Mistake practice never rewrites the test score");
  await page.locator('[data-action="result-new-round"]').click();await page.locator('[data-action="start"]').click();await answerReview(true);await page.locator('[data-action="end-session"]').click();
  assert.equal(await page.locator(".focus-results-heading h2").innerText(),"Test ended early");assert.equal(await page.locator('.focus-result-stat[data-result="good"] strong').innerText(),"1");assert.equal(await page.locator('.focus-result-stat[data-result="unanswered"] strong').innerText(),String(wordCount-1));assert.equal(await page.locator('.focus-result-stat[data-result="again"] strong').innerText(),"0");
  await page.locator('[data-action="result-back-study"]').click();assert.equal(await page.locator(".focus-card").isVisible(),true);
  await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="cloze"]').click();await chooseWorkspaceOption(page, "#demo-gap-position", "first");await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row[data-item^="sentence:"]').first().click();await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();
  await page.locator("#listening-answer").fill("wrong");await page.locator("#demo-answer .primary").click();assert.equal(await page.locator("#demo-solution").isVisible(),false);
  await page.locator("#listening-answer").fill("sore");await page.locator("#demo-answer .primary").click();await page.locator('[data-action="next-question"]').click();
  assert.equal(await page.locator('.focus-result-stat[data-result="hard"] strong').innerText(),"1");assert.equal(await page.locator(".focus-result-score strong").innerText(),"0%","A retry does not receive first-try credit");
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,"mobile-results.png"),fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,scope:"Real9-item test score, exact missed-item practice, retained original score, early termination, retry grading, details and four-theme/mobile layout"},null,2));
  console.log("PASS C1 results flow: real 6/9 score, exact mistake practice, original score retained, unanswered partial test, retry distinction and four themes/mobile");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
