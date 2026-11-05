'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async()=>{
 const source=path.resolve(__dirname,'../extension'),browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  for(const dpr of [1,1.25,1.5,2]){
   const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:dpr});
   await page.route('http://spinner.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);if(!name)return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'});if(!/^[a-z-]+\.css$/.test(name))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(source,name))});});
   await page.goto('http://spinner.test/');
   await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><link rel="stylesheet" href="http://spinner.test/theme.css"><link rel="stylesheet" href="http://spinner.test/study-focus.css"></head><body><div class="course-feedback" data-state="loading"><p>Loading course</p></div><button class="audio-mini" data-audio-loading="true"><span data-play-text>Listen with Mao Plain</span><span data-play-status><span class="audio-loading-spinner"></span>Loading</span></button><div class="noji-writing-tools"><button class="card-writing-button" data-card-writing="romaji" aria-busy="true">Loading</button></div></body></html>');
   await page.locator('.audio-loading-spinner').waitFor();
   for(const theme of ['paper','midnight','tokyo','forest']){
    await page.evaluate(theme=>document.documentElement.dataset.ikrTheme=theme,theme);
    const metrics=await page.evaluate(()=>{
     const pick=(node,pseudo)=>{const style=getComputedStyle(node,pseudo);return{width:style.width,height:style.height,box:style.boxSizing,radius:style.borderRadius,top:style.borderTopColor,right:style.borderRightColor,stroke:style.borderTopWidth,animation:style.animationName,speed:style.animationDuration,aspect:style.aspectRatio};};
     return{course:pick(document.querySelector('.course-feedback p'),'::before'),audio:pick(document.querySelector('.audio-loading-spinner')),romaji:pick(document.querySelector('.card-writing-button'),'::before')};
    });
    assert.deepEqual(metrics.romaji,metrics.course,`${theme}/DPR${dpr}: Romaji uses the course ring`);assert.deepEqual(metrics.audio,metrics.course,`${theme}/DPR${dpr}: audio uses the course ring`);assert.equal(metrics.audio.width,'16px');assert.equal(metrics.audio.height,'16px');assert.equal(metrics.audio.box,'border-box');assert.equal(metrics.audio.radius,'50%');assert.equal(metrics.audio.aspect,'1 / 1');assert.equal(metrics.audio.animation,'course-loading-turn');assert.equal(metrics.audio.speed,'0.85s');assert.notEqual(metrics.audio.top,metrics.audio.right);
   }
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.audio-loading-spinner').evaluate(node=>getComputedStyle(node).animationName),'none');await page.close();
  }
  console.log('PASS Identical round course/audio/Romaji loading rings across4themes and4DPR, fixed16pxsquare geometry, matching stroke/colors/speed and reduced motion.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
