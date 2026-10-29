/* Compare the restored default to the existing production styles themselves.
 * Pure UI fixtures: no extension host, browser profile, storage or network. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const ext=path.resolve(__dirname,"../extension"),out=path.join(__dirname,"original-theme-evidence");
const css=name=>fs.readFileSync(path.join(ext,name),"utf8");
const own=(page,body)=>`<html class="ikr-theme-page" data-ikr-theme="paper"><head></head><body data-ikr-page="${page}">${body}</body></html>`;
const cases=[
 {name:"course",base:["content.css","automation.css","series.css","companion.css","panel-layout.css","course-study.css"],theme:["theme-content.css"],html:`<html class="ikr-active" data-ikr-theme="paper"><head></head><body><div class="ikr-toolbar ikr-owned"><strong>iKnow! Reading Helper</strong><label>Words<input type="checkbox" checked></label><select><option>All groups</option></select><button>Retry</button></div><section class="ikr-preparation ikr-owned"><div><h2>Partly saved</h2><p class="ikr-preparation-detail">Choose extras to prepare.</p><button>Prepare selection</button></div></section><section class="ikr-series-card ikr-owned"><p class="ikr-series-eyebrow">iKnow!</p><h2>Prepare your courses</h2><button>Prepare selected</button></section></body></html>`,selectors:[".ikr-toolbar",".ikr-toolbar strong",".ikr-toolbar label",".ikr-toolbar input",".ikr-toolbar select",".ikr-toolbar button",".ikr-preparation",".ikr-preparation h2",".ikr-preparation::after",".ikr-preparation button",".ikr-series-card",".ikr-series-eyebrow",".ikr-series-card h2"]},
 {name:"study",base:["study.css"],theme:["theme-pages.css"],html:own("study",`<main><h1>Your study space</h1><div class="workspace"><aside class="library"><input id="search" type="search"><button class="library-item" aria-current="true"><span class="saved-japanese">それ</span><span class="saved-meaning">that</span></button></aside><section class="practice"><p class="japanese">それはとてもいい話だ。</p><p class="kana">それ は とても</p><div class="translation"><p lang="en">That's a really nice story.</p></div><button class="primary">Start practice</button><button class="secondary">Listen to original</button></section></div></main>`),selectors:["html","body","h1",".workspace",".library","#search",".library-item",".saved-japanese",".saved-meaning",".japanese",".kana",".translation p",".primary",".secondary"]},
 {name:"models",base:["models.css"],theme:["theme-pages.css"],html:own("models",`<main><h1>Models & voices</h1><p class="intro">Choose what you need.</p><article class="component"><h2>German & meaning colors</h2><p class="component-description">Local language model</p><div class="component-meta">Local files</div><span class="status" data-ready="true">Installed</span><button>Check</button></article><section class="job"><p>Preparing</p></section></main>`),selectors:["html","body","h1",".intro",".component","h2",".component-description",".component-meta",".status","button",".job"]},
 {name:"popup",base:["popup.css"],theme:["theme-pages.css","theme-popup.css"],html:own("popup",`<main><h1>Read, listen & understand</h1><p class="eyebrow">iKnow! Reading Helper</p><label class="setting-row master"><span class="setting-title">Reading Helper enabled</span><input type="checkbox" checked><span class="switch"></span></label><div class="card"><label class="select-row"><span class="setting-title">Meaning colors</span><select><option>All groups</option></select></label></div><a class="queue-link">Models & voices</a><button id="import-course-pack">Choose file</button></main>`),selectors:["html","body","h1",".eyebrow",".master",".setting-title",".switch",".card",".select-row select",".queue-link","#import-course-pack"]},
 {name:"queue",base:["queue.css"],theme:["theme-pages.css"],html:own("queue",`<main><h1>Your preparation</h1><section class="panel"><p id="phase">Audio timings</p><span class="badge" data-status="paused">Paused</span><button>Resume</button><div class="features"><span>German</span></div></section></main>`),selectors:["html","body","h1",".panel","#phase",".badge","button",".features span"]}
];
const style=page=>page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{const pseudo=selector.match(/::(?:before|after)$/)?.[0],node=document.querySelector(pseudo?selector.slice(0,-pseudo.length):selector);if(!node)throw Error("Fixture selector missing: "+selector);const value=getComputedStyle(node,pseudo);return[selector,Object.fromEntries(["color","backgroundColor","backgroundImage","borderTopColor","boxShadow","accentColor"].map(key=>[key,value[key]]))];})),page._selectors);
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:900}});let compared=0;
 await page.route("**/*",route=>route.abort());
 try{
  for(const item of cases){
   const base=item.base.map(css).join("\n"),themed=css("theme.css")+"\n"+base+"\n"+item.theme.map(css).join("\n");
   page._selectors=item.selectors;
   await page.setContent(item.html.replace("</head>",`<style>${base}</style></head>`));
   const original=await style(page);
   await page.setContent(item.html.replace("</head>",`<style>${themed}</style></head>`));
   const restored=await style(page);
   for(const selector of item.selectors)assert.deepEqual(restored[selector],original[selector],`${item.name} ${selector} default must retain original paints`);
   compared+=item.selectors.length;
   await page.screenshot({path:path.join(out,item.name+"-original.png"),fullPage:true});
   await page.locator("html").evaluate(node=>node.dataset.ikrTheme="tokyo");await page.waitForTimeout(180);
   const dark=await style(page);
   const surface=item.name==="course"?".ikr-toolbar":"body";
   assert.notEqual(dark[surface].backgroundColor,restored[surface].backgroundColor,`${item.name} dark themes remain distinct`);
   console.log(`PASS ${item.name}: Original retains every existing sampled paint; Tokyo remains an additional theme`);
  }
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({passed:true,cases:cases.map(value=>value.name),comparedElements:compared,paintProperties:["color","backgroundColor","backgroundImage","borderTopColor","boxShadow","accentColor"],scope:"Production original CSS compared with production theme layers under the original paper storage id; UI fixtures only, no profile/native/network"},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
