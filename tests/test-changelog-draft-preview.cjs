/* The Changelog shows its intended publication layout without publishing. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'changelog-preview-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 try{
  await page.goto('http://127.0.0.1:52332/extension/changelog.html#study-refinements');
  const release=page.locator('#study-refinements');await release.locator('.change').last().waitFor();
  assert.equal(await release.locator('.change').count(),2,'Personal learning levels debut beside improvements to the existing Study details');
  assert.equal(await page.locator('.release-entry').count(),4,'The public history is retained beside the intended release');
  assert.equal(await release.locator('.release-status').innerText(),'Released');
  assert.equal(await release.locator('.release-version').innerText(),'Version 1.41.1');
  assert.equal(await release.locator('.release-date').getAttribute('datetime'),'2026-11-01');
  assert.equal(await page.locator('#changelog-installed').innerText(),'Installed · 1.41.1');
  assert.deepEqual(await release.locator('.change-type').allTextContents(),['Added','Improved']);
  assert.deepEqual(await release.locator('.change h3').allTextContents(),['Personal learning levels','Study details']);
  const personal=release.locator('.change').first();
  assert.match(await personal.innerText(),/Right-click a saved word or sentence to set its learning level\./);
  assert.deepEqual(await personal.locator('.change-details li').allTextContents(),['Choose New, Weak, Learning or Strong.','Choose Automatic to use your practice results again.']);
  assert.equal(await page.locator('#new-study-space .change').first().locator('.change-details li').count(),6,'The earlier workspace introduction remains grouped in its original entry');
  assert.doesNotMatch(await page.locator('body').innerText(),/Preview|Next update|Local preview|\bdemo\b/i,'Display exactly the intended release layout');
  assert.equal(await release.locator('.changelog-image-button').count(),1,'Personal learning levels have one clear screenshot');
  for(const button of await release.locator('.changelog-image-button').all()){
   await button.click();await page.locator('#changelog-image-dialog[open]').waitFor();await page.waitForFunction(()=>document.getElementById('changelog-image-full').naturalWidth>0);await page.locator('#changelog-image-close').click();
  }
  assert.equal(await page.locator('#edit-changelog').isHidden(),true,'The web review is read-only');
  assert.equal(await page.evaluate(()=>Boolean(globalThis.chrome?.runtime?.sendMessage)),false,'The web review has no native author connection');
  await page.locator('.ikr-theme-trigger').scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.locator('.ikr-theme-trigger').click();
   assert.equal(await page.locator('.ikr-theme-options .ikr-theme-swatch').count(),4);
   await page.locator(`[data-theme-value="${theme}"]`).click();
   await page.waitForFunction(value=>document.documentElement.dataset.ikrTheme===value,theme);
   await page.locator('.ikr-theme-trigger').click();
   assert.equal(await page.locator(`[data-theme-value="${theme}"] .ikr-theme-check`).evaluate(node=>getComputedStyle(node).opacity),'1');
   await page.locator('.ikr-theme-trigger').click();
  }
  await page.locator('.ikr-theme-trigger').click();await page.locator('[data-theme-value="midnight"]').click();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'changelog-midnight.png')});
  await page.locator('.ikr-page-actions a').click();await page.locator('.focus-card').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),'midnight','The web review pages share the app-theme preview preference');
  assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:52332/')),'The review does not contact a publisher or upload anything');
  assert.deepEqual(errors,[]);
  console.log('PASS Final 1.41.1 Changelog: Added personal learning levels, Improved Study details, retained four-release history, intended version/date and one enlargable screenshot; no Preview/demo badges; read-only isolation and four-theme controls');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
