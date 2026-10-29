/* Accessible course menu with space for long titles; native data stays intact. */
(() => {
 "use strict";
 const select=document.getElementById("course-filter");if(!select)return;
 const trigger=document.createElement("button");trigger.type="button";trigger.id="course-filter-trigger";trigger.className="ikr-course-filter";
 trigger.setAttribute("aria-haspopup","listbox");trigger.setAttribute("aria-expanded","false");trigger.setAttribute("aria-controls","course-filter-options");
 const text=document.createElement("span");trigger.append(text);
 const chevron=document.createElementNS("http://www.w3.org/2000/svg","svg");chevron.setAttribute("viewBox","0 0 16 16");chevron.setAttribute("aria-hidden","true");
 const path=document.createElementNS(chevron.namespaceURI,"path");path.setAttribute("d","m4.5 6.5 3.5 3.5 3.5-3.5");chevron.append(path);trigger.append(chevron);
 const list=document.createElement("div");list.id="course-filter-options";list.className="ikr-course-options";list.hidden=true;list.setAttribute("role","listbox");list.setAttribute("aria-label","Course");
 select.classList.add("ikr-course-native");select.tabIndex=-1;select.setAttribute("aria-hidden","true");select.after(trigger);document.body.append(list);
 let options=[],active=0,prefix="",prefixTimer;
 function close(focus=false){list.hidden=true;trigger.setAttribute("aria-expanded","false");if(focus)trigger.focus({preventScroll:true});}
 function sync(){text.textContent=select.selectedOptions[0]?.textContent||"All courses";trigger.title=text.textContent;trigger.setAttribute("aria-label","Course: "+text.textContent);if(!list.hidden)draw();}
 function move(index){active=Math.max(0,Math.min(options.length-1,index));options[active]?.focus({preventScroll:true});options[active]?.scrollIntoView({block:"nearest"});}
 function choose(index){const value=select.options[index]?.value;if(value===undefined)return;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));sync();close(true);}
 function draw(){
  list.replaceChildren();options=[...select.options].map((option,index)=>{
   const row=document.createElement("button");row.type="button";row.setAttribute("role","option");row.setAttribute("aria-selected",String(option.value===select.value));row.tabIndex=-1;row.textContent=option.textContent;
   row.addEventListener("click",()=>choose(index));list.append(row);return row;
  });
  const rect=trigger.getBoundingClientRect(),width=Math.min(Math.max(rect.width,250),280,innerWidth-24);
  list.style.width=width+"px";list.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+"px";
  list.style.top=Math.min(rect.bottom+6,innerHeight-100)+"px";list.style.maxHeight=Math.max(90,Math.min(320,innerHeight-rect.bottom-18))+"px";
 }
 function open(index){list.hidden=false;trigger.setAttribute("aria-expanded","true");draw();move(index??Math.max(0,select.selectedIndex));}
 trigger.addEventListener("click",()=>{if(list.hidden)open();else close();});
 trigger.addEventListener("keydown",event=>{if(["ArrowDown","ArrowUp"].includes(event.key)){event.preventDefault();open();}});
 list.addEventListener("keydown",event=>{
  if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();move(event.key==="Home"?0:event.key==="End"?options.length-1:active+(event.key==="ArrowDown"?1:-1));}
  else if(event.key==="Enter"||event.key===" "){event.preventDefault();choose(active);}
  else if(event.key==="Escape"){event.preventDefault();close(true);}
  else if(event.key==="Tab")close();
  else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){clearTimeout(prefixTimer);prefix+=event.key.toLocaleLowerCase();const index=options.findIndex(option=>option.textContent.toLocaleLowerCase().startsWith(prefix));if(index>=0)move(index);prefixTimer=setTimeout(()=>{prefix="";},650);}
 });
 document.addEventListener("pointerdown",event=>{if(!list.contains(event.target)&&!trigger.contains(event.target))close();});
 window.addEventListener("resize",()=>close());window.addEventListener("scroll",event=>{if(!list.contains(event.target))close();},true);
 select.addEventListener("change",sync);new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true});sync();
})();
