/* One small preference, independent of course settings and preparation. */
(() => {
 "use strict";
 if(globalThis.IKnowReaderTheme)return;
 const root=document.documentElement,own=root.classList.contains("ikr-theme-page");
 const scope=!own||root.dataset.ikrThemeScope==="panels"?"panels":"app";
 const KEY=scope==="panels"?"iknowReaderPanelTheme":"iknowReaderTheme";
 const choices=Object.freeze([{id:"paper",label:"Original",swatch:["#fff6e9","#c99065"]},{id:"midnight",label:"Midnight",swatch:["#263344","#a2afcf"]},{id:"tokyo",label:"Tokyo Neon",swatch:["#392747","#c6a1eb"]},{id:"forest",label:"Kyoto Forest",swatch:["#2a4034","#b5c6a4"]}]);
 const valid=value=>choices.some(choice=>choice.id===value)?value:"paper";
 const controls=new Set();
 let current="paper",confirmed="paper",generation=0,revision=0,pendingWrites=0,desired="paper",writes=Promise.resolve();
 const icon='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.2A6.2 6.2 0 0 1 7.8 4a6.4 6.4 0 1 0 8 8.2Z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 function apply(value){
  current=valid(value);root.dataset.ikrTheme=current;root.classList.remove("ikr-theme-pending");
  if(own)try{localStorage.setItem(KEY,current);}catch{}
  for(const control of controls){if(!control.wrapper.isConnected){control.close();controls.delete(control);continue;}control.name.textContent=choices.find(choice=>choice.id===current).label;for(const button of control.options)button.setAttribute("aria-pressed",String(button.dataset.themeValue===current));}
 }
 if(own){root.classList.add("ikr-theme-pending");try{apply(localStorage.getItem(KEY));}catch{apply("paper");}}
 else apply("paper");
 const loadGeneration=generation,loadRevision=revision;
 const ready=Promise.resolve().then(()=>globalThis.chrome?.storage?.local?.get(KEY)).then(stored=>{
  if(loadGeneration===generation&&loadRevision===revision){confirmed=valid(stored?.[KEY]);apply(confirmed);}
 }).catch(()=>{confirmed=current;root.classList.remove("ikr-theme-pending");});
 function choose(value,feedback){
  const next=valid(value),request=++generation;desired=next;pendingWrites++;apply(next);
  writes=writes.then(async()=>{
   try{
    if(!globalThis.chrome?.storage?.local?.set)throw Error("Theme storage unavailable");
    await chrome.storage.local.set({[KEY]:next});confirmed=next;if(feedback)feedback.textContent="Theme saved.";
   }catch{if(generation===request)apply(confirmed);if(feedback)feedback.textContent="Could not save the theme. Please try again.";}
   finally{pendingWrites--;}
  });return writes;
 }
 function mount(container){
  if(!container||container.dataset.ikrThemeMounted)return;
  container.dataset.ikrThemeMounted="true";
  const wrapper=document.createElement("div");wrapper.className="ikr-theme-picker ikr-owned";
  const trigger=document.createElement("button");trigger.type="button";trigger.className="ikr-theme-trigger";trigger.innerHTML=icon;
  const name=document.createElement("span");trigger.append(name);trigger.setAttribute("aria-label",scope==="panels"?"Choose course panel theme":"Choose app theme");trigger.title=scope==="panels"?"Theme for iKnow course and series panels":"Theme for Reading Helper pages and popup";trigger.setAttribute("aria-expanded","false");
  const panel=document.createElement("div");panel.className="ikr-theme-options";panel.hidden=true;panel.setAttribute("role","group");panel.setAttribute("aria-label","Theme");panel.setAttribute("popover","manual");
  const feedback=document.createElement("span");feedback.className="ikr-theme-feedback";feedback.setAttribute("role","status");
  const close=()=>{try{panel.hidePopover?.();}catch{}panel.hidden=true;trigger.setAttribute("aria-expanded","false");};
  const open=()=>{
   panel.hidden=false;trigger.setAttribute("aria-expanded","true");try{panel.showPopover?.();}catch{}
   const rect=trigger.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
   panel.style.left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8))+"px";
   panel.style.top=(rect.bottom+height+8<innerHeight?rect.bottom+7:Math.max(8,rect.top-height-7))+"px";
  };
  const options=choices.map(choice=>{const button=document.createElement("button");button.type="button";button.className="ikr-theme-option";button.dataset.themeValue=choice.id;
   const ns="http://www.w3.org/2000/svg",swatch=document.createElementNS(ns,"svg");swatch.classList.add("ikr-theme-swatch");swatch.dataset.swatch=choice.id;swatch.setAttribute("viewBox","0 0 20 20");swatch.setAttribute("aria-hidden","true");
   const base=document.createElementNS(ns,"circle");base.setAttribute("cx","10");base.setAttribute("cy","10");base.setAttribute("r","9");base.setAttribute("fill",choice.swatch[0]);
   const half=document.createElementNS(ns,"path");half.setAttribute("d","M3.636 16.364A9 9 0 0 0 16.364 3.636Z");half.setAttribute("fill",choice.swatch[1]);
   const rim=document.createElementNS(ns,"circle");rim.setAttribute("cx","10");rim.setAttribute("cy","10");rim.setAttribute("r","9");rim.setAttribute("fill","none");rim.setAttribute("stroke","#9f94ab66");rim.setAttribute("stroke-width",".6");swatch.append(base,half,rim);button.append(swatch,document.createTextNode(choice.label));
   button.addEventListener("click",()=>{void choose(choice.id,feedback);close();trigger.focus({preventScroll:true});});panel.append(button);return button;
  });
  trigger.addEventListener("click",()=>{if(panel.hidden)open();else close();});
  wrapper.addEventListener("keydown",event=>{if(event.key==="Escape"){close();trigger.focus({preventScroll:true});event.stopPropagation();}if(event.key==="ArrowDown"&&event.target===trigger){event.preventDefault();open();options[0].focus();}});
  wrapper.addEventListener("focusout",event=>{if(!wrapper.contains(event.relatedTarget))close();});
  wrapper.append(trigger,panel,feedback);container.append(wrapper);controls.add({name,options,wrapper,close});apply(current);
 }
 function scan(){
  if(own&&document.body?.dataset.ikrPage!=="popup"){
   const header=document.querySelector("main > header");
   if(header&&!header.querySelector("[data-ikr-theme-picker]")){
    const actions=document.createElement("div");actions.className="ikr-page-actions";
    for(const link of [...header.children].filter(node=>node.tagName==="A"))actions.append(link);
    const picker=document.createElement("span");picker.dataset.ikrThemePicker="";actions.append(picker);header.append(actions);
   }
  }
  document.querySelectorAll("[data-ikr-theme-picker]").forEach(mount);
 }
 globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{
  if(area!=="local"||!changes[KEY])return;
  const observed=++revision;
  // Read the authoritative last value; queued own writes may have delivered an
  // older onChanged event after a newer choice was already shown optimistically.
  void Promise.resolve(chrome.storage.local.get(KEY)).then(stored=>{
   if(observed!==revision)return;confirmed=valid(stored?.[KEY]);
   if(!pendingWrites||confirmed===desired)apply(confirmed);
  }).catch(()=>{});
 });
 const closeAll=event=>{for(const control of controls){if(!control.wrapper.isConnected){control.close();controls.delete(control);}else if(event?.type!=="pointerdown"||!control.wrapper.contains(event.target))control.close();}};
 document.addEventListener("pointerdown",closeAll);window.addEventListener("resize",closeAll);window.addEventListener("scroll",closeAll,true);
 const unmount=container=>{for(const control of controls)if(container?.contains(control.wrapper)){control.close();controls.delete(control);}};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",scan,{once:true});else scan();
 globalThis.IKnowReaderTheme=Object.freeze({KEY,scope,choices,ready,mount,unmount,get current(){return current;},choose:value=>choose(value)});
})();
