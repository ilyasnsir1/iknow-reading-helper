(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const Practice = globalThis.IKnowReaderStudyPractice;
  const Store = globalThis.IKnowReaderStudyStore;
  const Runtime=globalThis.IKnowStudyWorkspaceData?.create();
  const escape = text => String(text ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const paths = {
    book:'<path d="M3 4h5l2 2 2-2h5v12h-5l-2 1-2-1H3zM10 6v11"/>',
    listen:'<path d="M3 8v4m3-7v10m4-12v14m4-11v8m3-6v4"/>',
    gap:'<path d="M3 5h8M3 10h4M3 17h14m-6-6 5-5 2 2-5 5-3 1 1-3Zm4-4 2 2"/>',
    test:'<path d="M6 4H3v13h14V4h-3M7 2h6v4H7zM7 10h6M7 14h4"/>',
    library:'<path d="M3 3h4v14H3zM9 5h4v12H9zM15 4l3 12"/>',
    moon:'<path d="M16 12A6.1 6.1 0 0 1 8 4a6.5 6.5 0 1 0 8 8Z"/>',
    play:'<path d="m7 4 10 6-10 6Z"/>',
    close:'<path d="m5 5 10 10M15 5 5 15"/>',
    trash:'<path d="M3 5h14M8 2h4l1 3M5 5l1 13h8l1-13M8 8v6m4-6v6"/>',
    backup:'<path d="M10 2v10m-3-3 3 3 3-3M4 12v5h12v-5"/>',
    chevron:'<path d="m5 7 5 5 5-5"/>',
    settings:'<path d="M3 5h14M3 10h14M3 15h14M6 3v4m8 1v4m-7 1v4"/>',
    note:'<path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h3"/>',
    check:'<path d="m3.5 8 3 3 6-6"/>',
    kana:'<path d="M3 4h9M7 2v3c0 5-1 8-4 11m1-9c1 4 4 7 8 9M13 7h4l-2 10m-3-4h6"/>',
  };
  const icon = name => `<svg viewBox="${name==='check'?'0 0 16 16':'0 0 20 20'}"${name==='check'?' class="ui-check"':''} aria-hidden="true">${paths[name] || paths.book}</svg>`;
  const viewIds = new Set(["study", "practice", "test", "kana"]);
  const routeView = () => viewIds.has(location.hash.slice(1)) ? location.hash.slice(1) : "study";
  const explanations = {a:"Library and activities in one workspace.",b:"A collection first. Open an item when you need it.",c:"One item at a time. Keep the library within reach."};
  const german = {
    "それ":"das, jenes", "見る":"sehen, anschauen", "円":"Kreis", "多い":"viel, zahlreich", "家":"Haus, Zuhause", "これ":"dies, dieses", "新しい":"neu", "私":"ich", "仕事":"Arbeit, Beruf",
    "それはとてもいい話だ。":"Das ist eine wirklich schöne Geschichte.", "私は絵を見るのが好きです。":"Ich schaue mir gern Bilder an.", "そこに大きな円を描いて。":"Zeichne dort einen großen Kreis.", "京都にはお寺が多い。":"In Kyoto gibt es viele Tempel.", "家に遊びにきてください。":"Komm mich zu Hause besuchen.", "これをください。":"Das hätte ich bitte.", "彼の車は新しい。":"Sein Auto ist neu.", "私が行きましょう。":"Dann gehe ich.", "3月は仕事が忙しい。":"Im März habe ich viel Arbeit."
  };
  let items = [], current = "", version = "c", libraryOpen = true, course = "", view = "study", mode = "review", language = "en", search = "", kind = "", strength = "", drawer = false, selectionMode = false, picker = false, pickerPurpose = "practice", pickerSearch = "", setupModal = false, session = null, revealed = false, audio = null, toastTimer;
  const librarySources = { all: "All", iknow: "iKnow", noji: "Noji" };
  let librarySource = "all",showRomaji=false,romajiPreferenceBusy=false;
  if(!Runtime)try{showRomaji=localStorage.getItem("ikr-layout-review:show-romaji")==="true";}catch{}
  const libraryScroll = new Map(),libraryRowItems=new WeakMap();
  const tokenReveals = new Map(),readingRequests=new Map(),noteDrafts=new Map();
  const flippedCards = new Set(), cardWritings = new Map(), cardReadings = new Map();
  const NojiReading = globalThis.IKnowNojiCardReading;
  const nojiReadingCache=new Map(),NOJI_READING_CACHE='iknowReaderNojiReadings:v2';
  const validNojiRomaji=value=>typeof value==='string'&&value.length>0&&value.length<=2000&&/[a-z]/iu.test(value)&&/^[a-z0-9 ,.!?;:'()"-]+$/iu.test(value);
  try{const raw=localStorage.getItem(NOJI_READING_CACHE);if(raw&&raw.length<600000){const entries=JSON.parse(raw);if(Array.isArray(entries))for(const entry of entries.slice(-200))if(Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&entry[0].length<=400&&validNojiRomaji(entry[1]))nojiReadingCache.set(entry[0],entry[1]);}}catch{}
  function rememberNojiReading(text,value){
    if(text.length>400||!validNojiRomaji(value))return;
    nojiReadingCache.delete(text);nojiReadingCache.set(text,value);
    while(nojiReadingCache.size>200)nojiReadingCache.delete(nojiReadingCache.keys().next().value);
    try{localStorage.setItem(NOJI_READING_CACHE,JSON.stringify([...nojiReadingCache]));}catch{}
  }

  const expansionOrders=new Map(),expansionAnimations=new Map();
  let compareOpen = false, compareKey = "", dockAnimation = null, dockCoreAnimation = null, dockRevision = 0;
  let panelResizeObserver=null,panelLayoutFrame=0;
  let menuCleanup = null, resultsCleanup = null, kanaCleanup = null, previousTestReport = null;
  let practiceAttempts = "retry", practiceGapPosition = "random", practiceSource = "saved", practiceOrder = "course", practiceContent = "word";
  const courseClient = globalThis.IKnowFocusCourse.createClient(), reviewCache = new WeakMap();
  let testCatalog = null, testCourseInput = "19053", testContent = "word", courseBusy = false, courseError = "", courseRevision = 0;
  let previewLibrary = null, previewLearning = {schemaVersion:1,records:{},session:null}, previewSettings = {}, backupController = null;
  let practiceCatalog = null, practiceCourseInput = "19053", practiceCourseBusy = false, practiceCourseError = "", practiceRevision = 0;
  let answerComposing = false;
  let runtimeSnapshot=null,runtimeBusy=false,disposeRuntime=null;
  let libraryActions=null,strengthMenu=null,nojiImport=null;
  let voiceMenu=null,voiceAnchor=null;
  const Rounds=Runtime?globalThis.IKnowStudyWorkspaceRounds.create({runtime:Runtime,practice:Practice,reviewQuestion,getLanguage:()=>language,getGapPosition:()=>practiceGapPosition,canSynthesize:record=>Boolean(localVoice(record,true))}):null;
  const practiceCourseCache = new WeakMap();
  const selected = new Set();

  const savedByAdded=library=>Object.values(library.records).sort((a,b)=>a.createdAt-b.createdAt);
  const getItem = key => session?.pool?.find(item => item.key === key) || items.find(item => item.key === key) || testCatalog?.records.find(item => item.key === key) || items[0];
  const germanMeaning=item=>item?.german||(!Runtime&&german[item?.japanese])||'';
  const romajiFor=item=>Runtime?globalThis.IKnowReaderCore.displayRomaji(item,runtimeSnapshot?.reading.romajiStyle||'source'):item.romaji;
  const nojiCard=record=>Boolean(record&&Store.isImportedDeck(record.courseId));
  const cardSide=item=>flippedCards.has(item.key)?'back':'front';
  const cardSideKey=(item,side=cardSide(item))=>item.key+':'+side;
  const sideText=(item,side)=>side==='front'?meaning(item):item.japanese;
  const faceReading=(item,side=cardSide(item))=>NojiReading?.faces(item)[side];
  const cardReadingKey=(item,side=cardSide(item))=>cardSideKey(item,side)+'|'+sideText(item,side);
  const speechText=(record,face=false)=>nojiCard(record)?(face?faceReading(record):NojiReading?.primary(record))?.speech||'':record?.script==='romaji'?record.kana:record?.japanese;
  const voiceSource=record=>Store.isImportedDeck(record.courseId)?'noji':'iknow';
  const voiceFor=(record,settings=runtimeSnapshot?.reading)=>voiceSource(record)==='noji'?settings?.nojiVoice||'female':settings?.sentenceVoice||'original';
  function localVoice(record, allowWithoutOriginal = false, face = false) {
    if (!Runtime || !globalThis.IKnowReaderCore.neuralSentenceText(speechText(record,face))) return "";
    const selectedVoice = voiceFor(record);
    if (selectedVoice === "female" || selectedVoice === "male") return selectedVoice;
    return !record.audioUrl && (allowWithoutOriginal || globalThis.IKnowReaderStudyStore.isImportedDeck(record.courseId)) ? "female" : "";
  }
  const playLabel = record => {
    const voice = localVoice(record,false,true);
    if(!nojiCard(record)&&record.script==='romaji'&&!record.kana)return "Listen";
    return voice ? "Listen with " + globalThis.IKnowReaderCore.SENTENCE_VOICES[voice] : "Listen to original";
  };
  function playbackVolume(record,withPlayer=false,recording=true){
    const voice=localVoice(record,withPlayer,!withPlayer)||(nojiCard(record)?voiceFor(record):'');
    const kind=voice==='female'||voice==='male'?'word':'original';
    return{kinds:recording?[kind,'recording']:[kind],labels:kind==='word'?{word:'Local AI voice · '+globalThis.IKnowReaderCore.SENTENCE_VOICES[voice]}:{}};
  }
  function volumeButton(record,withPlayer=false,recording=true){const source=playbackVolume(record,withPlayer,recording);return globalThis.IKnowReaderVolumeControls.button(source.kinds,source.labels);}
  function updateVolumeSource(record,withPlayer=false){const source=playbackVolume(record,withPlayer,!withPlayer);globalThis.IKnowReaderVolumeControls.configure(document.querySelector(withPlayer?'.session-screen [data-audio-volume-menu]':'.focus-card [data-audio-volume-menu]'),source.kinds,source.labels);}
  function closeVoiceMenu(focus=false) {
    voiceMenu?.remove();voiceMenu=null;
    voiceAnchor?.setAttribute('aria-expanded','false');
    if(focus&&voiceAnchor?.isConnected)voiceAnchor.focus({preventScroll:true});
    voiceAnchor=null;
  }
  function openVoiceMenu(button,point) {
    const record=items.find(item=>item.key===current);
    if(!Runtime||!record)return;
    closeVoiceMenu();strengthMenu?.close();globalThis.IKnowReaderVolumeControls?.close();
    const source=voiceSource(record),selected=voiceFor(record);
    const options=source==='noji'?['female','male']:['original','female','male'];
    const labels={original:'iKnow audio',female:'Female · Mao Plain',male:'Male · Nise'};
    voiceMenu=document.createElement('div');voiceMenu.className='focus-menu focus-voice-menu';voiceMenu.id='focus-voice-menu';
    voiceMenu.setAttribute('role','menu');voiceMenu.setAttribute('aria-label',`Voice for ${source==='noji'?'Noji':'iKnow'} cards`);
    voiceMenu.innerHTML=`<div class="focus-menu-list">${options.map(voice=>`<button type="button" class="focus-menu-option" role="menuitemradio" data-study-voice="${voice}" data-voice-source="${source}" aria-checked="${selected===voice}"><span>${labels[voice]}</span><svg class="focus-voice-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg></button>`).join('')}</div>`;
    document.body.append(voiceMenu);voiceAnchor=button;button.setAttribute('aria-expanded','true');
    const anchor=button.getBoundingClientRect(),box=voiceMenu.getBoundingClientRect();
    voiceMenu.style.left=Math.max(8,Math.min(point?.x??anchor.left,innerWidth-box.width-8))+'px';
    voiceMenu.style.top=Math.max(8,Math.min(point?.y??anchor.bottom+5,innerHeight-box.height-8))+'px';
    voiceMenu.querySelector('[aria-checked=true]').focus({preventScroll:true});
  }
  const meaning = item => language === "de" ? germanMeaning(item) || item.english : item.english || (Store.isImportedDeck(item.courseId) ? item.german : "");
  const subtitle = item => item.kind === "word" ? "Word" : "Sentence";
  const noun = (records, plural = false) => {
    const present=records.filter(Boolean);if(present.length&&present.every(nojiCard))return plural?'cards':'card';
    const kinds = new Set(present.map(item=>item.kind));
    return kinds.size===1&&kinds.has('word')?(plural?'words':'word'):kinds.size===1&&kinds.has('sentence')?(plural?'sentences':'sentence'):(plural?'words & sentences':'question');
  };
  const nextSavedLabel = () => {const list=filtered(),at=list.findIndex(item=>item.key===current),next=list.length?list[(Math.max(at,0)+1)%list.length]:null;return nojiCard(next)?'Next card':next?.kind==='sentence'?'Next sentence':'Next word';};
  const strengthLabel = value => ({new:"New",weak:"Weak",learning:"Learning",strong:"Strong"}[value]);
  const close = `<button class="close-button danger" type="button" data-action="close-overlay" aria-label="Close">Close</button>`;
  const modeName = () => ({review:"Review",cloze:"Fill the gap",listening:"Listening"}[mode]);
  const SELECTION_KEY='iknowReaderStudyWorkspaceSelection:v1';
  function rememberStudySelection(){
    if(!items.length)return;
    const list=$('demo-library-list'),stored=libraryScroll.get('docked');
    const top=list?.scrollTop??stored?.top??0;
    try{sessionStorage.setItem(SELECTION_KEY,JSON.stringify({schemaVersion:1,context:location.search,current,course,kind,strength,source:librarySource,search:search.slice(0,200),libraryOpen,scrollTop:Math.max(0,Math.round(top))}));}catch{}
  }
  function restoreStudySelection(){
    try{
      const raw=sessionStorage.getItem(SELECTION_KEY);if(!raw||raw.length>2500)return false;
      const saved=JSON.parse(raw);
      if(saved.schemaVersion!==1||saved.context!==location.search||typeof saved.current!=='string'||saved.current.length>130)return false;
      const source=Object.hasOwn(librarySources,saved.source)?saved.source:'all';
      if(source==='all'&&!items.some(item=>item.key===saved.current))return false;
      librarySource=source;
      current=librarySelection(saved.current);
      course=typeof saved.course==='string'&&libraryCourses().has(saved.course)?saved.course:'';
      kind=['','word','sentence'].includes(saved.kind)?saved.kind:'';strength=['','new','weak','learning','strong'].includes(saved.strength)?saved.strength:'';search=typeof saved.search==='string'?saved.search.slice(0,200):'';
      libraryOpen=typeof saved.libraryOpen==='boolean'?saved.libraryOpen:true;
      if(Number.isSafeInteger(saved.scrollTop)&&saved.scrollTop>=0&&saved.scrollTop<=1000000)libraryScroll.set('docked',{top:saved.scrollTop,left:0});
      return true;
    }catch{return false;}
  }
  function matchesLibrarySource(item) {
    return librarySource === 'all' || Store.isImportedDeck(item.courseId) === (librarySource === 'noji');
  }
  function librarySelection(key) {
    return items.find(item=>item.key===key&&matchesLibrarySource(item))?.key || items.find(matchesLibrarySource)?.key || '';
  }
  function libraryCourses() {
    return new Map(items.filter(matchesLibrarySource).map(item=>[item.courseId,item.courseTitle||`Course ${item.courseId}`]));
  }
  function courseOptions(courses) {
    return `<option value="">${librarySource==='noji'?'All decks':'All courses'}</option>${[...courses].map(([id,title])=>`<option value="${escape(id)}"${course===id?' selected':''}>${escape(title)}</option>`).join('')}`;
  }
  function libraryHasTypes() {
    return librarySource!=='noji'&&!Store.isImportedDeck(course)&&items.some(item=>matchesLibrarySource(item)&&!Store.isImportedDeck(item.courseId)&&(!course||item.courseId===course));
  }
  function updateLibraryTypes() {
    const control=$('demo-kind');if(!control)return;
    const available=libraryHasTypes();control.hidden=!available;control.disabled=!available;
  }
  function filtered() {
    const query = search.trim().toLowerCase(),types=libraryHasTypes();
    return items.filter(item => matchesLibrarySource(item) && (!course || item.courseId === course) && (!kind || !types || !Store.isImportedDeck(item.courseId)&&item.kind===kind) && (!strength || item.strength === strength) && (!query || [item.japanese,item.kana,item.romaji,item.english,germanMeaning(item)].join(" ").toLowerCase().includes(query)));
  }
  function sourceCourseLink(item){
    const title=item.courseTitle||`Course ${item.courseId}`;
    try{const id=courseClient.courseId(item.courseId);return `<a class="focus-source-link" href="https://iknow.jp/courses/${id}" target="_blank" rel="noopener noreferrer" aria-label="Open course: ${escape(title)}">${escape(title)}</a>`;}catch{return escape(title);}
  }
  function header() {
    const menus=globalThis.IKnowFocusMenus,theme=document.documentElement.dataset.ikrTheme;
    return `<header class="app-header"><div class="brand"><img src="icons/icon128.png" alt="" width="43" height="43"><div><p class="eyebrow">iKnow! Reading Helper</p><h1>Your study space</h1></div></div><div class="app-actions">${Runtime ? '<button class="quiet import-noji-button" data-action="import-noji">Import Noji</button>' : ''}<button class="quiet backup-button" data-action="backup">${icon("backup")}Backup</button>${menus.render({theme,language,kind:"language",languageDisabled:Boolean(session&&!session.finishedAt)})}${menus.render({theme,language,kind:"theme"})}</div></header>`;
  }
  function tabs() {
    return `<div class="tabs" role="group" aria-label="Study activity">${[["study","Study"],["practice","Practice"],["test","Course test"]].map(([id,label])=>`<button type="button" data-view="${id}" aria-pressed="${view===id}">${label}</button>`).join("")}</div>`;
  }
  function filterFields(collection = false) {
    return `<input type="search" id="demo-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(search)}" autocomplete="off"><${collection ? "div" : "div"} class="${collection ? "sr-only" : "library-filters"}">${!collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>` : ""}${!collection ? kindSelect() : ""}</div>${collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>${kindSelect()}<select id="demo-strength" aria-label="Learning strength"><option value="">All strengths</option>${["new","weak","learning","strong"].map(s=>`<option value="${s}"${strength===s?" selected":""}>${strengthLabel(s)}</option>`).join("")}</select>` : ""}`;
  }
  function kindSelect() {
    return `<select id="demo-kind" aria-label="Words or sentences"${libraryHasTypes()?'':' hidden disabled'}><option value="">All types</option><option value="word"${kind==="word"?" selected":""}>Words</option><option value="sentence"${kind==="sentence"?" selected":""}>Sentences</option></select>`;
  }
  function strengthSelect(id='demo-strength') {
    return `<select id="${id}" aria-label="Learning level"><option value="">All levels</option>${['new','weak','learning','strong'].map(level=>`<option value="${level}"${strength===level?' selected':''}>${strengthLabel(level)}</option>`).join('')}</select>`;
  }
  const practiceSavedItems=()=>items.filter(item=>!strength||item.strength===strength);
  const selectedPracticeItems=()=>practiceSavedItems().filter(item=>selected.has(item.key));
  function pickerItems(){
    const query=pickerSearch.trim().toLowerCase();
    return practiceSavedItems().filter(item=>!query||[item.japanese,item.romaji,item.english,germanMeaning(item)].join(' ').toLowerCase().includes(query));
  }
  function setStrengthFilter(value){
    strength=['','new','weak','learning','strong'].includes(value)?value:'';
    for(const key of selected)if(!practiceSavedItems().some(item=>item.key===key))selected.delete(key);
    if(picker){render();return;}
    updateLists();
    const next=filtered();if(next.length&&!next.some(item=>item.key===current))selectStudyItem(next[0].key);
  }
  function readingPreference(){
    return `<label class="romaji-preference"${!current||nojiCard(items.find(item=>item.key===current))?' hidden':''}><input type="checkbox" id="always-show-romaji" role="switch"${showRomaji?' checked':''}${romajiPreferenceBusy?' disabled':''}><span class="romaji-preference-track" aria-hidden="true"></span><span>Always show Romaji</span></label>`;
  }
  function updateReadingPreference(){
    const input=$('always-show-romaji');if(!input)return;
    input.checked=showRomaji;input.disabled=romajiPreferenceBusy;
    input.closest('label').hidden=!current||nojiCard(items.find(item=>item.key===current));
  }
  async function setReadingPreference(value){
    if(romajiPreferenceBusy)return;
    const previous=showRomaji;showRomaji=value;romajiPreferenceBusy=true;updateReadingPreference();updateReading();
    try{
      if(Runtime)await Runtime.setPreferences({showRomaji:value});
      else{previewSettings[Store.PREFERENCES_KEY]={...(previewSettings[Store.PREFERENCES_KEY]||{}),showRomaji:value};localStorage.setItem('ikr-layout-review:show-romaji',String(value));}
    }catch(error){showRomaji=previous;updateReading();toast(error.message);}
    finally{romajiPreferenceBusy=false;updateReadingPreference();}
  }
  const tokenIsShown=(item,index)=>!nojiCard(item)&&showRomaji||tokenReveals.get(item.key)?.has(index);
  function row(item, checkboxes = false, pickerRow = false) {
    const checked = selected.has(item.key);
    const manual=(Runtime?runtimeSnapshot?.learning:previewLearning)?.assessments?.[item.key]?.level;
    return `<button class="library-row" type="button" data-item="${escape(item.key)}"${pickerRow ? ' data-picker-row="true"' : ' aria-description="Right-click or press Shift+F10 to set your learning level."'} aria-current="${!checkboxes && current===item.key}">${checkboxes ? `<input type="checkbox" aria-label="Select ${escape(item.japanese)}" tabindex="-1"${checked?" checked":""}>` : ""}<span class="item-main"><span class="jp"${nojiCard(item)?'':' lang="ja"'}>${escape(nojiCard(item)?meaning(item):item.japanese)}</span><span class="en">${escape(nojiCard(item)?item.japanese:meaning(item))}</span><span class="strength" data-strength="${item.strength}" data-manual="${Boolean(manual&&manual!=='auto')}">${strengthLabel(item.strength)}</span></span></button>`;
  }
  function libraryPane() {
    return `<aside class="library-pane" aria-label="Saved for later"><div class="library-heading"><h2>Saved for later <span>${items.length}</span></h2><button class="quiet" data-action="delete-all">Delete all</button></div><div class="library-search">${filterFields()}</div><div class="library-list" id="demo-library-list">${filtered().map(item=>row(item)).join("")}</div><div class="library-bottom">${items.length} saved items</div></aside>`;
  }
  function displayedJapanese(item) {
    if(item.script==='romaji')return tokenReveals.get(item.key)?.size&&item.kana?{text:item.kana,lang:'ja'}:{text:item.japanese,lang:'ja-Latn'};
    const romaji=Store.isImportedDeck(item.courseId)&&tokenReveals.get(item.key)?.size?romajiFor(item):"";
    return romaji?{text:romaji,lang:"ja-Latn"}:{text:item.japanese,lang:"ja"};
  }
  function japaneseHeading(item) {
    const {text,lang}=displayedJapanese(item);
    return `<h2 class="japanese"${Store.isImportedDeck(item.courseId)?' id="focus-reading-title"':''} lang="${lang}">${escape(text)}</h2>`;
  }
  const kanaScript=item=>/\p{Script=Katakana}/u.test(item.kana)&&!/\p{Script=Hiragana}/u.test(item.kana)?'Katakana':'Hiragana';
  function reading(item) {
    if(item.cardMode==='original')return '';
    const words=romajiFor(item).split(/\s+/).filter(Boolean),tokens=tokenReveals.get(item.key)||new Set(),all=words.length&&tokens.size===words.length;
    const noji=Store.isImportedDeck(item.courseId);
    if(item.script==='romaji'&&!item.kana)return "";
    if(!words.length&&!(Runtime&&noji))return "";
    const loading=!words.length&&readingRequests.get(item.key)?.notice===true;
    const label=item.script==='romaji'?(all?'Show Romaji':'Show '+kanaScript(item)):loading?"Preparing Romaji…":all?(noji?"Show Japanese":"Hide Romaji"):"Show Romaji";
    const toggle=noji?`<div class="romaji-heading"><button type="button" class="quiet romaji-toggle" data-action="reveal-reading" aria-controls="focus-reading-title"${readingRequests.has(item.key)?' aria-disabled="true" aria-busy="true"':''}>${label}</button></div>`:'';
    const wordButtons=noji?"":`<div class="romaji" id="focus-romaji" aria-label="Reveal individual Romaji words">${words.map((word,index)=>`<button type="button"${showRomaji?' disabled data-always-shown="true"':''} data-reading="${escape(word)}" data-reading-index="${index}" aria-pressed="${Boolean(tokenIsShown(item,index))}" class="${tokenIsShown(item,index)?"revealed":""}">${tokenIsShown(item,index)?escape(word):"•••"}</button>`).join("")}</div>`;
    return `<div class="detail-reading">${toggle}${wordButtons}</div>`;
  }
  function meanings(item, focus = false) {
    const english = `<p lang="en">${escape(item.english)}</p>`;
    const deutsch = `<p lang="de">${escape(germanMeaning(item) || "German not prepared.")}</p>`;
    const translated = Store.isImportedDeck(item.courseId) ? (item.english ? english : deutsch) :
      language==="de" ? deutsch : language==="both" ? english+deutsch : english;
    return `<${focus ? "div" : "details"} class="meaning"${focus ? "" : " open"}>${focus ? "" : `<summary>${icon("chevron")}Meaning</summary>`}${translated}</${focus ? "div" : "details"}>`;
  }
  function noteState(item){
    let draft=noteDrafts.get(item.key);const saved=String(item.notes||'');
    if(!draft){draft={saved,value:saved,open:Boolean(saved),editing:false,busy:false,error:''};noteDrafts.set(item.key,draft);}
    else if(draft.saved!==saved){if(draft.value===draft.saved&&!draft.busy)draft.value=saved;draft.saved=saved;}
    return draft;
  }
  function noteMarkup(item){
    if(!item)return '';
    const draft=noteState(item),editing=draft.editing;
    if(!draft.open)return '<section id="focus-note" class="focus-note" data-study-panel="note" hidden></section>';
    const remove=draft.saved?`<button type="button" class="quiet focus-note-delete" data-action="delete-note"${draft.busy?' disabled':''}>Delete note</button>`:'';
    return `<section id="focus-note" class="focus-note" data-study-panel="note" data-note-state="${editing?'edit':'read'}"><div class="focus-note-inner"><div class="focus-note-heading"><h3>${icon('note')}Note</h3>${editing?'':`<div>${remove}<button type="button" class="quiet" data-action="edit-note"${draft.busy?' disabled':''}>Edit</button></div>`}</div>${editing?`<textarea id="focus-note-input" rows="2" maxlength="4000" aria-label="Your note" placeholder="Write a note…" spellcheck="false"${draft.busy?' disabled':''}>${escape(draft.value)}</textarea><footer class="focus-note-footer"><p class="focus-note-status" role="status" data-error="${Boolean(draft.error)}">${escape(draft.error)}</p><div>${remove}<button type="button" class="quiet" data-action="cancel-note"${draft.busy?' disabled':''}>Cancel</button><button type="button" class="primary" data-action="save-note"${draft.busy||draft.value===draft.saved?' disabled':''}>Save note</button></div></footer>`:`<p class="focus-note-text">${escape(draft.saved)}</p>${draft.error?`<p class="focus-note-status" role="status" data-error="true">${escape(draft.error)}</p>`:''}`}</div></section>`;
  }
  function syncStudyPanels(opening,animate=false){
    const container=document.querySelector('.focus-expansions');if(!container)return;
    const item=items.find(record=>record.key===current),grid=container.querySelector('.focus-panel-grid');if(!item||!grid)return;
    const desired={note:noteState(item).open,compare:compareOpen};
    const shown=Object.keys(desired).filter(name=>desired[name]);
    const panels=[...grid.children],gridTop=grid.getBoundingClientRect().top;
    const before=new Map(panels.map(panel=>[panel,{open:panel.dataset.motionOpen==='true',hidden:panel.hidden,top:panel.getBoundingClientRect().top-gridTop,opacity:panel.hidden?0:Number(getComputedStyle(panel).opacity)}]));
    const newlyOpened=opening&&desired[opening]&&!before.get(grid.querySelector(`[data-study-panel="${opening}"]`))?.open;
    const order=(expansionOrders.get(current)||[]).filter(name=>desired[name]&&(!newlyOpened||name!==opening));
    for(const name of shown)if((!newlyOpened||name!==opening)&&!order.includes(name))order.push(name);
    if(newlyOpened)order.push(opening);
    expansionOrders.set(current,order);
    container.dataset.count=String(shown.length);
    container.dataset.open=String(Boolean(shown.length));
    const core=container.previousElementSibling,coreStyle=core&&getComputedStyle(core);
    const fromGap=coreStyle?{marginTop:coreStyle.marginTop,marginBottom:coreStyle.marginBottom}:null;
    const revision=++dockRevision,from=container.hidden?0:container.getBoundingClientRect().height;
    dockAnimation?.cancel();dockAnimation=null;dockCoreAnimation?.cancel();dockCoreAnimation=null;
    container.hidden=false;container.style.height=from+'px';
    let nextTop=12;
    for(const name of order){
      const panel=grid.querySelector(`[data-study-panel="${name}"]`);
      expansionAnimations.get(panel)?.cancel();expansionAnimations.delete(panel);
      panel.hidden=false;panel.style.transform='';panel.style.opacity='';
      grid.append(panel);panel.style.top=nextTop+'px';
      const height=panel.getBoundingClientRect().height;panel.dataset.layoutHeight=String(height);
      nextTop+=height+12;
    }
    const to=shown.length?nextTop-8:0,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let toGap=null;
    if(core&&fromGap){
      core.style.marginTop='';core.style.marginBottom='';container.style.height=to+'px';
      const style=getComputedStyle(core);toGap={marginTop:style.marginTop,marginBottom:style.marginBottom};
      container.style.height=from+'px';Object.assign(core.style,fromGap);
    }
    for(const panel of panels){
      const open=desired[panel.dataset.studyPanel],previous=before.get(panel);
      expansionAnimations.get(panel)?.cancel();expansionAnimations.delete(panel);
      panel.dataset.motionOpen=String(open);panel.inert=!open;panel.setAttribute('aria-hidden',String(!open));
      if(!animate||reduced||!open&&previous.hidden){panel.hidden=!open;panel.style.transform='';panel.style.opacity='';continue;}
      panel.hidden=false;
      const offset=open?(previous.hidden?5:previous.top-Number.parseFloat(panel.style.top||'0')):0;
      if(open&&previous.open&&Math.abs(offset)<.25&&previous.opacity>.99)continue;
      const animation=panel.animate([{opacity:previous.opacity,transform:`translateY(${offset}px)`},{opacity:open?1:0,transform:open?'translateY(0)':'translateY(-3px)'}],{duration:open&&previous.open?260:180,easing:'cubic-bezier(.22,.68,.2,1)',fill:'forwards'});
      expansionAnimations.set(panel,animation);
      animation.finished.then(()=>{if(expansionAnimations.get(panel)!==animation)return;panel.hidden=!open;expansionAnimations.delete(panel);animation.cancel();}).catch(()=>{});
    }
    const action=document.querySelector('[data-action="note"]');action?.setAttribute('aria-expanded',String(shown.includes('note')));
    if(action)action.disabled=noteState(item).busy;
    const finish=()=>{if(revision!==dockRevision||!container.isConnected)return;container.style.height=to+'px';container.hidden=!to;dockAnimation=null;dockCoreAnimation?.cancel();dockCoreAnimation=null;if(core){core.style.marginTop='';core.style.marginBottom='';}if(!to)expansionOrders.delete(current);};
    if(!animate||Math.abs(from-to)<.5||reduced)finish();
    else{
      const timing={duration:260,easing:'cubic-bezier(.22,.68,.2,1)',fill:'forwards'};
      if(core&&fromGap&&toGap)dockCoreAnimation=core.animate([fromGap,toGap],timing);
      const animation=container.animate([{height:from+'px'},{height:to+'px'}],timing);dockAnimation=animation;
      animation.finished.then(()=>{finish();animation.cancel();}).catch(()=>{});
    }
  }
  function observeStudyPanels(){
    panelResizeObserver?.disconnect();
    if(!globalThis.ResizeObserver)return;
    panelResizeObserver=new ResizeObserver(entries=>{
      if(!entries.some(entry=>entry.target.dataset.motionOpen==='true'&&Math.abs(entry.target.getBoundingClientRect().height-Number(entry.target.dataset.layoutHeight||0))>.5)||panelLayoutFrame)return;
      panelLayoutFrame=requestAnimationFrame(()=>{panelLayoutFrame=0;if(view==='study'&&!session)syncStudyPanels(null,true);});
    });
    for(const panel of document.querySelectorAll('.focus-panel-grid>[data-study-panel]'))panelResizeObserver.observe(panel);
  }
  function updateInlineNote(focus=false,animate=false){
    const item=items.find(record=>record.key===current),section=$('focus-note');if(!item||!section)return;
    const draft=noteState(item),focusWasInside=section.contains(document.activeElement);
    if(draft.open){
      expansionAnimations.get(section)?.cancel();expansionAnimations.delete(section);
      const wasOpen=section.dataset.motionOpen==='true',template=document.createElement('template');template.innerHTML=noteMarkup(item);const next=template.content.firstElementChild;next.dataset.motionOpen=String(wasOpen);next.style.cssText=section.style.cssText;next.hidden=!wasOpen;section.replaceWith(next);
    }
    if(!draft.open&&focusWasInside)document.querySelector('[data-action="note"]')?.focus({preventScroll:true});
    syncStudyPanels(draft.open?'note':null,animate);
    observeStudyPanels();
    if(focus){const input=$('focus-note-input');input?.focus({preventScroll:true});input?.setSelectionRange(input.value.length,input.value.length);}
    else if(focusWasInside&&draft.open&&!draft.editing)document.querySelector('[data-action="edit-note"]')?.focus({preventScroll:true});
  }
  function openInlineNote(){
    const item=items.find(record=>record.key===current);if(!item)return;
    const draft=noteState(item);if(draft.busy)return;
    if(draft.open){draft.open=false;draft.editing=false;draft.value=draft.saved;draft.error='';updateInlineNote(false,true);}
    else{draft.open=true;draft.editing=!draft.saved;draft.error='';updateInlineNote(draft.editing,true);}
  }
  function editInlineNote(){
    const item=items.find(record=>record.key===current);if(!item)return;
    const draft=noteState(item);if(draft.busy)return;draft.open=true;draft.editing=true;draft.error='';updateInlineNote(true);
  }
  function cancelInlineNote(){
    const item=items.find(record=>record.key===current);if(!item)return;const draft=noteState(item);if(draft.busy)return;
    draft.value=draft.saved;draft.editing=false;draft.open=Boolean(draft.saved);draft.error='';updateInlineNote(false,true);
  }
  async function saveInlineNote(remove=false){
    const item=items.find(record=>record.key===current);if(!item)return;const draft=noteState(item);if(draft.busy||(remove?!draft.saved:draft.value===draft.saved))return;
    const key=item.key,value=remove?'':draft.value;draft.busy=true;draft.error='';updateInlineNote();
    try{
      if(Runtime){const record=await Runtime.updateNotes(key,value);draft.saved=value;draft.value=value;draft.editing=false;draft.open=Boolean(value);
        receiveRuntimeSnapshot({...runtimeSnapshot,library:{schemaVersion:1,records:{...runtimeSnapshot.library.records,[key]:record}}});}
      else{await updatePreviewLibrary(records=>{records[key]={...records[key],notes:value,updatedAt:Date.now()};});draft.saved=value;draft.value=value;draft.editing=false;draft.open=Boolean(value);}
    }catch(error){draft.error=String(error.message||'The note could not be saved. Try again.');}
    finally{draft.busy=false;if(current===key)updateInlineNote(false,true);}
  }
  function cardFaceText(item,side){
    const original=sideText(item,side);
    const writing=cardWritings.get(cardSideKey(item,side)),analysis=faceReading(item,side);
    const translated=writing==='romaji'?cardReadings.get(cardReadingKey(item,side)):writing&&analysis?.[writing];
    return translated||original;
  }
  function cardTools(item){
    const reading=faceReading(item),writing=cardWritings.get(cardSideKey(item));
    const voice=localVoice(item,false,true),label=playLabel(item),request=readingRequests.get(cardReadingKey(item));
    const play=voice?`<button type="button" data-action="play" class="audio-mini" data-play-label="${label}" aria-haspopup="menu" aria-expanded="false" aria-description="Right-click to choose a voice.">${icon('listen')}<span data-play-text>${label}</span><span id="focus-audio-visualization" hidden></span></button>`:'';
    const scripts=reading?.kind==='romaji'?['hiragana','katakana'].map(script=>`<button type="button" class="quiet card-writing-button" data-card-writing="${script}" aria-pressed="${writing===script}">${writing===script?'Romaji':script==='hiragana'?'Hiragana':'Katakana'}</button>`).join(''):reading?.kind==='japanese'&&reading.full?`<button type="button" class="quiet card-writing-button" data-card-writing="romaji" aria-pressed="${writing==='romaji'}"${request?' disabled':''}${request?.notice?' aria-busy="true"':''}>${request?.notice?'Loading':writing==='romaji'?'Japanese':'Romaji'}</button>`:'';
    const suggestion=reading?.kind==='romaji'&&reading.needsReview&&writing?'<span class="noji-select-hint">Suggested kana</span>':'';
    return `<div class="noji-writing-tools">${scripts}${suggestion}</div><div class="noji-audio-tools">${play}<button type="button" data-action="compare" class="quiet" aria-expanded="${compareOpen}" aria-controls="focus-compare">Listen & compare</button>${volumeButton(item)}</div>`;
  }
  function originalCard(item) {
    const flipped=flippedCards.has(item.key);
    const face=side=>`<span class="focus-flashcard-face" data-original-side="${side}" data-visible="${(side==='back')===flipped}" aria-hidden="${(side==='back')!==flipped}"${(side==='back')!==flipped?' inert':''}><span class="focus-flashcard-side">${side==='front'?'Front':'Back'}</span><span class="focus-flashcard-text">${escape(cardFaceText(item,side))}</span></span>`;
    return `<article class="focus-card focus-original-card" data-compare-open="${compareOpen}"><div class="focus-card-core"><p class="eyebrow">${sourceCourseLink(item)}</p><button type="button" class="focus-flashcard" data-action="flip-card" aria-label="Show ${flipped?'front':'back'}" aria-pressed="${flipped}"><span class="focus-flashcard-faces">${face('front')}${face('back')}</span></button><div class="practice-tools noji-card-tools">${cardTools(item)}</div></div><div class="focus-expansions" data-count="0" hidden><div class="focus-panel-grid">${noteMarkup(item)}<section id="focus-compare" class="focus-compare-panel" data-study-panel="compare" aria-label="Listen and compare" aria-hidden="${!compareOpen}"${compareOpen?'':' hidden inert'}></section></div></div></article>`;
  }
  function updateOriginalCard(item){
    const card=document.querySelector('.focus-original-card');if(!card)return;
    const flipped=flippedCards.has(item.key),button=card.querySelector('[data-action="flip-card"]'),label=`Show ${flipped?'front':'back'}`;
    button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(flipped));
    for(const face of button.querySelectorAll('[data-original-side]')){const active=(face.dataset.originalSide==='back')===flipped;face.dataset.visible=String(active);face.inert=!active;face.setAttribute('aria-hidden',String(!active));face.querySelector('.focus-flashcard-text').textContent=cardFaceText(item,face.dataset.originalSide);}
    card.querySelector('.noji-card-tools').innerHTML=cardTools(item);
    globalThis.IKnowFocusAudio?.mountVisualizer($('focus-audio-visualization'));
  }
  function flipOriginalCard(){
    const item=items.find(record=>record.key===current);if(!nojiCard(item))return;
    closeVoiceMenu();globalThis.IKnowReaderVolumeControls?.close();stopAudio();globalThis.IKnowFocusAudio?.stopMedia();
    const selection=getSelection();if(selection?.anchorNode?.parentElement?.closest('.focus-flashcard'))selection.removeAllRanges();
    flippedCards.has(item.key)?flippedCards.delete(item.key):flippedCards.add(item.key);updateOriginalCard(item);
  }
  async function changeCardWriting(writing){
    const item=items.find(record=>record.key===current);if(!nojiCard(item))return;
    const side=cardSide(item),key=cardReadingKey(item,side),writingKey=cardSideKey(item,side),reading=faceReading(item);
    if(!nojiCard(item)||!reading||readingRequests.has(key))return;
    const isCurrent=()=>current===item.key&&view==='study'&&cardSide(item)===side&&cardReadingKey(item,side)===key;
    closeVoiceMenu();stopAudio();
    if(cardWritings.get(writingKey)===writing){cardWritings.delete(writingKey);updateOriginalCard(item);return;}
    if(writing==='romaji'&&!cardReadings.has(key)){
      const saved=side==='back'&&reading.text===item.japanese?romajiFor(item):'';
      const immediate=saved||globalThis.IKnowRomajiKana?.toRomaji(reading.text)||nojiReadingCache.get(reading.text);
      if(immediate){cardReadings.set(key,immediate);rememberNojiReading(reading.text,immediate);}
      else{
        const request={notice:false};readingRequests.set(key,request);updateOriginalCard(item);
        const notice=setTimeout(()=>{request.notice=true;if(isCurrent())updateOriginalCard(item);},150);
        let timeout;
        try{
          const result=await Promise.race([chrome.runtime.sendMessage({type:'ikr:noji:reading',text:reading.text}),new Promise(resolve=>{timeout=setTimeout(()=>resolve({ok:false,code:'noji_reading_timeout'}),15000);})]);
          if(!result?.ok)throw Error(result?.code==='noji_reading_timeout'?'Romaji took too long. Try again.':result?.code==='noji_reading_busy'?'The local reader is busy. Try again.':'Romaji could not be prepared. Check Models & voices.');
          cardReadings.set(key,result.romaji);rememberNojiReading(reading.text,result.romaji);
        }catch(error){if(isCurrent())toast(error.message);return;}
        finally{clearTimeout(notice);clearTimeout(timeout);if(readingRequests.get(key)===request)readingRequests.delete(key);if(isCurrent())updateOriginalCard(item);}
      }
    }
    if(!isCurrent())return;
    if(writing==='romaji'&&reading.kind!=='japanese'||writing!=='romaji'&&!reading[writing])return;
    cardWritings.set(writingKey,writing);if(current===item.key)updateOriginalCard(item);
  }
  function detail(focus = false) {
    const item = focus ? items.find(record=>record.key===current) : getItem(current);
    if (!item && items.length && librarySource!=='all') return `<article class="focus-card focus-empty"><h2>No ${librarySources[librarySource]} cards yet.</h2></article>`;
    if (!item) return '<article class="focus-card focus-empty"><h2>Your library is empty.</h2><p>Save a word or sentence from an iKnow course.</p></article>';
    if(nojiCard(item))return originalCard(item);
    if(focus) return `<article class="focus-card" data-compare-open="${compareOpen}"><div class="focus-card-core"><p class="eyebrow">${subtitle(item)} · ${sourceCourseLink(item)}</p>${japaneseHeading(item)}${item.script==='romaji'?'':`<p class="kana" lang="ja">${escape(item.kana)}</p>`}${reading(item)}${meanings(item,true)}<div class="practice-tools"><button data-action="play" class="audio-mini" data-play-label="${playLabel(item)}" aria-haspopup="menu" aria-expanded="false" aria-controls="focus-voice-menu" aria-description="Right-click or press Shift+F10 to choose a voice."${!item.audioUrl&&!localVoice(item)?' disabled':''}>${icon("listen")}<span data-play-text>${playLabel(item)}</span><span id="focus-audio-visualization" hidden></span></button><button data-action="compare" class="quiet" aria-expanded="${compareOpen}" aria-controls="focus-compare">Listen & compare</button>${volumeButton(item)}</div></div><div class="focus-expansions" data-count="0" hidden><div class="focus-panel-grid">${noteMarkup(item)}<section id="focus-compare" class="focus-compare-panel" data-study-panel="compare" aria-label="Listen and compare" aria-hidden="${!compareOpen}"${compareOpen?"":" hidden inert"}></section></div></div></article>`;
    return `<article class="detail"><div class="detail-inner"><div class="detail-top"><p class="eyebrow">${subtitle(item)} · ${escape(item.courseTitle||`Course ${item.courseId}`)}</p><button class="quiet delete-item" data-action="delete">${icon("trash")}Delete</button></div>${japaneseHeading(item)}${item.script==='romaji'?'':`<p class="kana" lang="ja">${escape(item.kana)}</p>`}${reading(item)}${meanings(item)}<div class="practice-tools"><button class="primary" data-action="practise-item">Practise this ${item.kind}</button><button class="quiet" data-action="play">${icon("listen")}${playLabel(item)}</button></div><div class="detail-note"><label for="demo-note">A note to yourself</label><textarea id="demo-note" rows="2" placeholder="A reminder, an example, or a way to remember it."></textarea></div><div class="detail-footer"><span>${items.findIndex(i=>i.key===current)+1} of ${items.length} saved items</span><button class="quiet" data-action="next">${nextSavedLabel()}</button></div></div></article>`;
  }
  function choiceStepper(id,name,label,choices,value,disabled=false){
    const selected=choices.find(choice=>choice[0]===value)||choices[0];
    const arrow=(direction,path)=>`<button type="button" data-choice-step="${direction}" aria-label="${direction==='previous'?'Previous':'Next'} ${escape(label.toLowerCase())}"${disabled?' disabled':''}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg></button>`;
    return `<div class="focus-choice-field"><span id="${id}-label">${escape(label)}</span><div class="focus-choice-stepper" role="group" aria-labelledby="${id}-label" data-choice="${name}" aria-disabled="${disabled}">${arrow('previous','m10 4-4 4 4 4')}<output id="${id}" data-value="${selected[0]}" aria-live="polite">${escape(selected[1])}</output>${arrow('next','m6 4 4 4-4 4')}</div></div>`;
  }
  const attemptChoices=()=>[['retry','One retry'],['single','One attempt']];
  const contentChoices=()=>[['word','Vocabulary'],['sentence','Sentences'],['both','Vocabulary & sentences']];
  const orderChoices=()=>[['course',practiceSource==='course'?'Course order':'Library order'],['shuffle','Shuffle']];
  const gapChoices=()=>[['random','Random word'],['first','First word']];
  function hasSentenceGaps(){
    return mode==='cloze'&&(practiceSource==='course'?practiceContent!=='word':items.some(item=>selected.has(item.key)&&item.kind==='sentence'));
  }
  function practiceOptions(){
    return choiceStepper('demo-attempts','attempts','Attempts',attemptChoices(),practiceAttempts)+choiceStepper('demo-practice-order','practice-order','Order',orderChoices(),practiceOrder)+(hasSentenceGaps()?choiceStepper('demo-gap-position','gap-position','Gap position',gapChoices(),practiceGapPosition):'');
  }
  function updatePracticeOptions(){
    const container=document.querySelector('[data-practice-options]');
    if(!container)return;
    const gap=container.querySelector('[data-choice="gap-position"]')?.closest('.focus-choice-field');
    if(gap&&!hasSentenceGaps())gap.remove();
    else if(!gap&&hasSentenceGaps())container.insertAdjacentHTML('beforeend',choiceStepper('demo-gap-position','gap-position','Gap position',gapChoices(),practiceGapPosition));
  }
  function refreshActivity(test=false){
    if(session||view!==(test?'test':'practice'))return;
    const surface=document.querySelector('.focus-desk>.activity-pane>.activity-inner');
    if(!surface||Boolean(surface.querySelector('[data-practice-source]'))===test){render();return;}
    const template=document.createElement('template');template.innerHTML=activity(test);

    const key=node=>node.nodeType===Node.ELEMENT_NODE?node.tagName+':'+(node.id||['data-action','data-mode','data-practice-source','data-choice'].map(name=>node.getAttribute(name)||'').join(':')+':'+node.className):'#'+node.nodeType;
    const sync=(target,next)=>{
      const previous=[...target.childNodes],used=new Set();
      const pairs=[...next.childNodes].map(fresh=>{
        const match=previous.find(node=>!used.has(node)&&key(node)===key(fresh));
        if(match)used.add(match);
        return{fresh,match,node:match||fresh};
      });

      for(const node of previous)if(!used.has(node))node.remove();
      let cursor=target.firstChild;
      for(const{fresh,match,node}of pairs){
        if(match){
          if(match.nodeType===Node.TEXT_NODE){if(match.data!==fresh.data)match.data=fresh.data;}
          else if(match.nodeType===Node.ELEMENT_NODE){
            for(const attr of [...match.attributes])if(!fresh.hasAttribute(attr.name))match.removeAttribute(attr.name);
            for(const attr of fresh.attributes)if(match.getAttribute(attr.name)!==attr.value)match.setAttribute(attr.name,attr.value);
            if(match instanceof HTMLInputElement&&match.value!==fresh.value)match.value=fresh.value;
            sync(match,fresh);
          }
        }
        if(node===cursor)cursor=cursor.nextSibling;else target.insertBefore(node,cursor);
      }
    };
    sync(surface,template.content.querySelector('.activity-inner'));
  }
  function stepChoice(name,direction){
    if(runtimeBusy||session)return;
    const settings={
      attempts:{id:'demo-attempts',choices:attemptChoices(),value:practiceAttempts},
      'practice-order':{id:'demo-practice-order',choices:orderChoices(),value:practiceOrder},
      'practice-content':{id:'demo-practice-content',choices:contentChoices(),value:practiceContent,disabled:practiceCourseBusy},
      'test-content':{id:'demo-test-content',choices:contentChoices(),value:testContent,disabled:courseBusy},
      'gap-position':{id:'demo-gap-position',choices:gapChoices(),value:practiceGapPosition}
    };
    const setting=settings[name];if(!setting||setting.disabled)return;
    const offset=direction==='previous'?-1:1,index=setting.choices.findIndex(choice=>choice[0]===setting.value);
    const next=setting.choices[(Math.max(0,index)+offset+setting.choices.length)%setting.choices.length];
    if(name==='attempts'){practiceAttempts=next[0];if(Runtime)void Runtime.setPreferences({attempts:practiceAttempts}).catch(error=>toast(error.message));}
    else if(name==='practice-order'){practiceOrder=next[0];retainPracticeSetup();}
    else if(name==='practice-content'){practiceContent=next[0];retainPracticeSetup();updatePracticeSummary();}
    else if(name==='test-content'){testContent=next[0];retainTestSetup();updateTestSummary();}
    else if(name==='gap-position'){practiceGapPosition=next[0];if(Runtime)void Runtime.setPreferences({gapPosition:practiceGapPosition}).catch(error=>toast(error.message));}
    const output=$(setting.id);if(output){output.dataset.value=next[0];output.textContent=next[1];}
  }
  function activity(test = false, modal = false) {
    const coursePractice=!test&&practiceSource==='course';
    const practicePlan=coursePractice?practiceCoursePlan():null;
    const count = coursePractice?practicePlan.count:selectedPracticeItems().length;
    const plan = test ? testPlan() : null;
    const heading=`<div class="activity-heading"><div><p class="eyebrow">${test ? "Check your progress" : "Your pace"}</p><h2>${test ? "Course test" : "Practice"}</h2></div>${modal ? close : test ? "" : `<small>${count} ${coursePractice?'available':'selected'}</small>`}</div>`;
    const modes=`<div class="mode-grid" role="group" aria-label="Practice mode">${[["review","book","Review","Find the meaning."],["cloze","gap","Fill the gap","Complete the sentence."],["listening","listen","Listening","Listen, then write."]].map(([id,graphic,label,description])=>`<button class="mode-card" data-mode="${id}" aria-pressed="${mode===id}">${icon(graphic)}<span>${label}</span><small>${description}</small></button>`).join("")}</div>`;
    const options=`<div class="setup-fields" data-practice-options>${practiceOptions()}</div>`;
    const selection=`<div class="activity-selection"><div><p>${count ? `${count} selected` : "Choose what you want to practise"}</p><small>${selectedPracticeItems().filter(i=>i.kind==="word").length} words · ${selectedPracticeItems().filter(i=>i.kind==="sentence").length} sentences</small></div><button data-action="choose">Choose words &amp; sentences</button></div>`;
    const sources=`<div class="practice-sources" role="group" aria-label="Practice source"><button type="button" data-practice-source="saved" aria-pressed="${!coursePractice}">Saved library</button><button type="button" data-practice-source="course" aria-pressed="${coursePractice}">Course</button></div>`;
    const practiceCourse=coursePractice?practiceCourseMarkup(practicePlan):'';
    const loaded=courseMatchesInput()&&!courseError&&!courseBusy;
    const course=test?`<div class="setup-course" aria-busy="${courseBusy}"><h3 id="demo-test-title">${escape(testCatalog?.title || "Load a course")}</h3>${courseSourceFields('test',testCourseInput,testContent,courseBusy,courseError,loaded,testLoadLabel())}${courseFeedback('demo-test-source-status',plan,courseBusy,courseError)}</div>`:"";
    return `<section class="activity-pane"><div class="activity-inner">${heading}${test?course:sources+modes+(coursePractice?practiceCourse:'')+options+(coursePractice?'':selection)}<div class="setup-start"><button class="primary" data-action="start"${test?!plan.ready?" disabled":"":coursePractice?!practicePlan.ready?' disabled':'':!count?" disabled":""}>${test ? `Start test<span id="demo-test-total">${plan.count?` (${plan.count})`:""}</span>` : coursePractice?`Start practice (${count})`:"Start session"}</button></div></div></section>`;
  }
  function courseSourceFields(kind,value,content,busy,error,loaded,loadLabel){
    return `<div class="setup-fields course-source-fields"><div class="course-entry"><label for="demo-${kind}-course">Course ID or link</label><div class="course-input-action"><input id="demo-${kind}-course" type="text" value="${escape(value)}" maxlength="200" placeholder="19053" autocomplete="off" aria-describedby="demo-${kind}-source-status" aria-invalid="${Boolean(error)}"${busy?' disabled':''}><button type="button" class="course-load" data-action="load-${kind}-course"${busy||loaded||!value.trim()?' disabled':''}${loaded?' hidden':''}>${loadLabel}</button><span class="course-source-ready" role="status"${loaded?'':' hidden'}>Ready</span></div></div>${choiceStepper(`demo-${kind}-content`,`${kind}-content`,'Content',contentChoices(),content,busy)}</div>`;
  }
  function updateCourseSource(kind,value,busy,error,loaded,label){
    const load=document.querySelector(`[data-action="load-${kind}-course"]`);if(!load)return;
    load.disabled=busy||loaded||!value.trim();load.hidden=loaded;load.textContent=label;
    load.parentElement.querySelector('.course-source-ready').hidden=!loaded;
  }
  function courseFeedback(id,plan,busy,error){
    const state=error?'error':busy?'loading':'idle';
    return `<div class="course-feedback" data-state="${state}"${plan.label?'':' hidden'}><p class="small" id="${id}" role="${error?'alert':'status'}" aria-atomic="true">${escape(plan.label)}</p></div>`;
  }
  function updateCourseFeedback(id,plan,busy,error){
    const status=$(id);if(!status)return;
    const feedback=status.closest('.course-feedback');
    feedback.dataset.state=error?'error':busy?'loading':'idle';feedback.hidden=!plan.label;
    status.setAttribute('role',error?'alert':'status');status.textContent=plan.label;
    const container=feedback.closest('.setup-course');container.setAttribute('aria-busy',String(busy));
    container.querySelector('input').setAttribute('aria-invalid',String(Boolean(error)));
  }
  function practiceCourseMatchesInput(){try{return practiceCatalog?.courseId===courseClient.courseId(practiceCourseInput);}catch{return false;}}
  function unavailableReason(record,exerciseMode=mode){
    if(record.cardMode==='original'&&exerciseMode!=='review')return 'original';
    if(exerciseMode==='cloze')return Practice.clozeUnavailableReason?.(record)||(record.kind==='word'?!record.context?'example':'target':'boundaries');
    if(exerciseMode==='listening')return record.audioUrl||record.context?.audioUrl||localVoice(record)?'answer':'audio';
    return record.english||germanMeaning(record)?'choices':'meaning';
  }
  function unavailableMessage(entries){
    const counts=new Map();for(const entry of entries)counts.set(entry.reason,(counts.get(entry.reason)||0)+1);
    const phrase=(count,singular,plural)=>`${count} ${count===1?singular:plural}`;
    const descriptions={
      original:count=>phrase(count,'original card can be practised in Review.','original cards can be practised in Review.'),
      example:count=>phrase(count,'word has no example sentence.','words have no example sentence.'),
      boundaries:count=>phrase(count,'example has no reliable word boundaries.','examples have no reliable word boundaries.'),
      target:count=>phrase(count,'word could not be matched to its example.','words could not be matched to their examples.'),
      audio:count=>phrase(count,'question has no original recording.','questions have no original recording.'),
      answer:count=>phrase(count,'recording has no usable answer text.','recordings have no usable answer text.'),
      meaning:count=>phrase(count,'question has no usable meaning.','questions have no usable meaning.'),
      choices:count=>phrase(count,'question has no distinct answer choices.','questions have no distinct answer choices.')
    };
    return [...counts].map(([reason,count])=>descriptions[reason](count)).join(' ');
  }
  function practiceCoursePlan(){
    if(practiceCourseBusy)return{count:0,ready:false,records:[],label:'Loading course…'};
    if(practiceCourseError)return{count:0,ready:false,records:[],label:practiceCourseError};
    if(!practiceCatalog||!practiceCourseMatchesInput())return{count:0,ready:false,records:[],label:'Load a course to begin.'};
    const pool=practiceCatalog.records;
    let cache=practiceCourseCache.get(pool);if(!cache){cache=new Map();practiceCourseCache.set(pool,cache);}
    const cacheKey=mode+':'+(language==='de'?'de':'en')+(mode==='listening'?':'+runtimeSnapshot?.reading.sentenceVoice:'');
    if(!cache.has(cacheKey)){
      const records=[],missing=[];
      for(const record of pool){
        const valid=mode==='cloze'?Boolean(Practice.buildCloze(record,{gapPosition:'first'})):mode==='listening'?Boolean(Practice.buildListening(record,{canSynthesize:localVoice})):Boolean(reviewQuestion(record,pool));
        if(valid)records.push(record);else missing.push({kind:record.kind,reason:unavailableReason(record)});
      }
      cache.set(cacheKey,{records,missing});
    }
    const matches=record=>practiceContent==='both'||record.kind===practiceContent;
    const records=cache.get(cacheKey).records.filter(matches),missing=cache.get(cacheKey).missing.filter(matches);
    return{count:records.length,ready:records.length>0,records,label:missing.length?unavailableMessage(missing):practiceCatalog.stale?'Using the saved course copy.':''};
  }
  function practiceCourseMarkup(plan){
    const loaded=practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCourseBusy;
    return `<div class="setup-course practice-course" aria-busy="${practiceCourseBusy}"><h3 id="demo-practice-title">${escape(practiceCatalog?.title||'Load a course')}</h3>${courseSourceFields('practice',practiceCourseInput,practiceContent,practiceCourseBusy,practiceCourseError,loaded,practiceCourseBusy?'Loading…':loaded?'Loaded':'Load course')}${courseFeedback('demo-practice-source-status',plan,practiceCourseBusy,practiceCourseError)}</div>`;
  }
  function updatePracticeSummary(){
    if(view!=='practice'||practiceSource!=='course'||session)return;
    const plan=practiceCoursePlan();updateCourseFeedback('demo-practice-source-status',plan,practiceCourseBusy,practiceCourseError);
    const loaded=practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCourseBusy;updateCourseSource('practice',practiceCourseInput,practiceCourseBusy,practiceCourseError,loaded,practiceCourseBusy?'Loading…':loaded?'Loaded':'Load course');
    const start=document.querySelector('[data-action="start"]');if(start){start.disabled=!plan.ready;start.textContent=`Start practice (${plan.count})`;}
    const count=document.querySelector('.activity-heading small');if(count)count.textContent=plan.count?`${plan.count} available`:'';
    updatePracticeOptions();
  }
  async function loadPracticeCourse(){
    if(practiceCourseBusy||session||!practiceCourseInput.trim()||(practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCatalog?.stale))return;
    const revision=++practiceRevision,input=practiceCourseInput;practiceCourseBusy=true;practiceCourseError='';
    const cached=(practiceCourseMatchesInput()?practiceCatalog:null)||await courseClient.cached(input);
    if(revision!==practiceRevision)return;
    practiceCatalog=cached;

    if(cached&&!cached.stale){practiceCourseBusy=false;retainPracticeSetup();if(!session&&view==='practice'&&practiceSource==='course')refreshActivity();return;}
    if(!session&&view==='practice'&&practiceSource==='course')refreshActivity();
    try{const catalog=await courseClient.load(input);if(revision===practiceRevision)practiceCatalog=catalog;}
    catch(error){if(revision===practiceRevision)practiceCourseError=String(error.message||'Course could not be loaded. Try again.');}
    finally{if(revision===practiceRevision){practiceCourseBusy=false;if(practiceCatalog)retainPracticeSetup();if(!session&&view==='practice'&&practiceSource==='course')refreshActivity();}}
  }
  function restorePracticeSetup(){
    try{
      const raw=sessionStorage.getItem('ikr-layout-review:practice-course');if(!raw||raw.length>700)return;
      const saved=JSON.parse(raw);
      if(saved.schemaVersion!==1||typeof saved.input!=='string'||saved.input.length>200||courseClient.courseId(saved.input)!==saved.courseId)return;
      practiceCourseInput=saved.input;
      if(['word','sentence','both'].includes(saved.content))practiceContent=saved.content;
      if(['course','shuffle'].includes(saved.order))practiceOrder=saved.order;
      if(['saved','course'].includes(saved.source))practiceSource=saved.source;
      if(['review','cloze','listening'].includes(saved.mode))mode=saved.mode;
    }catch{   }
  }
  function retainPracticeSetup(){
    try{sessionStorage.setItem('ikr-layout-review:practice-course',JSON.stringify({schemaVersion:1,courseId:courseClient.courseId(practiceCourseInput),input:practiceCourseInput,content:practiceContent,order:practiceOrder,source:practiceSource,mode}));}catch{}
  }
  function reviewQuestion(record, pool) {
    let cached=reviewCache.get(pool);if(!cached){const prepared=pool.map(item=>({...item,german:germanMeaning(item)}));cached={prepared,records:new Map(prepared.map(item=>[item.key,item])),languages:new Map()};reviewCache.set(pool,cached);}
    const locale=language==="de"?"de":"en";let entries=cached.languages.get(locale);
    if(!entries){entries=new Map();cached.languages.set(locale,entries);}
    if(!entries.has(record.key))entries.set(record.key,Practice.buildReviewQuestion(cached.records.get(record.key),cached.prepared,{language:locale}));
    return entries.get(record.key);
  }
  function courseMatchesInput() {try{return testCatalog?.courseId===courseClient.courseId(testCourseInput);}catch{return false;}}
  function testLoadLabel() {return courseBusy?(courseMatchesInput()?"Updating…":"Loading…"):courseMatchesInput()&&!courseError?"Loaded":"Load course";}
  function restoreTestSetup() {
    try {
      const saved=JSON.parse(sessionStorage.getItem("ikr-layout-review:test-course")||"null");
      if(!saved||typeof saved.input!=="string"||saved.input.length>200||courseClient.courseId(saved.input)!==saved.courseId)return;
      testCourseInput=saved.input;
      if(["word","sentence","both"].includes(saved.content))testContent=saved.content;
    } catch {   }
  }
  function retainTestSetup() {
    if(!courseMatchesInput())return;
    try {sessionStorage.setItem("ikr-layout-review:test-course",JSON.stringify({courseId:testCatalog.courseId,input:testCourseInput,content:testContent}));} catch {}
  }
  function testPlan() {
    if(courseBusy){const count=courseMatchesInput()?testCatalog.records.filter(item=>testContent==="both"||item.kind===testContent).length:0;return{count,ready:false,label:count?"Updating course…":"Loading course…"};}
    if(courseError)return{count:0,ready:false,label:courseError};
    if(!testCatalog||!courseMatchesInput())return{count:0,ready:false,label:"Load this course to begin."};
    const records=testCatalog.records.filter(item=>testContent==="both"||item.kind===testContent);
    const unavailable=records.filter(item=>!reviewQuestion(item,testCatalog.records)).map(record=>({reason:unavailableReason(record,'review')}));
    return{count:records.length,ready:records.length>0&&!unavailable.length,label:unavailable.length?unavailableMessage(unavailable):testCatalog.stale?"Using the saved course copy.":""};
  }
  function updateTestSummary() {
    if(view!=="test"||session)return;const plan=testPlan();
    if($("demo-test-total"))$("demo-test-total").textContent=plan.count?` (${plan.count})`:"";
    updateCourseFeedback('demo-test-source-status',plan,courseBusy,courseError);
    updateCourseSource('test',testCourseInput,courseBusy,courseError,courseMatchesInput()&&!courseError&&!courseBusy,testLoadLabel());
    const start=document.querySelector('[data-action="start"]');if(start)start.disabled=!plan.ready;
  }
  async function loadTestCourse() {
    if(courseBusy||session||!testCourseInput.trim()||(courseMatchesInput()&&!courseError&&!testCatalog?.stale))return;
    const revision=++courseRevision,input=testCourseInput;
    courseBusy=true;courseError="";
    const prior=courseMatchesInput()?testCatalog:null;
    const cached=prior||await courseClient.cached(input);
    if(revision!==courseRevision)return;
    testCatalog=cached;
    if(cached&&!cached.stale){courseBusy=false;retainTestSetup();if(!session&&view==="test")refreshActivity(true);return;}
    if(!session&&view==="test")refreshActivity(true);
    try{const catalog=await courseClient.load(input);if(revision!==courseRevision)return;testCatalog=catalog;}
    catch(error){if(revision===courseRevision)courseError=String(error.message||"Course could not be loaded. Try again.");}
    finally{if(revision===courseRevision){courseBusy=false;if(testCatalog)retainTestSetup();if(!session&&view==="test")refreshActivity(true);}}
  }
  function workspaceA() {
    return `<div class="app-frame"><div class="frame-toolbar">${tabs()}<div class="spacer"></div><span class="counter">${items.length} saved items</span><button class="quiet delete-all" data-action="delete-all">Delete all</button></div>${libraryPane()}${view==="study"?detail():activity(view==="test")}${overlays()}</div>`;
  }
  function workspaceB() {
    return `<div class="app-frame"><div class="frame-toolbar"><h2>Saved for later</h2><span class="counter">${items.length}</span><div class="spacer"></div><button class="quiet" data-action="collection-select">${selectionMode?"Done selecting":"Select items"}</button><button data-action="test-modal">Course test</button><button class="primary" data-action="practice-modal">Practice</button></div><div class="collection-filters">${filterFields(true)}</div><div class="collection-body"><div class="collection-grid" id="demo-library-list">${filtered().map(item=>row(item,selectionMode)).join("")}</div></div><div class="collection-footer"><span id="collection-count">${selectionMode?`${selectedPracticeItems().length} selected`:`${filtered().length} items`}</span><button class="quiet" data-action="delete-all">Delete all</button>${selectionMode ? `<button class="primary" data-action="practice-modal"${!selected.size?" disabled":""}>Practise selected</button>` : `<span>Core 2000 · Step 1</span>`}</div>${drawer?`<aside class="drawer" aria-label="Item details"><div class="drawer-head"><span>Item details</span><button class="close-button danger" data-action="close-drawer" aria-label="Close item details">Close</button></div>${detail()}</aside>`:""}${overlays()}</div>`;
  }
  function workspaceC() {
    const list = filtered();
    const navigation=`<nav class="item-navigation" aria-label="Saved words and sentences"><button data-action="previous"${list.length?"":" disabled"}>Previous</button><button data-action="next"${list.length?"":" disabled"}>${nextSavedLabel()}</button></nav>`;
    const desk = `<section class="focus-desk">${view==="study"?`<div class="focus-top">${readingPreference()}${current?`<div class="focus-study-actions"><button type="button" class="quiet" data-action="note" aria-controls="focus-note">${icon("note")}Note</button><button type="button" class="quiet" data-action="delete">${icon("trash")}Delete</button></div>`:""}</div><div class="focus-main">${detail(true)}</div><footer class="focus-bottom">${navigation}<button class="primary" data-action="practise-item"${current?"":" disabled"}>Practice this ${noun([getItem(current)])}</button></footer>`:view==='kana'?(globalThis.IKnowFocusKana?.render()||''):activity(view==="test")}</section>`;
    return `<div class="app-frame"><nav class="focus-rail" aria-label="Study activity">${[["study","book","Study"],["practice","listen","Practice"],["test","test","Test"],["kana","kana","Kana"]].map(([id,graphic,label])=>`<button data-view="${id}" aria-pressed="${view===id}">${icon(graphic)}${label}</button>`).join("")}<button data-action="browse" aria-expanded="${libraryOpen&&view==="study"}" aria-controls="focus-library">${icon("library")}Library</button></nav><div class="focus-body">${libraryOpen&&view==="study"?focusLibrary():""}${desk}</div>${overlays()}</div>`;
  }
  function focusLibrary() {
    const sources=Object.entries(librarySources).map(([id,label])=>`<button type="button" data-library-source="${id}" aria-pressed="${librarySource===id}">${label}</button>`).join('');
    return `<aside class="focus-library" id="focus-library" aria-label="Saved for later"><div class="focus-library-controls"><div class="focus-library-heading"><h2>Saved for later <span class="count">${filtered().length}</span></h2><button type="button" class="quiet" data-action="delete-all"${items.length?"":" disabled"}>Delete all</button></div><div class="library-search"><div class="library-sources" role="group" aria-label="Card source">${sources}</div><input type="search" id="demo-search" value="${escape(search)}" placeholder="Find a word or sentence" aria-label="Find a word or sentence" autocomplete="off"><div class="library-filters"><select id="demo-course" aria-label="${librarySource==='noji'?'Deck':'Course'}">${courseOptions(libraryCourses())}</select>${kindSelect()}${strengthSelect()}</div></div></div><div id="demo-library-list" class="library-list">${filtered().map(item=>row(item)).join("")||'<p class="no-results">No words or sentences found.</p>'}</div></aside>`;
  }
  function refreshLibraryCourses() {
    const courses=libraryCourses();
    if(!courses.has(course))course='';
    const select=$('demo-course');
    if(!select)return;
    const options=courseOptions(courses);
    if(select.dataset.courseOptions===options)return;
    select.innerHTML=options;
    select.dataset.courseOptions=options;
    select.setAttribute('aria-label',librarySource==='noji'?'Deck':'Course');
  }
  function changeLibrarySource(source) {
    if(!Object.hasOwn(librarySources,source)||source===librarySource)return;
    librarySource=source;
    refreshLibraryCourses();
    for(const button of document.querySelectorAll('[data-library-source]'))button.setAttribute('aria-pressed',String(button.dataset.librarySource===source));
    const list=$('demo-library-list');if(list)list.scrollTop=0;
    const next=librarySelection(current);
    if(next===current){updateLists();return;}
    if(next)selectStudyItem(next);
    else{current='';render();}
    document.querySelector(`[data-library-source="${source}"]`)?.focus({preventScroll:true});
  }
  function navigateItem(step) {
    const list=filtered();if(!list.length)return;
    const at=list.findIndex(item=>item.key===current),key=list[(at<0?step<0?list.length-1:0:(at+step+list.length)%list.length)].key;
    selectStudyItem(key);
  }
  function cancelStudyPanelMotion(){
    dockRevision++;dockAnimation?.cancel();dockAnimation=null;dockCoreAnimation?.cancel();dockCoreAnimation=null;
    panelResizeObserver?.disconnect();panelResizeObserver=null;cancelAnimationFrame(panelLayoutFrame);panelLayoutFrame=0;
    for(const animation of expansionAnimations.values())animation.cancel();expansionAnimations.clear();
  }
  function selectStudyItem(key){
    const item=items.find(record=>record.key===key);if(!item)return;
    const card=document.querySelector('.focus-main>.focus-card');
    const local=version==='c'&&view==='study'&&!picker&&!setupModal&&!session&&card&&!card.classList.contains('focus-empty');
    if(local&&key===current)return;
    if(!local){current=key;view='study';revealed=false;if(version==='b')drawer=true;render();return;}
    closeVoiceMenu();strengthMenu?.close();globalThis.IKnowReaderVolumeControls?.close();stopAudio();
    cancelStudyPanelMotion();globalThis.IKnowFocusAudio?.reset();compareOpen=false;compareKey=key;
    current=key;revealed=false;

    const template=document.createElement('template');template.innerHTML=detail(true);
    const next=template.content.firstElementChild;card.className=next.className;card.dataset.compareOpen='false';card.replaceChildren(...next.childNodes);
    const main=card.parentElement;main.scrollTop=0;
    const practise=document.querySelector('.focus-bottom>[data-action="practise-item"]');if(practise)practise.textContent=`Practice this ${noun([item])}`;
    updateLists();const nextButton=document.querySelector('.item-navigation [data-action="next"]');if(nextButton)nextButton.textContent=nextSavedLabel();
    updateReadingPreference();mountStudyTools(item);rememberStudySelection();
  }
  function pickerMarkup() {
    const list=pickerItems();
    return `<div class="overlay"><section class="picker-modal" role="dialog" aria-modal="true" aria-labelledby="picker-title"><div class="modal-head"><h2 id="picker-title">${pickerPurpose==="browse"?"Your library":"Choose words &amp; sentences"}</h2>${close}</div><div class="picker-search"><input type="search" id="picker-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(pickerSearch)}">${strengthSelect('picker-strength')}</div><div class="picker-actions"><span>${list.length} saved</span>${pickerPurpose==="browse"?"":`<div><button class="quiet" data-action="select-all">Select all</button><button class="quiet" data-action="clear-selection">Clear</button></div>`}</div><div class="picker-list" id="picker-list">${list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No words or sentences found.</p>'}</div><div class="picker-bottom"><span id="picker-count">${pickerPurpose==="browse"?`${items.length} saved`:`${selectedPracticeItems().length} selected`}</span><button class="primary" data-action="close-picker">${pickerPurpose==="browse"?"Done":"Use selection"}</button></div></section></div>`;
  }
  function sessionMarkup() {
    if(!session)return "";
    if(session.finishedAt)return globalThis.IKnowFocusResults.render(session,{items,language});
    const item=getItem(session.keys[session.index]),exercise=session.exercises[session.index];
    const prompt=mode==="cloze"?exercise.before+" _____ "+exercise.after:exercise.prompt||item.japanese;
    const solution=mode==="cloze"?exercise.answerJapanese:mode==='listening'?exercise.details.japanese:item.japanese,romaji=mode==="cloze"?exercise.answerRomaji:mode==='listening'?exercise.displayRomaji:item.romaji;
    const solutionMeaning=meaning(mode==='listening'?exercise.details:item);
    const nextKind=mode==='listening'?session.exercises[session.index+1]?.details?.kind:getItem(session.keys[session.index+1])?.kind;
    return `<section class="session-screen" aria-label="Practice session"><div class="session-top"><p class="eyebrow">${session.test?"Course test · ":""}${modeName()}</p><button data-action="end-session">End session</button></div><div class="session-progress"><span>${session.index+1} of ${session.keys.length}</span><progress max="${session.keys.length}" value="${session.index}"></progress></div><div class="session-content">${mode==="listening"?player():`<p class="session-word" lang="ja">${escape(prompt)}</p>`}${mode==="review"?`<div class="session-review"><p class="small">${nojiCard(item)?'Choose the other side':'Choose the meaning'}</p>${exercise.choices.map(option=>`<button data-review="${escape(option.id)}">${escape(option.label)}</button>`).join("")}</div>`:`<form id="demo-answer" class="answer-form"><label for="listening-answer">${mode==="listening"?"Your answer":"Missing word"}</label><div class="answer-row"><input type="text" id="listening-answer" value="${escape(session.lastSubmitted[session.index]||'')}" placeholder="Japanese / Kana / Romaji" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="primary" type="submit"${session.lastSubmitted[session.index]?.trim()?'':' disabled'}>Check answer</button></div><p id="demo-feedback" class="feedback" role="status"></p><button class="quiet reveal-demo" type="button" data-action="show-answer">Show answer</button></form>`}<div class="session-solution" id="demo-solution" hidden><p class="japanese" lang="ja">${escape(solution)}</p><p class="kana">${escape(romaji)}</p>${mode==="cloze"?`<p class="kana" lang="ja">${escape(exercise.details.japanese)}</p>`:""}<p class="solution-meaning">${escape(solutionMeaning)}</p><div class="session-next"><button class="primary" data-action="next-question">${session.index+1===session.keys.length?"Finish":nextKind==='sentence'?"Next sentence":"Next word"}</button></div></div></div></section>`;
  }
  function player() {
    return `<div class="audio-player" id="demo-player" data-playing="false"><div class="audio-top"><button class="play-circle" data-action="play-session" aria-label="Play audio">${icon("play")}</button><span id="demo-play-label">Play audio</span><span class="waveform" aria-hidden="true">${[13,26,38,20,33,40,24,36,18,31,39,23,16].map((height,i)=>`<i style="--h:${height}px;--d:${i*.05}s"></i>`).join("")}</span></div><div class="audio-meta"><progress id="demo-audio-progress" max="1" value="0"></progress><span id="demo-audio-time">0:00</span>${volumeButton(session.exercises[session.index].details,true,false)}</div></div>`;
  }
  function overlays() {
    return `${setupModal?`<div class="overlay setup-overlay">${activity(view==="test",true)}</div>`:""}${picker?pickerMarkup():""}${session?sessionMarkup():""}`;
  }
  function render() {
    closeVoiceMenu();
    strengthMenu?.close();
    const hash = "#" + view;
    if(location.hash !== hash)history.replaceState(history.state,"",location.pathname+location.search+hash);
    globalThis.IKnowReaderVolumeControls?.close();stopAudio();
    answerComposing=false;
    menuCleanup?.();menuCleanup=null;
    resultsCleanup?.();resultsCleanup=null;
    kanaCleanup?.();kanaCleanup=null;
    cancelStudyPanelMotion();
    globalThis.IKnowFocusAudio?.unmount();
    if(compareKey!==current||view!=="study"||session){globalThis.IKnowFocusAudio?.reset();compareOpen=false;}
    compareKey=current;
    const list=$("demo-library-list");if(list)libraryScroll.set("docked",{top:list.scrollTop,left:list.scrollLeft});
    rememberStudySelection();
    $("demo").dataset.layout=version;
    $("demo").dataset.focusVariant="docked";
    $("demo").innerHTML=header()+workspaceC();
    mountHeaderMenus();
    const visibleItems=new Map(filtered().map(item=>[item.key,item]));
    for(const node of document.querySelectorAll('#demo-library-list>.library-row'))libraryRowItems.set(node,visibleItems.get(node.dataset.item));
    document.querySelector(".focus-rail").inert=Boolean(session&&!session.finishedAt);document.querySelector(".focus-body").inert=Boolean(session);
    const scroll=libraryScroll.get("docked");if(scroll)$("demo-library-list")?.scrollTo(scroll.left,scroll.top);
    if($("focus-compare"))mountStudyTools(getItem(current));
    if(session?.finishedAt)resultsCleanup=globalThis.IKnowFocusResults.mount?.(document.querySelector('.focus-results'),session,{items,language});
    if(view==='kana'&&!session)kanaCleanup=globalThis.IKnowFocusKana?.mount(document.querySelector('[data-kana-root]'));
    if(session&&!session.finishedAt&&session.results.some(row=>row.key===session.keys[session.index]))showSolution();
    else if(session&&!session.finishedAt){
      const attempts=session.answerHistory?.[session.index]||[],wrong=attempts.filter(attempt=>!attempt.correct);
      if(wrong.length){const feedback=$('demo-feedback');if(feedback){feedback.textContent='Incorrect';feedback.dataset.correct='false';}
        for(const button of document.querySelectorAll('.session-review [data-review]'))if(wrong.some(attempt=>attempt.submitted===button.textContent)){button.disabled=true;button.style.borderColor='var(--ikr-danger)';}
      }
    }
    if(session?.finishedAt&&session.fromTest&&previousTestReport){const button=document.createElement("button");button.type="button";button.dataset.action="result-test-report";button.textContent="Back to test results";document.querySelector(".focus-results-actions")?.prepend(button);}
  }
  function mountHeaderMenus(){
    menuCleanup=globalThis.IKnowFocusMenus.mount(document.querySelector(".app-actions"),{onTheme:theme=>{document.documentElement.dataset.ikrTheme=theme;if(Runtime)void globalThis.IKnowReaderTheme.choose(theme).catch(error=>toast(error.message));else try{localStorage.setItem("ikr-layout-review:theme",theme);}catch{}},onLanguage:value=>{language=value;render();if(Runtime)void Runtime.setLanguage(value).catch(error=>toast(error.message));}});
  }
  function refreshHeader(){
    menuCleanup?.();const template=document.createElement('template');template.innerHTML=header();document.querySelector('.app-header')?.replaceWith(template.content.firstElementChild);mountHeaderMenus();
  }
  function mountStudyTools(item){
    if(!$('focus-compare'))return;
    globalThis.IKnowFocusAudio?.mount($('focus-compare'),{key:current,audioUrl:item.audioUrl,stopOtherAudio:stopAudio,visualHost:$('focus-audio-visualization')});
    syncStudyPanels();
    observeStudyPanels();
  }
  function toggleCompare() {
    const panel=$("focus-compare"),button=document.querySelector('[data-action="compare"]');if(!panel||!button)return;
    compareOpen=!compareOpen;
    if(!compareOpen)globalThis.IKnowFocusAudio?.stopMedia();
    button.setAttribute("aria-expanded",String(compareOpen));
    document.querySelector(".focus-card").dataset.compareOpen=String(compareOpen);
    syncStudyPanels(compareOpen?'compare':null,true);
  }
  function updateReading() {
    const item=getItem(current),words=romajiFor(item).split(/\s+/).filter(Boolean),tokens=tokenReveals.get(current)||new Set();
    for(const button of document.querySelectorAll("[data-reading-index]")){const shown=Boolean(tokenIsShown(item,Number(button.dataset.readingIndex)));button.disabled=showRomaji&&!nojiCard(item);if(button.disabled)button.dataset.alwaysShown="true";else delete button.dataset.alwaysShown;button.classList.toggle("revealed",shown);button.setAttribute("aria-pressed",String(shown));button.textContent=shown?button.dataset.reading:"•••";}
    const control=document.querySelector('[data-action="reveal-reading"]');
    if(control){
      const loading=!words.length&&readingRequests.get(current)?.notice===true;
      if(readingRequests.has(current)){control.setAttribute('aria-disabled','true');control.setAttribute('aria-busy','true');}
      else{control.removeAttribute('aria-disabled');control.removeAttribute('aria-busy');}
      const heading=$('focus-reading-title');
      if(heading){const {text,lang}=displayedJapanese(item);heading.textContent=text;heading.lang=lang;}
      control.textContent=item.script==='romaji'?(tokens.size?'Show Romaji':'Show '+kanaScript(item)):loading?"Preparing Romaji…":words.length&&tokens.size===words.length?(heading?"Show Japanese":"Hide Romaji"):"Show Romaji";
    }
  }
  async function revealReading() {
    const item=getItem(current), words=romajiFor(item).split(/\s+/).filter(Boolean);
    if(item.cardMode==='original')return;
    if(words.length){
      const tokens=tokenReveals.get(item.key)||new Set();
      tokenReveals.set(item.key,tokens.size===words.length?new Set():new Set(words.map((_,index)=>index)));updateReading();return;
    }
    if(!Runtime||!Store.isImportedDeck(item?.courseId)||readingRequests.has(item.key))return;
    const text=globalThis.IKnowReaderCore.neuralSentenceText(item.japanese);
    if(!text){toast('Romaji is available for short Japanese words and sentences.');return;}
    const request={notice:false};
    readingRequests.set(item.key,request);updateReading();
    const noticeTimer=setTimeout(()=>{
      request.notice=true;
      if(current===item.key&&view==='study')updateReading();
    },200);
    try{
      const result=await chrome.runtime.sendMessage({type:'ikr:noji:reading',text});
      if(!result?.ok){
        const unavailable=['noji_reading_unavailable','word_neural_missing'].includes(result?.code);
        throw Error(unavailable?'Install or repair the local voices to show Romaji for Noji cards.':'Romaji could not be prepared. Try again.');
      }
      const revealed=result.romaji.split(/\s+/).filter(Boolean);
      tokenReveals.set(item.key,new Set(revealed.map((_,index)=>index)));
      await Store.enrich([{...item,romaji:result.romaji}]);
      await refreshRuntime();
    }catch(error){if(current===item.key&&view==='study')toast(error.message);}
    finally{clearTimeout(noticeTimer);readingRequests.delete(item.key);if(current===item.key&&view==='study')updateReading();}
  }
  function updateLists() {
    if(!$("demo-library-list"))return;
    updateLibraryTypes();
    const container=$("demo-library-list"),records=filtered(),top=container.scrollTop;
    const existing=new Map([...container.querySelectorAll(':scope>.library-row')].map(node=>[node.dataset.item,node])),wanted=new Set(records.map(item=>item.key));
    for(const node of [...container.children])if(!wanted.has(node.dataset.item))node.remove();
    let cursor=container.firstElementChild;
    for(const item of records){
      let node=existing.get(item.key);
      if(!node||libraryRowItems.get(node)!==item){const template=document.createElement('template');template.innerHTML=row(item);const next=template.content.firstElementChild;if(node?.isConnected){if(node===cursor)cursor=node.nextElementSibling;node.replaceWith(next);}node=next;libraryRowItems.set(node,item);}
      const active=String(current===item.key);if(node.getAttribute('aria-current')!==active)node.setAttribute('aria-current',active);
      if(node===cursor)cursor=cursor.nextElementSibling;else if(node.nextElementSibling!==cursor||node.parentElement!==container)container.insertBefore(node,cursor);
    }
    if(!records.length&&!container.children.length){const empty=document.createElement('p');empty.className='no-results';empty.textContent='No words or sentences found.';container.append(empty);}
    container.scrollTop=top;
    const count=document.querySelector('.focus-library-heading .count');if(count)count.textContent=String(records.length);
    const list=records;
    const next=document.querySelector('.item-navigation [data-action="next"]');if(next)next.textContent=nextSavedLabel();
    for(const button of document.querySelectorAll('[data-action="next"],[data-action="previous"]'))button.disabled=!list.length;
    if($("collection-count"))$("collection-count").textContent=selectionMode?`${selectedPracticeItems().length} selected`:`${filtered().length} items`;
    rememberStudySelection();
  }
  function toast(message) {
    document.querySelector(".toast")?.remove();clearTimeout(toastTimer);
    const node=document.createElement("p");node.className="toast";node.textContent=message;node.setAttribute("role","status");document.querySelector(".app-frame").append(node);
    toastTimer=setTimeout(()=>node.remove(),2600);
  }
  function lockRuntime(){
    runtimeBusy=true;
    const controls=[...document.querySelectorAll('#demo button,#demo input,#demo select')].map(node=>[node,node.disabled]);
    for(const [node] of controls)node.disabled=true;
    return()=>{runtimeBusy=false;for(const [node,disabled] of controls)if(node.isConnected)node.disabled=disabled;};
  }
  async function answerQuestion(correct,submitted='',shown=false,choice=null){
    if(!session||session.finishedAt||runtimeBusy||session.results.some(row=>row.key===session.keys[session.index]))return;
    if(Runtime){
      const release=lockRuntime();
      try{await Rounds.answer(session,correct,submitted,shown);}catch(error){toast(String(error.message||'The answer could not be saved. Try again.'));return;}finally{release();}
    }
    const done=registerAnswer(correct,submitted,shown);
    const feedback=$('demo-feedback');if(feedback){feedback.textContent=correct?'Correct':'Incorrect';feedback.dataset.correct=String(correct);}
    if(choice){choice.style.borderColor=correct?'var(--ikr-positive)':'var(--ikr-danger)';if(!done){choice.disabled=true;choice.setAttribute('aria-label',choice.textContent+', incorrect');}}
    Rounds?.persistView(session);if(done)showSolution();
  }
  function applyRuntimeSnapshot(snapshot){
    const previous=runtimeSnapshot,oldCurrent=current;runtimeSnapshot=snapshot;previewLibrary=snapshot.library;previewLearning=snapshot.learning;
    if(!previous||previous.library!==snapshot.library){
      const oldItems=new Map(items.map(item=>[item.key,item]));
      items=savedByAdded(snapshot.library).map(record=>{
        const next={...record,strength:Runtime.strength(record.key,snapshot.learning,mode)},old=oldItems.get(record.key);
        return old&&previous?.learning.assessments===snapshot.learning.assessments&&JSON.stringify(old)===JSON.stringify(next)?old:next;
      });
    }else if(previous.learning.records!==snapshot.learning.records||previous.learning.assessments!==snapshot.learning.assessments){
      items=items.map(item=>{const strength=Runtime.strength(item.key,snapshot.learning,mode);return item.strength===strength&&previous.learning.assessments===snapshot.learning.assessments?item:{...item,strength};});
    }
    const available=new Set(items.map(record=>record.key));current=librarySelection(oldCurrent);
    for(const key of selected)if(!available.has(key))selected.delete(key);
    practiceAttempts=snapshot.preferences.attempts;practiceGapPosition=snapshot.preferences.gapPosition;showRomaji=snapshot.preferences.showRomaji===true;
    language=snapshot.reading.translationLanguage;document.documentElement.dataset.ikrTheme=snapshot.appTheme;
  }
  const detailSignature=item=>item?JSON.stringify([item.key,item.kind,item.script,item.cardMode,item.japanese,item.kana,item.romaji,item.english,item.german,item.courseTitle,item.audioUrl]):'';
  function receiveRuntimeSnapshot(snapshot){
    const before=runtimeSnapshot,oldItems=items,previous=items.find(record=>record.key===current),oldLanguage=language;
    applyRuntimeSnapshot(snapshot);
    const voiceChanged=before?.reading.sentenceVoice!==snapshot.reading.sentenceVoice||before?.reading.nojiVoice!==snapshot.reading.nojiVoice;
    if(session||runtimeBusy){
      if(voiceChanged&&session&&!session.finishedAt&&session.mode==='listening'){stopAudio();updatePlayer(false,'Play audio');updateVolumeSource(session.exercises[session.index].details,true);}
      return;
    }
    if(view!=='study'){
      if(oldLanguage!==language||before?.appTheme!==snapshot.appTheme)refreshHeader();
      if(oldLanguage!==language||voiceChanged){if(view==='test')updateTestSummary();else if(view==='practice'&&practiceSource==='course')updatePracticeSummary();else if(voiceChanged&&view==='practice')refreshActivity();}
      return;
    }
    const next=items.find(record=>record.key===current);
    const readingChanged=oldLanguage!==language||before?.reading.romajiStyle!==snapshot.reading.romajiStyle;
    const readingSection=previous&&next&&previous.romaji!==next.romaji&&detailSignature({...previous,romaji:next.romaji})===detailSignature(next)&&!readingChanged&&document.querySelector('.focus-card .detail-reading');
    if(before?.library!==snapshot.library)refreshLibraryCourses();
    if(oldItems!==items)updateLists();
    if(previous?.notes!==next?.notes&&detailSignature(previous)===detailSignature(next)&&!readingChanged)updateInlineNote(false,true);
    if(readingSection){
      const focused=readingSection.contains(document.activeElement);
      readingSection.outerHTML=reading(next);
      updateReading();
      if(focused)document.querySelector('.focus-card .romaji-toggle')?.focus({preventScroll:true});
      if(previous.notes!==next.notes)updateInlineNote(false,true);
    }else if(detailSignature(previous)!==detailSignature(next)||readingChanged){
      closeVoiceMenu();
      stopAudio();
      globalThis.IKnowFocusAudio?.unmount();compareOpen=false;compareKey=current;globalThis.IKnowFocusAudio?.reset();
      const main=document.querySelector('.focus-main');if(main){main.innerHTML=detail(true);if($('focus-compare'))mountStudyTools(next);}
      const studyActions=document.querySelector('.focus-study-actions');if(!next)studyActions?.remove();
      else if(!studyActions){const actions=document.createElement('div');actions.className='focus-study-actions';actions.innerHTML=`<button type="button" class="quiet" data-action="note">${icon('note')}Note</button><button type="button" class="quiet" data-action="delete">${icon('trash')}Delete</button>`;document.querySelector('.focus-top')?.append(actions);}
      const practise=document.querySelector('.focus-bottom>[data-action="practise-item"]');if(practise){practise.disabled=!next;practise.textContent=`Practice this ${noun([next])}`;}
    }
    if(before?.preferences.showRomaji!==snapshot.preferences.showRomaji){updateReadingPreference();updateReading();}
    updateReadingPreference();
    if(voiceChanged && next){
      if(voiceFor(next,before?.reading)!==voiceFor(next,snapshot.reading))stopAudio();
      const button=document.querySelector('.focus-card [data-action="play"]'), label=playLabel(next);
      if(button){button.dataset.playLabel=label;button.setAttribute("aria-label",label);button.disabled=!next.audioUrl&&!localVoice(next,false,true);button.querySelector("[data-play-text]").textContent=label;}
      for(const option of document.querySelectorAll('[data-study-voice]'))option.setAttribute('aria-checked',String(option.dataset.studyVoice===voiceFor(next)));
      updateVolumeSource(next);
    }
    if(oldLanguage!==language||before?.appTheme!==snapshot.appTheme)refreshHeader();
  }
  async function refreshRuntime(){receiveRuntimeSnapshot(await Runtime.loadSnapshot());}
  async function initRuntime(){
    await globalThis.IKnowReaderTheme?.ready;
    applyRuntimeSnapshot(await Runtime.loadSnapshot());
    const params=new URLSearchParams(location.search),requested=params.get('item'),requestedCourse=params.get('course');
    if(requested&&items.some(record=>record.key===requested))current=requested;
    if(requestedCourse&&items.some(record=>record.courseId===requestedCourse))course=requestedCourse;
    restoreStudySelection();
    libraryActions=globalThis.IKnowStudyWorkspaceActions.create({runtime:Runtime,getCurrent:()=>items.find(record=>record.key===current),getItems:()=>items,onChanged:refreshRuntime,onError:error=>toast(error.message)});
    backupController=globalThis.IKnowFocusBackup.create({getSnapshot:backupSnapshot,filenamePrefix:'iKnow-Study-backup',backend:{
      exportBackup:()=>Runtime.exportBackup(),previewBackup:backup=>Runtime.previewBackup(backup),
      importBackup:async(backup,options)=>{const result=await Runtime.importBackup(backup,options);await refreshRuntime();return result;}
    }});
    nojiImport=globalThis.IKnowNojiImport?.create(async deck=>{
      const result=await Store.importCards(deck);
      await refreshRuntime().catch(()=>{});
      toast(`${result.added} imported${result.updated ? ` · ${result.updated} readings added` : result.skipped ? ` · ${result.skipped} already in your library` : ""}.`);
    });
    disposeRuntime=Runtime.subscribe(receiveRuntimeSnapshot,error=>toast(error.message));
    restoreTestSetup();restorePracticeSetup();view=routeView();
    const saved=runtimeSnapshot.learning.session;
    if(saved){session=Rounds.restore(saved);mode=session.mode;view=session.test?'test':'practice';if(session.finishedAt){await Runtime.endRound(saved.id);if(session.test)previousTestReport=structuredClone(session);}}
    if(view==='test'&&!session)void loadTestCourse();else if(view==='practice'&&practiceSource==='course'&&!session)void loadPracticeCourse();else render();
  }
  function backupSnapshot(){
    const Store=globalThis.IKnowReaderStudyStore,Core=globalThis.IKnowReaderCore,Learning=globalThis.IKnowReaderStudyLearningStore;
    if(Runtime)return{[Store.KEY]:runtimeSnapshot.library,[Learning.KEY]:runtimeSnapshot.learning,[Store.PREFERENCES_KEY]:runtimeSnapshot.preferences,[Core.STORAGE_KEY]:runtimeSnapshot.reading,iknowReaderTheme:runtimeSnapshot.appTheme,iknowReaderPanelTheme:runtimeSnapshot.panelTheme};
    return {...previewSettings,[Store.KEY]:structuredClone(previewLibrary),[Learning.KEY]:structuredClone(previewLearning),
      [Store.PREFERENCES_KEY]:{attempts:practiceAttempts,gapPosition:practiceGapPosition},
      [Core.STORAGE_KEY]:Core.normalizeSettings({...previewSettings[Core.STORAGE_KEY],translationLanguage:language}),
      iknowReaderTheme:document.documentElement.dataset.ikrTheme};
  }
  function applyBackupSnapshot(data){
    const Store=globalThis.IKnowReaderStudyStore,Core=globalThis.IKnowReaderCore,Learning=globalThis.IKnowReaderStudyLearningStore;
    const learning=data[Learning.KEY]||{schemaVersion:1,records:{},session:null};
    const nextItems=savedByAdded(data[Store.KEY]).map(record=>({...record,strength:globalThis.IKnowReaderStudyLearning.strengthFor(record.key,learning,mode)}));
    previewLibrary=structuredClone(data[Store.KEY]);previewLearning=structuredClone(learning);
    previewSettings=Object.fromEntries([Core.STORAGE_KEY,'iknowReaderTheme','iknowReaderPanelTheme'].filter(key=>data[key]!==undefined).map(key=>[key,structuredClone(data[key])]));
    items=nextItems;current=librarySelection(current);
    for(const key of selected)if(!items.some(record=>record.key===key))selected.delete(key);
    const preferences=data[Store.PREFERENCES_KEY];if(preferences){practiceAttempts=preferences.attempts||practiceAttempts;practiceGapPosition=preferences.gapPosition||practiceGapPosition;if(typeof preferences.showRomaji==='boolean')showRomaji=preferences.showRomaji;}
    if(['en','de','both'].includes(data[Core.STORAGE_KEY]?.translationLanguage))language=data[Core.STORAGE_KEY].translationLanguage;
    const theme=data.iknowReaderTheme;if(['paper','midnight','tokyo','forest'].includes(theme)){document.documentElement.dataset.ikrTheme=theme;try{localStorage.setItem('ikr-layout-review:theme',theme);}catch{}}
  }
  async function readStoredPreview(){
    const data=await globalThis.IKnowFocusBackup.loadSnapshot();if(!data)return false;
    const Store=globalThis.IKnowReaderStudyStore,Core=globalThis.IKnowReaderCore,Learning=globalThis.IKnowReaderStudyLearningStore;
    const checked=await Store.createBackend({async get(keys){return Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,data[key]]));},async set(){throw Error('Unexpected preview restore write.');}}).exportBackup();
    applyBackupSnapshot({[Store.KEY]:checked.library,[Learning.KEY]:{schemaVersion:1,...checked.learning,records:checked.learning?.records||{},session:null},[Store.PREFERENCES_KEY]:checked.settings.study,
      [Core.STORAGE_KEY]:checked.settings.reading,iknowReaderTheme:checked.settings.appTheme,iknowReaderPanelTheme:checked.settings.panelTheme});
    return true;
  }
  async function updatePreviewLibrary(change){
    const library=structuredClone(previewLibrary);change(library.records);
    const data={...backupSnapshot(),[globalThis.IKnowReaderStudyStore.KEY]:library};
    await globalThis.IKnowFocusBackup.saveSnapshot(data);applyBackupSnapshot(data);
  }
  async function setPersonalLevel(key,level){
    if(session||runtimeBusy||!items.some(item=>item.key===key))throw Error('Return to your library to change this learning level.');
    if(Runtime){
      const progress=await Runtime.setAssessment(key,level);
      receiveRuntimeSnapshot({...runtimeSnapshot,learning:{...runtimeSnapshot.learning,...progress}});
    }else{
      const Learning=globalThis.IKnowReaderStudyLearningStore,learning=structuredClone(previewLearning);
      learning.assessments||={};learning.assessments[key]={level,updatedAt:Math.max(Date.now(),(learning.assessments[key]?.updatedAt||0)+1)};
      const data={...backupSnapshot(),[Learning.KEY]:learning};await globalThis.IKnowFocusBackup.saveSnapshot(data);applyBackupSnapshot(data);updateLists();
    }
  }
  function initStrengthMenu(){
    if(strengthMenu)return;
    strengthMenu=globalThis.IKnowStudyStrengthMenu?.create({getItem:key=>items.find(item=>item.key===key),getLevel:key=>(Runtime?runtimeSnapshot?.learning:previewLearning)?.assessments?.[key]?.level||'auto',onSelect:setPersonalLevel,onError:toast});
  }
  let releaseAudioVolume=null, preparingVoice=null, playbackNotice=null;
  function showAudioLoading(control,busy){
    if(!control)return;
    control.dataset.audioLoading=String(busy);
    if(busy){
      control.setAttribute('aria-busy','true');control.setAttribute('aria-label','Preparing audio');
      if(!control.querySelector('[data-play-status]')){const status=document.createElement('span');status.dataset.playStatus='';status.setAttribute('aria-hidden','true');status.innerHTML='<span class="audio-loading-spinner"></span>'+(control.querySelector('[data-play-text]')?'Loading':'');control.append(status);}
    }else{control.removeAttribute('aria-busy');control.querySelector('[data-play-status]')?.remove();if(control.dataset.playLabel)control.setAttribute('aria-label',control.dataset.playLabel);}
  }
  function clearPlaybackNotice(){if(playbackNotice){clearTimeout(playbackNotice.timer);showAudioLoading(playbackNotice.control,false);playbackNotice=null;}}
  function stopAudio() {
    clearPlaybackNotice();
    if(preparingVoice){clearTimeout(preparingVoice.timer);showAudioLoading(preparingVoice.control,false);preparingVoice=null;}
    releaseAudioVolume?.();releaseAudioVolume=null;
    if(audio){audio.pause();audio.removeAttribute("src");audio.load();audio=null;}
    globalThis.IKnowFocusAudio?.observeOriginal(null);
  }
  function updatePlayer(playing, label) {
    if($("demo-player"))$("demo-player").dataset.playing=String(playing);
    if($("demo-play-label"))$("demo-play-label").textContent=label;
  }
  async function play(record, withPlayer = false) {
    globalThis.IKnowFocusAudio?.stopMedia();
    if(audio||preparingVoice){stopAudio();updatePlayer(false,"Play audio");return;}
    const voice=localVoice(record,withPlayer,!withPlayer);
    if(voice){
      const control=document.querySelector(`[data-action="${withPlayer?"play-session":"play"}"]`);
      const request={control,timer:setTimeout(()=>{
        showAudioLoading(control,true);
        if(withPlayer)updatePlayer(false,"Preparing audio…");
      },180)};
      preparingVoice=request;
      let result;
      try{result=await chrome.runtime.sendMessage({type:"ikr:sentence:neural",text:speechText(record,!withPlayer),speed:1,voice});}catch{}
      if(preparingVoice!==request)return;
      stopAudio();
      if(!result?.ok){
        updatePlayer(false,"Play audio");
        toast(!result||["word_neural_missing","neural_voice_missing"].includes(result.code)?"Install local voices from Models & voices, then try again.":"Could not prepare local audio. Try again.");
        return;
      }
      const active=new Audio("data:audio/wav;base64,"+result.data);
      audio=active;startAudio(active,withPlayer,'word');
      return;
    }
    if(!record.audioUrl){toast("This word or sentence has no recording.");return;}
    const active=new Audio(record.audioUrl);audio=active;startAudio(active,withPlayer,'original');
  }
  function startAudio(active, withPlayer, volumeKind) {
    active.preload="none";releaseAudioVolume=globalThis.IKnowReaderCore.audioVolume().bind(active,volumeKind);
    const control=document.querySelector(`[data-action="${withPlayer?'play-session':'play'}"]`);
    const waiting=()=>{if(audio!==active||playbackNotice)return;playbackNotice={control,timer:setTimeout(()=>{if(audio===active){showAudioLoading(control,true);if(withPlayer)updatePlayer(false,'Loading audio…');}},180)};};
    active.addEventListener('waiting',waiting);active.addEventListener('playing',()=>{clearPlaybackNotice();if(withPlayer)updatePlayer(true,'Playing');});waiting();
    if(!withPlayer)globalThis.IKnowFocusAudio?.observeOriginal(active);
    const reset=()=>{if(audio!==active)return false;stopAudio();if(withPlayer)updatePlayer(false,"Play again");return true;};
    if(withPlayer){updatePlayer(true,"Playing");active.addEventListener("timeupdate",()=>{if(audio!==active)return;if($("demo-audio-progress"))$("demo-audio-progress").value=active.duration?active.currentTime/active.duration:0;if($("demo-audio-time"))$("demo-audio-time").textContent=`0:${String(Math.floor(active.currentTime)).padStart(2,"0")}`;});}
    active.addEventListener("ended",reset);active.play().catch(()=>{if(reset())toast("Could not play the recording. Try again.");});
  }
  function openPicker(purpose) {picker=true;pickerPurpose=purpose;pickerSearch="";render();$("picker-search").focus({preventScroll:true});}
  function resultRecord(index,outcome,submitted="") {
    const item=getItem(session.keys[index]),exercise=session.exercises[index];
    const expected=session.mode==="review"?exercise.choices.find(choice=>choice.id===exercise.correctId)?.label||meaning(item):session.mode==="cloze"?[exercise.answerJapanese,exercise.answerRomaji].filter(Boolean).join(" · "):exercise.displayRomaji||exercise.details.japanese;
    return {key:item.key,japanese:exercise.prompt||item.japanese,expected,submitted:String(submitted||"").slice(0,5000),outcome,attempts:session.answerAttempts[index],attemptsHistory:structuredClone(session.answerHistory?.[index]||[])};
  }
  function registerAnswer(correct, submitted="", shown=false) {
    if(!session||session.finishedAt||session.results.some(result=>result.key===session.keys[session.index]))return false;
    const index=session.index;
    if(!shown)session.answerAttempts[index]++;
    session.lastSubmitted[index]=String(submitted||"").slice(0,5000);
    session.answerHistory||=session.keys.map(()=>[]);
    session.answerHistory[index].push({submitted:session.lastSubmitted[index],correct:Boolean(correct),shown:Boolean(shown)});
    if(session.answerHistory[index].length>50)session.answerHistory[index].splice(0,session.answerHistory[index].length-50);
    if(!correct&&!shown&&session.attempts==="retry"&&session.answerAttempts[index]<2)return false;
    session.results.push(resultRecord(index,correct?(session.answerAttempts[index]===1?"good":"hard"):"again",session.lastSubmitted[index]));
    return true;
  }
  function showSolution() {
    if(!session||session.finishedAt)return;
    $("demo-solution").hidden=false;
    const reveal=document.querySelector('[data-action="show-answer"]');if(reveal)reveal.hidden=true;
    document.querySelectorAll('#demo-answer input,#demo-answer button:not([data-action="show-answer"]),.session-review button').forEach(control=>{control.disabled=true;});
    const row=session.results.find(result=>result.key===session.keys[session.index]),feedback=$('demo-feedback');
    if(row&&feedback){feedback.textContent=row.outcome==='again'?'Incorrect':'Correct';feedback.dataset.correct=String(row.outcome!=='again');}
  }
  function updateAnswerAction(){
    const input=$('listening-answer'),button=document.querySelector('#demo-answer button[type="submit"]');if(!input||!button)return;
    const answered=!session||session.finishedAt||session.results.some(result=>result.key===session.keys[session.index]);
    button.disabled=Boolean(answered||answerComposing||!input.value.trim());
  }
  async function startRound(keys,test=false,poolOverride=null,options={}) {
    if(runtimeBusy)return;
    const chosen=[...new Set(keys)];if(!chosen.length)return;
    if(!test&&options.shuffle)for(let index=chosen.length-1;index>0;index--){const other=Math.floor(Math.random()*(index+1));[chosen[index],chosen[other]]=[chosen[other],chosen[index]];}
    if(test)mode="review";
    const sourcePool=Array.isArray(poolOverride)?poolOverride:test?testCatalog?.records:items;
    if(!Array.isArray(sourcePool)){toast("Load a course before starting its test.");return;}
    const records=new Map(sourcePool.map(record=>[record.key,record]));
    const exercises=chosen.map(key=>records.has(key)?exerciseFor(records.get(key),sourcePool):null);
    if(exercises.some(exercise=>!exercise)){
      const unavailable=chosen.flatMap((key,index)=>exercises[index]?[]:records.has(key)?[{reason:unavailableReason(records.get(key))}]:[]);
      toast(unavailable.length?unavailableMessage(unavailable):'Some selected questions are no longer available. Choose them again.');return;
    }
    const catalog=test?testCatalog:practiceSource==='course'&&!poolOverride?practiceCatalog:null;
    const draft={keys:chosen,pool:structuredClone(sourcePool),index:0,mode,test,exercises,attempts:test?"single":practiceAttempts,results:[],answerAttempts:chosen.map(()=>0),answerHistory:chosen.map(()=>[]),lastSubmitted:chosen.map(()=>""),complete:false,startedAt:Date.now(),finishedAt:0,courseId:options.catalog?.courseId||catalog?.courseId||"",courseTitle:options.catalog?.title||catalog?.title||""};
    if(Runtime){
      const release=lockRuntime();
      try{await Rounds.begin(draft);}catch(error){toast(String(error.message||'The session could not be started.'));return;}finally{release();}
    }
    session=draft;setupModal=false;picker=false;render();
  }
  async function finishRound() {
    if(!session||session.finishedAt||runtimeBusy)return;
    if(Runtime){const release=lockRuntime();try{await Rounds.finish(session);}catch(error){toast(String(error.message||'The session could not be saved. Try again.'));return;}finally{release();}}
    session.complete=session.results.length===session.keys.length;session.finishedAt=Date.now();
    for(let index=0;index<session.keys.length;index++)if(!session.results.some(row=>row.key===session.keys[index])){
      const attempted=session.answerAttempts[index]>0;
      const lastAttempt=session.answerHistory?.[index]?.at(-1);
      const submitted=attempted?lastAttempt?.submitted||"":index===session.index?$("listening-answer")?.value||session.lastSubmitted[index]:session.lastSubmitted[index];
      session.results.push(resultRecord(index,attempted?"again":"unanswered",submitted));
    }
    if(session.test)previousTestReport=structuredClone(session);
    Rounds?.persistView(session);render();
  }
  function exerciseFor(record,pool=items) {
    const romajiStyle=Runtime?runtimeSnapshot?.reading.romajiStyle||'source':'source';
    if(mode==="cloze")return Practice.buildCloze(record,{gapPosition:practiceGapPosition,romajiStyle});
    if(mode==="listening")return Practice.buildListening(record,{romajiStyle,canSynthesize:localVoice});
    return reviewQuestion(record,pool);
  }
  const voiceButtonFor=event=>event.target.closest?.('.focus-card [data-action="play"]');
  document.addEventListener('contextmenu',event=>{
    const button=voiceButtonFor(event);
    if(!Runtime||!button||runtimeBusy||session||button.closest('[inert]'))return;
    event.preventDefault();openVoiceMenu(button,{x:event.clientX,y:event.clientY});
  });
  document.addEventListener('pointerdown',event=>{if(voiceMenu&&!voiceMenu.contains(event.target))closeVoiceMenu();},true);
  document.addEventListener('keydown',event=>{
    const button=voiceButtonFor(event);
    if((event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')&&Runtime&&button&&!runtimeBusy&&!session&&!button.closest('[inert]')){
      event.preventDefault();openVoiceMenu(button);return;
    }
    if(!voiceMenu)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeVoiceMenu(true);return;}
    if(event.key==='Tab'){closeVoiceMenu(true);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&voiceMenu.contains(event.target)){
      event.preventDefault();const options=[...voiceMenu.querySelectorAll('[role="menuitemradio"]')],at=options.indexOf(document.activeElement);
      const index=event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options[index]?.focus({preventScroll:true});
    }
  },true);
  addEventListener('resize',()=>closeVoiceMenu());
  addEventListener('scroll',event=>{if(voiceMenu&&!voiceMenu.contains(event.target))closeVoiceMenu();},true);
  document.addEventListener("click",event=>{
    const card=event.target.closest('.focus-original-card');
    if(card&&!event.target.closest('button,a,input,textarea,select,.focus-expansions,.focus-flashcard-text')&&!runtimeBusy&&!session){flipOriginalCard();return;}
    const button=event.target.closest("button");if(!button||button.disabled||runtimeBusy)return;
    if(session&&!button.closest(".session-screen")){
      const resultNavigation=session.finishedAt&&button.closest(".focus-rail")&&(button.dataset.view||button.dataset.action==="browse");
      if(!resultNavigation)return;

      session=null;picker=false;setupModal=false;drawer=false;
      if(button.dataset.action==="browse"){view="study";libraryOpen=true;render();return;}
    }
    if(button.dataset.choiceStep){const group=button.closest('[data-choice]');if(group)stepChoice(group.dataset.choice,button.dataset.choiceStep);return;}
    if(button.dataset.cardWriting){void changeCardWriting(button.dataset.cardWriting);return;}
    if(button.dataset.studyVoice){
      const item=items.find(record=>record.key===current);
      closeVoiceMenu(true);
      if(Runtime&&item&&button.dataset.voiceSource===voiceSource(item)&&button.dataset.studyVoice!==voiceFor(item)){
        void Runtime.setVoice(voiceSource(item),button.dataset.studyVoice).then(refreshRuntime,error=>toast(error.message));
      }
      return;
    }
    if(button.dataset.librarySource){changeLibrarySource(button.dataset.librarySource);return;}
    if(button.dataset.practiceSource){if(practiceSource===button.dataset.practiceSource)return;practiceSource=button.dataset.practiceSource;retainPracticeSetup();if(practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else refreshActivity();return;}
    if(button.dataset.view){if(view===button.dataset.view&&!session&&!picker&&!setupModal&&!drawer&&!document.querySelector('.focus-results'))return;view=button.dataset.view;drawer=false;if(view==="test"&&!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else if(view==='practice'&&practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else render();return;}
    if(button.dataset.mode){if(mode===button.dataset.mode)return;mode=button.dataset.mode;retainPracticeSetup();items=items.map(item=>({...item,strength:globalThis.IKnowReaderStudyLearning.strengthFor(item.key,Runtime?runtimeSnapshot.learning:previewLearning,mode)}));refreshActivity();return;}
    if(button.dataset.reading){if(showRomaji&&!nojiCard(getItem(current)))return;const tokens=tokenReveals.get(current)||new Set(),index=Number(button.dataset.readingIndex);tokens.has(index)?tokens.delete(index):tokens.add(index);tokenReveals.set(current,tokens);updateReading();return;}
    if(button.dataset.item){const key=button.dataset.item;if(button.dataset.pickerRow){if(pickerPurpose==="browse"){current=key;picker=false;view="study";revealed=false;render();return;}selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("picker-count").textContent=`${selectedPracticeItems().length} selected`;return;}if(version==="b"&&selectionMode){selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("collection-count").textContent=`${selectedPracticeItems().length} selected`;const practise=document.querySelector(".collection-footer .primary");if(practise)practise.disabled=!selected.size;return;}selectStudyItem(key);return;}
    if(button.dataset.review){if(!session||session.finishedAt)return;const exercise=session.exercises[session.index],correct=button.dataset.review===exercise.correctId,submitted=exercise.choices.find(choice=>choice.id===button.dataset.review)?.label||button.textContent;void answerQuestion(correct,submitted,false,button);return;}
    switch(button.dataset.action){
      case "choose":openPicker("practice");break;
      case "browse":if(view!=="study"){view="study";libraryOpen=true;}else libraryOpen=!libraryOpen;render();break;
      case "close-overlay":picker=false;setupModal=false;render();break;
      case "close-picker":picker=false;render();break;
      case "select-all":(picker?pickerItems():filtered()).forEach(item=>selected.add(item.key));render();break;
      case "clear-selection":selected.clear();render();break;
      case "collection-select":selectionMode=!selectionMode;drawer=false;render();break;
      case "close-drawer":drawer=false;render();break;
      case "practice-modal":view="practice";setupModal=true;drawer=false;render();break;
      case "test-modal":view="test";setupModal=true;drawer=false;if(!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else render();break;
      case "load-test-course":void loadTestCourse();break;
      case "load-practice-course":void loadPracticeCourse();break;
      case "reveal-reading":void revealReading();break;
      case "play":play(getItem(current));break;
      case "flip-card":{if(event.detail&&event.target.closest('.focus-flashcard-text'))break;flipOriginalCard();break;}
      case "play-session":{const record=getItem(session.keys[session.index]),exercise=session.exercises[session.index];play(session.mode==='listening'?{...record,...exercise.details}:record,true);break;}
      case "practise-item":if(strength&&getItem(current)?.strength!==strength)strength='';selected.clear();selected.add(current);practiceSource='saved';retainPracticeSetup();view="practice";if(version==="b")setupModal=true;drawer=false;render();break;
      case "next":navigateItem(1);break;
      case "previous":navigateItem(-1);break;
      case "start":{
        const test=view==='test';if(test){if(testPlan().ready)startRound(testCatalog.records.filter(item=>testContent==='both'||item.kind===testContent).map(item=>item.key),true);break;}
        if(practiceSource==='course'){const plan=practiceCoursePlan();if(plan.ready)startRound(plan.records.map(item=>item.key),false,practiceCatalog.records,{shuffle:practiceOrder==='shuffle',catalog:practiceCatalog});}
        else startRound(selectedPracticeItems().map(item=>item.key),false,null,{shuffle:practiceOrder==='shuffle'});
        break;
      }
      case "end-session":finishRound();break;
      case "show-answer":void answerQuestion(false,$("listening-answer")?.value||"",true);break;
      case "next-question":if(!session||session.finishedAt||!session.results.some(result=>result.key===session.keys[session.index]))break;if(session.index+1>=session.keys.length)finishRound();else{session.index++;Rounds?.persistView(session);render();}break;
      case "result-back-study":session=null;view="study";render();break;
      case "result-new-round":session=null;render();break;
      case "result-practice-mistakes":{if(!session?.finishedAt)break;const summary=globalThis.IKnowFocusResults.summarize(session),keys=summary.reviewKeys;if(!keys.length)break;const fromTest=session.test||session.fromTest,pool=session.pool;mode=session.mode;view="practice";session=null;void startRound(keys,false,pool).then(()=>{if(session){session.fromTest=fromTest;Rounds?.persistView(session);}});break;}
      case "result-test-report":if(previousTestReport){session=structuredClone(previousTestReport);mode=session.mode;view="test";render();}break;
      case "delete":case "delete-all":libraryActions?.openDelete({all:button.dataset.action==='delete-all'});break;
      case "backup":backupController?.open();break;
      case "import-noji":nojiImport?.open();break;
      case "note":openInlineNote();break;
      case "edit-note":editInlineNote();break;
      case "cancel-note":cancelInlineNote();break;
      case "save-note":void saveInlineNote();break;
      case "delete-note":void saveInlineNote(true);break;
      case "compare":toggleCompare();break;
    }
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="demo-kind"){kind=event.target.value;updateLists();}
    if(event.target.id==="demo-course"){course=event.target.value;updateLists();}
    if(event.target.id==="demo-strength"||event.target.id==="picker-strength"){setStrengthFilter(event.target.value);}
    if(event.target.id==="always-show-romaji")void setReadingPreference(event.target.checked);
  });
  document.addEventListener("input",event=>{
    if(event.target.id==="demo-test-course"){testCourseInput=event.target.value;courseError="";updateTestSummary();}
    if(event.target.id==='demo-practice-course'){practiceCourseInput=event.target.value;practiceCourseError='';updatePracticeSummary();}
    if(event.target.id==='listening-answer'){
      if(session&&!session.finishedAt&&!session.results.some(row=>row.key===session.keys[session.index])){session.lastSubmitted[session.index]=event.target.value.slice(0,5000);Rounds?.persistView(session);}
      updateAnswerAction();
    }
    if(event.target.id==='focus-note-input'){
      const item=items.find(record=>record.key===current),draft=item&&noteState(item);if(draft&&!draft.busy){draft.value=event.target.value;draft.error='';const save=document.querySelector('[data-action="save-note"]');if(save)save.disabled=draft.value===draft.saved;const status=document.querySelector('.focus-note-status');if(status){status.textContent='';status.dataset.error='false';}}
    }
    if(event.target.id==="demo-search"){search=event.target.value;updateLists();}
    if(event.target.id==="picker-search"){pickerSearch=event.target.value;const query=pickerSearch.toLowerCase();const list=pickerItems();$("picker-list").innerHTML=list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No words or sentences found.</p>';}
  });
  document.addEventListener("submit",event=>{
    if(event.target.id!=="demo-answer")return;event.preventDefault();
    if(!session||session.finishedAt||runtimeBusy||session.results.some(row=>row.key===session.keys[session.index]))return;
    const exercise=session.exercises[session.index],answer=$("listening-answer").value;
    if(answerComposing||!answer.trim())return;
    const correct=mode==="cloze"?Practice.checkAnswer(exercise,answer):Practice.checkListening(exercise,answer);
    void answerQuestion(correct,answer);
  });
  document.addEventListener('compositionstart',event=>{if(event.target.id==='listening-answer'){answerComposing=true;updateAnswerAction();}});
  document.addEventListener('compositionend',event=>{if(event.target.id==='listening-answer'){answerComposing=false;updateAnswerAction();}});
  document.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
    const button=event.target.closest('[data-choice-step]'),group=button?.closest('[data-choice]');
    if(!button||button.disabled||!group)return;
    event.preventDefault();stepChoice(group.dataset.choice,event.key==='ArrowLeft'?'previous':'next');
  });
  document.addEventListener("keydown",event=>{if(event.key==="Enter"&&event.target.id==="demo-test-course"){event.preventDefault();void loadTestCourse();}if(event.key==='Enter'&&event.target.id==='demo-practice-course'){event.preventDefault();void loadPracticeCourse();}if(event.key==="Escape"&&(picker||setupModal||drawer)){picker=false;setupModal=false;drawer=false;render();}});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopAudio();});
  window.addEventListener("pagehide",()=>{rememberStudySelection();stopAudio();Rounds?.persistView(session);disposeRuntime?.();});
  window.addEventListener('resize',()=>{if(view==='study'&&!session)syncStudyPanels();});
  window.addEventListener("hashchange",()=>{
    if(runtimeBusy||session&&!session.finishedAt){history.replaceState(history.state,"",location.pathname+location.search+"#"+view);return;}
    view=routeView();session=null;picker=false;setupModal=false;drawer=false;
    if(view==="test"&&!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else if(view==='practice'&&practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else render();
  });
  async function init(){
    initStrengthMenu();
    if(globalThis.IKnowStudyWorkspaceProduction){
      try{if(!Runtime)throw Error('The Study data connection is unavailable. Reload Reading Helper.');await initRuntime();}
      catch(error){$('demo').innerHTML='<p class="no-results"></p>';$('demo').querySelector('p').textContent=String(error.message||'The library could not be loaded.');console.error(error);}
      return;
    }
    try{const saved=localStorage.getItem("ikr-layout-review:theme");if(["paper","midnight","tokyo","forest"].includes(saved))document.documentElement.dataset.ikrTheme=saved;}catch{}
    try{
      const response=await fetch('/library.json');if(!response.ok)throw Error('Library unavailable');const library=await response.json();
      previewLibrary={schemaVersion:1,records:Object.fromEntries(Object.entries(library.records).slice(0,18))};
      items=savedByAdded(previewLibrary).map(item=>({...item,strength:globalThis.IKnowReaderStudyLearning.strengthFor(item.key,previewLearning,mode)}));current=items[0]?.key||'';
      let restoreError='';try{await readStoredPreview();}catch(error){restoreError=String(error.message||'The imported preview library could not be restored.');}
      items.slice(0,4).forEach(item=>selected.add(item.key));
      restoreStudySelection();
      backupController=globalThis.IKnowFocusBackup.create({getSnapshot:backupSnapshot,onImport:async data=>{
        await globalThis.IKnowFocusBackup.saveSnapshot(data);
        applyBackupSnapshot(data);view='study';session=null;picker=false;setupModal=false;course='';kind='';strength='';search='';libraryOpen=true;libraryScroll.clear();render();
      }});
      libraryActions=globalThis.IKnowStudyWorkspaceActions.create({runtime:{
        remove:key=>updatePreviewLibrary(records=>{delete records[key];}),
        removeAll:keys=>updatePreviewLibrary(records=>{for(const key of keys)delete records[key];})
      },getCurrent:()=>items.find(record=>record.key===current),getItems:()=>items,onChanged:()=>render(),onError:error=>toast(error.message)});
      restoreTestSetup();restorePracticeSetup();view=routeView();
      if(view==="test")void loadTestCourse();else if(view==='practice'&&practiceSource==='course')void loadPracticeCourse();else render();
      if(restoreError)toast(restoreError);
    }catch(error){$('demo').innerHTML='<p class="no-results">The library could not be loaded. Refresh to try again.</p>';console.error(error);}
  }
  init();
})();
