'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-preview-actions-evidence');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:52332';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const errors=[],requests=[],observations=[];
 try{
  for(const [index,theme]of ['paper','midnight','tokyo','forest'].entries()){
   const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'no-preference'});
   await context.addInitScript(theme=>{try{if(!localStorage.getItem('ikr-layout-review:theme'))localStorage.setItem('ikr-layout-review:theme',theme);}catch{}},theme);
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
   await page.goto(origin+'/study-focus.html?review=preview-actions#study');await page.locator('.focus-card').waitFor();
   assert.equal(await page.locator('#demo-library-list .library-row').count(),18,'A fresh localhost context uses only the demo library');
   assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),theme);
   const order=index%2?['compare','note']:['note','compare'];
   for(const action of order){
    await page.locator(`[data-action="${action}"]`).click();
    if(action==='note')assert.ok(await page.locator('#focus-note').evaluate(node=>node.getAnimations().length>0),'Opening Note uses the requested expansion animation');
   }
   await page.locator('.focus-expansions[data-count="2"]').waitFor();await page.waitForTimeout(300);
   assert.deepEqual(await page.locator('.focus-panel-grid>[data-study-panel]:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.studyPanel)),order,'Panels follow the order in which they were opened');
   assert.equal(await page.locator('[data-compare-action="original"]').count(),0,'Comparison does not duplicate the original recording button');
   const note=`A saved preview note (${theme}).`;
   await page.locator('#focus-note-input').fill(note);await page.locator('[data-action="save-note"]').click();await page.locator('#focus-note[data-note-state="read"]').waitFor();
   assert.equal(await page.locator('.focus-note-text').innerText(),note);
   assert.equal(await page.locator('#focus-compare').isVisible(),true,'Saving a note does not close comparison');
   const geometry=await page.locator('.focus-main').evaluate(node=>{const tools=node.querySelector('.practice-tools').getBoundingClientRect(),panels=[...node.querySelectorAll('[data-study-panel]:not([hidden])')].map(panel=>panel.getBoundingClientRect().top);return{scroll:node.scrollHeight-node.clientHeight,toolsBottom:tools.bottom,panelsTop:Math.min(...panels)};});
   assert.ok(geometry.scroll<=1,`${theme}: both panels fit the desktop workspace`);assert.ok(geometry.toolsBottom<geometry.panelsTop,'One fixed audio row stays above the expansions');
   observations.push({theme,order,geometry});await page.screenshot({path:path.join(out,theme+'-expanded.png')});
   await page.reload();await page.locator('.focus-note-text').waitFor();assert.equal(await page.locator('.focus-note-text').innerText(),note,'The note returns from this context’s local preview snapshot');
   assert.equal(await page.locator('#demo-library-list .library-row').count(),18);
   await page.locator('[data-action="delete-all"]').click();await page.getByRole('dialog').waitFor();
   assert.equal(await page.locator('#focus-workspace-action-title').innerText(),'Delete all saved items?');
   assert.equal(await page.locator('[data-workspace-action="confirm"]').innerText(),'Delete all');
   assert.equal(await page.locator('footer [data-workspace-action="close"]').evaluate(node=>node===document.activeElement),true,'Confirmation initially focuses Cancel');
   assert.equal(await page.locator('[data-workspace-action="confirm"]').evaluate(node=>{const swatch=document.createElement('span');swatch.style.color='var(--ikr-danger)';node.append(swatch);const color=getComputedStyle(swatch).color;swatch.remove();return getComputedStyle(node).color===color;}),true,'Delete all confirmation uses the theme danger color');
   await page.locator('footer [data-workspace-action="close"]').click();assert.equal(await page.locator('#demo-library-list .library-row').count(),18,'Cancel keeps all demo entries');assert.equal(await page.locator('.focus-note-text').innerText(),note);
   await page.locator('[data-action="delete-all"]').click();await page.locator('[data-workspace-action="confirm"]').click();await page.locator('.focus-empty').waitFor();
   assert.equal(await page.locator('#demo-library-list .library-row').count(),0);await page.reload();await page.locator('.focus-empty').waitFor();assert.equal(await page.locator('#demo-library-list .library-row').count(),0,'An intentionally empty local preview library remains empty');
   await context.close();
  }
  assert.deepEqual(errors,[]);assert.ok(requests.every(request=>new URL(request.url).origin===origin&&request.method==='GET'),'All requests stay on the local preview; note/deletion writes stay in disposable browser storage');
  fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(observations,null,2)+'\n');
  console.log('PASS Localhost controls: fresh demo18, animated notes, saved/reloaded text, both panel orders without desktop scroll, one Original control, Delete all cancel/confirm/empty refresh in four themes; no personal data or uploads');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
