/* Design alternatives use one explicit example, never the user's real tests. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-result-designs-evidence");fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:"reduce"}),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:52332/study-result-designs.html?layout=report");
  await page.locator(".result-content").waitFor();
  assert.match(await page.locator(".results-review-bar").innerText(),/EXAMPLE RESULTS/);
  assert.deepEqual(await page.evaluate(()=>{const s=IKnowResultsDesignDemo.summary();return{total:s.total,firstTry:s.firstTry,missed:s.missed,retried:s.retried,unanswered:s.unanswered,percent:s.percent};}),{total:9,firstTry:6,missed:3,retried:0,unanswered:0,percent:67});
  for(const layout of ["report","review","map"]){
   await page.locator('[data-result-design="'+layout+'"]').click();
   assert.equal(await page.locator(".result-content").getAttribute("data-layout-choice"),layout);
   for(const theme of ["paper","midnight","tokyo","forest"]){
    await page.locator("#focus-theme-trigger").click();await page.locator('.focus-menu-theme [data-menu-value="'+theme+'"]').click();
    assert.equal(await page.locator("html").getAttribute("data-ikr-theme"),theme);
    assert.equal((await page.locator("[data-demo-percent]").innerText()).replace(/\s/g,""),"67%");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),layout+" no horizontal overflow");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),layout+" stays in desktop frame");
    if(theme==="paper"||theme==="midnight")await page.screenshot({path:path.join(out,layout+"-"+theme+"-1280.png")});
   }
   await page.locator("#focus-theme-trigger").click();await page.locator('.focus-menu-theme [data-menu-value="paper"]').click();
   if(layout==="review"){
    await page.locator('[data-result-filter="all"]').click();assert.equal(await page.locator(".review-item").count(),9);
    await page.locator(".review-item").first().click();assert.equal(await page.locator(".correction-japanese").innerText(),"それ");
    await page.locator('[data-result-filter="review"]').click();assert.equal(await page.locator(".review-item").count(),3);
   }else if(layout==="map"){
    assert.equal(await page.locator(".map-node").count(),9);await page.locator(".map-node").nth(7).click();assert.equal(await page.locator(".map-selected-heading h3").innerText(),"私");
    await page.locator(".session-map").evaluate(map=>{const sample=map.firstElementChild;for(let index=map.children.length;index<400;index++)map.append(sample.cloneNode(true));});
    assert.ok(await page.locator(".session-map").evaluate(map=>map.clientHeight<=200&&map.scrollHeight>map.clientHeight),"A 400-answer map stays bounded and scrolls internally");
    const selected=await page.locator(".map-selected").boundingBox(),frame=await page.locator(".result-content").boundingBox();assert.ok(selected.y<frame.y+frame.height-80,"A long map keeps the answer panel within reach");
    await page.locator('[data-result-design="map"]').click();
   }else{
    await page.locator(".answer-details summary").first().click();const answer=await page.locator(".answer-details").first().innerText();assert.match(answer,/Your answer/);assert.match(answer,/Expected answer/);
    await page.locator('[data-result-action="all-answers"]').click();assert.equal(await page.locator(".correct-group").getAttribute("open"),"");
   }
   await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,layout+"-paper-1440.png")});
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Mobile no horizontal overflow");assert.ok(await page.locator(".review-correction,.review-list-pane,.map-main,.map-sidebar,.result-report").evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})),"Mobile panels do not silently clip their content");await page.screenshot({path:path.join(out,layout+"-mobile.png"),fullPage:true});await page.setViewportSize({width:1280,height:720});
  }
  await page.locator('[data-result-action="practice"]').first().click();await page.locator(".practice-demo").waitFor();
  assert.equal(await page.locator(".result-content").evaluate(node=>node.inert),true);
  for(const answer of ["new","I","work, job"]){
   await page.locator('[data-demo-answer="'+answer+'"]').click();assert.equal(await page.locator("#practice-demo-status").innerText(),"Correct");await page.locator('[data-result-action="practice-next"]').click();
  }
  assert.match(await page.locator(".practice-demo-complete").innerText(),/stays at 67%/);await page.locator('[data-result-action="close-practice"]').first().click();assert.equal(await page.locator(".practice-demo").count(),0);
  assert.equal((await page.locator("[data-demo-percent]").innerText()).replace(/\s/g,""),"67%");
  await page.locator("#focus-language-trigger").click();await page.locator('.focus-menu-language [data-menu-value="de"]').click();assert.equal(await page.locator("#focus-language-trigger").innerText(),"German");assert.equal((await page.locator("[data-demo-percent]").innerText()).replace(/\s/g,""),"67%");
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,scope:"Three distinct result layouts, shared6/9 statistics, all4themes, desktop/mobile, answer detail navigation, sample mistake practice and unchanged example score"},null,2));
  console.log("PASS Results designs A/B/C: shared exact example counts, four themes, desktop/mobile fit, answer details, sample mistake practice and unchanged original score");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
