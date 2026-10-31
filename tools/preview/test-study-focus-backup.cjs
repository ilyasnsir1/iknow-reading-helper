/* Backup import/export uses the production format and stays on the preview origin. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const Learning=require('../../extension/study-learning.js');
const out=path.resolve(__dirname,'../../tests/study-focus-backup-evidence');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:52332',dialog='[role="dialog"][aria-label="Backup"]';
const text=async(page,selector)=>(await page.locator(selector).innerText()).trim();
const file=(value,name='other-pc.json')=>({name,mimeType:'application/json',buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
async function open(page){if(!await page.locator(dialog).count()){await page.locator('[data-action="backup"]').click();await page.locator(dialog).waitFor();}}
async function exported(page){await open(page);const waiting=page.waitForEvent('download');await page.locator('[data-backup-action="export"]').click();const download=await waiting;assert.equal(await download.failure(),null);assert.match(download.suggestedFilename(),/^iKnow-Study-preview-backup-\d{4}-\d{2}-\d{2}\.json$/);await page.waitForFunction(()=>document.getElementById('focus-backup-status')?.textContent==='Backup downloaded.');return JSON.parse(fs.readFileSync(await download.path(),'utf8'));}
async function choose(page,value,name='other-pc.json'){await open(page);await page.locator('#focus-backup-file').setInputFiles(file(value,name));await page.waitForFunction(()=>document.getElementById('focus-backup-status')?.textContent!=='Checking backup…');}
async function apply(page){await page.locator('[data-backup-action="import"]').click();await page.waitForFunction(()=>document.getElementById('focus-backup-status')?.textContent.startsWith('Imported.')||document.getElementById('focus-backup-status')?.dataset.error==='true');}
function sourceSnapshot(backup){return{library:backup.library,learning:backup.learning,settings:backup.settings};}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  await page.addInitScript(()=>localStorage.setItem('backup-private-sentinel','unchanged'));
  await page.goto(origin+'/study-focus.html?review=backup-import');await page.locator('.focus-card').waitFor();
  const baseline=await exported(page),keys=Object.keys(baseline.library.records);assert.equal(keys.length,18);
  const incoming=structuredClone(baseline),first=keys[0],second=keys[1],now=Date.now();
  const added={kind:'word',courseId:'19055',courseTitle:'Another course',sourceId:'backup909',japanese:'猫',jpan:'',kana:'ねこ',romaji:'neko',english:'cat',german:'Katze',audioUrl:'',notes:'Imported note\n<strong>plain text</strong>',key:'word:19055:backup909',createdAt:now-5000,updatedAt:now};
  incoming.library.records[added.key]=added;
  incoming.library.records[first].updatedAt+=1000;incoming.library.records[first].notes='Newer note from the other PC';
  incoming.library.records[second].notes='Equal-date note must not replace the existing entry';
  incoming.learning={records:{[added.key]:{review:Learning.next(undefined,'good',now)},[first]:{listening:Learning.next(undefined,'again',now)}}};
  incoming.settings.appTheme='forest';incoming.settings.study={attempts:'single',gapPosition:'first'};

  await choose(page,incoming);assert.equal(await page.locator('#focus-backup-preview').isVisible(),true);assert.deepEqual(await page.locator('.focus-backup-counts strong').allTextContents(),['1','1','17']);
  assert.equal(await page.locator('#focus-backup-settings').isChecked(),false);assert.equal(await page.locator('[data-backup-action="import"]').isEnabled(),true);
  assert.equal(await page.locator('#demo-library-list .library-row').count(),18,'Checking a backup changes no library data');
  await page.locator('[data-backup-action="close"]').click();assert.equal(await page.locator(dialog).count(),0);assert.equal(await page.locator('#demo').evaluate(n=>n.inert),false);
  assert.deepEqual(sourceSnapshot(await exported(page)),sourceSnapshot(baseline),'Cancelling an import leaves all data unchanged');
  await choose(page,incoming);await apply(page);assert.match(await text(page,'#focus-backup-status'),/^Imported\./);
  assert.equal(await page.locator('#demo-library-list .library-row').count(),19);assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),'paper','Import settings is optional and initially off');
  let roundtrip=await exported(page);assert.equal(roundtrip.library.records[first].notes,'Newer note from the other PC');assert.deepEqual(roundtrip.library.records[second],baseline.library.records[second]);assert.deepEqual(roundtrip.library.records[added.key],added);assert.deepEqual(roundtrip.learning,incoming.learning);assert.equal(roundtrip.settings.appTheme,'paper');
  await page.locator('[data-backup-action="close"]').click();assert.equal(await page.locator('[data-action="backup"]').evaluate(node=>document.activeElement===node),true,'Closing after a parent redraw returns focus to the current Backup button');
  await page.locator(`.library-row[data-item="${added.key}"]`).click();
  assert.equal(await page.locator('.focus-card .focus-source-link').getAttribute('href'),'https://iknow.jp/courses/19055','An imported word links to its real source course');
  assert.equal(await page.locator('.focus-card>.eyebrow').innerText(),'WORD · ANOTHER COURSE','The word caption uses its actual course title');
  await page.locator(`.library-row[data-item="${first}"]`).click();
  assert.equal(await page.locator('.focus-card .focus-source-link').getAttribute('href'),`https://iknow.jp/courses/${baseline.library.records[first].courseId}`,'Switching words updates the source link');
  await page.reload();await page.locator('.focus-card').waitFor();assert.equal(await page.locator('#demo-library-list .library-row').count(),19,'Imported library survives refresh');assert.deepEqual((await exported(page)).learning,incoming.learning);
  await choose(page,incoming);await page.locator('#focus-backup-settings').check();await apply(page);assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),'forest');roundtrip=await exported(page);assert.deepEqual(roundtrip.settings.study,{attempts:'single',gapPosition:'first'});

  const stable=sourceSnapshot(roundtrip);
  const older=structuredClone(incoming);older.library.records[first].updatedAt=baseline.library.records[first].updatedAt;older.library.records[first].notes='Older note must not replace the current note';older.learning.records[added.key].review=Learning.next(undefined,'again',now-1000);
  await choose(page,older,'older-pc.json');assert.deepEqual(await page.locator('.focus-backup-counts strong').allTextContents(),['0','0','19']);await apply(page);assert.deepEqual(sourceSnapshot(await exported(page)),stable,'Older matching notes and learning history cannot overwrite newer local data');
  for(const invalid of ['{broken',JSON.stringify({format:'foreign',schemaVersion:1}),JSON.stringify({...incoming,library:{...incoming.library,records:{...incoming.library.records,[added.key]:{...added,key:'word:19055:wrong'}}}})]){
   await choose(page,invalid,'invalid.json');assert.equal(await page.locator('#focus-backup-status').getAttribute('data-error'),'true');assert.equal(await page.locator('#focus-backup-preview').isHidden(),true);assert.equal(await page.locator('[data-backup-action="import"]').isDisabled(),true);assert.deepEqual(sourceSnapshot(await exported(page)),stable,'Invalid import cannot mutate the current snapshot');
  }
  await page.locator('#focus-backup-file').setInputFiles({name:'oversize.json',mimeType:'application/json',buffer:Buffer.alloc(12*1024*1024+1,32)});await page.waitForFunction(()=>document.getElementById('focus-backup-status')?.dataset.error==='true');assert.match(await text(page,'#focus-backup-status'),/12 MiB/);assert.equal(await page.locator('[data-backup-action="import"]').isDisabled(),true);

  const failed=structuredClone(incoming),extra={...added,sourceId:'failure910',key:'word:19055:failure910',japanese:'犬',kana:'いぬ',romaji:'inu',english:'dog',german:'Hund'};failed.library.records[extra.key]=extra;
  await choose(page,failed,'save-failure.json');await page.evaluate(()=>{globalThis.backupOriginalOpen=indexedDB.open;indexedDB.open=()=>{throw Error('Simulated storage failure');};});await apply(page);
  assert.equal(await page.locator('#focus-backup-status').getAttribute('data-error'),'true');assert.equal(await page.locator('#demo-library-list .library-row').count(),19,'Failed persistence does not apply the library');await page.evaluate(()=>{indexedDB.open=backupOriginalOpen;delete globalThis.backupOriginalOpen;});assert.deepEqual(sourceSnapshot(await exported(page)),stable);

  // A slower old file must not replace a newer selection's validation result.
  await page.evaluate(()=>{const nativeText=File.prototype.text;File.prototype.text=function(){return this.name==='slow.json'?nativeText.call(this).then(value=>new Promise(resolve=>{globalThis.releaseSlowBackup=()=>resolve(value);})):nativeText.call(this);};});
  await page.locator('#focus-backup-file').setInputFiles(file(failed,'slow.json'));await page.waitForFunction(()=>typeof releaseSlowBackup==='function');await choose(page,roundtrip,'fast.json');assert.deepEqual(await page.locator('.focus-backup-counts strong').allTextContents(),['0','0','19']);await page.evaluate(async()=>{releaseSlowBackup();await new Promise(resolve=>setTimeout(resolve,50));});assert.deepEqual(await page.locator('.focus-backup-counts strong').allTextContents(),['0','0','19'],'Stale file validation cannot replace the selected backup');
  await page.locator('[data-backup-action="close"]').click();

  for(const theme of ['paper','midnight','tokyo','forest']){
   await page.locator('#focus-theme-trigger').click();await page.locator('.focus-menu-theme [data-menu-value="'+theme+'"]').click();await open(page);await choose(page,incoming);
   for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);const rect=await page.locator(dialog).boundingBox();assert.ok(rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1,theme+' modal fits viewport');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const close=page.locator('[data-backup-action="close"]'),last=page.locator('[data-backup-action="import"]');await close.focus();await page.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(n=>document.activeElement===n),true,'Focus wraps backward inside the modal');await page.keyboard.press('Tab');assert.equal(await close.evaluate(n=>document.activeElement===n),true,'Focus wraps forward inside the modal');
    await page.screenshot({path:path.join(out,theme+'-'+viewport.width+'.png'),fullPage:viewport.width===390});
   }
   await page.keyboard.press('Escape');assert.equal(await page.locator(dialog).count(),0);assert.equal(await page.locator('#demo').evaluate(n=>n.inert),false);await page.setViewportSize({width:1280,height:720});
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('backup-private-sentinel')),'unchanged');assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===origin),'No preparation jobs, uploads or external data access');
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,baseline:18,merged:19,progressPreserved:true,atomicFailure:true,fileRace:true,themes:4,viewports:3},null,2));
  console.log('PASS Backup preview, cancel, validated merge, notes/progress/settings roundtrip, refresh persistence, invalid/oversize rejection, atomic storage failure and file-selection race; four themes, mobile and focus trap; no jobs/uploads');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
