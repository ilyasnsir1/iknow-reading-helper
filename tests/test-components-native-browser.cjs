/* Real Brave native-messaging and detached worker lifetimes. The helper's
 * download transport serves a small local fixture; no actual models/setup. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const root=path.resolve(__dirname,".."),out=path.join(__dirname,"components-native-evidence"),python=path.join(process.env.LOCALAPPDATA,"iKnowLesehilfe/runtime/python/python.exe");fs.mkdirSync(out,{recursive:true});
const until=async(fn,label)=>{const at=Date.now();while(!await fn()){if(Date.now()-at>30000)throw Error("Timed out: "+label);await new Promise(resolve=>setTimeout(resolve,50));}};
(async()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"iknow-component-browser-")),app=path.join(fixture,"App"),cache=path.join(fixture,"Cache");fs.mkdirSync(app,{recursive:true});fs.mkdirSync(cache);
 fs.cpSync(path.join(root,"helper"),path.join(app,"helper"),{recursive:true,filter:src=>!src.includes("__pycache__")});
 fs.mkdirSync(path.join(app,"extension"));fs.copyFileSync(path.join(root,"extension/manifest.json"),path.join(app,"extension/manifest.json"));
 const data=Buffer.alloc(6*1024*1024,83),sha=crypto.createHash("sha256").update(data).digest("hex");fs.writeFileSync(path.join(fixture,"payload.bin"),data);
 fs.writeFileSync(path.join(app,"helper/component_catalog.py"),`CATALOG_VERSION='fixture'\nCOMPONENTS={'fixture':{'id':'fixture','title':'Native download fixture','description':'Six MB test data','version':'1','downloadBytes':${data.length},'sizeIsEstimate':False,'requirements':None,'artifacts':[{'name':'Fixture data','url':'https://fixture.example/model','sha256':'${sha}','target':'models/fixture.bin','root':'cache','maximum':${data.length},'size':${data.length},'archive':None}]}}\n`);
 const transport=`import io,time,pathlib\nclass Response(io.BytesIO):\n def __init__(self,request):\n  payload=(pathlib.Path(__file__).resolve().parents[2]/'payload.bin').read_bytes()\n  offset=int(request.get_header('Range','bytes=0-').split('=')[1].split('-')[0])\n  super().__init__(payload[offset:]);self.status=206 if offset else 200;self.headers={'Content-Length':str(len(payload)-offset),'Content-Range':f'bytes {offset}-{len(payload)-1}/{len(payload)}'}\n def geturl(self):return 'https://fixture.example/model'\n def read(self,size=-1):time.sleep(.10);return super().read(size)\ndef urlopen(request,**kwargs):return Response(request)\n`;
 fs.writeFileSync(path.join(app,"helper/fixture_transport.py"),transport);
 const manager=path.join(app,"helper/component_manager.py");fs.writeFileSync(manager,fs.readFileSync(manager,"utf8").replace("from component_catalog import CATALOG_VERSION, COMPONENTS","from component_catalog import CATALOG_VERSION, COMPONENTS\nimport fixture_transport\nurllib.request.urlopen = fixture_transport.urlopen"));
 const extension=require("./fixtures/isolate-extension.cjs")(path.join(root,"extension"),out);
 const name="de.iknow.test.components.t"+crypto.randomBytes(8).toString("hex"),manifest=path.join(fixture,"native.json"),launcher=path.join(fixture,"host.cmd");
 fs.writeFileSync(launcher,`@echo off\r\nset "IKNOW_READER_CACHE=${cache}"\r\nset "PYTHONDONTWRITEBYTECODE=1"\r\n"${python}" -u "${path.join(app,"helper/native_host.py")}"\r\n`);
 fs.writeFileSync(path.join(extension,"fixture-native.js"),`const originalNative=chrome.runtime.connectNative.bind(chrome.runtime);chrome.runtime.connectNative=host=>{if(host!=='de.iknow.lesehilfe')throw Error('Unexpected host');return originalNative('${name}');};`);
 const background=path.join(extension,"background.js");fs.writeFileSync(background,'importScripts("fixture-native.js");\n'+fs.readFileSync(background,"utf8"));
 const context=await chromium.launchPersistentContext(path.join(out,"profile-"+Date.now()),{executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
 let registered=false;const errors=[];
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker"),id=new URL(worker.url()).host;
  fs.writeFileSync(manifest,JSON.stringify({name,description:"Isolated component test",path:launcher,type:"stdio",allowed_origins:[`chrome-extension://${id}/`]}));
  execFileSync(python,["-B",path.join(__dirname,"component-registry-fixture.py"),"register",name,manifest],{windowsHide:true});registered=true;
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));await page.goto(`chrome-extension://${id}/models.html`);await page.locator(".component button").click();
  await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(cache,"components/job.json"))).phase==='downloading';}catch{return false;}},"detached real native download");
  await page.locator("#pause").click();await until(async()=>await page.locator("#pause").innerText()==="Resume","native pause");assert.equal(fs.existsSync(path.join(cache,"models/fixture.bin")),false);
  const partial=path.join(cache,"components/downloads",sha+".part");assert.ok(fs.statSync(partial).size>0);
  await page.locator("#pause").click();await page.close();
  await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(cache,"components/job.json"))).status==='complete';}catch{return false;}},"worker survives native disconnect and UI closure");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(cache,"models/fixture.bin"))).digest("hex"),sha);
  const result={passed:true,pauseRetainsPartial:true,resumeVerified:true,continuesAfterUIAndNativePortClose:true,actualBraveNativeMessaging:true,fixtureBytes:data.length,scope:"Unique test host registration only; local fake transport, no models or installed application touched"};
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));console.log("PASS Actual Brave/native broker starts, pauses and resumes a verified small download; detached installation completes after UI/native port close");
 }finally{
  await context.close();
  if(registered)execFileSync(python,["-B",path.join(__dirname,"component-registry-fixture.py"),"remove",name,manifest],{windowsHide:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
