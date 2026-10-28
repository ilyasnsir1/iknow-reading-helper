/* Preview-only Chrome shim. No native messaging, network, installation or storage. */
"use strict";
(() => {
  const key = "iknowReaderUpdateState", listeners = [], timers = new Set(), pending = new Set();
  let currentVersion = "1.34.1", state = {}, checkTarget = "available";
  const delay = (fn, ms) => {const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;};
  const stop = () => {for(const id of timers) clearTimeout(id);timers.clear();for(const finish of [...pending])queueMicrotask(finish);};
  const templates = {
    available:{status:"available",latestVersion:"1.35.0",message:"Version 1.35.0 is available."},
    current:{status:"current",latestVersion:"1.34.1",message:"You are up to date."},
    checking:{status:"checking",message:"Checking for updates…"},
    downloading:{status:"downloading",latestVersion:"1.35.0",progress:.44,message:"Downloading the update …"},
    installing:{status:"installing",latestVersion:"1.35.0",progress:.96,message:"Installing the update …"},
    complete:{status:"complete",latestVersion:"1.35.0",refreshTabs:true,message:"Update installed. Reloading Reading Helper…"},
    installed:{status:"current",latestVersion:"1.35.0",refreshTabs:true,message:"Updated. Refresh your open iKnow pages."},
    error:{status:"error",message:"The update could not be downloaded. Check your connection and try again."}
  };
  function emit(next, additions={}) {
    if(next === "installed") currentVersion="1.35.0";
    else if(next === "current" || next === "available") currentVersion="1.34.1";
    state={currentVersion,...templates[next],...additions};
    const version=document.getElementById("update-version");if(version)version.textContent="Version "+currentVersion;
    for(const listener of listeners)listener({[key]:{newValue:{...state}}},"local");
    parent.postMessage({type:"update-preview:rendered",status:state.status,refreshTabs:state.refreshTabs===true,message:state.message},location.origin);
    return {ok:state.status!=="error",state:{...state}};
  }
  function install() {
    stop();emit("downloading",{progress:0});
    for(let i=1;i<=12;i++)delay(()=>emit("downloading",{progress:i/12*.9}),i*180);
    delay(()=>emit("installing"),2400);delay(()=>emit("complete"),3600);delay(()=>emit("installed"),4300);
    return Promise.resolve({ok:true,state:{...state}});
  }
  globalThis.chrome={runtime:{getManifest:()=>({version:currentVersion}),sendMessage:async message=>{
    const action=message.type.slice("ikr:update:".length);
    if(action==="status" || action==="auto-check")return {ok:true,state:{...state}};
    if(action==="check"){
      stop();emit("checking");
      return new Promise(resolve=>{
        const finish=()=>{pending.delete(finish);resolve({ok:true,state:{...state}});};
        pending.add(finish);delay(()=>{emit(checkTarget);finish();},850);
      });
    }
    if(action==="install")return install();
    if(action==="refresh")return emit("installed",{refreshTabs:false,message:"Your open iKnow pages have been refreshed."});
    return {ok:false};
  }},storage:{onChanged:{addListener:listener=>listeners.push(listener)}}};
  state={currentVersion,...templates.available};
  window.addEventListener("message",event=>{
    if(event.origin!==location.origin || event.source!==parent)return;
    if(event.data?.type==="update-preview:state" && templates[event.data.value]){stop();checkTarget=event.data.value==="current"?"current":"available";emit(event.data.value);}
    if(event.data?.type==="update-preview:play"){
      stop();checkTarget="available";emit("checking");delay(()=>emit("available"),850);delay(()=>install(),2100);
    }
  });
  const settings=document.getElementById("settings");
  if(settings){
    settings.setAttribute("aria-busy","false");
    for(const element of settings.querySelectorAll("fieldset,input,select"))element.disabled=false;
    const defaults=globalThis.IKnowReaderCore?.DEFAULTS || {};
    for(const element of settings.querySelectorAll("input,select")){
      if(element.type==="checkbox")element.checked=element.id==="enabled" || defaults[element.id]===true;
      else if(defaults[element.id]!==undefined)element.value=String(defaults[element.id]);
    }
    const save=document.getElementById("save-status");if(save)save.textContent="Preview settings";
    document.querySelectorAll('a[target="_blank"]').forEach(link=>link.addEventListener("click",event=>event.preventDefault()));
  }
})();
