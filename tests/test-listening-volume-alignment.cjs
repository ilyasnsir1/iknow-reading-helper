/* Listening volume has a deliberate optical lift and a roomy, stable hover box. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'listening-volume-alignment-evidence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 try{
  await page.route('http://listening.invalid/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);const folder=['theme.css','audio-volume-controls.css','audio-volume-controls.js','core.js'].includes(name)?'extension':'tools/preview';return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':'text/css',body:fs.readFileSync(path.join(root,folder,name),'utf8')});});
  await page.goto('about:blank');
  await page.setContent('<html class="ikr-theme-page" data-ikr-theme="paper"><head><link rel="stylesheet" href="http://listening.invalid/theme.css"><link rel="stylesheet" href="http://listening.invalid/study-focus.css"><link rel="stylesheet" href="http://listening.invalid/audio-volume-controls.css"><style>.app-frame{display:block!important;overflow:visible}.focus-desk{height:auto}.session-screen{position:static;min-height:300px}.session-content{overflow:visible}</style></head><body><main id="demo" data-layout="c"><div class="app-frame"><div class="focus-desk"><section class="session-screen"><div class="session-content"><div class="audio-player"><div class="audio-top"><span>Play audio</span></div><div class="audio-meta"><progress max="1" value="0"></progress><span id="demo-audio-time">0:00</span><button class="ikr-volume-trigger"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m9 4-4 3H2v6h3l4 3V4Zm4 3a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></svg><span>Volume</span></button></div></div></div></section></div></div></main></body></html>');
  await page.locator('.audio-player').waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const theme of ['paper','midnight','tokyo','forest'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.ikrTheme=theme,theme);await page.mouse.move(0,0);const before=await page.locator('.ikr-volume-trigger').boundingBox();await page.locator('.ikr-volume-trigger').hover();
   const layout=await page.evaluate(()=>{const timer=document.getElementById('demo-audio-time'),button=document.querySelector('.ikr-volume-trigger'),label=button.querySelector('span'),box=button.getBoundingClientRect(),css=getComputedStyle(button);const glyph=node=>{const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return rect.y+rect.height/2;};return{timer:glyph(timer),label:glyph(label),buttonCenter:box.y+box.height/2,timerCenter:timer.getBoundingClientRect().y+timer.getBoundingClientRect().height/2,height:box.height,paddingLeft:parseFloat(css.paddingLeft),paddingRight:parseFloat(css.paddingRight),right:box.right,viewport:innerWidth};});
   assert.ok(Math.abs(layout.timer-layout.label-1)<.6,`${theme}/${width}: intended 1px text lift ${JSON.stringify(layout)}`);assert.ok(Math.abs(layout.timerCenter-layout.buttonCenter-1)<.6);assert.ok(layout.height>=34&&layout.paddingLeft>=11&&layout.paddingRight>=11);assert.ok(layout.right<=layout.viewport);const after=await page.locator('.ikr-volume-trigger').boundingBox();assert.deepEqual(after,before,'Hover keeps the lifted target still');
   if(theme==='midnight'&&width===1440)await page.locator('.audio-player').screenshot({path:path.join(out,'listening-volume.png')});
  }
  console.log('PASS Listening volume: 1px optical lift, stable 34px hover target with comfortable padding, four themes and 390px fit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
