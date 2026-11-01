'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'changelog-patch-range-evidence','run-'+Date.now());fs.mkdirSync(out,{recursive:true});
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(path.join(root,'extension'),out),notesPath=path.join(extension,'changelog.json'),originalText=fs.readFileSync(notesPath,'utf8'),original=JSON.parse(originalText);
 assert.equal(JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version,'1.41.2');
 const context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],requests=[],evidence=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  const latest=structuredClone(original.entries.find(entry=>entry.version==='1.41.1'));assert.ok(latest,'The fixture includes the public 1.41.1 notes');
  const older=structuredClone(original.entries.filter(entry=>entry.id!==latest.id));
  const future={...structuredClone(latest),id:'future-release',version:'1.42.0',date:'2026-12-01',title:'Future notes'};
  const draft={...structuredClone(latest),id:'draft-patch',version:'1.41.2',status:'unreleased',date:null,title:'Unpublished draft'};
  const fallback={schemaVersion:1,entries:[older[older.length-1],future,draft,latest,...older.slice(0,-1)]};
  const exactEntry={...structuredClone(latest),id:'exact-patch',version:'1.41.2',title:'Matching patch notes'};
  const exact={schemaVersion:1,entries:[future,...older,latest,draft,exactEntry]};
  const crossLineHistory=older.filter(entry=>!entry.version.startsWith('1.41.'));
  const crossLine={schemaVersion:1,entries:[future,draft,...crossLineHistory]};
  const assertLabels=async(data,rangeId)=>{
   const labels=await page.evaluate(({data,rangeId})=>{
    const before=JSON.stringify(data),rendered=IKnowReaderChangelog.render(data);
    return{unchanged:JSON.stringify(data)===before,returned:rendered.entries.map(entry=>({id:entry.id,version:entry.version,date:entry.date,status:entry.status})),cards:[...document.querySelectorAll('.release-entry')].map(node=>({id:node.id,label:node.querySelector('.release-version').textContent,date:node.querySelector('time')?.dateTime||null,nav:document.querySelector(`#changelog-nav a[href="#${node.id}"]`).textContent})),installed:document.getElementById('changelog-installed').textContent};
   },{data,rangeId});
   assert.equal(labels.unchanged,true,'Rendering never mutates its input JSON');assert.deepEqual(labels.returned,data.entries.map(({id,version,date,status})=>({id,version,date,status})),'Validated notes retain every original version, date and status');
   assert.equal(labels.installed,'Installed · 1.41.2');
   assert.deepEqual(labels.cards,data.entries.map(entry=>{const version=entry.id===rangeId?'1.41.2':entry.version;return{id:entry.id,label:'Version '+version,date:entry.date,nav:version};}),'Only the eligible notes card and matching navigation label display the patch range');
   return labels;
  };
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);await page.goto(`chrome-extension://${id}/changelog.html#${latest.id}`);await page.locator('#changelog-entries .release-entry').first().waitFor();await page.evaluate(()=>IKnowReaderChangelog.ready);
   assert.equal(await page.locator(`#${latest.id} .release-version`).innerText(),'Version 1.41.2','Actual bundled notes cover the installed patch');assert.equal(await page.locator('#changelog-installed').innerText(),'Installed · 1.41.2');assert.equal(await page.locator('html').getAttribute('data-ikr-theme'),theme);
   const fallbackLabels=await assertLabels(fallback,latest.id);
   const picture=page.locator(`#${latest.id} .changelog-image-button`).first();
   await picture.locator('img').evaluate(image=>image.decode());
   const imageBox=await picture.evaluate(button=>{const outer=button.getBoundingClientRect(),inner=button.querySelector('img').getBoundingClientRect();return{outer:outer.width,inner:inner.width,background:getComputedStyle(button).backgroundColor};});
   assert.ok(Math.abs(imageBox.outer-imageBox.inner)<=3,'The frame follows the image width without empty colored side panels');
   assert.equal(imageBox.background,'rgba(0, 0, 0, 0)');
   assert.equal(await page.locator('#edit-changelog').isHidden(),true,'Ordinary installations remain read-only');
   await page.locator(`#${latest.id} .changelog-image-button`).first().click();await page.locator('#changelog-image-dialog[open]').waitFor();await page.waitForFunction(()=>document.getElementById('changelog-image-full').naturalWidth>0);await page.locator('#changelog-image-close').click();
   assert.equal(await page.locator(`#${latest.id} .release-date`).getAttribute('datetime'),latest.date,'Sharing notes does not alter their original release date');
   const exactLabels=await assertLabels(exact,null);assert.ok(exactLabels.cards.every(entry=>!entry.label.includes('–')),'An exact released match suppresses every range, even with an unpublished matching draft');
   await assertLabels(crossLine,null);assert.equal(await page.evaluate(entries=>IKnowReaderChangelogVersions.select(entries,'1.41.2')?.version,crossLine.entries),crossLineHistory.reduce((a,b)=>IKRCompare(a.version,b.version)>0?a:b).version,'Fallback selection is independent of entry order');
   await assertLabels(fallback,latest.id);await page.locator(`#${latest.id}`).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,theme+'-patch-range.png')});evidence.push({theme,fallback:fallbackLabels.cards,exact:exactLabels.cards});
  }
  assert.equal(fs.readFileSync(notesPath,'utf8'),originalText,'The bundled notes file is unchanged');assert.ok(requests.every(url=>url.startsWith(`chrome-extension://${id}/`)),'The reader only uses bundled resources');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,evidence},null,2)+'\n');console.log('PASS Changelog patch range in four themes: exact match, unsorted future/draft fallback, one eligible card/nav range, intact installed/history/date/input JSON, read-only access and enlargable image');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
function IKRCompare(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<4;i++){const difference=(left[i]||0)-(right[i]||0);if(difference)return Math.sign(difference);}return 0;}
