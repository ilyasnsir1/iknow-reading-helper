/* Capture intended release illustrations from isolated public-text fixtures. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const{chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../changelog-review-media'));
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.addInitScript(()=>localStorage.setItem('ikr-layout-review:theme','midnight'));
  await page.goto('http://127.0.0.1:52332/study-focus.html#study');await page.locator('.focus-card').waitFor();
  await page.locator('.library-row[data-item^="sentence:"]').first().click();await page.locator('[data-action="reveal-reading"]').click();
  await page.screenshot({path:path.join(output,'study-workspace.png')});
  await page.locator('[data-view="kana"]').click();await page.locator('[data-kana-root]').waitFor();
  const all=page.locator('[data-kana-action="all-groups"]');if(await all.textContent()==='All groups')await all.click();
  await page.screenshot({path:path.join(output,'kana-learning.png')});
  if(errors.length)throw Error(errors.join('\n'));
  for(const name of ['study-workspace.png','kana-learning.png']){const size=fs.statSync(path.join(output,name)).size;if(size>600*1024)throw Error('Screenshot is too large: '+name);process.stdout.write(name+' '+size+' bytes\n');}
 }finally{await browser.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
