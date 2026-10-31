/* Isolated Kana chart and reading practice. Nothing is uploaded or graded as speech.
   Chart reference: Japan Foundation, Irodori X_L01 (hiragana) / X_L02 (katakana).
   https://nd.jpf.go.jp/wp-content/uploads/2023/01/X_L01_NP.pdf
   https://classroomresources.sydney.jpf.go.jp/resources/hiragana-katakana-game/ */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const definitions={
    basic:[
      ['Vowels','あ:a い:i う:u え:e お:o'],['K','か:ka き:ki く:ku け:ke こ:ko'],
      ['S','さ:sa し:shi,si す:su せ:se そ:so'],['T','た:ta ち:chi,ti つ:tsu,tu て:te と:to'],
      ['N','な:na に:ni ぬ:nu ね:ne の:no'],['H','は:ha ひ:hi ふ:fu,hu へ:he ほ:ho'],
      ['M','ま:ma み:mi む:mu め:me も:mo'],['Y','や:ya _ ゆ:yu _ よ:yo'],
      ['R','ら:ra り:ri る:ru れ:re ろ:ro'],['W','わ:wa _ _ _ を:wo,o'],['N sound','ん:n,nn,n\' _ _ _ _']
    ],
    voiced:[
      ['G','が:ga ぎ:gi ぐ:gu げ:ge ご:go'],['Z','ざ:za じ:ji,zi ず:zu ぜ:ze ぞ:zo'],
      ['D','だ:da ぢ:ji,di づ:zu,du,dzu で:de ど:do'],['B','ば:ba び:bi ぶ:bu べ:be ぼ:bo'],
      ['P','ぱ:pa ぴ:pi ぷ:pu ぺ:pe ぽ:po']
    ],
    combinations:[
      ['KY','きゃ:kya きゅ:kyu きょ:kyo'],['SH','しゃ:sha,sya しゅ:shu,syu しょ:sho,syo'],
      ['CH','ちゃ:cha,tya,cya ちゅ:chu,tyu,cyu ちょ:cho,tyo,cyo'],['NY','にゃ:nya にゅ:nyu にょ:nyo'],
      ['HY','ひゃ:hya ひゅ:hyu ひょ:hyo'],['MY','みゃ:mya みゅ:myu みょ:myo'],['RY','りゃ:rya りゅ:ryu りょ:ryo'],
      ['GY','ぎゃ:gya ぎゅ:gyu ぎょ:gyo'],['J','じゃ:ja,zya,jya じゅ:ju,zyu,jyu じょ:jo,zyo,jyo'],
      ['BY','びゃ:bya びゅ:byu びょ:byo'],['PY','ぴゃ:pya ぴゅ:pyu ぴょ:pyo']
    ]
  };
  const groups={basic:'Basic kana',voiced:'Voiced kana',combinations:'Combinations'};
  const rows=Object.fromEntries(Object.entries(definitions).map(([group,value])=>[group,value.map(([label,spec],row)=>({
    label,id:group+'-'+row,cells:spec.split(' ').map((part,column)=>{
      if(part==='_')return null;const [kana,reading]=part.split(':'),accepted=reading.split(',');
      return Object.freeze({id:group+':'+kana,kana,romaji:accepted[0],accepted:Object.freeze(accepted),row:group+'-'+row,column});
    })
  }))]));
  const catalog=Object.values(rows).flatMap(group=>group.flatMap(row=>row.cells.filter(Boolean))),byId=new Map(catalog.map(entry=>[entry.id,entry]));
  const selected=new Map(Object.keys(groups).map(group=>[group,new Set(rows[group].flatMap(row=>row.cells.filter(Boolean).map(entry=>entry.id)))]));
  const state={script:'hiragana',enabled:new Set(['basic']),readings:true,density:'compact',order:'shuffle',focused:'basic:あ',session:null,original:null};
  const PREFERENCES_KEY='iknowReaderStudyKanaPreferences:v1';
  function restorePreferences(){
    try{
      const text=globalThis.localStorage?.getItem(PREFERENCES_KEY);if(!text||text.length>10000)return;
      const value=JSON.parse(text),names=['schemaVersion','script','enabled','selected','readings','order','focused'];
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||Object.keys(value).some(key=>!names.includes(key))||value.schemaVersion!==1)return;
      if(!['hiragana','katakana'].includes(value.script)||typeof value.readings!=='boolean'||!['shuffle','chart'].includes(value.order)||!byId.has(value.focused))return;
      if(!Array.isArray(value.enabled)||value.enabled.length>3||new Set(value.enabled).size!==value.enabled.length||value.enabled.some(group=>!Object.hasOwn(groups,group)))return;
      if(!value.selected||typeof value.selected!=='object'||Array.isArray(value.selected)||Object.keys(value.selected).length!==3||Object.keys(value.selected).some(group=>!Object.hasOwn(groups,group)))return;
      const restored=new Map();
      for(const group of Object.keys(groups)){
        const ids=value.selected[group];
        if(!Array.isArray(ids)||ids.length>selected.get(group).size||new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id)||!id.startsWith(group+':')))return;
        restored.set(group,new Set(ids));
      }
      state.script=value.script;state.enabled=new Set(value.enabled);state.readings=value.readings;state.order=value.order;state.focused=value.focused;
      for(const [group,ids]of restored)selected.set(group,ids);
    }catch{ /* Restricted storage or malformed preferences leave the chart defaults intact. */ }
  }
  function persistPreferences(){
    try{globalThis.localStorage?.setItem(PREFERENCES_KEY,JSON.stringify({schemaVersion:1,script:state.script,enabled:[...state.enabled],selected:Object.fromEntries([...selected].map(([group,ids])=>[group,[...ids]])),readings:state.readings,order:state.order,focused:state.focused}));}catch{ /* Chart choices remain usable when local preference storage is unavailable. */ }
  }
  restorePreferences();
  const resultSessions=new WeakMap();
  const isKatakana=()=>state.script==='katakana';
  const glyph=(entry,script=state.script)=>script==='katakana'?Array.from(entry.kana,char=>String.fromCharCode(char.charCodeAt(0)+0x60)).join(''):entry.kana;
  const clean=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g,"'");
  function entries(group='basic',script='hiragana'){
    if(!rows[group]||!['hiragana','katakana'].includes(script))return[];
    return rows[group].flatMap(row=>row.cells.filter(Boolean).map(entry=>({...entry,kana:glyph(entry,script),accepted:[...entry.accepted]})));
  }
  function check(id,answer){const entry=byId.get(id);return Boolean(entry&&entry.accepted.includes(clean(answer)));}
  function shuffled(list,random=Math.random){const result=[...list];for(let index=result.length-1;index>0;index--){const other=Math.min(index,Math.max(0,Math.floor(random()*(index+1))));[result[index],result[other]]=[result[other],result[index]];}return result;}
  function note(entry){
    if(entry.kana==='は')return'Chart reading: ha. The topic particle is pronounced wa.';
    if(entry.kana==='へ')return'Chart reading: he. The direction particle is pronounced e.';
    if(entry.kana==='を')return'Written wo in this chart; pronounced o as a particle.';
    if(entry.kana==='ぢ')return'Pronounced ji. The typing form di is also accepted.';
    if(entry.kana==='づ')return'Pronounced zu. The typing forms du and dzu are also accepted.';
    return entry.accepted.length>1?'Also accepted: '+entry.accepted.slice(1).join(', ')+'.':'';
  }
  const scriptName=()=>isKatakana()?'Katakana':'Hiragana';
  function chosenKeys(){return Object.keys(groups).filter(group=>state.enabled.has(group)).flatMap(group=>rows[group].flatMap(row=>row.cells.filter(entry=>entry&&selected.get(group).has(entry.id)).map(entry=>entry.id)));}
  function allGroupsEnabled(){return Object.keys(groups).every(group=>state.enabled.has(group));}
  function enabledSelectionComplete(){return state.enabled.size>0&&catalog.every(entry=>{const group=entry.id.split(':')[0];return !state.enabled.has(group)||selected.get(group).has(entry.id);});}
  function chart(){
    const focused=byId.get(state.focused)||catalog[0],count=chosenKeys().length;
    const tables=Object.entries(groups).map(([group,label])=>{
      const active=selected.get(group),enabled=state.enabled.has(group),combination=group==='combinations';
      const rowButtons=rows[group].map(row=>{
        const cells=row.cells.filter(Boolean),all=enabled&&cells.every(entry=>active.has(entry.id));
        return `<div class="kana-chart-row"><button type="button" class="kana-row-toggle" data-kana-row="${row.id}" aria-pressed="${all}" aria-label="${all?'Deselect':'Select'} ${label}, ${row.label} row">${row.label}</button>${row.cells.map(entry=>entry?`<button type="button" class="kana-cell" data-kana-select="${escape(entry.id)}" aria-pressed="${enabled&&active.has(entry.id)}" aria-label="${escape(glyph(entry))}, ${entry.romaji}${enabled&&active.has(entry.id)?', selected':''}"><span lang="ja">${glyph(entry)}</span>${state.readings?`<small>${entry.romaji}</small>`:''}</button>`:'<span class="kana-blank" aria-hidden="true"></span>').join('')}</div>`;
      }).join('');
      return `<section class="kana-chart-section" data-kana-table="${group}" data-enabled="${enabled}" aria-label="${scriptName()} ${label}"><header class="kana-group-heading"><label><input type="checkbox" data-kana-include="${group}"${enabled?' checked':''}>${label}</label><span>${rows[group].reduce((sum,row)=>sum+row.cells.filter(Boolean).length,0)}</span></header><div class="kana-chart-scroll" data-combinations="${combination}"><div class="kana-column-labels"><span></span>${(combination?['ya','yu','yo']:['a','i','u','e','o']).map(value=>`<span>${value}</span>`).join('')}</div>${rowButtons}</div></section>`;
    }).join('');
    return `<header class="kana-heading"><div><p class="eyebrow">Reading starts here</p><h2>Kana</h2></div><div class="kana-focus-preview" aria-live="polite"><strong lang="ja">${glyph(focused)}</strong><span class="kana-card-reading">${focused.romaji}</span></div><div class="kana-heading-tools"><div class="kana-view-size" role="group" aria-label="Chart size"><button type="button" data-kana-size="compact" aria-pressed="${state.density==='compact'}">Compact</button><button type="button" data-kana-size="large" aria-pressed="${state.density==='large'}">Large</button></div><label class="kana-readings"><input type="checkbox" data-kana-readings${state.readings?' checked':''}>Show readings</label><div class="kana-script-tabs" role="group" aria-label="Writing system"><button type="button" data-kana-script="hiragana" aria-pressed="${!isKatakana()}">Hiragana</button><button type="button" data-kana-script="katakana" aria-pressed="${isKatakana()}">Katakana</button></div></div></header><div class="kana-chart-layout">${tables}</div><footer class="kana-practice-footer"><div class="kana-selection-tools"><span>${count} selected</span><div><button type="button" data-kana-action="all-groups" aria-pressed="${allGroupsEnabled()}">${allGroupsEnabled()?'Deselect groups':'All groups'}</button><button type="button" data-kana-action="select-all" aria-pressed="${enabledSelectionComplete()}"${state.enabled.size?'':' disabled'}>${enabledSelectionComplete()?'Deselect all':'Select all'}</button><button type="button" data-kana-action="clear"${count?'':' disabled'}>Clear</button></div></div><div class="kana-start"><div class="kana-order"><span>Order</span><div class="kana-order-stepper" role="group" aria-label="Practice order"><button type="button" data-kana-order-step="previous" aria-label="Previous order"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4"/></svg></button><output data-kana-order-label aria-live="polite">${state.order==='shuffle'?'Shuffle':'Chart order'}</output><button type="button" data-kana-order-step="next" aria-label="Next order"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></div></div><button type="button" class="primary" data-kana-action="start"${count?'':' disabled'}>Practise ${count} kana</button></div></footer>`;
  }
  function question(){
    const session=state.session,entry=byId.get(session.keys[session.index]),answer=session.answers[session.index];
    const script=session.script==='katakana'?'Katakana':'Hiragana';
    return `<header class="kana-quiz-heading"><div><p class="eyebrow">${script} practice</p><span class="kana-progress-count">${session.index+1} of ${session.keys.length}</span></div><button type="button" data-kana-action="end">End practice</button></header><progress class="kana-progress" value="${session.index}" max="${session.keys.length}" aria-label="Practice progress"></progress><div class="kana-question"><div class="kana-prompt"><p class="kana-question-label">Read this ${script}</p><p class="kana-question-glyph" lang="ja">${glyph(entry,session.script)}</p></div><form data-kana-form><label for="kana-reading-answer">Romaji</label><div class="kana-answer-row"><input id="kana-reading-answer" data-kana-answer type="text" value="${escape(session.draft)}" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="40"${answer?' disabled':''}><button class="primary" type="submit" data-kana-check${answer||!session.draft.trim()?' disabled':''}>Check answer</button></div></form><div class="kana-answer-footer" data-answered="${Boolean(answer)}"><div class="kana-quiz-feedback" data-correct="${answer?answer.correct:''}" role="status">${answer?`<strong><svg viewBox="0 0 20 20" aria-hidden="true">${answer.correct?'<path d="m4 10 4 4 8-8"/>':'<path d="m6 6 8 8m0-8-8 8"/>'}</svg>${answer.correct?'Correct':'Incorrect'}</strong>`:''}</div><div class="kana-next"><button type="button" class="primary" data-kana-action="next"${answer?'':' hidden'}>${session.index+1===session.keys.length?'Finish':`Next ${script}`}</button></div></div><div class="kana-answer-correction"${answer&&!answer.correct?'':' hidden'}>${answer&&!answer.correct?`<dl><div><dt>Your answer</dt><dd>${escape(answer.submitted)}</dd></div><div><dt>Reading</dt><dd>${entry.romaji}</dd></div></dl>`:''}</div></div>`;
  }
  function reportSession(){
    const session=state.session;
    if(resultSessions.has(session))return resultSessions.get(session);
    const pool=session.keys.map(key=>{const entry=byId.get(key);return {key,japanese:glyph(entry,session.script),english:entry.romaji};});
    const results=session.keys.map((key,index)=>{const entry=byId.get(key),answer=session.answers[index];return {key,japanese:glyph(entry,session.script),expected:entry.romaji,submitted:answer?.submitted||(index===session.index?session.draft:''),outcome:answer?(answer.correct?'good':'again'):'unanswered',attempts:answer?1:0};});
    const report={keys:[...session.keys],pool,mode:'kana',test:false,complete:session.answers.filter(Boolean).length===session.keys.length,results};
    resultSessions.set(session,report);return report;
  }
  function resultOptions(){const script=state.session.script==='katakana'?'Katakana':'Hiragana';return {rowKind:script,noun:script,eyebrow:`${script} practice`,showAnswerList:false,backLabel:'Back to chart',newLabel:'Practise again',originalLabel:state.original&&state.original!==state.session?'Back to results':''};}
  function results(){
    return globalThis.IKnowFocusResults.render(reportSession(),resultOptions());
  }
  function content(){return state.session?(state.session.finished?results():question()):chart();}
  function render(){return `<section class="kana-panel" data-kana-root data-kana-density="${state.density}" data-show-readings="${state.readings}" data-kana-mode="${state.session?(state.session.finished?'results':'practice'):'chart'}" aria-label="Kana learning">${content()}</section>`;}
  function begin(keys){
    const ordered=keys||chosenKeys();
    if(!ordered.length)return;state.session={keys:state.order==='shuffle'?shuffled(ordered):[...ordered],script:state.script,index:0,answers:[],draft:'',finished:false};
  }
  function mount(root){
    if(!root)return()=>{};
    let resultsCleanup=null,composing=false;
    function mountResults(){resultsCleanup?.();resultsCleanup=null;if(state.session?.finished)resultsCleanup=globalThis.IKnowFocusResults.mount(root.querySelector('.focus-results'),reportSession(),resultOptions());}
    function update(focus){
      resultsCleanup?.();resultsCleanup=null;
      const active=document.activeElement,attribute=active&&root.contains(active)?['data-kana-script','data-kana-select','data-kana-row','data-kana-action','data-kana-include','data-kana-readings','data-kana-size','data-kana-order-step'].find(name=>active.hasAttribute(name)):null;
      const restore=attribute?'['+attribute+'="'+CSS.escape(active.getAttribute(attribute))+'"]':null;
      root.dataset.kanaMode=state.session?(state.session.finished?'results':'practice'):'chart';root.dataset.kanaDensity=state.density;root.dataset.showReadings=String(state.readings);root.innerHTML=content();mountResults();
      if(focus||restore)root.querySelector(focus||restore)?.focus({preventScroll:true});
    }
    function click(event){
      const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;event.stopPropagation();
      if(button.dataset.action?.startsWith('result-')){
        if(button.dataset.action==='result-back-study'){state.session=null;state.original=null;update();}
        if(button.dataset.action==='result-new-round'){const keys=state.session.keys;state.script=state.session.script;state.original=null;begin(keys);update('[data-kana-answer]');}
        if(button.dataset.action==='result-practice-mistakes'){const original=state.original||state.session,keys=state.session.keys.filter((_,index)=>!state.session.answers[index]?.correct);state.script=state.session.script;begin(keys);state.original=original;update('[data-kana-answer]');}
        if(button.dataset.action==='result-original-report'&&state.original){state.session=state.original;state.original=null;update();}
        return;
      }
      if(button.dataset.kanaSize){state.density=button.dataset.kanaSize==='compact'?'compact':'large';update();return;}
      if(button.dataset.kanaOrderStep){state.order=state.order==='shuffle'?'chart':'shuffle';persistPreferences();update();return;}
      if(button.dataset.kanaScript){state.script=button.dataset.kanaScript;persistPreferences();update();return;}
      if(button.dataset.kanaSelect){const id=button.dataset.kanaSelect,group=id.split(':')[0],active=selected.get(group);if(!state.enabled.has(group)){state.enabled.add(group);active.clear();active.add(id);}else active.has(id)?active.delete(id):active.add(id);state.focused=id;persistPreferences();update();return;}
      if(button.dataset.kanaRow){const group=button.dataset.kanaRow.split('-')[0],row=rows[group]?.find(row=>row.id===button.dataset.kanaRow);if(!row)return;const active=selected.get(group),cells=row.cells.filter(Boolean),enabled=state.enabled.has(group),all=enabled&&cells.every(entry=>active.has(entry.id));if(!enabled){state.enabled.add(group);active.clear();}cells.forEach(entry=>all?active.delete(entry.id):active.add(entry.id));state.focused=cells[0].id;persistPreferences();update();return;}
      switch(button.dataset.kanaAction){
        case'all-groups':{const all=allGroupsEnabled();Object.keys(groups).forEach(group=>all?state.enabled.delete(group):state.enabled.add(group));persistPreferences();update();break;}
        case'select-all':{const all=enabledSelectionComplete();catalog.forEach(entry=>{const group=entry.id.split(':')[0];if(state.enabled.has(group))all?selected.get(group).delete(entry.id):selected.get(group).add(entry.id);});persistPreferences();update();break;}
        case'clear':for(const active of selected.values())active.clear();persistPreferences();update();break;
        case'start':state.original=null;begin();update('[data-kana-answer]');break;
        case'end':state.session.finished=true;update();break;
        case'next':if(!state.session.answers[state.session.index])break;if(state.session.index+1>=state.session.keys.length)state.session.finished=true;else{state.session.index++;state.session.draft='';}update('[data-kana-answer]');break;
        case'chart':state.session=null;update();break;
        case'again':{const keys=state.session.keys;state.script=state.session.script;begin(keys);update('[data-kana-answer]');break;}
        case'mistakes':{const session=state.session,keys=session.keys.filter((_,index)=>!session.answers[index]?.correct);state.script=session.script;begin(keys);update('[data-kana-answer]');break;}
      }
    }
    function change(event){
      const node=event.target;
      if(node.matches('[data-kana-include]')){event.stopPropagation();const group=node.dataset.kanaInclude;if(!rows[group])return;node.checked?state.enabled.add(group):state.enabled.delete(group);persistPreferences();update();}
      if(node.matches('[data-kana-readings]')){event.stopPropagation();state.readings=node.checked;persistPreferences();update();}
    }
    function input(event){if(event.target.matches('[data-kana-answer]')){event.stopPropagation();if(state.session&&!state.session.finished&&!state.session.answers[state.session.index]){state.session.draft=event.target.value;const checkButton=root.querySelector('[data-kana-check]');if(checkButton)checkButton.disabled=composing||event.isComposing||!state.session.draft.trim();}}}
    function composition(event){if(!event.target.matches('[data-kana-answer]'))return;event.stopPropagation();composing=event.type==='compositionstart';input(event);}
    function submit(event){
      if(!event.target.matches('[data-kana-form]'))return;event.preventDefault();event.stopPropagation();
      const session=state.session;if(composing||!session||session.finished||session.answers[session.index])return;
      const input=root.querySelector('[data-kana-answer]'),submitted=input.value;if(!submitted.trim()){input.focus();return;}
      session.draft=input.value;session.answers[session.index]={submitted,correct:check(session.keys[session.index],submitted)};update('[data-kana-action="next"]');
    }
    function keydown(event){if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&event.target.closest('.kana-order-stepper')){event.preventDefault();event.stopPropagation();state.order=state.order==='shuffle'?'chart':'shuffle';persistPreferences();update();}}
    root.addEventListener('keydown',keydown);root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);root.addEventListener('compositionstart',composition);root.addEventListener('compositionend',composition);root.addEventListener('submit',submit);mountResults();
    return()=>{resultsCleanup?.();root.removeEventListener('keydown',keydown);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);root.removeEventListener('compositionstart',composition);root.removeEventListener('compositionend',composition);root.removeEventListener('submit',submit);};
  }
  const api=Object.freeze({render,mount,entries,check,shuffled});globalThis.IKnowFocusKana=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
