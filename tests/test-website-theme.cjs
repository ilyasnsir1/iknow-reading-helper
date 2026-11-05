const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const fixture = `<!doctype html><style>
body{background:#fff;color:#000}.marketing_navi .fixed-container{background:linear-gradient(#fff,#eee)}
.content-container,.item,.course{background:#fff;color:#000;border:1px solid #ccc}
</style><nav class="marketing_navi"><section class="fixed-container"><h1 class="logo">iKnow!</h1></section></nav>
<div class="content"><div class="content-container"><div class="course-content-container"><div class="course-content"><div class="items"><div class="item">
<div class="item-details"><div class="cue-response"><a class="cue" href="/items/100">それ</a><p class="response">that</p></div></div>
<div class="item-sentences"><div class="sentence"><div class="sentence-text"><p class="text">それは本です。</p><p class="transliteration">それ は ほん です。</p><p class="translation">That is a book.</p></div></div></div>
</div></div></div></div></div></div>`;

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ikr-website-theme-'));
  const extension = require('./fixtures/isolate-extension.cjs')(path.resolve(__dirname, '../extension'), temp);
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`],
    viewport: {width: 1040, height: 770}
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.route('https://iknow.jp/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/courses/19053') return route.fulfill({ contentType:'text/html', body:fixture });
      if (pathname === '/content/japanese') return route.fulfill({ contentType:'text/html', body:'<!doctype html><body style="background:white"><div class="content-container">Japanese</div>' });
      if (pathname === '/content/japanese/series/3423') return route.fulfill({ contentType:'text/html', body:'<!doctype html><h1>Japanese Core 1000</h1><div class="series_list"><a href="/courses/19053">Step 1</a></div>' });
      return route.abort();
    });
    const course = await context.newPage();
    await course.goto('https://iknow.jp/courses/19053');
    const picker = course.locator('.ikr-toolbar .ikr-theme-trigger');
    const theme = async value => {await picker.click();await course.locator(`[data-theme-value="${value}"]`).click();};
    const bodyColor = page => page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
    const nativeColor = await bodyColor(course);
    await theme('midnight');
    assert.equal(await bodyColor(course),nativeColor);
    await picker.click();
    assert.equal(await course.getByRole('button',{name:'Helper panels',exact:true}).getAttribute('aria-pressed'),'true');
    await course.getByRole('button',{name:'Entire iKnow page',exact:true}).click();
    assert.equal(await bodyColor(course),'rgb(18, 21, 28)');
    assert.equal(await course.locator('.fixed-container').evaluate(node=>getComputedStyle(node).backgroundImage),'none');
    await course.keyboard.press('Escape');
    await course.reload();
    await course.waitForSelector('html[data-ikr-website-theme]',{state:'attached'});
    const catalog = await context.newPage();
    await catalog.goto('https://iknow.jp/content/japanese');
    assert.equal(await catalog.locator('html').getAttribute('data-ikr-website-theme'),null);
    assert.equal(await catalog.locator('.ikr-toolbar, .ikr-series-card').count(),0);
    const series = await context.newPage();
    await series.goto('https://iknow.jp/content/japanese/series/3423');
    await series.waitForSelector('html[data-ikr-website-theme]',{state:'attached'});
    for(const [themeId,color] of [['tokyo','rgb(21, 17, 31)'],['forest','rgb(17, 27, 24)']]){
      await theme(themeId);
      for (const page of [course,series]) await page.waitForFunction(color=>getComputedStyle(document.body).backgroundColor===color,color);
    }
    await theme('paper');
    for (const page of [course,catalog,series]) await page.waitForSelector('html:not([data-ikr-website-theme])',{state:'attached'});
    assert.equal(await bodyColor(course),nativeColor);
    await theme('midnight');
    await picker.click();
    await course.getByRole('button',{name:'Helper panels',exact:true}).click();
    for (const page of [course,catalog,series]) await page.waitForSelector('html:not([data-ikr-website-theme])',{state:'attached'});
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('iknowReaderWebsiteThemeScope')).iknowReaderWebsiteThemeScope),'panels');
    const app = await context.newPage();
    await app.goto(`chrome-extension://${new URL(worker.url()).host}/models.html`);
    await app.locator('.ikr-theme-trigger').click();
    assert.equal(await app.getByRole('button',{name:'Entire iKnow page',exact:true}).count(),0);
    console.log('PASS Theme scope defaults to panels, persists across reload, follows course and series tabs, restores native colors, and stays separate from app themes.');
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
