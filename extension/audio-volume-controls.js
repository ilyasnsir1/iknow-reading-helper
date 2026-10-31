/* Shared playback levels. Sliders never alter microphone input or audio files. */
(() => {
  'use strict';
  const volume=globalThis.IKnowReaderCore?.audioVolume();if(!volume)return;
  const names={original:'Original audio',word:'Word voice',recording:'My recording'};
  const icon='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m9 4-4 3H2v6h3l4 3V4Zm4 3a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></svg>';
  let panel=null,opener=null;
  const known=kinds=>kinds.filter(kind=>Object.hasOwn(names,kind));
  const markup=(kinds=Object.keys(names))=>known(kinds).map(kind=>`<label class="ikr-volume-row"><span>${names[kind]}</span><output data-audio-volume-output="${kind}">${volume.get(kind)}%</output><input type="range" min="0" max="100" step="1" value="${volume.get(kind)}" data-audio-volume="${kind}" aria-label="${names[kind]} volume"></label>`).join('');
  function refresh(){
    for(const input of document.querySelectorAll('[data-audio-volume]')){const value=volume.get(input.dataset.audioVolume);input.value=String(value);input.style.setProperty('--volume',value+'%');}
    for(const output of document.querySelectorAll('[data-audio-volume-output]'))output.textContent=volume.get(output.dataset.audioVolumeOutput)+'%';
  }
  function close(focus=false){if(!panel)return;panel.remove();panel=null;opener?.setAttribute('aria-expanded','false');if(focus&&opener?.isConnected)opener.focus({preventScroll:true});opener=null;}
  function open(button){
    if(panel&&opener===button){close();return;}close();opener=button;button.setAttribute('aria-expanded','true');
    panel=document.createElement('section');panel.id='ikr-playback-volume';panel.className='ikr-volume-menu';panel.setAttribute('role','group');panel.setAttribute('aria-label','Playback volume');panel.setAttribute('popover','manual');
    panel.innerHTML='<p class="ikr-volume-heading">Playback volume</p>'+markup((button.dataset.audioVolumeKinds||'original,recording').split(','))+'<p class="ikr-volume-status" role="status" hidden></p>';
    document.body.append(panel);panel.showPopover?.();
    const anchor=button.getBoundingClientRect(),box=panel.getBoundingClientRect();
    panel.style.left=Math.max(12,Math.min(anchor.left,innerWidth-box.width-12))+'px';
    panel.style.top=Math.max(12,anchor.bottom+box.height+8<=innerHeight?anchor.bottom+8:anchor.top-box.height-8)+'px';refresh();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-audio-volume-menu]');
    if(button&&!button.disabled){event.preventDefault();open(button);if(event.detail>0)button.blur();else panel?.querySelector('input')?.focus({preventScroll:true});return;}
    if(panel&&!panel.contains(event.target)&&!opener?.contains(event.target))close();
  });
  document.addEventListener('input',event=>{
    const input=event.target.closest('[data-audio-volume]');if(!input)return;
    const status=input.closest('.ikr-volume-menu,.ikr-volume-inline')?.querySelector('.ikr-volume-status');if(status)status.hidden=true;
    void volume.set(input.dataset.audioVolume,Number(input.value)).catch(()=>{if(status){status.textContent='Could not save the volume. Please try again.';status.hidden=false;}});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){event.preventDefault();close(true);}});
  window.addEventListener('scroll',()=>close(),{capture:true,passive:true});window.addEventListener('resize',()=>close(),{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  volume.subscribe(refresh);void volume.ready.then(refresh);
  for(const host of document.querySelectorAll('[data-audio-volume-controls]')){host.classList.add('ikr-volume-inline');host.innerHTML='<p class="ikr-volume-heading">Playback volume</p>'+markup()+'<p class="ikr-volume-status" role="status" hidden></p>';}
  globalThis.IKnowReaderVolumeControls=Object.freeze({button:(kinds=['original','recording'])=>`<button type="button" class="ikr-volume-trigger" data-audio-volume-menu data-audio-volume-kinds="${known(kinds).join(',')}" aria-label="Playback volume" aria-expanded="false" aria-controls="ikr-playback-volume">${icon}<span>Volume</span></button>`,close});
})();
