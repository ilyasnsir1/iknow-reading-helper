/* Source navigation belongs to the selected Study record, never global activities. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(__dirname,'study-workspace-source-link-evidence');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../native-audio-audit/goal-19053.json'),'utf8'));
(async()=>{
 const extension=require('./fixtures/isolate-extension.cjs')(process.env.IKR_WORKSPACE_TEST_EXTENSION||path.resolve(__dirname,'../extension'),out);
 const context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],evidence=[];
 try{
  await context.route('https://iknow.jp/api/v2/goals/*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...source,id:Number(route.request().url().split('/').pop())})}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
   const records={};for(const [courseId,sourceId,japanese,kana,romaji,english] of [['19053','one','本','ほん','hon','book'],['19055','two','猫','ねこ','neko','cat']]){const key=`word:${courseId}:${sourceId}`;records[key]={kind:'word',courseId,courseTitle:'Saved source '+courseId,sourceId,japanese,kana,romaji,english,german:'Meaning',audioUrl:'',key,createdAt:1,updatedAt:1};}
   await chrome.storage.local.set({iknowReaderStudyLibrary:{schemaVersion:1,records},iknowReaderTheme:'paper'});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${id}/study.html`);await page.locator('.focus-card').waitFor();
  async function noGlobalLink(){assert.equal(await page.locator('.app-actions a').count(),0,'The global toolbar contains no course link');assert.equal(await page.locator('#focus-course-link').count(),0,'The retired global source control is absent');assert.equal(await page.locator('.app-actions').evaluate(node=>node.children.length),3,'Language, Backup and Theme are the complete global control group');}
  await noGlobalLink();
  for(const key of ['word:19053:one','word:19055:two']){
   await page.locator(`.library-row[data-item="${key}"]`).click();const courseId=key.split(':')[1],link=page.locator('.focus-card .focus-source-link');
   assert.equal(await link.count(),1);assert.equal(await link.getAttribute('href'),'https://iknow.jp/courses/'+courseId);assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);assert.match(await link.innerText(),new RegExp(courseId));
   await noGlobalLink();
  }
  for(const theme of ['paper','midnight','tokyo','forest']){
   await worker.evaluate(theme=>chrome.storage.local.set({iknowReaderTheme:theme}),theme);await page.waitForFunction(theme=>document.documentElement.dataset.ikrTheme===theme&&document.querySelector('[data-focus-menu="theme"]')?.dataset.value===theme,theme);
   for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844}]){
    await page.setViewportSize(viewport);await noGlobalLink();
    const geometry=await page.locator('.app-actions').evaluate(node=>{const boxes=[...node.children].map(child=>{const r=child.getBoundingClientRect();return{x:r.x,right:r.right,cy:r.y+r.height/2,height:r.height};});return{boxes,gaps:boxes.slice(1).map((box,index)=>box.x-boxes[index].right),overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(geometry.overflow,false,'Toolbar never makes the document overflow');assert.ok(Math.max(...geometry.gaps)-Math.min(...geometry.gaps)<=1,'The three header controls have balanced edge gaps: '+JSON.stringify({theme,viewport,...geometry}));
    if(viewport.width>760)for(const gap of geometry.gaps)assert.ok(Math.abs(gap-12)<=1,'Desktop header uses a compact 12px control gap: '+JSON.stringify({theme,viewport,...geometry}));
    assert.ok(Math.max(...geometry.boxes.map(box=>box.cy))-Math.min(...geometry.boxes.map(box=>box.cy))<=1,'All three header controls share a vertical center');for(const box of geometry.boxes)assert.ok(Math.abs(box.height-34)<=1,'Header height '+JSON.stringify({theme,viewport,...geometry}));
    const link=await page.locator('.focus-source-link').boundingBox();assert.ok(link.width>0&&link.x>=0&&link.x+link.width<=viewport.width,'The inline source link is visible and fits');evidence.push({theme,viewport,...geometry});
   }
  }
  for(const view of ['practice','test','kana']){
   await page.locator(`.focus-rail [data-view="${view}"]`).click();await page.locator(`.focus-rail [data-view="${view}"][aria-pressed="true"]`).waitFor();await noGlobalLink();assert.equal(await page.locator('.focus-source-link').count(),0,'Source links are absent from '+view);
   if(view==='test'){await page.locator('#demo-test-course').fill('19055');await noGlobalLink();await page.locator('#demo-test-course').fill('');await noGlobalLink();}
  }
  await page.locator('.focus-rail [data-view="study"]').click();assert.equal(await page.locator('.focus-source-link').getAttribute('href'),'https://iknow.jp/courses/19055');await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,'study-source.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS Contextual source link: selected real course only in Study, no global/Test/Practice/Kana link, compact balanced three-control header across four themes and desktop/mobile');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
