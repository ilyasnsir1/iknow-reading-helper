/* Practice settings occupy their row and keep Kana's transparent arrow hover. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const source=path.resolve(__dirname,'../tools/preview'),out=path.join(__dirname,'study-stepper-layout-evidence');
fs.mkdirSync(out,{recursive:true});
const themes=['paper','midnight','tokyo','forest'];
const geometry=node=>{const row=node.getBoundingClientRect();return{left:row.left,right:row.right,width:row.width,top:row.top,children:[...node.querySelectorAll('.focus-choice-stepper')].map(child=>{const rect=child.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width,top:rect.top,bottom:rect.bottom};})};};
const paint=node=>{const css=getComputedStyle(node);return{background:css.backgroundColor,color:css.color,border:css.borderColor,transform:css.transform};};
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const file of ['study-focus.css','study-focus.js','study-focus-kana.css'])await page.route('**/'+file,route=>route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/css',body:fs.readFileSync(path.join(source,file),'utf8')}));
  await page.goto('http://127.0.0.1:52332/study-focus.html?review=stepper-layout#practice');await page.locator('.mode-grid').waitFor();
  const row=page.locator('.activity-inner>.setup-fields');
  for(const theme of themes){
   await page.evaluate(theme=>{document.documentElement.dataset.ikrTheme=theme;},theme);
   for(const [mode,count] of [['review',2],['cloze',3],['listening',2]]){
    await page.locator(`[data-mode="${mode}"]`).click();
    const layout=await row.evaluate(geometry),modes=await page.locator('.mode-grid').boundingBox();
    assert.equal(layout.children.length,count);
    assert.ok(Math.abs(layout.left-modes.x)<1&&Math.abs(layout.right-(modes.x+modes.width))<1,'Settings align with the full mode row');
    assert.ok(layout.children.every(child=>Math.abs(child.width-layout.children[0].width)<1),'Settings share their row evenly');
    assert.ok(Math.abs(layout.children[0].left-layout.left)<1&&Math.abs(layout.children.at(-1).right-layout.right)<1,'No unused width beside the settings');
    const arrow=row.locator('[data-choice-step="next"]').first();await page.mouse.move(0,0);const before=await arrow.evaluate(paint);await arrow.hover();assert.deepEqual(await arrow.evaluate(paint),before,'Enabled arrow hover adds no background or color effect');
    await arrow.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await arrow.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')),true);assert.notEqual(await arrow.evaluate(node=>getComputedStyle(node).boxShadow),'none','Keyboard focus remains visible');
    await page.mouse.click(0,0);
    if(mode==='review'||mode==='cloze')await page.screenshot({path:path.join(out,`${mode}-${theme}.png`)});
   }
   await page.locator('.focus-rail [data-view="kana"]').click();const kanaArrow=page.locator('[data-kana-order-step="next"]');await page.mouse.move(0,0);const kanaBefore=await kanaArrow.evaluate(paint);await kanaArrow.hover();assert.deepEqual(await kanaArrow.evaluate(paint),kanaBefore,'Kana hover remains unchanged');
   await page.locator('.focus-rail [data-view="practice"]').click();
  }
  for(const width of [900,640,390]){
   await page.setViewportSize({width,height:900});
   for(const mode of ['review','cloze']){
    await page.locator(`[data-mode="${mode}"]`).click();const controls=await row.evaluate(geometry);
    assert.ok(controls.children.every(child=>child.left>=0&&child.right<=width),'All controls remain inside the viewport');
    assert.ok(await row.locator('output').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth)),'Responsive labels remain readable');
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS Stepper layout: full-width equal Practice columns, transparent Kana-style hover, keyboard focus and readable narrow layouts in four themes.');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
