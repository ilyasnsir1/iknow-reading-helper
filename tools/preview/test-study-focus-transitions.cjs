/* C1 disclosure motion and geometry, isolated from real microphones and data. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const out=path.resolve(__dirname,"../../tests/study-focus-transitions-evidence");fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const evidence=[];
  for(const motion of ["no-preference","reduce"]){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:motion});
   await context.addInitScript(()=>{window.transitionMicCalls=0;Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{transitionMicCalls++;throw Error("A disclosure must never request microphone access.");}}});});
   const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
   for(const viewport of [{width:1440,height:900},{width:1280,height:720}]){
    await page.setViewportSize(viewport);await page.goto("http://127.0.0.1:52332/study-focus.html?review=disclosure-regression");await page.locator(".focus-card").waitFor();
    const baseline=await page.locator(".focus-card").evaluate(card=>({card:card.getBoundingClientRect().top,japanese:card.querySelector(".japanese").getBoundingClientRect().top,romaji:card.querySelector(".romaji").getBoundingClientRect().top}));
    assert.equal(await page.locator("button[data-focus-variant]").count(),0);
    const frames=await page.evaluate(async()=>{
     const result=[],start=performance.now();document.querySelector('[data-action="compare"]').click();
     while(performance.now()-start<600){await new Promise(requestAnimationFrame);const panel=document.getElementById("focus-compare"),style=getComputedStyle(panel);result.push({t:performance.now()-start,height:panel.getBoundingClientRect().height,opacity:Number(style.opacity),card:document.querySelector(".focus-card").getBoundingClientRect().top,japanese:document.querySelector(".focus-card .japanese").getBoundingClientRect().top,romaji:document.querySelector(".focus-card .romaji").getBoundingClientRect().top});}
     return result;
    });
    const end=frames.at(-1);assert.ok(end.height>25,"The recorder opens");
    for(const frame of frames){assert.ok(Math.abs(frame.japanese-baseline.japanese)<1.1,"Japanese text does not jump during reveal");assert.ok(Math.abs(frame.romaji-baseline.romaji)<1.1,"Romaji does not jump during reveal");assert.ok(Math.abs(frame.card-baseline.card)<1.1,"Card top remains anchored");}
    const intermediate=frames.some(frame=>(frame.height>1&&frame.height<end.height-1)||(frame.opacity>0.01&&frame.opacity<0.99));
    if(motion==="no-preference")assert.ok(intermediate,"Normal motion has intermediate disclosure frames");
    else assert.equal(intermediate,false,"Reduced motion skips animated disclosure frames");
    assert.equal(await page.locator('[data-action="compare"]').getAttribute("aria-expanded"),"true");assert.equal(await page.evaluate(()=>transitionMicCalls),0);
    await page.screenshot({path:path.join(out,`${motion}-${viewport.width}-open.png`)});
    await page.locator('[data-action="compare"]').click();await page.waitForTimeout(420);assert.equal(await page.locator('[data-action="compare"]').getAttribute("aria-expanded"),"false");
    const closed=await page.locator(".focus-card").evaluate(card=>({card:card.getBoundingClientRect().top,japanese:card.querySelector(".japanese").getBoundingClientRect().top,romaji:card.querySelector(".romaji").getBoundingClientRect().top}));
    for(const name of ["card","japanese","romaji"])assert.ok(Math.abs(closed[name]-baseline[name])<1.1,"Closing returns without shifting "+name);
    assert.equal(await page.locator("#focus-compare").isVisible(),false,"Closed recorder is concealed");
    const controls=page.locator('#focus-compare button:not(:disabled)');if(await controls.count()){assert.equal(await controls.first().evaluate(button=>{button.focus();return document.activeElement===button;}),false,"Closed controls cannot receive focus");}
    await page.evaluate(async()=>{for(let i=0;i<5;i++){document.querySelector('[data-action="compare"]').click();await new Promise(resolve=>setTimeout(resolve,35));}});await page.waitForTimeout(420);assert.equal(await page.locator('[data-action="compare"]').getAttribute("aria-expanded"),"true");assert.equal(await page.locator("#focus-compare").isVisible(),true,"Rapid reversal settles open");
    await page.locator('[data-action="compare"]').click();await page.waitForTimeout(420);assert.equal(await page.locator("#focus-compare").isVisible(),false,"Rapid reversal still closes normally");assert.equal(await page.evaluate(()=>transitionMicCalls),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
    evidence.push({motion,viewport,baseline,frames});
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,evidence},null,2));
  console.log("PASS C1 disclosure: anchored card/text, real intermediate motion, reduced motion, rapid reversals, concealed keyboard controls and no microphone access");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
