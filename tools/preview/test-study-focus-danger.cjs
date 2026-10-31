/* Danger colors are palette-aware and disabled controls never react to hover. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-focus-danger-evidence');fs.mkdirSync(out,{recursive:true});
const stylesheet=fs.readFileSync(path.join(__dirname,'study-focus-danger.css'),'utf8');
const metrics=async locator=>locator.evaluate(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return{color:s.color,background:s.backgroundColor,border:s.borderColor,radius:s.borderRadius,width:r.width,height:r.height,transition:s.transitionDuration,animation:s.animationName};});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:52332/study-focus.html?review=danger-controls');await page.locator('.focus-card').waitFor();
  await page.addStyleTag({content:stylesheet});await page.locator('[data-view="kana"]').click();await page.locator('[data-kana-root]').waitFor();
  await page.evaluate(()=>{
   const fixture=document.createElement('div');fixture.id='danger-fixture';fixture.className='picker-actions';fixture.style.cssText='position:fixed;left:12px;top:12px;z-index:5000;display:flex;gap:6px;flex-wrap:wrap;padding:8px;max-width:calc(100vw - 24px);background:var(--study-sheet);border:1px solid var(--ikr-line);';
   fixture.innerHTML='<button class="quiet" data-action="clear-selection">Clear</button><button class="quiet" data-action="delete">Delete</button><button data-action="delete-all">Delete all</button><button class="danger">Delete entry</button><button class="quiet" data-action="close-overlay">Cancel</button><span id="danger-color-reference" style="color:var(--ikr-danger)"></span>';
   fixture.addEventListener('click',event=>event.stopPropagation());document.body.append(fixture);
  });
  const controls=['[data-kana-action="clear"]','#danger-fixture [data-action="clear-selection"]','#danger-fixture [data-action="delete"]','#danger-fixture [data-action="delete-all"]','#danger-fixture .danger'];
  const evidence=[];
  for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const theme of ['paper','midnight','tokyo','forest']){
    await page.evaluate(value=>document.documentElement.dataset.ikrTheme=value,theme);await page.mouse.move(0,0);
    const expected=await page.locator('#danger-color-reference').evaluate(node=>getComputedStyle(node).color);
    for(const selector of controls){
     const control=page.locator(selector);await control.evaluate(node=>node.disabled=false);await control.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(170);
     const normal=await metrics(control);assert.equal(normal.color,expected,`${theme}: Clear/Delete is red before hovering`);assert.equal(normal.background,'rgba(0, 0, 0, 0)');assert.equal(normal.radius,'4px');
     await control.hover();await page.waitForTimeout(170);const hovered=await metrics(control);assert.equal(hovered.color,expected);assert.notEqual(hovered.background,normal.background,'Enabled hover has a subtle danger tint');assert.equal(hovered.width,normal.width);assert.equal(hovered.height,normal.height);
     await control.evaluate(node=>node.disabled=true);const disabledUnderPointer=await metrics(control);await page.mouse.move(0,0);const disabledAway=await metrics(control);await control.hover();const disabledAgain=await metrics(control);
     assert.equal(disabledUnderPointer.color,expected);assert.equal(disabledUnderPointer.background,'rgba(0, 0, 0, 0)');assert.equal(disabledUnderPointer.transition,'0s');assert.equal(disabledUnderPointer.animation,'none');
     for(const field of ['color','background','border','width','height'])assert.equal(disabledAgain[field],disabledAway[field],`Disabled ${field} never changes on hover`);
     await control.evaluate(node=>node.disabled=false);evidence.push({viewport,theme,selector,normal,hovered,disabled:disabledAgain});
    }
    assert.notEqual(await page.locator('#danger-fixture [data-action="close-overlay"]').evaluate(node=>getComputedStyle(node).color),expected,'Cancel is not styled as destructive');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
   }
  }
  await page.locator('#danger-fixture').evaluate(node=>node.remove());await page.setViewportSize({width:1280,height:720});await page.mouse.move(0,0);
  await page.screenshot({path:path.join(out,'kana-clear-red.png')});
  await page.locator('[data-kana-action="clear"]').click();assert.equal(await page.locator('[data-kana-action="clear"]').isDisabled(),true,'Real Clear disables when the selection is empty');
  await page.locator('[data-kana-action="select-all"]').click();assert.equal(await page.locator('[data-kana-action="clear"]').isEnabled(),true);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,evidence},null,2));
  console.log('PASS Clear/Delete red before hover across four themes and three viewport sizes; compact geometry, enabled hover tint, disabled no hover/animation, Cancel unchanged and real Kana clear/select behavior');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
