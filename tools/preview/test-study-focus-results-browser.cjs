/* Isolated results fixture, no learner data or external services. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source=path.resolve(__dirname,"../../extension"),out=path.resolve(__dirname,"../../tests/study-focus-results-evidence");fs.mkdirSync(out,{recursive:true});
const Results=require("./study-focus-results.js");
const session={test:true,complete:true,keys:["a","b","c"],results:[{key:"a",japanese:"それ",expected:"that, that one",submitted:"that, that one",outcome:"good",attempts:1},{key:"b",japanese:"見る",expected:"see, look at",submitted:"see, look at",outcome:"good",attempts:1},{key:"c",japanese:"円",expected:"circle",submitted:"money",outcome:"again",attempts:1}]};
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:"reduce"}),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",route=>route.abort());
  const css=[path.join(source,"theme.css"),path.join(__dirname,"study-layouts.css"),path.join(__dirname,"study-focus.css"),path.join(__dirname,"study-focus-results.css")].map(file=>fs.readFileSync(file,"utf8").replace(/@import[^;]*;/g,"")).join("\n");
  await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'.app-frame{position:relative;width:calc(100% - 48px);max-width:1100px;height:calc(100dvh - 48px);margin:24px auto;flex:none}</style></head><body><div class="app-frame">'+Results.render(session)+'</div></body></html>');
  assert.equal(await page.locator(".focus-result-score>strong").innerText(),"67%");assert.equal(await page.locator("[data-action=result-practice-mistakes]").innerText(),"Practise 1 item");assert.equal(await page.locator(".focus-result-item").count(),3);
  await page.locator('.focus-result-item[data-result="again"]>summary').click();assert.equal(await page.locator('.focus-result-item[data-result="again"]').evaluate(n=>n.open),true);assert.match(await page.locator('.focus-result-item[data-result="again"]').innerText(),/money[\s\S]*circle/);
  const rectangles=[];
  for(const theme of ["paper","midnight","tokyo","forest"]){await page.locator("html").evaluate((n,t)=>n.dataset.ikrTheme=t,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));rectangles.push(await page.locator(".focus-results").boundingBox());await page.screenshot({path:path.join(out,theme+"-results.png")});}
  assert.ok(rectangles.every(rect=>JSON.stringify(rect)===JSON.stringify(rectangles[0])));
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator("[data-action=result-back-study]").scrollIntoViewIfNeeded();assert.equal(await page.locator("[data-action=result-new-round]").isVisible(),true);await page.screenshot({path:path.join(out,"mobile-results.png"),fullPage:true});
  assert.deepEqual(errors,[]);console.log("PASS Focus results visual: real score/counts, answer detail disclosure, four-theme geometry, reachable actions and mobile overflow");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
