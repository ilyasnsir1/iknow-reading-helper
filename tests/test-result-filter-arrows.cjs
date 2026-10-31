/* Results use visible arrow controls and no native vocabulary hover tooltip. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),source=path.join(root,'tools/preview'),Results=require(path.join(source,'study-focus-results.js'));
const out=path.join(__dirname,'result-filter-arrows-evidence');fs.mkdirSync(out,{recursive:true});
const session={test:true,complete:false,courseTitle:'Course 1',keys:Array.from({length:120},(_,i)=>'key'+i),pool:[],results:Array.from({length:120},(_,i)=>({key:'key'+i,japanese:'語'+i,expected:'meaning '+i,submitted:i<90?'answer '+i:'',outcome:['good','hard','again','unanswered'][Math.floor(i/30)],attempts:i<90?1:0}))};
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 try{
  const css=['extension/theme.css','tools/preview/study-layouts.css','tools/preview/study-focus.css','tools/preview/study-focus-results.css'].map(name=>fs.readFileSync(path.join(root,name),'utf8').replace(/@import[^;]*;/g,'')).join('\n');
  await page.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta charset="utf-8"><style>'+css+'.app-frame{width:calc(100% - 48px);height:calc(100dvh - 48px);margin:24px;position:relative;flex:none}</style></head><body><div class="app-frame">'+Results.render(session)+'</div></body></html>');
  await page.addScriptTag({content:fs.readFileSync(path.join(source,'study-focus-results.js'),'utf8')});await page.evaluate(session=>{window.fixtureSession=session;IKnowFocusResults.mount(document.querySelector('.focus-results'),session);},session);
  const snapshot=await page.evaluate(()=>JSON.stringify(fixtureSession)),group=page.locator('.focus-result-filter'),output=page.locator('[data-result-filter]'),next=page.locator('[data-result-filter-step=next]'),previous=page.locator('[data-result-filter-step=previous]');
  assert.equal(await page.locator('select[data-result-filter]').count(),0);assert.equal(await output.getAttribute('data-value'),'all');
  assert.equal(await page.locator('.focus-result-map-node').count(),50);await page.locator('[data-result-page=next]').click();assert.match(await page.locator('.focus-result-map-paging').innerText(),/51–100/);
  await group.evaluate(node=>node.fixtureToken='kept');await next.click();assert.equal(await output.getAttribute('data-value'),'review');assert.match(await output.innerText(),/90/);assert.equal(await page.locator('.focus-result-map-node[data-result=good]').count(),0);assert.match(await page.locator('.focus-result-map-paging').innerText(),/1–50 of 90 to review/);assert.equal(await group.evaluate(node=>node.fixtureToken),'kept','The arrow group stays mounted');
  assert.equal(await next.evaluate(node=>document.activeElement===node),true);await next.press('ArrowRight');assert.equal(await output.getAttribute('data-value'),'all');assert.equal(await next.evaluate(node=>document.activeElement===node),true,'Keyboard keeps its focus');await previous.click();assert.equal(await output.getAttribute('data-value'),'review');await previous.press('ArrowLeft');assert.equal(await output.getAttribute('data-value'),'all');
  await page.locator('[data-result-search]').fill('語100');assert.equal(await page.locator('.focus-result-map-node').count(),1);await next.click();assert.equal(await page.locator('[data-result-search]').inputValue(),'語100');assert.equal(await page.locator('.focus-result-map-node').count(),1);
  await page.locator('[data-result-search]').fill('');await next.click();assert.equal(await output.getAttribute('data-value'),'all');
  const selected=await page.locator('.focus-result-selected').innerText();assert.equal(await page.locator('.focus-result-map-node[title],.focus-result-map-node [title]').count(),0);
  const card=page.locator('.focus-result-map-node').first();await card.hover();assert.equal(await card.getAttribute('title'),null);assert.match(await card.getAttribute('aria-label'),/Answer 1, 語0/);assert.equal(await page.locator('.focus-result-selected').innerText(),selected,'Hover never changes the selected answer');
  for(const theme of ['paper','midnight','tokyo','forest'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});await page.locator('html').evaluate((node,theme)=>node.dataset.ikrTheme=theme,theme);await next.hover();
   const geometry=await group.evaluate(node=>{const box=node.getBoundingClientRect(),out=node.querySelector('output'),button=node.querySelector('button');return{left:box.left,right:box.right,height:box.height,textFits:out.scrollWidth<=out.clientWidth,hover:getComputedStyle(button).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(geometry.height,39);assert.equal(geometry.textFits,true);assert.equal(geometry.hover,'rgba(0, 0, 0, 0)');assert.equal(geometry.overflow,false);assert.ok(geometry.left>=0&&geometry.right<=width);
   if(theme==='midnight'&&width===1440)await page.screenshot({path:path.join(out,'results-midnight.png')});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(fixtureSession)),snapshot,'Filtering never rewrites answers or scores');assert.deepEqual(errors,[]);
  console.log('PASS Results arrows: All/To review, pointer/keyboard focus, pagination/search, no title tooltips, retained answer/score, four themes and mobile fit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
