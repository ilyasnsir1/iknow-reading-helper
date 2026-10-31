/* Whole-course practice uses actual course text without changing the saved library. */
'use strict';
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(__dirname,'../../tests/study-focus-course-practice-evidence');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../native-audio-audit/goal-19053.json'),'utf8'));
const base='http://127.0.0.1:52332';
async function resultKeys(page){
 const keys=[];
 for(let guard=0;guard<10;guard++){
  keys.push(...await page.locator('.focus-result-map-node').evaluateAll(nodes=>nodes.map(node=>node.dataset.resultPick)));
  const next=page.locator('[data-result-page="next"]');if(!await next.count()||await next.isDisabled())return keys;
  await next.click();
 }
 throw Error('Result pagination did not end');
}
const text=async(page,selector)=>(await page.locator(selector).innerText()).replace(/\s+/g,' ').trim();
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  await page.addInitScript(()=>localStorage.setItem('practice-qa-sentinel','unchanged'));
  await page.goto(base+'/study-focus.html?review=course-practice');await page.locator('.focus-card').waitFor();
  assert.equal(await page.locator('#demo-library-list .library-row').count(),18);
  assert.doesNotMatch(await page.locator('.focus-bottom').innerText(),/Next item|Practice this item/);
  await page.locator('[data-view="practice"]').click();
  assert.equal(await page.locator('[data-practice-source="saved"]').getAttribute('aria-pressed'),'true');
  assert.equal(await text(page,'.activity-heading small'),'4 selected');
  assert.match(await text(page,'[data-action="choose"]'),/Choose words.*sentences/);
  await page.locator('[data-practice-source="course"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="load-practice-course"]')?.textContent==='Loaded'&&!document.querySelector('[data-action="start"]')?.disabled);
  assert.equal(await text(page,'[data-action="start"]'),'Start practice (200)');
  const records=await page.evaluate(async()=>IKnowReaderStudyCatalog.normalizeSource(await(await fetch('/catalog-source.json')).json(),{courseId:'19053'}).records), words=records.filter(r=>r.kind==='word');
  await chooseWorkspaceOption(page, '#demo-practice-content', 'sentence');assert.equal(await text(page,'[data-action="start"]'),'Start practice (200)');
  await chooseWorkspaceOption(page, '#demo-practice-content', 'both');assert.equal(await text(page,'[data-action="start"]'),'Start practice (400)');
  await chooseWorkspaceOption(page, '#demo-practice-content', 'word');
  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.locator('#focus-theme-trigger').click();await page.locator('.focus-menu-theme [data-menu-value="'+theme+'"]').click();
   for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Course practice has no horizontal overflow at '+viewport.width);
    assert.ok(await page.locator('.activity-pane').evaluate(n=>{const b=n.getBoundingClientRect();return b.x>=0&&b.right<=innerWidth+1;}),'The practice panel is not silently clipped');
    await page.screenshot({path:path.join(out,'course-setup-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width===390});
   }
   await page.setViewportSize({width:1280,height:720});
  }
  await chooseWorkspaceOption(page, '#demo-practice-order', 'course');await page.locator('[data-action="start"]').click();
  assert.equal(await text(page,'.session-progress span'),'1 of 200');assert.equal(await text(page,'.session-word'),words[0].japanese);
  await page.locator('[data-review="'+words[0].key+'"]').click();assert.match(await text(page,'[data-action="next-question"]'),/Next word/);await page.locator('[data-action="next-question"]').click();
  assert.equal(await text(page,'.session-word'),words[1].japanese);
  await page.locator('[data-action="end-session"]').click();assert.deepEqual(await resultKeys(page),words.map(r=>r.key),'Course order follows every source vocabulary record, including unsaved entries');
  await page.locator('[data-action="result-new-round"]').click();
  await chooseWorkspaceOption(page, '#demo-practice-content', 'both');await chooseWorkspaceOption(page, '#demo-practice-order', 'shuffle');
  await page.evaluate(()=>{globalThis.savedMathRandom=Math.random;Math.random=()=>.37;});await page.locator('[data-action="start"]').click();await page.evaluate(()=>{Math.random=savedMathRandom;});
  assert.equal(await text(page,'.session-progress span'),'1 of 400');
  await page.locator('[data-action="end-session"]').click();const shuffled=await resultKeys(page);
  assert.equal(shuffled.length,400);assert.equal(new Set(shuffled).size,400);assert.deepEqual([...shuffled].sort(),records.map(r=>r.key).sort());assert.notDeepEqual(shuffled,records.map(r=>r.key),'Shuffle changes order without dropping or copying questions');
  await page.locator('[data-action="result-new-round"]').click();
  await page.locator('[data-mode="cloze"]').click();
  const eligible=await page.evaluate(rows=>rows.filter(row=>IKnowReaderStudyPractice.buildCloze(row,{gapPosition:'first'})).length,records);
  assert.equal(await text(page,'[data-action="start"]'),'Start practice ('+eligible+')','Fill-the-gap count reflects actual usable exercises');
  if(eligible<records.length)assert.match(await text(page,'#demo-practice-source-status'),/unavailable for this exercise/);
  await page.locator('[data-mode="review"]').click();
  await page.route('**/api/courses/19055',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...source,id:19055,title:'Other practice course'})}));
  await page.locator('#demo-practice-course').fill('https://iknow.jp/courses/19055');assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
  await page.locator('#demo-practice-course').press('Enter');await page.waitForFunction(()=>document.getElementById('demo-practice-title')?.textContent==='Other practice course');assert.equal(await text(page,'[data-action="start"]'),'Start practice (400)');
  await page.locator('[data-view="test"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.textContent==='Loaded');
  assert.equal(await page.locator('#demo-test-course').inputValue(),'19053','Practice course choice does not replace Test course input');
  await page.locator('[data-view="practice"]').click();assert.equal(await page.locator('#demo-practice-course').inputValue(),'https://iknow.jp/courses/19055');
  await page.locator('#demo-practice-course').fill('https://example.com/courses/1');await page.locator('[data-action="load-practice-course"]').click();await page.waitForFunction(()=>document.getElementById('demo-practice-source-status')?.textContent.includes('iKnow course'));
  assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);assert.equal(await page.locator('#demo-practice-source-status').isVisible(),true);
  await page.locator('[data-practice-source="saved"]').click();assert.equal(await text(page,'.activity-heading small'),'4 selected','Whole-course practice preserves saved selection');
  await page.locator('[data-view="study"]').click();assert.equal(await page.locator('#demo-library-list .library-row').count(),18,'No course question becomes a bookmark');
  await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="cloze"]').click();await chooseWorkspaceOption(page, '#demo-gap-position', 'first');await chooseWorkspaceOption(page, '#demo-attempts', 'single');await chooseWorkspaceOption(page, '#demo-practice-order', 'course');
  await page.locator('[data-action="choose"]').click();await page.locator('[data-action="clear-selection"]').click();await page.locator('.picker-list .library-row[data-item^="sentence:"]').first().click();await page.locator('[data-action="close-picker"]').click();await page.locator('[data-action="start"]').click();
  const wrong='  sorree  ';await page.locator('#listening-answer').fill(wrong);await page.locator('#demo-answer .primary').click();
  assert.equal(await text(page,'#demo-feedback'),'Incorrect');assert.equal(await page.locator('[data-action="show-answer"]').isHidden(),true);assert.equal(await page.locator('[data-action="show-answer"]').evaluate(n=>getComputedStyle(n).display),'none');assert.equal(await page.locator('#listening-answer').inputValue(),wrong);
  await page.locator('[data-action="next-question"]').click();assert.equal(await text(page,'.focus-results-heading h2'),'Practice complete');assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dd').textContent(),wrong,'Results preserve the original typed answer including spelling and spaces');
  assert.ok(await page.locator('.focus-result-prompt').count()>0,'Gap results retain the original question context');
  await page.locator('[data-action="result-new-round"]').click();await chooseWorkspaceOption(page, '#demo-attempts', 'retry');await page.locator('[data-action="start"]').click();
  await page.locator('#listening-answer').fill(' sorree ');await page.locator('#demo-answer .primary').click();assert.equal(await page.locator('#demo-solution').isHidden(),true);assert.equal(await page.locator('[data-action="show-answer"]').isVisible(),true);
  await page.locator('#listening-answer').fill('sore');await page.locator('#demo-answer .primary').click();assert.equal(await page.locator('[data-action="show-answer"]').isHidden(),true);await page.locator('[data-action="next-question"]').click();
  assert.equal(await page.locator('.focus-result-selected .focus-result-comparison>div:first-child dd').innerText(),'sore');assert.deepEqual(await page.locator('.focus-result-selected .focus-attempt-text').allTextContents(),[' sorree ']);
  assert.equal(await text(page,'.focus-result-stat[data-result="hard"] strong'),'1');assert.equal(await text(page,'.focus-result-score strong'),'0%');
  await page.screenshot({path:path.join(out,'actual-retry-history.png')});
  // A source with a deliberately missing recording must not reuse the earlier full-course cache.
  const contextOnly=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),contextPage=await contextOnly.newPage();contextPage.on('pageerror',error=>errors.push(error.message));contextPage.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  const contextSource=structuredClone(source);delete contextSource.goal_items[0].sound;
  await contextPage.route('**/catalog-source.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(contextSource)}));
  await contextPage.addInitScript(()=>{
   globalThis.audioConstructed=[];
   globalThis.Audio=class{
    constructor(url){this.src=url||'';this.currentTime=0;this.duration=1;if(url)audioConstructed.push(url);}
    addEventListener(){}
    getAttribute(name){return name==='src'&&this.src?this.src:null;}
    removeAttribute(name){if(name==='src')this.src='';}
    load(){}
    pause(){}
    play(){return Promise.resolve();}
   };
  });
  await contextPage.goto(base+'/study-focus.html?review=context-only-listening');await contextPage.locator('.focus-card').waitFor();await contextPage.locator('[data-view="practice"]').click();await contextPage.locator('[data-mode="listening"]').click();await chooseWorkspaceOption(contextPage, '#demo-attempts', 'single');await contextPage.locator('[data-practice-source="course"]').click();
  await contextPage.waitForFunction(()=>document.querySelector('[data-action="load-practice-course"]')?.textContent==='Loaded'&&!document.querySelector('[data-action="start"]')?.disabled);
  const contextWord=await contextPage.evaluate(async()=>IKnowReaderStudyCatalog.normalizeSource(await(await fetch('/catalog-source.json')).json(),{courseId:'19053'}).records.find(row=>row.kind==='word'));
  assert.equal(contextWord.audioUrl,'');assert.ok(contextWord.context.audioUrl);assert.notEqual(contextWord.context.japanese,contextWord.japanese);
  await contextPage.locator('[data-action="start"]').click();await contextPage.locator('[data-action="play-session"]').click();
  assert.deepEqual(await contextPage.evaluate(()=>audioConstructed),[contextWord.context.audioUrl],'Listening plays the same context recording whose sentence is graded');
  assert.equal(await text(contextPage,'#demo-play-label'),'Playing');assert.equal(await contextPage.locator('.toast').count(),0);
  await contextPage.locator('#listening-answer').fill(contextWord.context.romaji);await contextPage.locator('#demo-answer .primary').click();
  assert.equal(await text(contextPage,'#demo-feedback'),'Correct','The complete context sentence is accepted');assert.equal(await text(contextPage,'#demo-solution .japanese'),contextWord.context.japanese,'The displayed solution matches the context audio');
  assert.equal(await text(contextPage,'#demo-solution .kana'),contextWord.context.romaji);await contextPage.locator('[data-action="end-session"]').click();
  await contextPage.screenshot({path:path.join(out,'context-only-listening-result.png')});
  await contextPage.close();
  assert.equal(await page.evaluate(()=>localStorage.getItem('practice-qa-sentinel')),'unchanged');assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===base),'No write, preparation, model or external requests');
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,courseCounts:{words:200,sentences:200,both:400,cloze:eligible},shuffledUnique:shuffled.length,unchangedSaved:18,contextOnlyAudio:true},null,2));
  console.log('PASS Course Practice: real 200/200/400 source, course order and complete shuffle, eligible gap counts, independent course inputs, saved selection/library retained, one-attempt reveal cleanup, actual wrong retry history and matching context-only listening audio/answer; four-theme setup and no jobs/writes');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
