/* Chosen C1 workspace, no extension registration or personal data. */
"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-focus-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const themeChoice=async value=>{await page.locator('#focus-theme-trigger').click();const menu=await page.locator('#focus-theme-list').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=page.viewportSize().width,'Theme list fits the page');const colors=await page.locator('#focus-theme-list').evaluate(n=>{const expected=document.createElement('i');expected.style.background='var(--ikr-elevated)';document.body.append(expected);const result={actual:getComputedStyle(n).backgroundColor,expected:getComputedStyle(expected).backgroundColor};expected.remove();return result;});assert.equal(colors.actual,colors.expected,'Theme menu uses the current page palette');await page.locator('.focus-menu-theme [data-menu-value="'+value+'"]').click();await page.waitForFunction(value=>document.documentElement.dataset.ikrTheme===value,value);assert.equal(await page.locator('#focus-theme-trigger').getAttribute('aria-expanded'),'false');};
  for(const variant of ['docked']){
   await page.goto('http://127.0.0.1:52332/study-focus.html?variant='+variant);await page.locator('#focus-library').waitFor();
   assert.equal(await page.locator('.focus-rail button').allTextContents().then(a=>a.map(x=>x.trim()).join(',')),'Study,Practice,Test,Kana,Library');
   assert.equal(await page.locator('button[data-focus-variant]').count(),0,'Retired variants are absent');
   assert.equal(await page.locator('[data-action="browse"]').count(),1,'Only the Library rail button toggles the saved list');
   assert.equal(await page.locator('#demo-theme,#demo-language').count(),0,'Header choices never use native dropdowns');
   assert.ok((await page.locator('#focus-language-trigger').boundingBox()).width<=92,'The language control is compact');assert.ok((await page.locator('#focus-theme-trigger').boundingBox()).width<=136,'Theme control stays compact');
   const rects=[];
   for(const theme of ['paper','midnight','tokyo','forest']){
    await themeChoice(theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
    const card=await page.locator('.focus-card').boundingBox(),main=await page.locator('.focus-main').boundingBox();assert.ok(card.y>=main.y-1&&card.y+card.height<=main.y+main.height+1,variant+' initial card is fully visible');
    const footer=await page.locator('.focus-bottom').boundingBox(),previous=await page.locator('[data-action="previous"]').boundingBox(),next=await page.locator('[data-action="next"]').boundingBox(),practice=await page.locator('.focus-bottom [data-action="practise-item"]').boundingBox();
    assert.ok(previous.x-footer.x<45,'Previous starts at the footer left');assert.ok(next.x>previous.x,'Next stays with Previous');assert.ok(footer.x+footer.width-practice.x-practice.width<45,'Practice stays at the footer right');assert.ok(practice.x>next.x+next.width+50,'The footer separates navigation and practice');
    rects.push(await page.locator('.app-frame').evaluate(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
    if(theme==='paper'||theme==='midnight')await page.screenshot({path:path.join(out,variant+'-'+theme+'-1280.png')});
   }
   assert.ok(rects.every(r=>JSON.stringify(r)===JSON.stringify(rects[0])),'Themes keep identical geometry');
   await themeChoice('paper');
   await page.locator('#demo-search').fill('sore');assert.equal(await page.locator('#demo-library-list .library-row').count(),2);
   const keys=await page.locator('#demo-library-list .library-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.item));
   for(let i=0;i<2;i++){await page.locator('#demo-library-list .library-row').nth(i).click();assert.equal(await page.locator('#focus-library').isVisible(),true);assert.equal(await page.locator('#demo-library-list .library-row[aria-current=true]').getAttribute('data-item'),keys[i]);assert.equal(await page.locator('#demo-search').inputValue(),'sore');}
   await page.locator('[data-action="next"]').click();assert.equal(await page.locator('#demo-library-list .library-row[aria-current=true]').getAttribute('data-item'),keys[0]);
   await page.locator('[data-action="previous"]').click();assert.equal(await page.locator('#demo-library-list .library-row[aria-current=true]').getAttribute('data-item'),keys[1]);
   const current=await page.locator('.focus-card .japanese').innerText();await page.locator('#demo-search').fill('nothing matches here');assert.equal(await page.locator('.focus-card .japanese').innerText(),current);assert.equal(await page.locator('[data-action="next"]').isDisabled(),true);
   await page.locator('#demo-search').fill('');await page.locator('#demo-kind').selectOption('word');assert.equal(await page.locator('#demo-library-list .library-row').count(),9);await page.locator('#demo-kind').selectOption('');
   const scroll=await page.locator('#demo-library-list').evaluate(n=>{n.scrollTop=75;n.scrollLeft=75;return{top:n.scrollTop,left:n.scrollLeft};});
   await page.locator('.romaji [data-reading]').first().click();const token=await page.locator('.romaji [data-reading]').first().innerText();assert.notEqual(token,'•••');
   await page.locator('.focus-rail [data-action="browse"]').click();assert.equal(await page.locator('#focus-library').count(),0);assert.equal(await page.locator('.focus-rail [data-action="browse"]').getAttribute('aria-expanded'),'false');await page.locator('.focus-rail [data-action="browse"]').click();
   assert.deepEqual(await page.locator('#demo-library-list').evaluate(n=>({top:n.scrollTop,left:n.scrollLeft})),scroll);assert.equal(await page.locator('.focus-card .japanese').innerText(),current);
   assert.equal(await page.locator('.romaji [data-reading]').first().innerText(),token);
   await page.locator('[data-view="practice"]').click();await page.locator('[data-view="study"]').click();assert.equal(await page.locator('#focus-library').isVisible(),true);assert.equal(await page.locator('.focus-card .japanese').innerText(),current);
   assert.equal(await page.locator('.romaji [data-reading]').first().innerText(),token);
   await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,variant+'-paper-1440.png')});
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok((await page.locator('#focus-language-trigger').boundingBox()).width<=92);assert.ok((await page.locator('#focus-theme-trigger').boundingBox()).width<=136);await page.locator('#focus-theme-trigger').click();const menu=await page.locator('#focus-theme-list').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=390,'Theme list stays inside mobile viewport');await page.locator('#focus-theme-trigger').click();await page.locator('#demo-library-list .library-row').nth(1).click();assert.equal(await page.locator('#focus-library').isVisible(),true);await page.screenshot({path:path.join(out,variant+'-mobile.png'),fullPage:true});
   await page.setViewportSize({width:1280,height:720});
  }
  await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="listening"]').click();await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row').nth(0).click();await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();await page.locator('.session-screen').waitFor();
  assert.equal(await page.locator('.focus-body').evaluate(n=>n.inert),true);assert.equal(await page.locator('#focus-language-trigger').isDisabled(),true);assert.equal(await page.locator('#focus-theme-trigger').isDisabled(),false);await page.locator('.focus-rail [data-action="browse"]').evaluate(n=>n.click());assert.equal(await page.locator('.session-screen').isVisible(),true);await page.locator('[data-action="end-session"]').click();await page.locator('.focus-results').waitFor();assert.equal(await page.locator('.focus-body').evaluate(n=>n.inert),true,'Results stay open before returning');await page.locator('[data-action="result-back-study"]').click();assert.equal(await page.locator('.focus-body').evaluate(n=>n.inert),false);assert.equal(await page.locator('#focus-language-trigger').isDisabled(),false);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,scope:'C1 only, distributed footer, four-theme geometry, selection/search/filter persistence, filtered Previous/Next, collapse/restore, activity return, session concealment and mobile'},null,2));
  console.log('PASS C1: persistent library, distributed footer, filtered navigation, matching four-theme geometry, desktop/mobile fit and explicit session exit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
