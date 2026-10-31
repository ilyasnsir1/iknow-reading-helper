/* Preview source caching survives reload and remains optional and validated. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const source=fs.readFileSync(path.join(__dirname,"study-focus-course.js"),"utf8");
const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../native-audio-audit/goal-19053.json"),"utf8"));
(async()=>{
 const browser=await chromium.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/study-focus-course.js",route=>route.fulfill({contentType:"application/javascript",body:source}));
  await page.goto("http://127.0.0.1:52332/study-focus.html?review=course-cache#study");
  await page.locator(".focus-card").waitFor();
  const result=await page.evaluate(async raw=>{
   const Catalog=IKnowReaderStudyCatalog, Client=IKnowFocusCourse;
   const database="iknow-reading-helper-study-course-preview",store="cache";
   async function storage(write){return new Promise((resolve,reject)=>{
    const open=indexedDB.open(database,1);
    open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains(store))open.result.createObjectStore(store);};
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction(store,write?"readwrite":"readonly"),request=tx.objectStore(store).get(Catalog.KEY);let value;
     request.onsuccess=()=>{value=request.result;if(write){value=write(value);tx.objectStore(store).put(value,Catalog.KEY);}};
     tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
    };
   });}
   const expect=(condition,message)=>{if(!condition)throw Error(message);};
   const sourceFor=id=>({...structuredClone(raw),id:Number(id),title:"Cached course "+id});
   let calls=0;
   const fetchImpl=async url=>{calls++;const id=url.endsWith("catalog-source.json")?"19053":url.split("/").pop();return new Response(JSON.stringify(sourceFor(id)),{status:200,headers:{"content-type":"application/json"}});};
   const client=Client.createClient({fetchImpl});
   expect(await client.cached("19053")===null,"A cold cache has no visible course");
   const initial=await client.load("19053");expect(initial.records.length===400,"All validated source records are retained");
   const warm=await Client.createClient({fetchImpl}).cached("19053");
   expect(warm?.title===initial.title&&warm.records.length===400&&!warm.stale,"Another client reads the full valid cached source");
   expect(calls===1,"Reading a warm source never fetches");

   const first=Client.createClient({fetchImpl}),second=Client.createClient({fetchImpl});
   await Promise.all([first.load("19054"),second.load("19055")]);
   const concurrent=await storage();
   expect(["19053","19054","19055"].every(id=>concurrent.entries[id]),"Concurrent clients retain both new courses and earlier data");
   expect(Object.keys(concurrent.entries).length<=Catalog.MAX_COURSES,"The shared cache stays bounded");

   await storage(value=>{value.entries["19053"].at=Date.now()-Catalog.TTL-1000;return value;});
   const stale=await Client.createClient({fetchImpl}).cached("19053");
   expect(stale?.stale===true&&stale.records.length===400,"Expired validated text is marked stale instead of treated as a fresh source");
   const before=calls;await Client.createClient({fetchImpl}).load("19053");expect(calls===before+1,"Expired text revalidates through the source backend");

   await storage(value=>{value.entries["19053"].at=Date.now()+3600000;return value;});
   expect(await Client.createClient({fetchImpl}).cached("19053")===null,"Future cache timestamps cannot become a visible course");
   await storage(value=>{value.entries["19053"].at=Date.now();value.entries["19053"].source.id=19055;return value;});
   expect(await Client.createClient({fetchImpl}).cached("19053")===null,"A different course ID cannot attach to the selected course");

   const originalIndexedDB=Object.getOwnPropertyDescriptor(window,"indexedDB");
   const restore=()=>Object.defineProperty(window,"indexedDB",originalIndexedDB);
   let fallbackCalls=0;
   const fallbackFetch=async()=>{fallbackCalls++;return new Response(JSON.stringify(sourceFor("19053")),{status:200});};
   try{
    Object.defineProperty(window,"indexedDB",{configurable:true,value:undefined});
    const memory=Client.createClient({fetchImpl:fallbackFetch});await memory.load("19053");
    expect((await memory.cached("19053"))?.records.length===400&&fallbackCalls===1,"An unavailable IndexedDB uses an in-memory cache without failing a course load");
    Object.defineProperty(window,"indexedDB",{configurable:true,value:{open(){const request={};queueMicrotask(()=>request.onblocked?.());return request;}}});
    const blocked=Client.createClient({fetchImpl:fallbackFetch});await blocked.load("19053");
    expect((await blocked.cached("19053"))?.records.length===400&&fallbackCalls===2,"A blocked cache open resolves to memory instead of hanging");
   }finally{restore();}

   await storage(()=>({schemaVersion:1,entries:{}}));
   const originalTransaction=IDBDatabase.prototype.transaction;
   try{
    IDBDatabase.prototype.transaction=function(names,mode,...rest){if(mode==="readwrite")throw new DOMException("Simulated full store","QuotaExceededError");return originalTransaction.call(this,names,mode,...rest);};
    const full=Client.createClient({fetchImpl:fallbackFetch});
    const loaded=await full.load("19053"),saved=await full.cached("19053");
    expect(loaded.records.length===400&&saved?.records.length===400,"A cache write failure cannot turn a valid explicit load into an error");
   }finally{IDBDatabase.prototype.transaction=originalTransaction;}
   return{calls,concurrent:Object.keys(concurrent.entries),fallbackCalls};
  },raw);
  assert.deepEqual(result.concurrent.sort(),["19053","19054","19055"]);
  assert.deepEqual(errors,[]);
  console.log("PASS Public course cache: validated warm loads, concurrent clients, stale/future/mismatched entries, unavailable/blocked IndexedDB and write-failure memory fallback");
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
