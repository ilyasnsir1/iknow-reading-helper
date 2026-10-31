/* Course loading and an actual validated download, isolated from installed data. */
'use strict';
const chooseWorkspaceOption=require('../../tests/fixtures/choose-workspace-option.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../native-audio-audit/goal-19053.json'),'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},acceptDownloads:true}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  await page.addInitScript(()=>localStorage.setItem('private-data-sentinel','unchanged'));
  await page.goto('http://127.0.0.1:52332/study-focus.html?review=working-buttons');await page.locator('.focus-card').waitFor();
  const library=await page.evaluate(async()=>await(await fetch('/library.json')).json());
  await page.locator('[data-view="practice"]').click();await page.locator('[data-mode="cloze"]').click();await chooseWorkspaceOption(page, '#demo-attempts', 'single');await chooseWorkspaceOption(page, '#demo-gap-position', 'first');
  await page.locator('#focus-theme-trigger').click();await page.locator('.focus-menu-theme [data-menu-value="midnight"]').click();
  await page.locator('[data-action="backup"]').click();const downloadPromise=page.waitForEvent('download');await page.locator('[data-backup-action="export"]').click();const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^iKnow-Study-preview-backup-\d{4}-\d{2}-\d{2}\.json$/);assert.equal(await download.failure(),null);
  const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(backup.format,'iknow-reading-helper-study-backup');assert.deepEqual(backup.library,{...library,records:Object.fromEntries(Object.entries(library.records).map(([key,record])=>[key,{...record,jpan:record.jpan||''}]))});
  assert.deepEqual(backup.settings.study,{attempts:'single',gapPosition:'first'});assert.equal(backup.settings.appTheme,'midnight');assert.deepEqual(backup.learning.records,{});
  assert.ok(Object.values(backup.library.records).every(record=>!Object.hasOwn(record,'strength')),'Artificial preview strengths are excluded');
  const validation=await page.evaluate(async value=>IKnowReaderStudyStore.createBackend({async get(){return{}},async set(){throw Error('Unexpected write')}}).previewBackup(value),backup);
  assert.equal(validation.backupItems,18);assert.equal(validation.hasSettings,true);assert.match(await page.locator('#focus-backup-status').innerText(),/Backup downloaded/);await page.locator('[data-backup-action="close"]').click();
  await page.locator('[data-view="test"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="load-test-course"]')?.textContent==='Loaded');
  assert.equal(await page.locator('[data-action="load-test-course"]').isDisabled(),true);assert.equal((await page.locator('[data-action="start"]').innerText()).replace(/\s+/g,' '),'Start test (200)');assert.equal(await page.locator('#demo-test-source-status').isHidden(),true);
  await chooseWorkspaceOption(page, '#demo-test-content', 'both');assert.equal((await page.locator('[data-action="start"]').innerText()).replace(/\s+/g,' '),'Start test (400)');
  let release,arrived;const waiting=new Promise(resolve=>arrived=resolve);
  await page.route('**/api/courses/19055',async route=>{arrived();await new Promise(resolve=>release=resolve);await route.fulfill({contentType:'application/json',body:JSON.stringify({...source,id:19055,title:'Changed course'})});});
  await page.locator('#demo-test-course').fill('https://iknow.jp/courses/19055');assert.equal(await page.locator('[data-action="load-test-course"]').isEnabled(),true);assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);
  await page.locator('#demo-test-course').press('Enter');await waiting;assert.equal(await page.locator('[data-action="load-test-course"]').innerText(),'Loading…');assert.equal(await page.locator('#demo-test-course').isDisabled(),true);release();
  await page.waitForFunction(()=>document.getElementById('demo-test-title')?.textContent==='Changed course');assert.equal(await page.locator('[data-action="load-test-course"]').innerText(),'Loaded');assert.equal((await page.locator('[data-action="start"]').innerText()).replace(/\s+/g,' '),'Start test (400)');
  await page.locator('#demo-test-course').fill('https://example.com/courses/19055');await page.locator('[data-action="load-test-course"]').click();await page.waitForFunction(()=>document.getElementById('demo-test-source-status')?.textContent.includes('iKnow course'));
  assert.equal(await page.locator('#demo-test-source-status').isVisible(),true);assert.equal(await page.locator('[data-action="start"]').isDisabled(),true);assert.equal(await page.locator('[data-action="load-test-course"]').isEnabled(),true);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>localStorage.getItem('private-data-sentinel')),'unchanged');assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin==='http://127.0.0.1:52332'));
  console.log('PASS Course Loaded/loading/error states, Enter-to-load, dynamic Start counts, concise source status and validated demo backup download with retained preferences; no personal data or jobs touched');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
