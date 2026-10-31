/* Results layout review. The fixture is explicit and never touches real grades. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let catalog=[], words=[], stats=null, reviewRows=[], rowMap=new Map(), wordMap=new Map(), rowPositions=new Map(), exampleSize=9;
  const labels = {good:'Correct',hard:'After a retry',again:'Incorrect',unanswered:'Not answered'};
  const byKey = key => rowMap.get(key) || stats.rows[0];
  const wordFor = key => wordMap.get(key) || words[0];
  let layout='report', selected='', language='en', filter='review', cleanup=null, practice=null;
  let mapPage=0, mapFilter='all', mapSearch='';
  const PAGE_SIZE=50;
  function useExample(size){
    const example=IKnowResultExamples.create(catalog,size);
    words=example.words; stats=IKnowFocusResults.summarize(example.fixture); exampleSize=size;
    reviewRows=stats.rows.filter(row=>row.outcome!=='good');
    rowMap=new Map(stats.rows.map(row=>[row.key,row])); wordMap=new Map(words.map(word=>[word.key,word]));
    rowPositions=new Map(stats.rows.map((row,index)=>[row.key,index+1]));
    selected=(reviewRows[0]||stats.rows[0]).key; mapPage=0;mapFilter='all';mapSearch='';practice=null;
    $('results-example-size').value=String(size);
    const url=new URL(location.href);url.searchParams.set('size',String(size));history.replaceState(null,'',url);
  }
  const paths = {
    study:'<path d="M3 4h5l2 2 2-2h5v12h-5l-2 1-2-1H3zM10 6v11"/>',
    practice:'<path d="M3 8v4m3-7v10m4-12v14m4-11v8m3-6v4"/>',
    test:'<path d="M6 4H3v13h14V4h-3M7 2h6v4H7zM7 10h6M7 14h4"/>',
    library:'<path d="M3 3h4v14H3zM9 5h4v12H9zM15 4l3 12"/>'
  };
  const icon = name => '<svg viewBox="0 0 20 20" aria-hidden="true">'+paths[name]+'</svg>';
  const status = row => '<span class="result-status" data-state="'+row.outcome+'">'+labels[row.outcome]+'</span>';
  const gloss = row => {
    const word=wordFor(row.key);
    return language==='de'?(word.german||word.english):language==='both'?[word.english,word.german].filter(Boolean).join(' · '):word.english;
  };
  const score = () => '<div class="score-number" data-demo-percent>'+stats.percent+'<span>%</span></div><p class="score-copy">'+stats.firstTry+' of '+stats.total+' correct<br>on the first try</p>';
  function stat(label,count,state){return '<div class="result-stat" data-state="'+state+'"><strong>'+count+'</strong><span>'+label+'</span></div>';}
  function counters(){return '<div class="result-stats">'+stat('First try',stats.firstTry,'good')+stat('Incorrect',stats.missed,'again')+stat('After a retry',stats.retried,'hard')+stat('Not answered',stats.unanswered,'unanswered')+'</div>';}
  function comparison(row){
    return '<dl class="answer-comparison"><div class="submitted" data-wrong="'+(row.outcome==='again')+'"><dt>Your answer</dt><dd>'+escape(row.submitted||'Not answered')+'</dd></div><div class="expected"><dt>Expected answer</dt><dd>'+escape(row.expected)+'</dd></div></dl>';
  }
  function details(row){
    return '<details class="answer-details" data-row-key="'+row.key+'" data-result="'+row.outcome+'"><summary><span class="result-japanese" lang="ja">'+escape(row.japanese)+'</span>'+status(row)+'</summary><p class="result-gloss">'+escape(gloss(row))+'</p>'+comparison(row)+'</details>';
  }
  function practiceButton(){return '<button type="button" class="primary" data-result-action="practice">Review '+stats.reviewKeys.length+' items</button>';}
  function header(){
    const theme=document.documentElement.dataset.ikrTheme;
    return '<header class="result-header"><div class="brand"><img src="/extension/icons/icon128.png" alt="" width="41" height="41"><div><p class="eyebrow">iKnow! Reading Helper</p><h1>Your study space</h1></div></div><div class="result-header-actions">'+IKnowFocusMenus.render({theme,language,kind:'language'})+IKnowFocusMenus.render({theme,language,kind:'theme'})+'</div></header>';
  }
  function rail(){
    return '<nav class="focus-rail" aria-label="Study space"><a href="/study-focus.html">'+icon('study')+'Study</a><a href="/study-focus.html">'+icon('practice')+'Practice</a><button type="button" aria-pressed="true" data-result-action="reset">'+icon('test')+'Test</button><a href="/study-focus.html">'+icon('library')+'Library</a></nav>';
  }
  function report(){
    return '<section class="result-report" aria-label="Report layout"><div class="report-heading"><div><p class="result-eyebrow">Japanese vocabulary test</p><h2>Test complete</h2></div><span class="result-source">Core 2000 · Step 1</span></div><div class="report-score-row"><div class="report-score">'+score()+'</div>'+counters()+'</div><div class="report-recommendation"><div><p>'+stats.reviewKeys.length+' items to revisit.</p><small>Your correct answers can wait.</small></div>'+practiceButton()+'</div><section class="report-answers"><div class="result-section-heading"><h3>Your answers</h3><span>'+stats.answered+' of '+stats.total+' answered</span></div>'+reviewRows.map(details).join('')+'<details class="correct-group"><summary>Correct on the first try · '+stats.firstTry+'</summary>'+stats.rows.filter(row=>row.outcome==='good').map(details).join('')+'</details></section><div class="result-button-row"><a href="/study-focus.html">Back to study</a><span class="spacer"></span><button type="button" class="quiet" data-result-action="all-answers">Show all answers</button></div></section>';
  }
  function reviewDesk(){
    const rows=filter==='review'?reviewRows:stats.rows, row=byKey(selected);
    return '<section class="review-desk" aria-label="Review desk layout"><header class="review-heading"><div><p class="result-eyebrow">Core 2000 · Step 1</p><h2>'+stats.reviewKeys.length+' to revisit.</h2></div><div class="review-score"><strong data-demo-percent>'+stats.percent+'%</strong><span>'+stats.firstTry+' of '+stats.total+' correct on the first try</span></div></header><div class="review-columns"><aside class="review-list-pane"><div class="review-list-tools"><button type="button" data-result-filter="review" aria-pressed="'+(filter==='review')+'">To review · '+reviewRows.length+'</button><button type="button" data-result-filter="all" aria-pressed="'+(filter==='all')+'">All · '+stats.total+'</button></div><div class="review-item-list">'+rows.map(item=>'<button type="button" class="review-item" data-result-pick="'+item.key+'" aria-current="'+(selected===item.key)+'"><span class="result-japanese" lang="ja">'+escape(item.japanese)+'</span>'+status(item)+'</button>').join('')+'</div><div class="review-list-bottom"><p>Keep the next round focused.</p>'+practiceButton()+'</div></aside><article class="review-correction"><div class="correction-context"><span>Answer '+(stats.rows.findIndex(item=>item.key===row.key)+1)+' of '+stats.total+'</span>'+status(row)+'</div><h3 class="correction-japanese" lang="ja">'+escape(row.japanese)+'</h3><p class="result-gloss">'+escape(gloss(row))+'</p>'+comparison(row)+'<div class="review-mini-stats"><span><strong>'+stats.retried+'</strong> after a retry</span><span><strong>'+stats.unanswered+'</strong> not answered</span></div><div class="result-button-row"><a href="/study-focus.html">Back to study</a><span class="spacer"></span><button type="button" data-result-action="next-answer">Next answer</button></div></article></div></section>';
  }
  function sessionMap(){
    const row=byKey(selected), rows=mapRows(), pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    mapPage=Math.min(mapPage,pages-1);
    const start=mapPage*PAGE_SIZE, visible=rows.slice(start,start+PAGE_SIZE), large=stats.total>50;
    const tools=large?'<div class="map-tools"><label class="map-search-label"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m12 12 5 5"/></svg><input id="map-search" type="search" placeholder="Find an answer" aria-label="Find an answer" value="'+escape(mapSearch)+'"></label><label class="map-filter-label"><span class="sr-only">Answers to show</span><select id="map-filter"><option value="all"'+(mapFilter==='all'?' selected':'')+'>All answers</option><option value="review"'+(mapFilter==='review'?' selected':'')+'>To review · '+reviewRows.length+'</option></select></label></div>':'';
    const pager=large?'<div class="map-paging"><span id="map-page-label" role="status">'+(rows.length?(start+1)+'–'+Math.min(start+PAGE_SIZE,rows.length):'0')+' of '+rows.length+(mapFilter==='review'?' to review':' answers')+'</span><div><button type="button" data-map-page="previous"'+(!mapPage?' disabled':'')+' aria-label="Previous answers page">Previous</button><button type="button" data-map-page="next"'+(mapPage+1>=pages?' disabled':'')+' aria-label="Next answers page">Next</button></div></div>':'';
    const nodes=visible.map(item=>{const index=rowPositions.get(item.key);return '<button type="button" class="map-node" data-state="'+item.outcome+'" data-result-pick="'+item.key+'" aria-current="'+(selected===item.key)+'" aria-label="Answer '+index+', '+escape(item.japanese)+', '+labels[item.outcome]+'">'+index+'<span lang="ja">'+escape(item.japanese)+'</span></button>';}).join('');
    const review=large?'':'<section class="map-answer-list"><div class="result-section-heading"><h3>To review</h3><span>'+stats.reviewKeys.length+' items</span></div>'+reviewRows.map(details).join('')+'</section>';
    return '<section class="map-layout" data-large="'+large+'" aria-label="Session map layout"><div class="map-main"><div class="map-title"><div><p class="result-eyebrow">Core 2000 · Step 1</p><h2>Your session at a glance.</h2></div><span class="map-total">'+stats.total+' answers</span></div>'+tools+'<div class="session-map" role="group" aria-label="Answers in order">'+(nodes||'<p class="map-no-results">No matching answers.</p>')+'</div>'+pager+'<div class="map-legend"><span><i class="good"></i>'+stats.firstTry+' first try</span><span><i class="again"></i>'+stats.missed+' incorrect</span></div><article class="map-selected" data-selected-key="'+escape(row.key)+'"><div class="map-answer-context">Answer '+rowPositions.get(row.key)+' of '+stats.total+'<span>'+escape(wordFor(row.key).kind==='sentence'?'Sentence':'Word')+'</span></div><div class="map-selected-heading"><h3 class="result-japanese" lang="ja">'+escape(row.japanese)+'</h3>'+status(row)+'</div><p class="result-gloss" data-duplicate="'+(language==='en')+'">'+escape(gloss(row))+'</p>'+comparison(row)+'</article>'+review+'</div><aside class="map-sidebar"><div>'+score()+'</div>'+counters()+'<div class="map-recommendation"><p>'+stats.reviewKeys.length+' items to revisit.</p>'+practiceButton()+'</div><div class="result-button-row"><a href="/study-focus.html">Back to study</a></div></aside></section>';
  }
  function mapRows(){
    const term=mapSearch.trim().toLocaleLowerCase();
    return stats.rows.filter(row=>(mapFilter!=='review'||row.outcome!=='good')&&(!term||[row.japanese,wordFor(row.key).english,wordFor(row.key).german,String(rowPositions.get(row.key))].some(value=>String(value||'').toLocaleLowerCase().includes(term))));
  }
  function practiceMarkup(){
    if(!practice)return '';
    const top='<div class="practice-demo-head"><p>EXAMPLE PRACTICE · '+Math.min(practice.index+1,reviewRows.length)+' of '+reviewRows.length+'</p><button type="button" data-result-action="close-practice">Back to results</button></div>';
    if(practice.index>=reviewRows.length)return '<section class="practice-demo" aria-label="Example practice">'+top+'<div class="practice-demo-complete"><h2>Practice complete.</h2><p>Your example test result stays at '+stats.percent+'%.</p><button type="button" class="primary" data-result-action="close-practice">Back to results</button></div></section>';
    const row=reviewRows[practice.index], distractors=[...new Set(words.map(word=>word.english))].filter(value=>value!==row.expected), choices=[distractors[0],row.expected,distractors[1]].filter(Boolean);
    return '<section class="practice-demo" aria-label="Example practice">'+top+'<div class="practice-demo-card"><p>Choose the meaning</p><h2 lang="ja">'+escape(row.japanese)+'</h2><div class="practice-demo-options">'+choices.map(label=>'<button type="button" data-demo-answer="'+escape(label)+'">'+escape(label)+'</button>').join('')+'</div><p id="practice-demo-status" class="practice-demo-status" role="status"></p><div class="result-button-row"><button type="button" class="primary" data-result-action="practice-next" disabled>'+((practice.index+1===reviewRows.length)?'Finish':'Next item')+'</button></div></div></section>';
  }
  function render(){
    const positions=['.result-content','.map-main','.session-map','.review-item-list','.review-correction'].map(selector=>[selector,document.querySelector(selector)?.scrollTop||0]);
    cleanup?.();
    $('demo').innerHTML=header()+'<div class="app-frame result-desk">'+rail()+'<div class="result-content" data-layout-choice="'+layout+'">'+({report,review:reviewDesk,map:sessionMap}[layout])()+'</div>'+practiceMarkup()+'</div>';
    cleanup=IKnowFocusMenus.mount(document.querySelector('.result-header-actions'),{onTheme:theme=>{document.documentElement.dataset.ikrTheme=theme;try{localStorage.setItem('ikr-results-review:theme',theme);}catch{}},onLanguage:value=>{language=value;render();}});
    document.querySelectorAll('[data-result-design]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.resultDesign===layout));button.disabled=Boolean(practice);});
    const railNode=document.querySelector('.focus-rail'), content=document.querySelector('.result-content');railNode.inert=content.inert=Boolean(practice);
    positions.forEach(([selector,top])=>{const node=document.querySelector(selector);if(node)node.scrollTop=top;});
    $('results-example-size').disabled=Boolean(practice);
  }
  document.addEventListener('click',event=>{
    const choice=event.target.closest('[data-result-design]');
    if(choice&&!practice){layout=choice.dataset.resultDesign;render();return;}
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.mapPage){mapPage+=button.dataset.mapPage==='next'?1:-1;render();const map=document.querySelector('.session-map');if(map)map.scrollTop=0;return;}
    if(button.dataset.resultPick){selected=button.dataset.resultPick;render();return;}
    if(button.dataset.resultFilter){filter=button.dataset.resultFilter;if(filter==='review'&&!stats.reviewKeys.includes(selected))selected=reviewRows[0].key;render();return;}
    if(button.dataset.demoAnswer){const row=reviewRows[practice.index],correct=button.dataset.demoAnswer===row.expected;button.dataset.correct=String(correct);$('practice-demo-status').textContent=correct?'Correct':'Incorrect';button.disabled=true;if(correct){practice.correct=true;document.querySelectorAll('[data-demo-answer]').forEach(node=>node.disabled=true);document.querySelector('[data-result-action="practice-next"]').disabled=false;}return;}
    switch(button.dataset.resultAction){
      case 'practice':practice={index:0,correct:false};render();break;
      case 'close-practice':practice=null;render();break;
      case 'practice-next':if(practice?.correct){practice.index++;practice.correct=false;render();}break;
      case 'reset':if(!practice)render();break;
      case 'all-answers':{const group=document.querySelector('.correct-group');if(group){group.open=true;group.scrollIntoView({block:'nearest',behavior:'instant'});}break;}
      case 'next-answer':{const rows=filter==='review'?reviewRows:stats.rows, index=rows.findIndex(row=>row.key===selected);selected=rows[(index+1)%rows.length].key;render();break;}
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&practice){practice=null;render();}});
  document.addEventListener('change',event=>{
    if(event.target.id==='results-example-size'&&!practice){useExample(Number(event.target.value));render();}
    if(event.target.id==='map-filter'){mapFilter=event.target.value;mapPage=0;render();document.querySelector('.session-map').scrollTop=0;}
  });
  document.addEventListener('input',event=>{
    if(event.target.id!=='map-search')return;
    const start=event.target.selectionStart,end=event.target.selectionEnd;
    mapSearch=event.target.value;mapPage=0;render();
    const search=$('map-search');search.focus({preventScroll:true});search.setSelectionRange(start,end);
    document.querySelector('.session-map').scrollTop=0;
  });
  try{const saved=localStorage.getItem('ikr-results-review:theme')||localStorage.getItem('ikr-layout-review:theme');if(['paper','midnight','tokyo','forest'].includes(saved))document.documentElement.dataset.ikrTheme=saved;const requested=new URLSearchParams(location.search).get('layout');if(['report','review','map'].includes(requested))layout=requested;}catch{}
  globalThis.IKnowResultsDesignDemo=Object.freeze({summary:()=>structuredClone(stats),size:()=>exampleSize,example:true});
  async function start(){
    $('demo').innerHTML='<p class="results-loading" role="status">Loading example results…</p>';
    try{
      const response=await fetch('/catalog-source.json');if(!response.ok)throw Error('Course data is unavailable.');
      catalog=IKnowReaderStudyCatalog.normalizeSource(await response.json(),{courseId:'19053'}).records;
      const requested=Number(new URLSearchParams(location.search).get('size'));
      useExample([9,200,400].includes(requested)?requested:9);render();
    }catch(error){$('demo').innerHTML='<p class="results-loading" role="alert">'+escape(error.message)+' Please refresh to retry.</p>';}
  }
  start();
})();
