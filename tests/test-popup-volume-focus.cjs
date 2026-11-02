'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),extension=path.join(root,'extension'),origin='http://127.0.0.1:53982';
const evidence=path.resolve(root,'../../outputs/popup-volume-focus-qa');fs.mkdirSync(evidence,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version;
const baseline=process.argv.includes('--baseline');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const report=[];
 try{
  for(const theme of ['paper','midnight','tokyo','forest']){
   const context=await browser.newContext({viewport:{width:376,height:600}});
   await context.addInitScript(({theme,version})=>{
    const values={iknowReaderTheme:theme,iknowReaderSettings:{enabled:true}},listeners=new Set();
    localStorage.setItem('iknowReaderTheme',theme);
    globalThis.chrome={runtime:{getManifest:()=>({version}),getURL:value=>new URL(value,location.href).href,sendMessage:async()=>({ok:true,state:{status:'current',message:'You are up to date.'}})},storage:{local:{get:async key=>typeof key==='string'?{[key]:values[key]}:{...values},set:async input=>{const changes={};for(const[key,value]of Object.entries(input)){changes[key]={oldValue:values[key],newValue:value};values[key]=value;}for(const callback of listeners)callback(changes,'local');}},onChanged:{addListener:value=>listeners.add(value),removeListener:value=>listeners.delete(value)}},tabs:{query:async()=>[]}};
   },{theme,version});
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
    const file=path.resolve(extension,decodeURIComponent(url.pathname.slice(1)));
    if(!file.startsWith(extension+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({contentType:type+'; charset=utf-8',body:fs.readFileSync(file)});
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/popup.html');
   const range=page.locator('[data-audio-volume=original]');await range.waitFor({state:'visible'});
   await page.locator('#reading-settings:not([disabled])').waitFor();
   await range.scrollIntoViewIfNeeded();
   const measure=()=>range.evaluate(input=>{const css=getComputedStyle(input);return {value:Number(input.value),outline:css.outlineStyle,outlineWidth:css.outlineWidth,shadow:css.boxShadow,keyboard:input.matches(':focus-visible'),modality:document.body.dataset.focusMode};});
   const box=await range.boundingBox();
   await range.click({position:{x:box.width*.35,y:box.height/2}});
   const pointer=await measure();
   if(!baseline){assert.equal(pointer.outline,'none',theme+' pointer outline');assert.equal(pointer.shadow,'none',theme+' pointer shadow');}
   await page.screenshot({path:path.join(evidence,(baseline?'before-':'after-')+theme+'-pointer.png')});
   const thumb=await range.boundingBox();
   await page.mouse.move(thumb.x+thumb.width*pointer.value/100,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(thumb.x+thumb.width*.72,thumb.y+thumb.height/2,{steps:8});await page.mouse.up();
   const drag=await measure();
   assert.ok(drag.value>pointer.value,theme+' drag changes volume');
   if(!baseline){assert.equal(drag.outline,'none',theme+' drag outline');assert.equal(drag.shadow,'none',theme+' drag shadow');}
   await page.locator('#wordAudioSpeed').focus();await page.keyboard.press('Tab');
   assert.equal(await range.evaluate(input=>document.activeElement===input),true,theme+' keyboard reaches slider');
   const old=Number(await range.inputValue());await page.keyboard.press('ArrowLeft');const keyboard=await measure();
   assert.equal(keyboard.value,old-1,theme+' keyboard changes volume');
   assert.equal(keyboard.modality,'keyboard');assert.equal(keyboard.keyboard,true);
   assert.ok(keyboard.outline!=='none'||keyboard.shadow!=='none',theme+' visible keyboard focus');
   await page.screenshot({path:path.join(evidence,(baseline?'before-':'after-')+theme+'-keyboard.png')});
   assert.deepEqual(errors,[]);report.push({theme,pointer,drag,keyboard});await context.close();
  }
  fs.writeFileSync(path.join(evidence,baseline?'before.json':'after.json'),JSON.stringify({passed:true,baseline,report},null,2));
  console.log(JSON.stringify({passed:true,baseline,themes:report.length,pointerShadows:report.map(row=>({theme:row.theme,shadow:row.pointer.shadow,keyboard:row.keyboard.shadow}))}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
