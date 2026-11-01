(() => {
  'use strict';
  const choices=[['auto','Automatic'],['new','New'],['weak','Weak'],['learning','Learning'],['strong','Strong']];
  function create({getItem,getLevel,onSelect,onError=()=>{}}){
    let panel=null,anchor=null,busy=false;
    const close=(focus=false)=>{if(busy)return;panel?.remove();panel=null;if(focus&&anchor){const target=anchor.isConnected?anchor:[...document.querySelectorAll('#demo-library-list>.library-row')].find(row=>row.dataset.item===anchor.dataset.item);target?.focus({preventScroll:true});}anchor=null;};
    function open(row,point){
      if(busy)return;
      const item=getItem(row.dataset.item);if(!item)return;
      close();anchor=row;
      panel=document.createElement('div');panel.className='focus-strength-menu';panel.setAttribute('role','menu');panel.setAttribute('aria-label','Personal learning level');
      const heading=document.createElement('header'),label=document.createElement('small'),name=document.createElement('strong');
      label.textContent='Personal level';name.textContent=item.japanese;name.lang='ja';heading.append(label,name);panel.append(heading);
      const level=getLevel(item.key)||'auto';
      for(const [value,text] of choices){
        const button=document.createElement('button');button.type='button';button.dataset.level=value;button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(level===value));
        const dot=document.createElement('span');dot.className='level-dot';dot.dataset.strength=value;
        const title=document.createElement('span');title.textContent=text;
        const check=document.createElement('span');check.className='level-check';check.textContent='✓';check.setAttribute('aria-hidden','true');button.append(dot,title,check);
        button.addEventListener('click',async()=>{
          if(busy)return;busy=true;const current=panel;current.setAttribute('aria-busy','true');current.querySelectorAll('button').forEach(node=>node.disabled=true);
          try{await onSelect(item.key,value);busy=false;close(true);}
          catch(error){busy=false;if(current.isConnected){current.removeAttribute('aria-busy');current.querySelectorAll('button').forEach(node=>node.disabled=false);}onError(error.message||'The learning level could not be saved.');}
        });panel.append(button);
      }
      const footer=document.createElement('p');footer.textContent='Your practice results stay unchanged.';panel.append(footer);document.body.append(panel);
      const box=row.getBoundingClientRect(),rect=panel.getBoundingClientRect(),x=point?.x??box.left+18,y=point?.y??box.bottom+5;
      panel.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';panel.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
      panel.querySelector('[aria-checked=true]').focus({preventScroll:true});
    }
    const rowFor=event=>event.target.closest?.('#demo-library-list>.library-row:not([data-picker-row])');
    document.addEventListener('contextmenu',event=>{const row=rowFor(event);if(!row||row.closest('[inert]'))return;event.preventDefault();open(row,{x:event.clientX,y:event.clientY});});
    document.addEventListener('pointerdown',event=>{if(panel&&!panel.contains(event.target))close();},true);
    document.addEventListener('keydown',event=>{
      const row=rowFor(event);
      if((event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')&&row&&!row.closest('[inert]')){event.preventDefault();open(row);return;}
      if(!panel)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return;}
      if(event.key==='Tab'){close();return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&panel.contains(event.target)){
        event.preventDefault();const buttons=[...panel.querySelectorAll('button:not(:disabled)')],at=buttons.indexOf(document.activeElement),index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();
      }
    },true);
    addEventListener('resize',()=>close());addEventListener('scroll',event=>{if(panel&&!panel.contains(event.target))close();},true);
    return Object.freeze({close});
  }
  globalThis.IKnowStudyStrengthMenu=Object.freeze({create});
})();
