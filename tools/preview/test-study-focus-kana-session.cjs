/* Independent end-to-end Kana sessions reuse the approved results map. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-focus-kana-session-evidence');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:52332', themes=['paper','midnight','tokyo','forest'];
const text=async(page,selector)=>(await page.locator(selector).innerText()).trim();
const results='.kana-panel[data-kana-mode="results"] .focus-results';
async function chooseOrder(page,order){const expected=order==='chart'?'Chart order':'Shuffle';if(await text(page,'[data-kana-order-label]')!==expected)await page.locator('[data-kana-order-step="next"]').click();}
async function start(page,{script='hiragana',keys=null,all=false}={}){
 await page.locator('[data-kana-script="'+script+'"]').click();
 if(all){if(await text(page,'[data-kana-action="all-groups"]')==='All groups')await page.locator('[data-kana-action="all-groups"]').click();if(await text(page,'[data-kana-action="select-all"]')==='Select all')await page.locator('[data-kana-action="select-all"]').click();}
 else if(keys){await page.locator('[data-kana-action="clear"]').click();for(const key of keys)await page.locator('[data-kana-select="'+key+'"]').click();}
 await chooseOrder(page,'chart');await page.locator('[data-kana-action="start"]').click();await page.locator('[data-kana-answer]').waitFor();
}
async function answer(page,value){await page.locator('[data-kana-answer]').fill(value);await page.locator('[data-kana-form]').evaluate(form=>form.requestSubmit());}
async function geometry(page,label){
 const bounds=await page.evaluate(()=>{
  const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const panel=document.querySelector('[data-kana-root]');return{viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,panel:{height:panel.clientHeight,scroll:panel.scrollHeight},glyph:box('.kana-question-glyph'),input:box('[data-kana-answer]'),footer:box('.kana-answer-footer'),next:box('[data-kana-action="next"]'),feedback:box('.kana-quiz-feedback>strong'),score:box('.focus-result-score')};
 });
 assert.ok(bounds.pageWidth<=bounds.viewport.width+1,label+': no horizontal overflow');
 if(bounds.viewport.width>760){
  assert.ok(bounds.pageHeight<=bounds.viewport.height+1,label+': desktop stays within app frame');
  assert.ok(bounds.panel.scroll<=bounds.panel.height+1,label+': Kana panel has no page scroll');
  for(const part of ['glyph','input','footer','next','feedback','score'])if(bounds[part])assert.ok(bounds[part].y>=0&&bounds[part].bottom<=bounds.viewport.height+1,label+': '+part+' remains visible');
  if(bounds.feedback&&bounds.next)assert.ok(Math.abs(bounds.feedback.y+bounds.feedback.height/2-bounds.next.y-bounds.next.height/2)<=6,label+': feedback and Next share one aligned row');
 }
 return bounds;
}
async function backToChart(page){await page.locator('[data-action="result-back-study"]').click();await page.locator('[data-kana-action="start"]').waitFor();}
async function completeByUI(page,{wrongEvery=0}={}){
 return page.evaluate(async ({wrongEvery})=>{
  const script=document.querySelector('.kana-quiz-heading .eyebrow').textContent.toLowerCase().includes('katakana')?'katakana':'hiragana';
  const entries=['basic','voiced','combinations'].flatMap(group=>IKnowFocusKana.entries(group,script)),byGlyph=new Map(entries.map(entry=>[entry.kana,entry.romaji]));
  const submitted=[];let guard=0;
  while(document.querySelector('[data-kana-answer]')){
   if(guard++>110)throw Error('Kana session did not finish');
   const glyph=document.querySelector('.kana-question-glyph').textContent,value=wrongEvery&&guard%wrongEvery===0?'wrong<'+guard+'>':byGlyph.get(glyph);
   if(!value)throw Error('Unknown glyph '+glyph);
   const input=document.querySelector('[data-kana-answer]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-kana-form]').requestSubmit();
   submitted.push({glyph,value,correct:!(wrongEvery&&guard%wrongEvery===0)});
   document.querySelector('[data-kana-action="next"]').click();await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  return submitted;
 },{wrongEvery});
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  await page.route('**/study-focus-kana.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'study-focus-kana.js'),'utf8')}));
  await page.goto(origin+'/study-focus.html?review=kana-session-polish');await page.locator('.focus-card').waitFor();await page.locator('[data-view="kana"]').click();
  const metrics=[];
  await start(page,{keys:['basic:あ','basic:い','basic:う']});
  assert.equal(await page.locator('[data-kana-check]').isDisabled(),true,'Empty answer has a disabled Check answer');
  await page.locator('[data-kana-form]').evaluate(form=>form.requestSubmit());assert.equal(await page.locator('.kana-quiz-feedback>strong').count(),0,'Programmatic empty submit does not grade');
  await page.locator('[data-kana-answer]').fill(' \t ');assert.equal(await page.locator('[data-kana-check]').isDisabled(),true);await page.locator('[data-kana-form]').evaluate(form=>form.requestSubmit());assert.equal(await page.locator('[data-kana-action="next"]').isVisible(),false,'Whitespace does not create an answer');
  await page.locator('[data-kana-answer]').fill('a');assert.equal(await page.locator('[data-kana-check]').isEnabled(),true);await page.locator('[data-kana-answer]').fill('');assert.equal(await page.locator('[data-kana-check]').isDisabled(),true);
  for(const theme of themes){await page.locator('html').evaluate((node,value)=>node.dataset.ikrTheme=value,theme);for(const viewport of[{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);metrics.push(await geometry(page,'blank/'+theme+'/'+viewport.width));}}
  await page.setViewportSize({width:1280,height:720});await answer(page,'a');assert.equal(await text(page,'.kana-quiz-feedback>strong'),'Correct');assert.equal(await text(page,'[data-kana-action="next"]'),'Next Hiragana');assert.equal(await page.locator('[data-kana-check]').isDisabled(),true);
  for(const theme of themes){await page.locator('html').evaluate((node,value)=>node.dataset.ikrTheme=value,theme);for(const viewport of[{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);metrics.push(await geometry(page,'correct/'+theme+'/'+viewport.width));await page.screenshot({path:path.join(out,'correct-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width<760});}}
  await page.setViewportSize({width:1280,height:720});await page.locator('[data-kana-action="next"]').click();assert.equal(await page.locator('[data-kana-check]').isDisabled(),true,'Next question returns to disabled checking');
  const beforeWrong=await geometry(page,'before wrong'),wrong='  incorrect<reading>  ';await answer(page,wrong);assert.equal(await text(page,'.kana-quiz-feedback>strong'),'Incorrect');const afterWrong=await geometry(page,'wrong');for(const part of ['glyph','input','footer'])assert.ok(Math.abs(beforeWrong[part].y-afterWrong[part].y)<=1,part+' stays in place when a wrong answer reveals its correction');await page.locator('[data-kana-action="end"]').click();await page.locator(results).waitFor();
  assert.equal(await text(page,'.focus-result-score>strong'),'33%');assert.equal(await text(page,'.focus-result-stat[data-result="good"] strong'),'1');assert.equal(await text(page,'.focus-result-stat[data-result="again"] strong'),'1');assert.equal(await text(page,'.focus-result-stat[data-result="unanswered"] strong'),'1');
  assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dd').textContent(),wrong,'Results retain the exact wrong submitted value');assert.equal(await page.locator('.kana-answer-list,.kana-result-row').count(),0,'The old separately scrolling answer list is gone');
  await page.locator('[data-action="result-practice-mistakes"]').click();assert.equal(await text(page,'.kana-progress-count'),'1 of 2');await page.locator('[data-kana-action="end"]').click();await backToChart(page);
  await start(page,{script:'katakana',keys:['basic:あ','basic:い']});await answer(page,'a');assert.equal(await text(page,'[data-kana-action="next"]'),'Next Katakana');await page.locator('[data-kana-action="end"]').click();await backToChart(page);
  await start(page,{script:'hiragana',keys:['basic:あ']});await answer(page,'wrong');assert.equal(await text(page,'[data-kana-action="next"]'),'Finish');await page.locator('[data-kana-action="next"]').click();assert.equal(await text(page,'.focus-result-score>strong'),'0%');assert.equal(await page.locator('.focus-result-map-node').count(),1);await backToChart(page);
  await page.locator('[data-kana-include="voiced"]').uncheck();await page.locator('[data-kana-include="combinations"]').uncheck();await page.locator('[data-kana-include="basic"]').check();await page.locator('[data-kana-action="select-all"]').click();await chooseOrder(page,'chart');await page.locator('[data-kana-action="start"]').click();const perfect=await completeByUI(page);assert.equal(perfect.length,46);assert.equal(await text(page,'.focus-result-score>strong'),'100%');assert.equal(await page.locator('[data-action="result-practice-mistakes"]').count(),0);assert.equal(await page.locator('.focus-result-map-node').count(),46);await backToChart(page);
  await start(page,{script:'katakana',all:true});const submitted=await completeByUI(page,{wrongEvery:3});assert.equal(submitted.length,104);assert.equal(new Set(submitted.map(row=>row.glyph)).size,104);assert.equal(await text(page,'.focus-result-score>strong'),'67%');assert.equal(await text(page,'.focus-result-stat[data-result="good"] strong'),'70');assert.equal(await text(page,'.focus-result-stat[data-result="again"] strong'),'34');assert.equal(await page.locator('.focus-result-map-node').count(),50);
  const initial=await page.locator('.focus-result-selected').innerText(),seen=[];
  while(true){seen.push(...await page.locator('.focus-result-map-node').evaluateAll(nodes=>nodes.map(node=>node.dataset.resultPick)));if(await page.locator('[data-result-page="next"]').isDisabled())break;await page.locator('[data-result-page="next"]').click();}
  assert.equal(seen.length,104);assert.equal(new Set(seen).size,104);assert.equal(await page.locator('.focus-result-selected').innerText(),initial,'Pagination retains selected answer');await page.locator('.focus-result-map-node').last().click();assert.equal(await text(page,'.focus-result-selected h3'),submitted.at(-1).glyph);
  await page.locator('[data-result-filter-step=next]').click();assert.equal(await page.locator('.focus-result-map-node').count(),34);assert.equal(await page.locator('.focus-result-map-node:not([data-result="again"])').count(),0);await page.locator('[data-result-filter-step=next]').click();
  for(const theme of themes){await page.locator('html').evaluate((node,value)=>node.dataset.ikrTheme=value,theme);for(const viewport of[{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);metrics.push(await geometry(page,'results/'+theme+'/'+viewport.width));assert.ok(await page.locator('.focus-result-map-grid').evaluate(node=>node.clientHeight<=node.closest('.focus-result-map-main').clientHeight*.65),'Kana maps leave room for the selected answer');if(viewport.width>760)assert.ok(await page.locator('.focus-result-selected').evaluate(node=>{const box=node.getBoundingClientRect(),main=node.closest('.focus-result-map-main').getBoundingClientRect();return box.bottom<=main.bottom+1;}),'Selected Kana answer remains visible below the larger map');await page.screenshot({path:path.join(out,'results-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width<760});}}
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===origin),'No uploads, preparation or helper requests');
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,scope:'Blank/whitespace gating, script-specific Next, aligned feedback, actual1/46/104 answer results and shared C map, all themes, desktop/mobile and no external writes',metrics},null,2));
  console.log('PASS Kana sessions: empty/whitespace checks disabled, script-specific Next, aligned feedback, exact answers, 1/46/104 shared-map results, pagination/filter/score, four themes and desktop/mobile fit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
