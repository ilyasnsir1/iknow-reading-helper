/* The actual canonical-development popup, original fox atlas and real animation
 * clocks. All requests use bounded local routes; no installed extension, native
 * helper, network, models, caches or release files are accessed. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
let playwright;
try { playwright = require(process.env.IKNOW_PLAYWRIGHT || 'playwright'); }
catch (error) {
  const local = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  if (!fs.existsSync(local)) throw error;
  playwright = require(local);
}
const {chromium} = playwright;
const root = path.resolve(__dirname, '..'), ext = fs.existsSync(path.join(root, 'extension/manifest.json')) ? path.join(root, 'extension') : path.join(root, 'work/github-source/extension');
const driver = fs.existsSync(path.join(__dirname, 'fixtures/update-preview-driver.js')) ? path.join(__dirname, 'fixtures/update-preview-driver.js') : path.join(root, 'work/update-preview/preview-driver.js');
const out = path.join(__dirname, 'fox-hide-seek-evidence'); fs.mkdirSync(out, {recursive:true});
const origin = 'http://popup-preview.invalid';
const passed = [], errors = [], requested = [], unexpectedRequests = [], screenshots = [];
const pass = value => {passed.push(value); console.log('PASS', value);};
const until = async (fn, label, ms=16000) => {const at=Date.now(); while (!await fn()) {if (Date.now()-at>ms) throw Error('Timed out: '+label); await new Promise(done=>setTimeout(done,25));}};
const contentType = name => ({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'}[path.extname(name)] || 'application/octet-stream');
const auditTransport = `
;(() => {
  const audit = globalThis.__foxTestAudit = {messages:[], native:[], timers:new Set()};
  const send = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async message => {
    audit.messages.push(message.type);
    if (!/^ikr:update:(status|auto-check|check|install|refresh)$/.test(message.type)) throw Error('Unbounded mock transport: '+message.type);
    return send(message);
  };
  for (const method of ['connectNative','sendNativeMessage']) chrome.runtime[method] = (...args) => {
    audit.native.push({method,args}); throw Error('Native transport is forbidden in preview');
  };
  const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
  window.setTimeout = (callback, milliseconds, ...args) => {
    const id = schedule(() => {audit.timers.delete(id); callback(...args);}, milliseconds);
    audit.timers.add(id); return id;
  };
  window.clearTimeout = id => {audit.timers.delete(id); cancel(id);};
})();`;

async function routeLocally(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()); requested.push(url.href);
    if (url.origin !== origin) {unexpectedRequests.push(url.href); await route.abort('blockedbyclient'); return;}
    const file = url.pathname === '/preview-driver.js' ? driver : path.join(ext, url.pathname.slice(1));
    assert.ok(file.startsWith(ext+path.sep) || file===driver, 'Fixture path stays inside development source');
    let body = fs.readFileSync(file);
    if (url.pathname === '/preview-driver.js') body = Buffer.from(body.toString('utf8')+auditTransport);
    if (url.pathname === '/popup.html') {
      let html = body.toString('utf8').replace(/\s*<script\b[^>]*>.*?<\/script>/gs, '');
      html = html.replace('</head>', '<script src="core.js" defer></script><script src="preview-driver.js" defer></script><script src="popup-fox.js" defer></script><script src="popup-updates.js" defer></script></head>');
      body = Buffer.from(html);
    }
    await route.fulfill({status:200, body, contentType:contentType(file)});
  });
}
async function localPopup(context) {
  const page = await context.newPage(); page.on('pageerror', error=>errors.push(error.message));
  await page.goto(origin+'/popup.html', {waitUntil:'networkidle'});
  await until(async()=>await page.locator('#app-updates').getAttribute('data-state')==='available', 'initial available');
  return page;
}
async function state(page, value) {
  await page.evaluate(value=>window.postMessage({type:'update-preview:state',value},location.origin), value);
  const expected = value==='installed' ? 'current' : value;
  await until(async()=>await page.locator('#app-updates').getAttribute('data-state')===expected, 'state '+value);
}
async function scrollTop(page) {
  await page.evaluate(()=>{document.scrollingElement.scrollTo({top:0,behavior:'instant'}); document.body.scrollTo({top:0,behavior:'instant'});});
}
async function screenshot(page, name) {
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:false}); screenshots.push(name+'.png');
}
async function sample(page) {
  return page.evaluate(() => {
    const mask=document.querySelector('.update-fox-window'), actor=document.querySelector('.update-fox-peek');
    const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
    const faces=[...mask.querySelectorAll('.update-fox-face')];
    return {mask:rect(mask),actor:rect(actor),transform:getComputedStyle(actor).transform,hero:rect(document.querySelector('.hero')),notice:rect(document.querySelector('#update-notice')),
      data:{wrap:{...document.querySelector('#update-notice-wrap').dataset},mask:{...mask.dataset},actor:{...actor.dataset}},
      activeFaces:faces.filter(face=>getComputedStyle(face).opacity==='1').map(face=>face.className),
      animations:document.getAnimations().filter(animation=>mask.contains(animation.effect?.target)).map(animation=>({target:animation.effect.target.className,state:animation.playState,duration:animation.effect.getTiming().duration})),
      timers:__foxTestAudit.timers.size};
  });
}
async function quiet(page, label) {
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const before=await sample(page);
  assert.equal(before.timers,0,label+' cancels all fox timers');
  assert.deepEqual(before.animations,[],label+' cancels all fox animations');
  await page.waitForTimeout(400);
  const after=await sample(page);
  assert.equal(after.transform,before.transform,label+' stays stationary relative to its clipping window');
  assert.deepEqual(after.activeFaces,before.activeFaces,label+' keeps a fixed face');
  assert.equal(after.timers,0,label+' does not schedule another cycle');
  assert.deepEqual(after.animations,[],label+' does not restart animations');
}

async function startTrajectory(page) {
  await page.evaluate(() => {
    const samples=[];
    const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    const stage=document.querySelector('.update-fox-window'),actor=document.querySelector('.update-fox-peek');
    const hero=document.querySelector('.hero'),notice=document.querySelector('#update-notice');
    const record=()=>{
      const mask=rect(stage),fox=rect(actor),matrix=new DOMMatrixReadOnly(getComputedStyle(actor).transform);
      samples.push({time:performance.now(),phase:actor.dataset.phase,pose:actor.dataset.pose,mask,fox,hero:rect(hero),notice:rect(notice),
        fullyHidden:fox.y>=mask.bottom-.1,
        pureTranslation:Math.abs(matrix.a-1)<.0001&&Math.abs(matrix.b)<.0001&&Math.abs(matrix.c)<.0001&&Math.abs(matrix.d-1)<.0001,
        activeFaces:[...actor.querySelectorAll('.update-fox-face')].filter(face=>getComputedStyle(face).opacity==='1').map(face=>face.className)});
      globalThis.__foxTrajectory.raf=requestAnimationFrame(record);
    };
    globalThis.__foxTrajectory={samples,raf:requestAnimationFrame(record)};
  });
}
async function stopTrajectory(page) {
  return page.evaluate(()=>{cancelAnimationFrame(__foxTrajectory.raf); return __foxTrajectory.samples;});
}
function validateTrajectory(samples, label) {
  assert.ok(samples.length>30,label+' records real animation frames');
  const rectKeys=['x','y','width','height'];
  const near=(a,b)=>rectKeys.every(key=>Math.abs(a[key]-b[key])<.1);
  const failures=[];
  for(let i=0;i<samples.length;i++) {
    const current=samples[i],previous=samples[i-1];
    if(current.activeFaces.length!==1) failures.push({time:current.time,faces:current.activeFaces});
    if(!current.pureTranslation) failures.push({time:current.time,rotationOrScale:true});
    if(!near(current.hero,samples[0].hero)||!near(current.notice,samples[0].notice)) failures.push({time:current.time,layoutMoved:true});
    if(previous&&Math.abs(current.fox.x-previous.fox.x)>.1&&(!previous.fullyHidden||!current.fullyHidden)) failures.push({time:current.time,visibleHorizontalMotion:true,previous,current});
  }
  assert.deepEqual(failures,[],label+' keeps one face, fixed layout and changes horizontal position only when entirely concealed');
}

(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'iknow-fox-hide-seek-'));
  const context=await chromium.launchPersistentContext(profile,{
    executablePath:process.env.IKNOW_BROWSER_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless:true,viewport:{width:376,height:600},serviceWorkers:'block'
  });
  let naturalTrajectory,caughtTrajectory,audit;
  try {
    await routeLocally(context);
    const page=await localPopup(context);
    assert.equal(await page.locator('#update-notice').isVisible(),true);
    assert.equal(await page.locator('#update-notice').getAttribute('href'),'#app-updates');
    assert.equal(await page.locator('.update-fox-window').getAttribute('aria-hidden'),'true');
    assert.equal(await page.locator('.update-fox-window').evaluate(element=>getComputedStyle(element).pointerEvents),'none');
    const faces=await page.locator('.update-fox-face').evaluateAll(elements=>elements.map(element=>({name:element.className,image:getComputedStyle(element).backgroundImage})));
    assert.equal(faces.length,4);
    for(const pose of ['idle','blink','happy','wave'])assert.equal(await page.locator('.update-fox-'+pose).count(),1);
    assert.ok(faces.every(face=>face.image.includes('assets/reading-fox-v1.png')&&!face.image.includes('reading-fox-notice-v1.png')));
    const mask=await page.locator('.update-fox-window').evaluate(element=>({overflow:getComputedStyle(element).overflow,zIndex:getComputedStyle(element).zIndex}));
    assert.equal(mask.overflow,'hidden');
    assert.ok(Number(mask.zIndex)<await page.locator('#update-notice').evaluate(element=>Number(getComputedStyle(element).zIndex)));
    pass('The actual development popup restores all four original fox poses behind the opaque Updates banner and keeps decoration out of pointer hit testing');

    await startTrajectory(page);
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-phase')==='peek','first real peek');
    const first=await sample(page);await screenshot(page,'01-original-fox-peeks-right');
    const peeks=[{x:first.actor.x,phase:first.data.actor.phase}];
    await until(async()=>{const next=await sample(page);return next.data.actor.phase==='peek'&&next.actor.x<first.actor.x-100;},'fox reappears on the left');
    const left=await sample(page);peeks.push({x:left.actor.x,phase:left.data.actor.phase});await screenshot(page,'02-original-fox-peeks-left');
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-pose')==='wave','original friendly wave',16000);
    await screenshot(page,'03-original-fox-waves-at-third-spot');
    naturalTrajectory=await stopTrajectory(page);validateTrajectory(naturalTrajectory,'Uninterrupted hide-and-seek');
    const poses=new Set(naturalTrajectory.map(item=>item.pose));
    assert.deepEqual([...poses].sort(),['blink','happy','idle','wave'].sort());
    assert.ok(peeks[1].x<peeks[0].x-100,'The first concealed relocation travels from the right toward the left');
    assert.ok(naturalTrajectory.some(item=>item.phase==='travel'&&item.fullyHidden));
    assert.ok(naturalTrajectory.some(item=>item.phase==='reveal'&&!item.fullyHidden));
    pass(`${naturalTrajectory.length} real animation frames show the fox hiding fully before right-to-left relocation, peeking from different places and retaining its original blink, happy and wave animation without moving the banner`);

    await page.mouse.move(375,590);
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-phase')==='peek','peek for mouse catch');
    await startTrajectory(page);
    const beforeCatch=await sample(page);
    await page.mouse.move(beforeCatch.actor.x+44,beforeCatch.actor.y+31);
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-phase')==='caught','mouse startles fox',1500);
    assert.equal(await page.locator('.update-fox-peek').getAttribute('data-pose'),'happy');
    assert.equal(await page.locator('.update-fox-startle').evaluate(element=>getComputedStyle(element).opacity),'1');
    await screenshot(page,'04-mouse-catches-startled-fox');
    await page.mouse.move(375,590);
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-phase')==='recovery','caught fox ducks fully',2000);
    const hidden=await sample(page);assert.ok(hidden.actor.y>=hidden.mask.bottom,'Caught fox is completely below the clipping edge');
    await screenshot(page,'05-caught-fox-hides');
    await until(async()=>await page.locator('.update-fox-peek').getAttribute('data-phase')==='peek','fox returns after recovering',5000);
    const returned=await sample(page);assert.ok(Math.abs(returned.actor.x-beforeCatch.actor.x)>20,'Fox returns at another hiding place');
    assert.equal(returned.data.actor.pose,'idle');
    await screenshot(page,'06-fox-returns-later');
    caughtTrajectory=await stopTrajectory(page);validateTrajectory(caughtTrajectory,'Mouse catch, duck and return');
    assert.ok(caughtTrajectory.some(item=>item.phase==='caught')&&caughtTrajectory.some(item=>item.phase==='hide')&&caughtTrajectory.some(item=>item.phase==='recovery'));
    pass('Mouse proximity produces a brief startled original fox, a complete duck, a hidden recovery pause and a later return at another position');

    const messagesBefore=await page.evaluate(()=>[...__foxTestAudit.messages]);
    await page.locator('#update-notice').click();
    await until(async()=>await page.locator('#app-updates').evaluate(element=>{const r=element.getBoundingClientRect();return r.bottom<=innerHeight+2&&r.top>=-2&&document.activeElement===element;}),'click reveals/focuses Updates');
    await quiet(page,'Scrolled-out scene');
    await scrollTop(page);await page.locator('#update-notice').focus();await page.keyboard.press('Enter');
    await until(async()=>await page.evaluate(()=>Math.max(document.scrollingElement.scrollTop,document.body.scrollTop)>0&&document.activeElement.id==='app-updates'),'Enter reveals/focuses Updates');
    assert.deepEqual(await page.evaluate(()=>__foxTestAudit.messages),messagesBefore);
    pass('The banner remains clickable and keyboard accessible, focuses Updates without starting work and suspends the fox when scrolled out of view');

    await scrollTop(page);
    for(const value of ['current','error','checking']) {
      await state(page,value);assert.equal(await page.locator('#update-notice-wrap').isVisible(),false);await quiet(page,value);
    }
    for(const value of ['downloading','installing','complete','installed']) {
      await state(page,value);assert.equal(await page.locator('#update-notice-wrap').isVisible(),true);await quiet(page,value);
      assert.equal(await page.locator('.update-fox-peek').getAttribute('data-pose'),'idle');
    }
    pass('Hidden notices cancel the scene; download, installation and refresh states retain a quiet original fox with no timers or animations');

    await state(page,'available');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await quiet(page,'Hidden document');
    await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    await until(async()=>['travel','reveal','peek'].includes(await page.locator('.update-fox-peek').getAttribute('data-phase')),'visible document resumes');
    await page.emulateMedia({reducedMotion:'reduce'});await quiet(page,'Reduced motion');
    assert.equal(await page.locator('.update-fox-peek').getAttribute('data-phase'),'static');
    assert.equal(await page.locator('.update-fox-peek').getAttribute('data-pose'),'idle');
    await screenshot(page,'07-reduced-motion-static-fox');
    await page.locator('#update-notice').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'app-updates');
    assert.ok(await page.evaluate(()=>Math.max(document.scrollingElement.scrollTop,document.body.scrollTop)>0));
    pass('Document visibility cancels and restores the scene; reduced motion keeps one static original fox and immediate Updates navigation');

    await scrollTop(page);await page.emulateMedia({reducedMotion:'no-preference'});
    await until(async()=>['travel','reveal','peek'].includes(await page.locator('.update-fox-peek').getAttribute('data-phase')),'scene resumes before teardown');
    await page.evaluate(()=>dispatchEvent(new Event('pagehide')));await quiet(page,'Disposed popup');
    await page.mouse.move(180,180);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});
    await quiet(page,'Disposed popup after later lifecycle events');
    assert.equal(await page.locator('.update-fox-peek').getAttribute('data-phase'),'off');
    pass('Popup teardown cancels pending timers and animations and removes listeners so later lifecycle or pointer events cannot restart it');

    assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
    audit=await page.evaluate(()=>({messages:__foxTestAudit.messages,native:__foxTestAudit.native,timers:__foxTestAudit.timers.size}));
    assert.deepEqual(audit.native,[]);
    assert.ok(audit.messages.every(type=>['ikr:update:status','ikr:update:auto-check'].includes(type)));
    assert.ok(!requested.some(url=>url.includes('reading-fox-notice-v1.png')));
    pass('No browser errors, foreign requests, native messaging, install/check/refresh commands or use of the rejected new atlas');
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual canonical-development popup, original four-pose fox and animation code; all requests locally fulfilled; bounded preview-only Chrome transport',passed,screenshots,naturalTrajectory,caughtTrajectory,errors,unexpectedRequests,requested,audit},null,2));
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
