/* Review-only layouts, independent of extension storage or personal course data. */
"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-layout-variants-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto('http://127.0.0.1:52332/study-layouts.html?layout=a');await page.locator('.library-row').first().waitFor();
  for(const version of ['a','b','c']){
   await page.locator(`[data-version="${version}"]`).click();
   for(const theme of ['paper','midnight','tokyo','forest']){
    await page.locator('#demo-theme').selectOption(theme);assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),theme);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),version+' desktop fits viewport');
    if(theme==='paper'||theme==='midnight')await page.screenshot({path:path.join(out,version+'-'+theme+'-1280.png')});
   }
   await page.locator('#demo-theme').selectOption('paper');
   if(version==='b'){
    await page.locator('.library-row').first().click();await page.locator('.drawer').waitFor();await page.screenshot({path:path.join(out,'b-item-drawer.png')});await page.locator('[data-action="close-drawer"]').click();
    await page.locator('[data-action="practice-modal"]').first().click();
   }else await page.locator('[data-view="practice"]').click();
   await page.locator('[data-mode="listening"]').click();await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();
   await page.locator('.picker-list .library-row').nth(0).click();await page.locator('.picker-list .library-row').nth(2).click();assert.equal(await page.locator('#picker-count').innerText(),'2 selected');
   await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();assert.equal(await page.locator('.session-progress span').innerText(),'1 of 2');
   assert.equal(await page.locator('#demo-solution').isVisible(),false);await page.locator('#listening-answer').fill('sore wa totemo ii hanashi da');await page.locator('#demo-answer .primary').click();assert.equal(await page.locator('#demo-feedback').innerText(),'Correct');assert.equal(await page.locator('#demo-solution').isVisible(),true);await page.locator('[data-action="next-question"]').click();assert.equal(await page.locator('.session-progress span').innerText(),'2 of 2');await page.locator('[data-action="end-session"]').click();assert.equal(await page.locator('.session-screen').count(),0);
   await page.locator(`[data-version="${version}"]`).click();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile horizontal overflow');await page.screenshot({path:path.join(out,version+'-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});
  }
  await page.locator('[data-version="a"]').click();await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="cloze"]').click();await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row').first().click();await page.locator('[data-action="close-picker"]').click();await page.locator('#demo-gap-position').selectOption('first');await page.locator('[data-action="start"]').click();
  assert.match(await page.locator('.session-word').innerText(),/^\s*_____\s*は/);await page.locator('#listening-answer').fill('sore wa totemo ii hanashi da');await page.locator('#demo-answer .primary').click();assert.equal(await page.locator('#demo-feedback').innerText(),'Incorrect');assert.equal(await page.locator('#demo-solution').isVisible(),false);await page.locator('#listening-answer').fill('sore');await page.locator('#demo-answer .primary').click();assert.equal(await page.locator('#demo-feedback').innerText(),'Correct');await page.locator('[data-action="end-session"]').click();
  await page.locator('#demo-theme').focus();assert.match(await page.locator('#demo-theme').evaluate(n=>getComputedStyle(n).boxShadow),/inset/);await page.locator('#demo-theme').selectOption('midnight');assert.equal(await page.locator('#demo-theme').evaluate(n=>getComputedStyle(n).boxShadow),'none');
  assert.deepEqual(errors,[]);console.log('PASS Three isolated layouts: four themes, desktop fit, mobile overflow, drawer, exact picker selection, production Listening/Cloze checking, keyboard/mouse theme focus and explicit exit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
