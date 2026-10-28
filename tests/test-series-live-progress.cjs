/* Actual production series/queue DOM with bounded storage/runtime fixtures.
 * No extension registration, personal profile, native helper, network or model
 * preparation is used. Queue aggregation is checked separately at the worker. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
let playwright;
try { playwright = require(process.env.IKNOW_PLAYWRIGHT || 'playwright'); }
catch(error) {
  const local = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  if (!fs.existsSync(local)) throw error;
  playwright = require(local);
}
const {chromium} = playwright;
const root = path.resolve(__dirname, '..'), ext = fs.existsSync(path.join(root, 'extension/core.js')) ? path.join(root, 'extension') : path.join(root, 'outputs/iknow-lesehilfe/extension');
const Core = require(path.join(ext, 'core.js'));
const evidence = path.join(__dirname, 'series-live-progress-evidence'); fs.mkdirSync(evidence, {recursive:true});
const passed = [], errors = [], requests = [];
const pass = message => {passed.push(message); console.log('PASS', message);};
const until = async (predicate, message) => {const at=Date.now(); while(!await predicate()){if(Date.now()-at>10000)throw Error('Timed out: '+message);await new Promise(resolve=>setTimeout(resolve,25));}};
const ids = ['566924','566925','566926','566927','566928','566929','566930','566932'];
const courses = ids.map((id,i)=>({id,title:`Japanese Core 1000 Step ${i+3}`,sentenceCount:196,status:i===0?'running':'pending'}));
const base = {schemaVersion:1,seriesId:'3423',title:'Japanese Core 1000',status:'running',stage:'language',features:{german:true,colors:true,audio:true},
  courses, currentIndex:0,totalCourses:8,processedCourses:0,completedCourses:0,failedCourses:0,skippedCourses:0,
  completed:119,total:196,progressFraction:119/196/2/8,etaSeconds:510,etaScope:'measured',etaStages:['language'],unestimatedStages:['audio']};
const initialCounts = {german:{status:'partial',ready:119,total:196,wordsReady:100,wordsTotal:100},colors:{status:'partial',ready:119,total:196,germanReady:119,germanTotal:196,germanStatus:'partial'},audio:{status:'missing',ready:0,total:196}};
async function setup(page, queue, kind) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route=>{
    requests.push(route.request().url());
    const html=kind==='series'?`<!doctype html><html><head><title>Japanese Core 1000</title></head><body><main class="host"><h1>Japanese Core 1000</h1><ul class="series_list">${courses.map(course=>`<li><a href="/courses/${course.id}">${course.title}</a><span>196 sentences</span></li>`).join('')}</ul></main></body></html>`:
      fs.readFileSync(path.join(ext,'queue.html'),'utf8').replace(/<script\b[^>]*>.*?<\/script>/gs,'').replace(/<link\b[^>]*>/g,'').replace('src="icons/icon128.png"',`src="data:image/png;base64,${fs.readFileSync(path.join(ext,'icons/icon128.png')).toString('base64')}"`);
    await route.fulfill({status:200,contentType:'text/html',body:html});
  });
  await page.goto(kind==='series'?'https://iknow.jp/content/japanese/series/3423':'https://preview.invalid/queue.html');
  await page.addStyleTag({path:path.join(ext,kind==='series'?'series.css':'queue.css')});
  if(kind==='series')await page.addStyleTag({content:'body{font:14px/1.6 Segoe UI,sans-serif;background:#fff}.host{max-width:980px;margin:30px auto}.series_list{padding:20px}.series_list>li{padding:12px}'});
  await page.evaluate(({queue,defaults,counts,ids})=>{
    const listeners=[],stored={iknowReaderSettings:{...defaults,prepareGerman:true,prepareColors:true,prepareAudio:true},iknowReaderQueue:queue};
    const notify=values=>{const changes={};for(const[key,newValue]of Object.entries(values)){changes[key]={oldValue:stored[key],newValue:structuredClone(newValue)};stored[key]=structuredClone(newValue);}for(const listener of listeners)listener(changes,'local');};
    globalThis.__fixture={stored,notify,commands:[],counts,setQueue:q=>notify({iknowReaderQueue:q}),setCounts:value=>{__fixture.counts=value;notify({iknowReaderCoursePacks:{fixtureCheckpoint:true}});}};
    globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,stored[key]])),set:async values=>notify(values)},onChanged:{addListener:listener=>listeners.push(listener)}},
      runtime:{id:'bounded-fixture',onMessage:{addListener(){}},sendMessage:async message=>{
        __fixture.commands.push(message.type);
        if(message.type==='ikr:queue:availability')return {ok:true,availability:Object.fromEntries(ids.map(id=>[id,{complete:false,totalSentences:196,totalWords:100,modules:__fixture.counts}]))};
        if(message.type==='ikr:queue:pause'){notify({iknowReaderQueue:{...stored.iknowReaderQueue,status:'paused',etaSeconds:null}});return{ok:true,queue:stored.iknowReaderQueue};}
        if(message.type==='ikr:queue:resume'){notify({iknowReaderQueue:{...stored.iknowReaderQueue,status:'running'}});return{ok:true,queue:stored.iknowReaderQueue};}
        if(message.type==='ikr:queue:status')return{ok:true,queue:stored.iknowReaderQueue};
        throw Error('No real work allowed in UI fixture: '+message.type);
      }}};
  },{queue,defaults:Core.DEFAULTS,counts:initialCounts,ids});
  await page.addScriptTag({path:path.join(ext,'core.js')});
  await page.addScriptTag({path:path.join(ext,kind==='series'?'series.js':'queue.js')});
  await until(async()=>kind==='series'?await page.locator('.ikr-series-card').count()>0:await page.locator('#queue').isVisible(),'actual UI mounted');
}
const ratio = (page,selector)=>page.locator(selector).evaluate(node=>node.value/node.max);
const near = (actual, expected)=>assert.ok(Math.abs(actual-expected)<.00001,`Progress ratio ${actual} should be ${expected}`);
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'iknow-series-progress-'));
  const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.IKNOW_BROWSER_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,viewport:{width:1440,height:1200}});
  try{
    const series=await context.newPage(), queue=await context.newPage();
    await setup(series,structuredClone(base),'series');await setup(queue,structuredClone(base),'queue');
    await until(async()=>await series.locator('.ikr-series-card').getAttribute('data-checking')==='false','first saved-data response');
    const apply=async value=>{for(const page of[series,queue])await page.evaluate(value=>__fixture.setQueue(value),value);};
    near(await ratio(series,'.ikr-series-progress'),base.progressFraction);near(await ratio(queue,'#course-progress'),base.progressFraction);
    assert.match(await queue.locator('#totals').textContent(),/0 of 8 courses processed/);
    assert.match(await queue.locator('#phase').textContent(),/119 of 196/);
    assert.doesNotMatch(await series.locator('.ikr-series-eta').textContent(),/calculating/i);
    assert.doesNotMatch(await queue.locator('#eta').textContent(),/calculating/i);
    assert.match(await queue.locator('#eta').textContent(),/German & meanings remaining:.*Audio timings estimate after it starts/);
    assert.match(await series.locator('.ikr-series-eta').textContent(),/German & meanings remaining:.*Audio timings estimate after it starts/);
    pass('First active course contributes fractional overall progress before any whole course is processed; measured ETA renders in both production views');

    const later={...structuredClone(base),completed:165,progressFraction:165/196/2/8,etaSeconds:360};await apply(later);
    await series.evaluate(counts=>__fixture.setCounts(counts),{...initialCounts,german:{...initialCounts.german,ready:165},colors:{...initialCounts.colors,ready:165,germanReady:165}});
    await until(async()=>(await series.locator('.ikr-series-status-detail').textContent()).includes('165 of 196'),'saved checkpoint count catches up without a checking flash');
    near(await ratio(series,'.ikr-series-progress'),later.progressFraction);near(await ratio(queue,'#course-progress'),later.progressFraction);
    assert.ok(await ratio(series,'.ikr-series-progress')>base.progressFraction);
    assert.match(await queue.locator('#phase').textContent(),/165 of 196/);
    assert.match(await queue.locator('#totals').textContent(),/0 of 8 courses processed/);
    const aria=await queue.locator('#course-progress').getAttribute('aria-valuetext');assert.ok(aria&&/\d/.test(aria));
    await series.locator('.ikr-series-card').screenshot({path:path.join(evidence,'active-course-progress.png')});
    pass('119→165 of 196 updates the actual overall bar while whole-course count stays0; progress has explicit accessible value text');

    const legacy={...structuredClone(later)};delete legacy.progressFraction;await apply(legacy);
    near(await ratio(series,'.ikr-series-progress'),later.progressFraction);near(await ratio(queue,'#course-progress'),later.progressFraction);
    const unknown={...structuredClone(base),completed:0,progressFraction:0,etaSeconds:null,etaStages:[],unestimatedStages:['language','audio']};await apply(unknown);
    assert.match(await queue.locator('#eta').textContent(),/^Measuring German & meanings speed/);assert.match(await queue.locator('#eta').textContent(),/Audio timings estimate after it starts/);
    assert.doesNotMatch(await queue.locator('#eta').textContent(),/Estimated time left: (?:about|calculating)/);
    pass('Older snapshots have a live phase-fraction fallback, while measured language estimates explicitly exclude unknown audio time and unsampled stages say measuring');

    const audio={...structuredClone(later),stage:'audio',completed:12,total:196,progressFraction:(1+12/196)/2/8,etaSeconds:220,etaScope:'total',unestimatedStages:[]};await apply(audio);
    near(await ratio(queue,'#course-progress'),audio.progressFraction);assert.ok(await ratio(queue,'#course-progress')>later.progressFraction);
    assert.match(await queue.locator('#phase').textContent(),/Audio timings.*12 of 196/);
    const next={...structuredClone(audio),stage:'language',completed:10,currentIndex:1,processedCourses:1,completedCourses:1,progressFraction:(1+10/196/2)/8,courses:courses.map((course,i)=>({...course,status:i===0?'complete':i===1?'running':'pending'}))};await apply(next);
    assert.ok(await ratio(queue,'#course-progress')>audio.progressFraction);assert.equal(await queue.locator('#course-count').textContent(),'Course 2 of 8');
    assert.match(await queue.locator('#totals').textContent(),/1 of 8 courses processed/);
    pass('Language→audio→next-course boundaries increase overall progress without resetting it to zero');

    await queue.locator('#pause').click();await until(async()=>await queue.locator('#status').textContent()==='Paused','paused via real action');
    const paused=await queue.evaluate(()=>__fixture.stored.iknowReaderQueue);await series.evaluate(value=>__fixture.setQueue(value),paused);
    assert.equal(await queue.locator('#eta').isVisible(),false);assert.equal(await series.locator('.ikr-series-eta').isVisible(),false);
    near(await ratio(queue,'#course-progress'),next.progressFraction);
    const reopened=await context.newPage();await setup(reopened,paused,'queue');near(await ratio(reopened,'#course-progress'),next.progressFraction);assert.equal(await reopened.locator('#status').textContent(),'Paused');
    await reopened.locator('#resume').click();assert.equal(await reopened.locator('#status').textContent(),'Preparing');await reopened.close();
    pass('Pause hides ETA but preserves progress; reopening/restoring the paused snapshot and resuming uses the existing fraction');

    const other={...structuredClone(next),seriesId:'9999'};await series.evaluate(value=>__fixture.setQueue(value),other);assert.equal(await series.locator('.ikr-series-status').isVisible(),false);
    await apply(next);
    const finished={...structuredClone(next),status:'complete',currentIndex:8,processedCourses:8,completedCourses:7,failedCourses:1,progressFraction:1,courses:courses.map((course,i)=>({...course,status:i===0?'error':'complete'}))};await apply(finished);
    near(await ratio(series,'.ikr-series-progress'),1);near(await ratio(queue,'#course-progress'),1);assert.equal(await queue.locator('#status').textContent(),'Partly saved');assert.match(await queue.locator('#totals').textContent(),/1 with missing additions/);
    assert.equal(await queue.locator('#eta').isVisible(),false);assert.match(await series.locator('.ikr-series-status-title').textContent(),/missing additions/);
    pass('Another series never shows this queue as its own; finished queues show full processed progress and explicitly retain failures');
    await queue.locator('main').screenshot({path:path.join(evidence,'queue-complete-with-missing.png')});
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>/^(?:https:\/\/iknow\.jp\/content\/japanese\/series\/3423|https:\/\/preview\.invalid\/queue\.html)$/.test(url)),JSON.stringify(requests));
    pass('No uncaught browser errors and every page request was fulfilled locally without native/model/network work');
    fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({boundary:'Actual production UI scripts with controlled Chrome storage/runtime and locally fulfilled host pages; worker aggregation/ETA are separate tests.',passed,errors,requests},null,2));
  }finally{await context.close();assert.equal(path.dirname(profile),os.tmpdir());assert.ok(path.basename(profile).startsWith('iknow-series-progress-'));fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
