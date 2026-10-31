/* Backup management for the isolated preview, using the production validator. */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const DATABASE='ikr-study-preview-backups', STORE='snapshot';
  async function database(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(Error('The preview library could not be opened.'));
      request.onblocked=()=>reject(Error('Close other preview tabs and try again.'));
    });
  }
  async function loadSnapshot(){
    const db=await database();
    try{return await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readonly'),request=transaction.objectStore(STORE).get('library');let value=null;request.onsuccess=()=>value=request.result||null;transaction.oncomplete=()=>resolve(value);transaction.onerror=transaction.onabort=()=>reject(Error('The preview library could not be restored.'));});}
    finally{db.close();}
  }
  async function saveSnapshot(value){
    const db=await database();
    try{await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite');transaction.objectStore(STORE).put(structuredClone(value),'library');transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(Error('The backup could not be saved. Your library has not changed.'));});}
    finally{db.close();}
  }
  function create({getSnapshot,onImport,backend:providedBackend,filenamePrefix='iKnow-Study-preview-backup',container=()=>document.getElementById('demo')}){
    const Store=globalThis.IKnowReaderStudyStore;
    let root=null,candidate=null,preview=null,fileName='',status='',error=false,busy=false,checking=false,includeSettings=false,serial=0,returnFocus=null,previousInert=false;
    const backend=providedBackend||Store.createBackend({
      async get(keys){const snapshot=structuredClone(getSnapshot());return Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,snapshot[key]]));},
      async set(patch){await onImport({...structuredClone(getSnapshot()),...structuredClone(patch)});}
    });
    function markup(){
      const count=Object.keys(getSnapshot()[Store.KEY]?.records||{}).length;
      return `<section class="focus-backup-dialog" role="dialog" aria-modal="true" aria-label="Backup" tabindex="-1"><header><div><p class="eyebrow">Your library</p><h2>Backup</h2></div><button type="button" class="focus-backup-close" data-backup-action="close" aria-label="Close backup"${busy?' disabled':''}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header><div class="focus-backup-body"><section class="focus-backup-export"><div><h3>Export</h3><p>${count} saved · notes &amp; learning progress</p></div><button type="button" data-backup-action="export"${busy?' disabled':''}>Export backup</button></section><section class="focus-backup-import"><h3>Import</h3><p>Choose a backup from this or another PC.</p><label class="focus-backup-file-label"><span>${fileName?escape(fileName):'Choose a JSON backup'}</span><input id="focus-backup-file" type="file" accept=".json,application/json" aria-label="Choose backup file"${busy?' disabled':''}></label><div id="focus-backup-preview"${preview?'':' hidden'}>${preview?`<div class="focus-backup-counts"><div><strong>${preview.added}</strong><span>New</span></div><div><strong>${preview.updated}</strong><span>Updated</span></div><div><strong>${preview.kept}</strong><span>Unchanged</span></div></div><p class="focus-backup-merge-note">Newer versions of matching entries are kept.${preview.learningItems?` Learning progress: ${preview.learningItems} saved.`:''}</p>`:''}</div><label class="focus-backup-settings"${preview?.hasSettings?'':' hidden'}><input id="focus-backup-settings" type="checkbox"${includeSettings?' checked':''}${busy?' disabled':''}>Import settings too</label><div class="focus-backup-import-actions"><p id="focus-backup-status" role="status" data-error="${error}"${status?'':' hidden'}>${escape(status)}</p><button type="button" class="primary" data-backup-action="import"${!candidate||checking||busy?' disabled':''}>${busy?'Working…':'Import backup'}</button></div></section></div></section>`;
    }
    function update(focus){if(!root)return;root.innerHTML=markup();if(focus)root.querySelector(focus)?.focus({preventScroll:true});}
    function close(){
      if(!root||busy)return;
      serial++;root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('keydown',keydown);root.remove();root=null;
      const page=container();if(page)page.inert=previousInert;const target=returnFocus?.isConnected?returnFocus:page?.querySelector('[data-action="backup"]');target?.focus({preventScroll:true});
    }
    function open(){
      if(root)return;
      candidate=null;preview=null;fileName='';status='';error=false;includeSettings=false;checking=false;
      returnFocus=document.activeElement;const page=container();previousInert=page?.inert||false;if(page)page.inert=true;
      root=document.createElement('div');root.className='focus-backup-overlay';root.dataset.focusBackupRoot='';root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('keydown',keydown);document.body.append(root);update('[role="dialog"]');
    }
    async function choose(file){
      const revision=++serial;candidate=null;preview=null;includeSettings=false;fileName=file?.name||'';status='';error=false;checking=Boolean(file);
      if(!file){update();return;}
      if(file.size>Store.MAX_BACKUP_BYTES){checking=false;status='Choose a backup smaller than 12 MiB.';error=true;update();return;}
      status='Checking backup…';update();
      try{
        const value=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const checked=await backend.previewBackup(value);
        if(revision!==serial||!root)return;
        candidate=value;preview=checked;status='Ready to import.';
      }catch(reason){if(revision!==serial||!root)return;status=reason instanceof SyntaxError?'Choose a valid Reading Helper JSON backup.':String(reason.message||'This backup could not be read.');error=true;}
      finally{if(revision===serial&&root){checking=false;update();}}
    }
    async function exportBackup(){
      if(busy)return;busy=true;status='Preparing backup…';error=false;update();
      try{
        const backup=await backend.exportBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${filenamePrefix}-${new Date(backup.exportedAt).toISOString().slice(0,10)}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status='Backup downloaded.';
      }catch(reason){status=String(reason.message||'The backup could not be exported.');error=true;}
      finally{busy=false;update('[data-backup-action="export"]');}
    }
    async function importBackup(){
      if(!candidate||busy||checking)return;busy=true;status='Importing backup…';error=false;update();
      try{const result=await backend.importBackup(candidate,{includeSettings});candidate=null;preview=null;fileName='';includeSettings=false;status=`Imported. ${result.added} new, ${result.updated} updated.`;}
      catch(reason){status=String(reason.message||'The backup could not be imported.');error=true;}
      finally{busy=false;update('[data-backup-action="close"]');}
    }
    function click(event){
      event.stopPropagation();const button=event.target.closest('[data-backup-action]');if(!button||button.disabled)return;
      if(button.dataset.backupAction==='close')close();if(button.dataset.backupAction==='export')void exportBackup();if(button.dataset.backupAction==='import')void importBackup();
    }
    function change(event){event.stopPropagation();if(event.target.id==='focus-backup-file')void choose(event.target.files[0]);if(event.target.id==='focus-backup-settings')includeSettings=event.target.checked;}
    function keydown(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key!=='Tab')return;
      const nodes=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(node=>!node.closest('[hidden]')),first=nodes[0],last=nodes.at(-1);
      if(!nodes.length){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    return Object.freeze({open,close});
  }
  globalThis.IKnowFocusBackup=Object.freeze({create,loadSnapshot,saveSnapshot});
})();
