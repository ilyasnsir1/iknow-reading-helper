/* Input-dependent actions never submit a blank answer or an empty course ID. */
'use strict';
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin='http://127.0.0.1:52332';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[],requests=[];
  for(const mode of ['cloze','listening'])for(const attempts of ['retry','single']){
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
   await page.goto(origin+'/study-focus.html?review=empty-'+mode+'-'+attempts);await page.locator('.focus-card').waitFor();
   const record=await page.evaluate(async()=>Object.values((await(await fetch('/library.json')).json()).records).find(record=>record.kind==='sentence'));
   const correct=await page.evaluate(({mode,record})=>mode==='cloze'?IKnowReaderStudyPractice.buildCloze(record,{gapPosition:'first',romajiStyle:'source'}).answerRomaji:record.romaji,{mode,record});
   await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="'+mode+'"]').click();await chooseWorkspaceOption(page, '#demo-attempts', attempts);
   if(mode==='cloze')await chooseWorkspaceOption(page, '#demo-gap-position', 'first');
   await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row[data-item="'+record.key+'"]').click();await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();
   const input=page.locator('#listening-answer'),check=page.locator('#demo-answer button[type="submit"]'),solution=page.locator('#demo-solution');
   assert.equal(await check.isDisabled(),true,mode+'/'+attempts+' starts disabled');
   for(const blank of ['', '   ', '\t\u3000']){
    await input.fill(blank);assert.equal(await check.isDisabled(),true,'Whitespace is empty');
    await page.locator('#demo-answer').evaluate(form=>form.requestSubmit());assert.equal(await solution.isHidden(),true);assert.equal(await page.locator('#demo-feedback').innerText(),'','A forced blank submit is not graded');
   }
   await input.fill('temporary answer');assert.equal(await check.isEnabled(),true);await input.fill('');assert.equal(await check.isDisabled(),true,'Deleting an answer disables checking again');
   await input.fill(correct);assert.equal(await check.isEnabled(),true);
   await input.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'})));
   assert.equal(await check.isDisabled(),true,'IME composition cannot be graded while incomplete');
   await page.locator('#demo-answer').evaluate(form=>form.requestSubmit());assert.equal(await solution.isHidden(),true);assert.equal(await page.locator('#demo-feedback').innerText(),'');
   await input.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'あ'})));assert.equal(await check.isEnabled(),true);
   await input.fill('not the answer');await check.click();
   if(attempts==='retry'){
    assert.equal(await solution.isHidden(),true);assert.equal(await page.locator('#demo-feedback').innerText(),'Incorrect');
    await input.fill('   ');assert.equal(await check.isDisabled(),true);await page.locator('#demo-answer').evaluate(form=>form.requestSubmit());
    await input.fill(correct);await check.click();
   }
   assert.equal(await solution.isVisible(),true);assert.equal(await check.isDisabled(),true);assert.equal(await input.isDisabled(),true);
   await input.evaluate(node=>{node.value='another answer';node.dispatchEvent(new InputEvent('input',{bubbles:true}));});assert.equal(await check.isDisabled(),true,'A graded answer stays disabled after synthetic input');
   await page.locator('[data-action="next-question"]').click();await page.locator('.focus-results').waitFor();
   assert.equal(await page.locator('.focus-result-score strong').innerText(),'0%','Ignored empty submissions never receive first-try credit');
   if(attempts==='retry'){
    assert.equal(await page.locator('.focus-result-stat[data-result="hard"] strong').innerText(),'1');
    assert.match(await page.locator('.focus-result-selected').innerText(),/not the answer/,'The actual wrong answer remains in retry history');
   }else assert.equal(await page.locator('.focus-result-stat[data-result="again"] strong').innerText(),'1');
   await page.close();
  }
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));let loads=0;page.on('request',request=>{if(/catalog-source\.json|\/api\/courses\//.test(request.url()))loads++;});
  await page.goto(origin+'/study-focus.html?review=empty-course');await page.locator('.focus-card').waitFor();await page.locator('[data-view="test"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.textContent==='Loaded');
  for(const source of ['test','practice']){
   if(source==='practice'){await page.locator('[data-view="practice"]').click();await page.locator('[data-practice-source="course"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="load-practice-course"]')?.textContent==='Loaded');}
   const input=page.locator('#demo-'+source+'-course'),load=page.locator('[data-action="load-'+source+'-course"]'),status=page.locator('#demo-'+source+'-source-status');
   for(const blank of ['', '  \t\u3000']){
    await input.fill(blank);assert.equal(await load.isDisabled(),true);assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
    const before=loads;await input.press('Enter');assert.equal(loads,before,'Blank Enter never starts a request');assert.doesNotMatch(await status.innerText(),/valid|supported|could not/i,'Blank input does not become a validation error');
   }
   await input.fill('https://example.com/courses/19053');assert.equal(await load.isEnabled(),true);await load.click();await page.waitForFunction(id=>document.getElementById(id)?.textContent.includes('iKnow course'),'demo-'+source+'-source-status');assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
  }
  await page.locator('[data-view="study"]').click();await page.locator('#demo-search').fill('');assert.equal(await page.locator('#demo-search').isEnabled(),true,'A search field remains usable when empty');
  assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.method==='GET'&&new URL(request.url).origin===origin),'No jobs or data writes');
  console.log('PASS Empty/whitespace/delete/composition guards for single/retry gap and listening, graded answer lock, course Load/Start blank guards and unchanged search behavior');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
