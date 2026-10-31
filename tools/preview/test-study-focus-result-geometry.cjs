/* Result actions are centered, and chart density cannot resize exercises. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const Results=require('./study-focus-results.js');
const origin='http://127.0.0.1:52332',out=path.resolve(__dirname,'../../tests/study-focus-result-geometry-evidence');fs.mkdirSync(out,{recursive:true});
const viewports=[{width:1280,height:720},{width:1440,height:900},{width:390,height:844}],themes=['paper','midnight','tokyo','forest'];
async function centered(page,label){
 const geometry=await page.locator('.focus-results-actions').evaluate(footer=>{
  const f=footer.getBoundingClientRect(),buttons=[...footer.querySelectorAll('button')].filter(node=>node.getBoundingClientRect().width);
  return {footer:{x:f.x,width:f.width},buttons:buttons.map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);const t=range.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,textCenter:t.x+t.width/2,paddingLeft:parseFloat(s.paddingLeft),paddingRight:parseFloat(s.paddingRight)};})};
 });
 const rows=[];
 for(const button of geometry.buttons){let row=rows.find(row=>Math.abs(row.y-button.y)<1);if(!row){row={y:button.y,buttons:[]};rows.push(row);}row.buttons.push(button);assert.equal(button.paddingLeft,button.paddingRight,label+': symmetric button padding');assert.ok(Math.abs(button.x+button.width/2-button.textCenter)<=1,label+': text centered within button');}
 for(const row of rows){const left=Math.min(...row.buttons.map(button=>button.x)),right=Math.max(...row.buttons.map(button=>button.x+button.width));assert.ok(Math.abs((left+right)/2-(geometry.footer.x+geometry.footer.width/2))<=1,label+': every wrapped action row is centered');}
 return geometry;
}
async function snapshot(page,selectors){return page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})),selectors);}
function same(left,right,label){assert.deepEqual(Object.keys(left),Object.keys(right));for(const selector of Object.keys(left))for(const field of ['x','y','width','height'])assert.ok(Math.abs(left[selector][field]-right[selector][field])<=1,`${label}: ${selector} ${field} differs by ${left[selector][field]-right[selector][field]}`);}
async function startKana(page,density,theme,viewport){
 await page.setViewportSize(viewport);await page.goto(origin+'/study-focus.html?review=result-geometry');await page.locator('.focus-card').waitFor();await page.locator('[data-view="kana"]').click();await page.locator('[data-kana-size="'+density+'"]').click();await page.locator('html').evaluate((node,value)=>node.dataset.ikrTheme=value,theme);
 assert.equal(await page.locator('[data-kana-root]').getAttribute('data-kana-density'),density);assert.equal(await page.locator('.kana-cell').count(),104);
 if(viewport.width>760){assert.ok(await page.locator('[data-kana-root]').evaluate(node=>node.scrollHeight<=node.clientHeight+1),'All groups still fit in the desktop chart');assert.ok(await page.locator('.kana-cell').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().bottom<=innerHeight)),'All 104 chart characters remain visible');}
 const font=await page.locator('.kana-cell>span').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
 await page.locator('[data-kana-action="clear"]').click();for(const key of ['basic:あ','basic:い','basic:う'])await page.locator('[data-kana-select="'+key+'"]').click();
 if(await page.locator('[data-kana-order-label]').innerText()!=='Chart order')await page.locator('[data-kana-order-step="next"]').click();await page.locator('[data-kana-action="start"]').click();
 const practice=await snapshot(page,['.app-header','.app-frame','.kana-panel','.kana-question','.kana-question-glyph','[data-kana-answer]','.kana-answer-footer']);
 await page.locator('[data-kana-answer]').fill('wrong');await page.locator('[data-kana-form]').evaluate(form=>form.requestSubmit());await page.locator('[data-kana-action="end"]').click();await page.locator('.focus-results').waitFor();
 const results=await snapshot(page,['.app-header','.app-frame','.kana-panel','.focus-results','.focus-results-inner','.focus-result-map-main','.focus-result-map-sidebar','.focus-result-score','.focus-results-actions']);
 assert.equal(await page.locator('.focus-results-actions button').count(),2);const two=await centered(page,'Kana '+density+'/'+theme+'/'+viewport.width+' two actions');
 if(density==='large'&&(theme==='paper'||theme==='midnight'))await page.screenshot({path:path.join(out,'results-two-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width<760});
 await page.locator('[data-action="result-practice-mistakes"]').click();await page.locator('[data-kana-action="end"]').click();await page.locator('.focus-results').waitFor();assert.equal(await page.locator('.focus-results-actions button').count(),3);const three=await centered(page,'Kana '+density+'/'+theme+'/'+viewport.width+' three actions');
 if(density==='large'&&(theme==='paper'||theme==='midnight'))await page.screenshot({path:path.join(out,'results-three-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width<760});
 await page.locator('[data-action="result-back-study"]').click();assert.equal(await page.locator('[data-kana-root]').getAttribute('data-kana-density'),density,'Returning to the chart remembers its density');
 return{practice,results,font,two,three};
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 try{
  const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[],evidence=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  for(const theme of themes)for(const viewport of viewports){const compact=await startKana(page,'compact',theme,viewport),large=await startKana(page,'large',theme,viewport);assert.ok(large.font>compact.font,'Large still enlarges the chart');same(compact.practice,large.practice,'Practice '+theme+'/'+viewport.width);same(compact.results,large.results,'Results '+theme+'/'+viewport.width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');evidence.push({theme,viewport,compact,large});if(theme==='paper'||theme==='midnight'){await page.screenshot({path:path.join(out,'chart-'+theme+'-'+viewport.width+'.png'),fullPage:viewport.width<760});}}
  const css=[path.resolve(__dirname,'../../extension/theme.css'),...['study-layouts.css','study-focus.css','study-focus-results.css'].map(name=>path.join(__dirname,name))].map(file=>fs.readFileSync(file,'utf8').replace(/@import[^;]*;/g,'')).join('\n');
  const fixture=await context.newPage();fixture.on('pageerror',error=>errors.push(error.message));
  const session={keys:['a','b'],pool:[{key:'a',japanese:'家',english:'house',kind:'word'},{key:'b',japanese:'猫',english:'cat',kind:'word'}],results:[{key:'a',japanese:'家',expected:'house',submitted:'car',outcome:'again'},{key:'b',japanese:'猫',expected:'cat',submitted:'cat',outcome:'good'}],complete:true};
  for(const test of [false,true])for(const originalLabel of ['', 'Back to test results']){
   await fixture.setContent('<!doctype html><html data-ikr-theme="paper"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'.app-frame{position:relative;width:calc(100% - 48px);height:calc(100dvh - 48px);margin:24px auto;flex:none}</style></head><body><div class="app-frame">'+Results.render({...session,test},{originalLabel})+'</div></body></html>');
   for(const theme of themes)for(const viewport of viewports){await fixture.setViewportSize(viewport);await fixture.locator('html').evaluate((node,value)=>node.dataset.ikrTheme=value,theme);await centered(fixture,(test?'Test':'Practice')+'/'+originalLabel+'/'+theme+'/'+viewport.width);}
  }
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===origin),'No uploads or native jobs');fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,evidence},null,2));console.log('PASS Centered result action rows and text for Kana/Practice/Test with two or three buttons; Compact/Large affects only chart geometry; four themes × three viewport sizes');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
