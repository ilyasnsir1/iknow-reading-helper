/* Library filter labels fit their compact controls in every shared palette. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-focus-select-fit-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:52332/study-focus.html?review=filter-fit');await page.locator('.focus-card').waitFor();
  // Read the canonical source even when another task has not restaged yet.
  await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'study-focus.css'),'utf8').replace(/^@import[^;]+;/,'')});
  const metrics=[];
  for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const theme of ['paper','midnight','tokyo','forest']){
    await page.evaluate(value=>document.documentElement.dataset.ikrTheme=value,theme);
    for(const [id,value] of [['demo-course',''],['demo-kind',''],['demo-kind','sentence']]){
     const box=await page.locator('#'+id).evaluate((node,value)=>{
      node.value=value;
      const style=getComputedStyle(node),context=document.createElement('canvas').getContext('2d');context.font=style.font;
      const label=node.selectedOptions[0].textContent;
      const textWidth=context.measureText(label).width,available=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
      const rect=node.getBoundingClientRect(),parent=node.closest('.library-filters').getBoundingClientRect();
      return{label,textWidth,available,left:rect.left,right:rect.right,parentLeft:parent.left,parentRight:parent.right,height:rect.height,textOverflow:style.textOverflow,appearance:style.appearance,chevron:style.backgroundImage};
     },value);
     assert.ok(box.available>=box.textWidth+2,`${viewport.width}/${theme}/${box.label}: label fits with room before arrow (${JSON.stringify(box)})`);
     assert.ok(box.left>=box.parentLeft&&box.right<=box.parentRight+1,'Filter stays within the library');
     assert.ok(box.height<=39,'Controls remain compact');assert.equal(box.textOverflow,'ellipsis');
     assert.equal(box.appearance,'none','A native arrow must not reserve extra invisible text inset');assert.notEqual(box.chevron,'none','The compact custom chevron remains visible');
     metrics.push({viewport,theme,id,...box});
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
    if(theme==='paper'||theme==='midnight')await page.screenshot({path:path.join(out,`${theme}-${viewport.width}.png`),fullPage:viewport.width===390});
   }
  }
  await page.locator('#demo-course').evaluate(node=>{const option=document.createElement('option');option.value='long-example';option.textContent='[Legacy] Japanese Core 2000: Step 4 with a deliberately long course title';node.append(option);node.value=option.value;});
  assert.equal(await page.locator('#demo-course').evaluate(node=>getComputedStyle(node).textOverflow),'ellipsis','Long course titles use a clear ellipsis');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,metrics},null,2));
  console.log('PASS Compact course/type filter labels fit at 1280,1440,1024 and390 pixels across four themes; long titles ellipsize without widening the library');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
