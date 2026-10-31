/* Real MediaRecorder on a fake browser microphone, never the user's device. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-focus-compare-browser-evidence");fs.mkdirSync(out,{recursive:true});
function wav(){const data=Buffer.alloc(44+44100);data.write("RIFF");data.writeUInt32LE(data.length-8,4);data.write("WAVEfmt ",8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(44100,24);data.writeUInt32LE(88200,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write("data",36);data.writeUInt32LE(44100,40);return data;}
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},permissions:["microphone"],reducedMotion:"reduce"});
  await context.route(/^https?:\/\/assets\d*\.iknow\.jp\//,r=>r.fulfill({contentType:"audio/wav",body:wav(),headers:{"Access-Control-Allow-Origin":"*"}}));
  await context.addInitScript(()=>{
   const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.compareMetrics={streams:[],plays:[]};
   navigator.mediaDevices.getUserMedia=async options=>{const stream=await gum(options);compareMetrics.streams.push(stream);return stream;};
   const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){compareMetrics.plays.push(this.src);return play.call(this);};
  });
  const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:52332/study-focus.html?variant=docked&review=compare-browser");
  const toggle=()=>page.locator('[data-action="compare"]'),action=name=>page.locator(`[data-compare-action="${name}"]`);
  const chooseTheme=async theme=>{await page.locator('#focus-theme-trigger').click();await page.locator(`.focus-menu-theme [data-menu-value="${theme}"]`).click();await page.waitForFunction(theme=>document.documentElement.dataset.ikrTheme===theme,theme);};
  const open=async()=>{await toggle().click();await page.locator("#focus-compare").waitFor();};
  const allReleased=()=>page.evaluate(()=>compareMetrics.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended")));
  await open();assert.equal(await page.evaluate(()=>compareMetrics.streams.length),0,"Opening Compare never requests the microphone");
  assert.equal(await page.locator(".toast").count(),0);assert.equal(await toggle().getAttribute("aria-expanded"),"true");
  for(const theme of ["paper","midnight","tokyo","forest"]){
   await chooseTheme(theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
   const card=await page.locator('.focus-card').boundingBox(),main=await page.locator('.focus-main').boundingBox();assert.ok(card.y>=main.y-1&&card.y+card.height<=main.y+main.height+1,'The idle comparison card fits without clipped edges');
   await page.locator('[data-action="reveal-reading"]').hover();assert.equal(await page.locator('[data-action="reveal-reading"]').evaluate(n=>getComputedStyle(n).backgroundColor),"rgba(0, 0, 0, 0)");
   assert.equal(await page.locator('[data-action="reveal-reading"]').evaluate(n=>getComputedStyle(n).borderRadius),"4px");
   await page.screenshot({path:path.join(out,theme+"-compare-open.png")});
  }
  await action("record").click();await page.waitForFunction(()=>document.getElementById("focus-compare").dataset.state==="recording");
  await page.locator('[data-action="reveal-reading"]').click();assert.equal(await page.locator("#focus-compare").getAttribute("data-state"),"recording","Romaji toggle does not interrupt recording");
  await page.waitForTimeout(350);await action("stop").click();await page.waitForFunction(()=>!document.querySelector('[data-compare-action="take"]').disabled);assert.ok(await allReleased());
  await action("take").click();await page.waitForFunction(()=>compareMetrics.plays.some(url=>url.startsWith("blob:")));
  await action("original").click();await page.waitForFunction(()=>compareMetrics.plays.some(url=>url.includes("iknow.jp")));
  await page.locator('.focus-rail [data-action="browse"]').click();assert.equal(await action("take").isDisabled(),false,"Same-item layout changes retain finished take");
  await toggle().click();await toggle().click();assert.equal(await action("take").isDisabled(),false,"Closing and reopening Compare retains the take");
  await action("record").click();await page.waitForFunction(()=>document.getElementById("focus-compare").dataset.state==="recording");
  await page.locator('[data-action="play"]').click();await page.waitForFunction(()=>compareMetrics.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended")));await page.waitForFunction(()=>!document.querySelector('[data-compare-action="take"]').disabled);
  await action("record").click();await page.waitForFunction(()=>document.getElementById("focus-compare").dataset.state==="recording");
  await page.locator('[data-action="next"]').click();assert.ok(await allReleased());assert.equal(await page.locator("#focus-compare").isVisible(),false);await open();assert.equal(await action("take").isDisabled(),true,"A new item never inherits another item's take");
  await page.setViewportSize({width:390,height:844});assert.equal(await toggle().isVisible(),true,"Compare remains available on mobile");assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,"mobile-compare.png"),fullPage:true});
  assert.deepEqual(errors,[]);await page.evaluate(()=>IKnowFocusAudio.reset());assert.ok(await allReleased());
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,scope:"C1 inline Compare, actual fake-device MediaRecorder, playback, rerender/item cleanup, Romaji recording continuity, four themes and mobile"},null,2));
  console.log("PASS C1 Compare: real fake-device recording/playback, inline controls, safe item/layout changes, Romaji continuity, quiet hover, four themes and mobile");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
