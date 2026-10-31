/* Full public course tests stay separate from the small saved-library fixture. */
"use strict";
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-focus-course-evidence");fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"});
  const page=await context.newPage(),errors=[],requests=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>requests.push(r.url()));
  await page.goto("http://127.0.0.1:52332/study-focus.html?review=full-course");await page.locator(".focus-card").waitFor();
  assert.equal(requests.filter(url=>url.endsWith("/catalog-source.json")).length,0,"Study does not load course text automatically");
  const savedCount=await page.locator("#demo-library-list .library-row").count();assert.equal(savedCount,18);
  await page.evaluate(()=>{window.courseTiming={start:performance.now()};document.querySelector('[data-view="test"]').click();});
  await page.waitForFunction(()=>document.getElementById("demo-test-total")?.textContent===" (200)"&&!document.querySelector('[data-action="start"]').disabled);
  const firstReady=await page.evaluate(()=>performance.now()-courseTiming.start);assert.ok(firstReady<5000,"Full course readiness is bounded");
  assert.equal(await page.locator('.app-actions a').count(),0,'The Test header has no unrelated course link');
  assert.equal(requests.filter(url=>url.endsWith("/catalog-source.json")).length,1);assert.equal(await page.locator(".activity-heading").innerText().then(t=>t.includes("selected")),false);
  assert.equal(await page.locator("#demo-test-source-status").isHidden(),true);assert.equal(await page.locator('[data-action="load-test-course"]').innerText(),"Loaded");assert.equal(await page.locator('[data-action="load-test-course"]').isDisabled(),true);
  await chooseWorkspaceOption(page, "#demo-test-content", "both");assert.equal(await page.locator("#demo-test-total").innerText(),"(400)");assert.equal(await page.locator("#demo-test-source-status").isHidden(),true);
  await chooseWorkspaceOption(page, "#demo-test-content", "sentence");assert.equal(await page.locator("#demo-test-total").innerText(),"(200)");
  await chooseWorkspaceOption(page, "#demo-test-content", "word");await page.locator('[data-action="start"]').click();assert.equal(await page.locator(".session-progress span").innerText(),"1 of 200");
  const words=await page.evaluate(async()=>IKnowReaderStudyCatalog.normalizeSource(await(await fetch("/catalog-source.json")).json()).records.filter(r=>r.kind==="word"));
  for(let i=0;i<10;i++){
   assert.equal(await page.locator(".session-word").innerText(),words[i].japanese,"Each course item uses its actual source rather than the first saved item");
   await page.locator(i===9?`[data-review]:not([data-review="${words[i].key}"])`:`[data-review="${words[i].key}"]`).first().click();await page.locator('[data-action="next-question"]').click();
  }
  assert.equal(await page.locator(".session-progress span").innerText(),"11 of 200");await page.locator('[data-action="end-session"]').click();
  assert.equal(await page.locator('.focus-result-stat[data-result="good"] strong').innerText(),"9");assert.equal(await page.locator('.focus-result-stat[data-result="again"] strong').innerText(),"1");assert.equal(await page.locator('.focus-result-stat[data-result="unanswered"] strong').innerText(),"190");
  await page.locator('[data-action="result-practice-mistakes"]').click();assert.equal(await page.locator(".session-progress span").innerText(),"1 of 191");assert.equal(await page.locator(".session-word").innerText(),words[9].japanese,"Unsaved course mistakes keep their frozen source");
  await page.locator(`[data-review="${words[9].key}"]`).click();await page.locator('[data-action="next-question"]').click();assert.equal(await page.locator(".session-word").innerText(),words[10].japanese);
  await page.locator('[data-action="end-session"]').click();await page.locator('[data-action="result-back-study"]').click();assert.equal(await page.locator("#demo-library-list .library-row").count(),savedCount,"Course tests never create saved items");
  await page.locator('[data-view="practice"]').click();assert.equal(await page.locator(".activity-heading small").innerText(),"4 selected","Course mistakes do not overwrite manual saved-item selection");
  await page.locator('[data-view="test"]').click();await chooseWorkspaceOption(page, "#demo-test-content", "both");
  const beforeStart=Date.now();await page.locator('[data-action="start"]').click();assert.equal(await page.locator(".session-progress span").innerText(),"1 of 400");const start400=Date.now()-beforeStart;assert.ok(start400<5000);
  await page.screenshot({path:path.join(out,"full-400-session.png")});await page.locator('[data-action="end-session"]').click();await page.locator('[data-action="result-back-study"]').click();
  await page.locator('[data-view="test"]').click();await page.locator("#demo-test-course").fill("https://iknow.jp/courses/19055");assert.equal(await page.locator('[data-action="start"]').isDisabled(),true,"Editing a course cannot start stale course data");
  await page.route("**/api/courses/19055",r=>r.fulfill({contentType:"application/json",body:JSON.stringify({...source,id:19055,title:"Other complete course"})}));
  await page.locator('[data-action="load-test-course"]').click();await page.waitForFunction(()=>document.getElementById("demo-test-title")?.textContent==="Other complete course"&&!document.querySelector('[data-action="start"]').disabled);assert.equal(await page.locator("#demo-test-total").innerText(),"(400)");
  assert.equal(await page.locator('.app-actions a').count(),0,'Loading a Test course does not add a header link');
  await page.locator("#demo-test-course").fill("https://example.com/courses/1");await page.locator('[data-action="load-test-course"]').click();await page.waitForFunction(()=>document.getElementById("demo-test-source-status")?.textContent.includes("iKnow course"));assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
  assert.equal(await page.locator('.app-actions a').count(),0,'Editing the Test course keeps the header stable');
  await page.screenshot({path:path.join(out,"course-input-validation.png")});
  // These fixtures intentionally have no saved course, unlike the warm-cache tabs above.
  const failContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"}),failPage=await failContext.newPage();failPage.on("pageerror",e=>errors.push(e.message));let failures=1;await failPage.route("**/catalog-source.json",r=>failures-- > 0?r.fulfill({status:503,body:"Unavailable"}):r.fulfill({contentType:"application/json",body:JSON.stringify(source)}));
  await failPage.goto("http://127.0.0.1:52332/study-focus.html?review=course-error");await failPage.locator(".focus-card").waitFor();await failPage.locator('[data-view="test"]').click();await failPage.waitForFunction(()=>document.getElementById("demo-test-source-status")?.textContent.includes("503"));
  assert.equal(await failPage.locator('[data-action="start"]').isDisabled(),true);assert.equal(await failPage.locator("#demo-test-total").innerText(),"");await failPage.locator('[data-action="load-test-course"]').click();await failPage.waitForFunction(()=>document.getElementById("demo-test-total")?.textContent===" (200)"&&!document.querySelector('[data-action="start"]').disabled);
  const delayedContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"}),delayedPage=await delayedContext.newPage();delayedPage.on("pageerror",e=>errors.push(e.message));let release,arrived;const waiting=new Promise(resolve=>arrived=resolve);
  await delayedPage.route("**/catalog-source.json",async route=>{arrived();await new Promise(resolve=>release=resolve);await route.fulfill({contentType:"application/json",body:JSON.stringify(source)});});
  await delayedPage.goto("http://127.0.0.1:52332/study-focus.html?review=background-course");await delayedPage.locator(".focus-card").waitFor();await delayedPage.locator('[data-view="test"]').click();await waiting;await delayedPage.locator('[data-view="study"]').click();
  await delayedPage.locator(".focus-card").evaluate(n=>n.dataset.preserve="yes");release();await delayedPage.waitForLoadState("networkidle");assert.equal(await delayedPage.locator(".focus-card").getAttribute("data-preserve"),"yes","A completed hidden course load never redraws the unrelated Study card");
  const preferencePage=await context.newPage();preferencePage.on("pageerror",e=>errors.push(e.message));await preferencePage.goto("http://127.0.0.1:52332/study-focus.html?review=practice-preferences");await preferencePage.locator(".focus-card").waitFor();
  await preferencePage.locator('[data-view="practice"]').click();await preferencePage.locator('[data-mode="cloze"]').click();await chooseWorkspaceOption(preferencePage, "#demo-attempts", "single");await chooseWorkspaceOption(preferencePage, "#demo-gap-position", "first");
  await preferencePage.locator('[data-action="choose"]').click();await preferencePage.locator('[data-action="clear-selection"]').click();await preferencePage.locator('.picker-list .library-row[data-item^="sentence:"]').first().click();await preferencePage.locator('[data-action="close-picker"]').click();
  assert.equal(await preferencePage.locator("#demo-attempts").getAttribute('data-value'),"single");assert.equal(await preferencePage.locator("#demo-gap-position").getAttribute('data-value'),"first");
  await preferencePage.locator('[data-view="test"]').click();await preferencePage.waitForFunction(()=>document.getElementById("demo-test-total")?.textContent===" (200)");await preferencePage.locator('[data-view="practice"]').click();
  assert.equal(await preferencePage.locator("#demo-attempts").getAttribute('data-value'),"single");assert.equal(await preferencePage.locator("#demo-gap-position").getAttribute('data-value'),"first");
  await preferencePage.locator("#focus-language-trigger").click();await preferencePage.locator('.focus-menu-language [data-menu-value="de"]').click();assert.equal(await preferencePage.locator("#demo-gap-position").getAttribute('data-value'),"first","Header redraw preserves the chosen gap");
  await preferencePage.locator('[data-action="start"]').click();assert.match(await preferencePage.locator(".session-word").innerText(),/^\s*_____\s*は/);await preferencePage.locator("#listening-answer").fill("wrong");await preferencePage.locator("#demo-answer .primary").click();assert.equal(await preferencePage.locator("#demo-solution").isVisible(),true,"The retained one-attempt policy reveals after the first wrong answer");
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,first200ReadyMs:Math.round(firstReady),start400Ms:start400,counts:{words:200,sentences:200,both:400,saved:savedCount}},null,2));
  console.log(`PASS Full course: 200/200/400 independent of18saved, unsaved question/mistake source, dynamic counts, no eager fetch or bookmark writes, validated course input/retry, retained practice gap/attempts; readiness ${Math.round(firstReady)}ms, 400start ${start400}ms`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
