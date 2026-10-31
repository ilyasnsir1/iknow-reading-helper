/* Chosen Study desk. Isolated demo, no personal extension data. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const Practice = globalThis.IKnowReaderStudyPractice;
  const Runtime=globalThis.IKnowStudyWorkspaceData?.create();
  const escape = text => String(text ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const paths = {
    book:'<path d="M3 4h5l2 2 2-2h5v12h-5l-2 1-2-1H3zM10 6v11"/>',
    listen:'<path d="M3 8v4m3-7v10m4-12v14m4-11v8m3-6v4"/>',
    gap:'<path d="M3 5h14M3 10h4m6 0h4M3 15h14M9 8v4m2-4v4"/>',
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
    check:'<path d="m4 10 4 4 8-8"/>',
    kana:'<path d="M3 4h9M7 2v3c0 5-1 8-4 11m1-9c1 4 4 7 8 9M13 7h4l-2 10m-3-4h6"/>',
  };
  const icon = name => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  const viewIds = new Set(["study", "practice", "test", "kana"]);
  const routeView = () => viewIds.has(location.hash.slice(1)) ? location.hash.slice(1) : "study";
  const explanations = {a:"Library and activities in one workspace.",b:"A collection first. Open an item when you need it.",c:"One item at a time. Keep the library within reach."};
  const german = {
    "それ":"das, jenes", "見る":"sehen, anschauen", "円":"Kreis", "多い":"viel, zahlreich", "家":"Haus, Zuhause", "これ":"dies, dieses", "新しい":"neu", "私":"ich", "仕事":"Arbeit, Beruf",
    "それはとてもいい話だ。":"Das ist eine wirklich schöne Geschichte.", "私は絵を見るのが好きです。":"Ich schaue mir gern Bilder an.", "そこに大きな円を描いて。":"Zeichne dort einen großen Kreis.", "京都にはお寺が多い。":"In Kyoto gibt es viele Tempel.", "家に遊びにきてください。":"Komm mich zu Hause besuchen.", "これをください。":"Das hätte ich bitte.", "彼の車は新しい。":"Sein Auto ist neu.", "私が行きましょう。":"Dann gehe ich.", "3月は仕事が忙しい。":"Im März habe ich viel Arbeit."
  };
  let items = [], current = "", version = "c", libraryOpen = true, course = "", view = "study", mode = "review", language = "en", search = "", kind = "", strength = "", drawer = false, selectionMode = false, picker = false, pickerPurpose = "practice", pickerSearch = "", setupModal = false, session = null, revealed = false, audio = null, toastTimer;
  const libraryScroll = new Map(),libraryRowItems=new WeakMap();
  const tokenReveals = new Map(),noteDrafts=new Map();
  let compareOpen = false, compareKey = "", compareAnimation = null, compareRevision = 0;
  let menuCleanup = null, resultsCleanup = null, kanaCleanup = null, previousTestReport = null;
  let practiceAttempts = "retry", practiceGapPosition = "random", practiceSource = "saved", practiceOrder = "course", practiceContent = "word";
  const courseClient = globalThis.IKnowFocusCourse.createClient(), reviewCache = new WeakMap();
  let testCatalog = null, testCourseInput = "19053", testContent = "word", courseBusy = false, courseError = "", courseRevision = 0;
  let previewLibrary = null, previewLearning = {schemaVersion:1,records:{},session:null}, previewSettings = {}, backupController = null;
  let practiceCatalog = null, practiceCourseInput = "19053", practiceCourseBusy = false, practiceCourseError = "", practiceRevision = 0;
  let answerComposing = false;
  let runtimeSnapshot=null,runtimeBusy=false,disposeRuntime=null;
  let libraryActions=null;
  const Rounds=Runtime?globalThis.IKnowStudyWorkspaceRounds.create({runtime:Runtime,practice:Practice,reviewQuestion,getLanguage:()=>language,getGapPosition:()=>practiceGapPosition}):null;
  const practiceCourseCache = new WeakMap();
  const selected = new Set();
  // Creation order stays steady when notes or learning progress are edited.
  // Stable sorting keeps the stored insertion order for same-millisecond saves.
  const savedByAdded=library=>Object.values(library.records).sort((a,b)=>a.createdAt-b.createdAt);
  const getItem = key => session?.pool?.find(item => item.key === key) || items.find(item => item.key === key) || testCatalog?.records.find(item => item.key === key) || items[0];
  const germanMeaning=item=>item?.german||(!Runtime&&german[item?.japanese])||'';
  const romajiFor=item=>Runtime?globalThis.IKnowReaderCore.displayRomaji(item,runtimeSnapshot?.reading.romajiStyle||'source'):item.romaji;
  const meaning = item => language === "de" ? germanMeaning(item) || item.english : item.english;
  const subtitle = item => item.kind === "word" ? "Word" : "Sentence";
  const noun = (records, plural = false) => {
    const kinds = new Set(records.filter(Boolean).map(item=>item.kind));
    return kinds.size===1&&kinds.has('word')?(plural?'words':'word'):kinds.size===1&&kinds.has('sentence')?(plural?'sentences':'sentence'):(plural?'words & sentences':'question');
  };
  const nextSavedLabel = () => {const list=filtered(),at=list.findIndex(item=>item.key===current),next=list.length?list[(Math.max(at,0)+1)%list.length]:null;return next?.kind==='sentence'?'Next sentence':'Next word';};
  const strengthLabel = value => ({new:"New",weak:"Weak",learning:"Learning",strong:"Strong"}[value]);
  const close = `<button class="close-button quiet" type="button" data-action="close-overlay" aria-label="Close">${icon("close")}</button>`;
  const modeName = () => ({review:"Review",cloze:"Fill the gap",listening:"Listening"}[mode]);
  const SELECTION_KEY='iknowReaderStudyWorkspaceSelection:v1';
  function rememberStudySelection(){
    if(!items.length)return;
    const list=$('demo-library-list'),stored=libraryScroll.get('docked');
    const top=list?.scrollTop??stored?.top??0;
    try{sessionStorage.setItem(SELECTION_KEY,JSON.stringify({schemaVersion:1,context:location.search,current,course,kind,search:search.slice(0,200),libraryOpen,scrollTop:Math.max(0,Math.round(top))}));}catch{}
  }
  function restoreStudySelection(){
    try{
      const raw=sessionStorage.getItem(SELECTION_KEY);if(!raw||raw.length>2500)return false;
      const saved=JSON.parse(raw);
      if(saved.schemaVersion!==1||saved.context!==location.search||typeof saved.current!=='string'||saved.current.length>130||!items.some(item=>item.key===saved.current))return false;
      current=saved.current;
      course=typeof saved.course==='string'&&items.some(item=>item.courseId===saved.course)?saved.course:'';
      kind=['','word','sentence'].includes(saved.kind)?saved.kind:'';search=typeof saved.search==='string'?saved.search.slice(0,200):'';
      libraryOpen=typeof saved.libraryOpen==='boolean'?saved.libraryOpen:true;
      if(Number.isSafeInteger(saved.scrollTop)&&saved.scrollTop>=0&&saved.scrollTop<=1000000)libraryScroll.set('docked',{top:saved.scrollTop,left:0});
      return true;
    }catch{return false;}
  }
  function filtered() {
    const query = search.trim().toLowerCase();
    return items.filter(item => (!course || item.courseId === course) && (!kind || item.kind === kind) && (!strength || item.strength === strength) && (!query || [item.japanese,item.kana,item.romaji,item.english,germanMeaning(item)].join(" ").toLowerCase().includes(query)));
  }
  function sourceCourseLink(item){
    const title=item.courseTitle||`Course ${item.courseId}`;
    try{const id=courseClient.courseId(item.courseId);return `<a class="focus-source-link" href="https://iknow.jp/courses/${id}" target="_blank" rel="noopener noreferrer" aria-label="Open course: ${escape(title)}">${escape(title)}</a>`;}catch{return escape(title);}
  }
  function header() {
    const menus=globalThis.IKnowFocusMenus,theme=document.documentElement.dataset.ikrTheme;
    return `<header class="app-header"><div class="brand"><img src="icons/icon128.png" alt="" width="43" height="43"><div><p class="eyebrow">iKnow! Reading Helper</p><h1>Your study space</h1></div></div><div class="app-actions"><button class="quiet backup-button" data-action="backup">${icon("backup")}Backup</button>${menus.render({theme,language,kind:"language",languageDisabled:Boolean(session&&!session.finishedAt)})}${menus.render({theme,language,kind:"theme"})}</div></header>`;
  }
  function tabs() {
    return `<div class="tabs" role="group" aria-label="Study activity">${[["study","Study"],["practice","Practice"],["test","Course test"]].map(([id,label])=>`<button type="button" data-view="${id}" aria-pressed="${view===id}">${label}</button>`).join("")}</div>`;
  }
  function filterFields(collection = false) {
    return `<input type="search" id="demo-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(search)}" autocomplete="off"><${collection ? "div" : "div"} class="${collection ? "sr-only" : "library-filters"}">${!collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>` : ""}${!collection ? kindSelect() : ""}</div>${collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>${kindSelect()}<select id="demo-strength" aria-label="Learning strength"><option value="">All strengths</option>${["new","weak","learning","strong"].map(s=>`<option value="${s}"${strength===s?" selected":""}>${strengthLabel(s)}</option>`).join("")}</select>` : ""}`;
  }
  function kindSelect() {
    return `<select id="demo-kind" aria-label="Words or sentences"><option value="">All types</option><option value="word"${kind==="word"?" selected":""}>Words</option><option value="sentence"${kind==="sentence"?" selected":""}>Sentences</option></select>`;
  }
  function row(item, checkboxes = false, pickerRow = false) {
    const checked = selected.has(item.key);
    return `<button class="library-row" type="button" data-item="${escape(item.key)}"${pickerRow ? ' data-picker-row="true"' : ""} aria-current="${!checkboxes && current===item.key}">${checkboxes ? `<input type="checkbox" aria-label="Select ${escape(item.japanese)}" tabindex="-1"${checked?" checked":""}>` : ""}<span class="item-main"><span class="jp" lang="ja">${escape(item.japanese)}</span><span class="en">${escape(meaning(item))}</span><span class="strength" data-strength="${item.strength}">${strengthLabel(item.strength)}</span></span></button>`;
  }
  function libraryPane() {
    return `<aside class="library-pane" aria-label="Saved for later"><div class="library-heading"><h2>Saved for later <span>${items.length}</span></h2><button class="quiet" data-action="delete-all">Delete all</button></div><div class="library-search">${filterFields()}</div><div class="library-list" id="demo-library-list">${filtered().map(item=>row(item)).join("")}</div><div class="library-bottom">${items.length} saved items</div></aside>`;
  }
  function reading(item) {
    const words=romajiFor(item).split(/\s+/).filter(Boolean),tokens=tokenReveals.get(item.key)||new Set(),all=words.length&&tokens.size===words.length;
    return `<div class="detail-reading"><div class="romaji-heading"><button type="button" class="quiet romaji-toggle" data-action="reveal-reading" aria-controls="focus-romaji">${all ? "Hide Romaji" : "Show Romaji"}</button></div><div class="romaji" id="focus-romaji" aria-label="Reveal individual Romaji words">${words.map((word,index)=>`<button type="button" data-reading="${escape(word)}" data-reading-index="${index}" aria-pressed="${tokens.has(index)}" class="${tokens.has(index)?"revealed":""}">${tokens.has(index)?escape(word):"•••"}</button>`).join("")}</div></div>`;
  }
  function meanings(item, focus = false) {
    const english = `<p lang="en">${escape(item.english)}</p>`;
    const deutsch = `<p lang="de">${escape(germanMeaning(item) || "German not prepared.")}</p>`;
    return `<${focus ? "div" : "details"} class="meaning"${focus ? "" : " open"}>${focus ? "" : `<summary>${icon("chevron")}Meaning</summary>`}${language==="de" ? deutsch : language==="both" ? english+deutsch : english}</${focus ? "div" : "details"}>`;
  }
  function noteState(item){
    let draft=noteDrafts.get(item.key);const saved=String(item.notes||'');
    if(!draft){draft={saved,value:saved,editing:false,busy:false,error:''};noteDrafts.set(item.key,draft);}
    else if(draft.saved!==saved){if(draft.value===draft.saved&&!draft.busy)draft.value=saved;draft.saved=saved;}
    return draft;
  }
  function noteMarkup(item){
    if(!Runtime||!item)return '';
    const draft=noteState(item),editing=draft.editing;
    if(!editing&&!draft.saved)return '<section id="focus-note" class="focus-note" hidden></section>';
    return `<section id="focus-note" class="focus-note" data-note-state="${editing?'edit':'read'}"><div class="focus-note-heading"><h3>Note</h3>${editing?'':`<button type="button" class="quiet" data-action="edit-note">Edit</button>`}</div>${editing?`<textarea id="focus-note-input" rows="3" maxlength="4000" aria-label="Your note" spellcheck="true"${draft.busy?' disabled':''}>${escape(draft.value)}</textarea><footer class="focus-note-footer"><p class="focus-note-status" role="status" data-error="${Boolean(draft.error)}">${escape(draft.error)}</p><div><button type="button" class="quiet" data-action="cancel-note"${draft.busy?' disabled':''}>Cancel</button><button type="button" class="primary" data-action="save-note"${draft.busy||draft.value===draft.saved?' disabled':''}>Save note</button></div></footer>`:`<p class="focus-note-text">${escape(draft.saved)}</p>`}</section>`;
  }
  function updateInlineNote(focus=false){
    const item=items.find(record=>record.key===current),section=$('focus-note');if(!item||!section)return;
    const template=document.createElement('template');template.innerHTML=noteMarkup(item);section.replaceWith(template.content.firstElementChild);
    if(focus){const input=$('focus-note-input');input?.focus({preventScroll:true});input?.setSelectionRange(input.value.length,input.value.length);$('focus-note')?.scrollIntoView({block:'nearest',behavior:'instant'});}
  }
  function openInlineNote(){
    if(!Runtime)return;const item=items.find(record=>record.key===current);if(!item)return;
    const draft=noteState(item);draft.editing=true;draft.error='';updateInlineNote(true);
  }
  function cancelInlineNote(){
    const item=items.find(record=>record.key===current);if(!item)return;const draft=noteState(item);if(draft.busy)return;
    draft.value=draft.saved;draft.editing=false;draft.error='';updateInlineNote();
  }
  async function saveInlineNote(){
    const item=items.find(record=>record.key===current);if(!Runtime||!item)return;const draft=noteState(item);if(draft.busy||draft.value===draft.saved)return;
    const key=item.key,value=draft.value;draft.busy=true;draft.error='';updateInlineNote();
    try{
      const record=await Runtime.updateNotes(key,value);draft.saved=value;draft.value=value;draft.editing=false;
      receiveRuntimeSnapshot({...runtimeSnapshot,library:{schemaVersion:1,records:{...runtimeSnapshot.library.records,[key]:record}}});
    }catch(error){draft.error=String(error.message||'The note could not be saved. Try again.');}
    finally{draft.busy=false;if(current===key)updateInlineNote();}
  }
  function detail(focus = false) {
    const item = getItem(current);
    if (!item) return '<article class="focus-card focus-empty"><h2>Your library is empty.</h2><p>Save a word or sentence from an iKnow course.</p></article>';
    if(focus) return `<article class="focus-card" data-compare-open="${compareOpen}"><p class="eyebrow">${subtitle(item)} · ${sourceCourseLink(item)}</p><h2 class="japanese" lang="ja">${escape(item.japanese)}</h2><p class="kana" lang="ja">${escape(item.kana)}</p>${reading(item)}${meanings(item,true)}${noteMarkup(item)}<div class="practice-tools"><button data-action="play" class="audio-mini">${icon("listen")}Listen to original</button><button data-action="compare" class="quiet" aria-expanded="${compareOpen}" aria-controls="focus-compare">Listen & compare</button>${globalThis.IKnowReaderVolumeControls.button()}</div><section id="focus-compare" class="focus-compare-panel" aria-label="Listen and compare" aria-hidden="${!compareOpen}"${compareOpen?"":" hidden inert"}></section></article>`;
    return `<article class="detail"><div class="detail-inner"><div class="detail-top"><p class="eyebrow">${subtitle(item)} · ${escape(item.courseTitle||`Course ${item.courseId}`)}</p><button class="quiet delete-item" data-action="delete">${icon("trash")}Delete</button></div><h2 class="japanese" lang="ja">${escape(item.japanese)}</h2><p class="kana" lang="ja">${escape(item.kana)}</p>${reading(item)}${meanings(item)}<div class="practice-tools"><button class="primary" data-action="practise-item">Practise this ${item.kind}</button><button class="quiet" data-action="play">${icon("listen")}Listen to original</button></div><div class="detail-note"><label for="demo-note">A note to yourself</label><textarea id="demo-note" rows="2" placeholder="A reminder, an example, or a way to remember it."></textarea></div><div class="detail-footer"><span>${items.findIndex(i=>i.key===current)+1} of ${items.length} saved items</span><button class="quiet" data-action="next">${nextSavedLabel()}</button></div></div></article>`;
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
    const count = coursePractice?practicePlan.count:selected.size;
    const plan = test ? testPlan() : null;
    const heading=`<div class="activity-heading"><div><p class="eyebrow">${test ? "Check your progress" : "Your pace"}</p><h2>${test ? "Course test" : "Practice"}</h2></div>${modal ? close : test ? "" : `<small>${count} ${coursePractice?'available':'selected'}</small>`}</div>`;
    const modes=`<div class="mode-grid" role="group" aria-label="Practice mode">${[["review","book","Review","Find the meaning."],["cloze","gap","Fill the gap","Complete the sentence."],["listening","listen","Listening","Listen, then write."]].map(([id,graphic,label,description])=>`<button class="mode-card" data-mode="${id}" aria-pressed="${mode===id}">${icon(graphic)}<span>${label}</span><small>${description}</small></button>`).join("")}</div>`;
    const options=`<div class="setup-fields">${choiceStepper('demo-attempts','attempts','Attempts',attemptChoices(),practiceAttempts)}${choiceStepper('demo-practice-order','practice-order','Order',orderChoices(),practiceOrder)}${mode==="cloze"?choiceStepper('demo-gap-position','gap-position','Gap position',gapChoices(),practiceGapPosition):''}</div>`;
    const selection=`<div class="activity-selection"><div><p>${count ? `${count} selected` : "Choose what you want to practise"}</p><small>${[...selected].map(key=>getItem(key)).filter(Boolean).filter(i=>i.kind==="word").length} words · ${[...selected].map(key=>getItem(key)).filter(Boolean).filter(i=>i.kind==="sentence").length} sentences</small></div><button data-action="choose">Choose words &amp; sentences</button></div>`;
    const sources=`<div class="practice-sources" role="group" aria-label="Practice source"><button type="button" data-practice-source="saved" aria-pressed="${!coursePractice}">Saved library</button><button type="button" data-practice-source="course" aria-pressed="${coursePractice}">Course</button></div>`;
    const practiceCourse=coursePractice?practiceCourseMarkup(practicePlan):'';
    const loaded=courseMatchesInput()&&!courseError&&!courseBusy;
    const course=test?`<div class="setup-course"><h3 id="demo-test-title">${escape(testCatalog?.title || "Load a course")}</h3><div class="setup-fields"><label>Course ID or link<input id="demo-test-course" type="text" value="${escape(testCourseInput)}" maxlength="200" placeholder="19053" autocomplete="off"${courseBusy?" disabled":""}></label><button type="button" class="quiet" data-action="load-test-course"${courseBusy||loaded||!testCourseInput.trim()?" disabled":""}>${testLoadLabel()}</button>${choiceStepper('demo-test-content','test-content','Content',contentChoices(),testContent,courseBusy)}</div><p class="small" id="demo-test-source-status" role="status"${plan.label?"":" hidden"}>${escape(plan.label)}</p></div>`:"";
    return `<section class="activity-pane"><div class="activity-inner">${heading}${test?course:sources+modes+(coursePractice?practiceCourse:'')+options+(coursePractice?'':selection)}<div class="setup-start"><button class="primary" data-action="start"${test?!plan.ready?" disabled":"":coursePractice?!practicePlan.ready?' disabled':'':!count?" disabled":""}>${test ? `Start test<span id="demo-test-total">${plan.count?` (${plan.count})`:""}</span>` : coursePractice?`Start practice (${count})`:"Start session"}</button></div></div></section>`;
  }
  function practiceCourseMatchesInput(){try{return practiceCatalog?.courseId===courseClient.courseId(practiceCourseInput);}catch{return false;}}
  function practiceCoursePlan(){
    if(practiceCourseBusy)return{count:0,ready:false,records:[],label:'Loading course…'};
    if(practiceCourseError)return{count:0,ready:false,records:[],label:practiceCourseError};
    if(!practiceCatalog||!practiceCourseMatchesInput())return{count:0,ready:false,records:[],label:'Load a course to begin.'};
    const pool=practiceCatalog.records;
    let cache=practiceCourseCache.get(pool);if(!cache){cache=new Map();practiceCourseCache.set(pool,cache);}
    const cacheKey=mode+':'+(language==='de'?'de':'en');
    if(!cache.has(cacheKey))cache.set(cacheKey,pool.filter(record=>mode==='cloze'?Boolean(Practice.buildCloze(record,{gapPosition:'first'})):mode==='listening'?Boolean(Practice.buildListening(record)):Boolean(reviewQuestion(record,pool))));
    const records=cache.get(cacheKey).filter(record=>practiceContent==='both'||record.kind===practiceContent);
    const total=pool.filter(record=>practiceContent==='both'||record.kind===practiceContent).length,skipped=total-records.length;
    return{count:records.length,ready:records.length>0,records,label:skipped?`${skipped} ${skipped===1?'question is':'questions are'} unavailable for this exercise.`:practiceCatalog.stale?'Using the saved course copy.':''};
  }
  function practiceCourseMarkup(plan){
    const loaded=practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCourseBusy;
    return `<div class="setup-course practice-course"><h3 id="demo-practice-title">${escape(practiceCatalog?.title||'Load a course')}</h3><div class="setup-fields"><label>Course ID or link<input id="demo-practice-course" type="text" value="${escape(practiceCourseInput)}" maxlength="200" autocomplete="off"${practiceCourseBusy?' disabled':''}></label><button type="button" class="quiet" data-action="load-practice-course"${practiceCourseBusy||loaded||!practiceCourseInput.trim()?' disabled':''}>${practiceCourseBusy?'Loading…':loaded?'Loaded':'Load course'}</button>${choiceStepper('demo-practice-content','practice-content','Content',contentChoices(),practiceContent,practiceCourseBusy)}</div><p class="small" id="demo-practice-source-status" role="status"${plan.label?'':' hidden'}>${escape(plan.label)}</p></div>`;
  }
  function updatePracticeSummary(){
    if(view!=='practice'||practiceSource!=='course'||session)return;
    const plan=practiceCoursePlan(),status=$('demo-practice-source-status');if(status){status.textContent=plan.label;status.hidden=!plan.label;}
    const loaded=practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCourseBusy,load=document.querySelector('[data-action="load-practice-course"]');if(load){load.disabled=practiceCourseBusy||loaded||!practiceCourseInput.trim();load.textContent=practiceCourseBusy?'Loading…':loaded?'Loaded':'Load course';}
    const start=document.querySelector('[data-action="start"]');if(start){start.disabled=!plan.ready;start.textContent=`Start practice (${plan.count})`;}
    const count=document.querySelector('.activity-heading small');if(count)count.textContent=plan.count?`${plan.count} available`:'';
  }
  async function loadPracticeCourse(){
    if(practiceCourseBusy||session||!practiceCourseInput.trim()||(practiceCourseMatchesInput()&&!practiceCourseError&&!practiceCatalog?.stale))return;
    const revision=++practiceRevision,input=practiceCourseInput;practiceCourseBusy=true;practiceCourseError='';
    const cached=(practiceCourseMatchesInput()?practiceCatalog:null)||await courseClient.cached(input);
    if(revision!==practiceRevision)return;
    practiceCatalog=cached;
    // Validate the saved source before rendering. A warm course never paints
    // the generic loading title, zero count or disabled Start button.
    if(cached&&!cached.stale){practiceCourseBusy=false;retainPracticeSetup();if(!session&&view==='practice'&&practiceSource==='course')render();return;}
    if(!session&&view==='practice'&&practiceSource==='course')render();
    try{const catalog=await courseClient.load(input);if(revision===practiceRevision)practiceCatalog=catalog;}
    catch(error){if(revision===practiceRevision)practiceCourseError=String(error.message||'Course could not be loaded. Try again.');}
    finally{if(revision===practiceRevision){practiceCourseBusy=false;if(practiceCatalog)retainPracticeSetup();if(!session&&view==='practice'&&practiceSource==='course')render();}}
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
    }catch{ /* Invalid tab preferences cannot restore another course or exercise. */ }
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
    } catch { /* An unavailable or invalid tab preference cannot select another course. */ }
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
    const unavailable=records.filter(item=>!reviewQuestion(item,testCatalog.records)).length;
    return{count:records.length,ready:records.length>0&&!unavailable,label:unavailable?`${unavailable} ${unavailable===1?"question has":"questions have"} no usable meaning for this test.`:testCatalog.stale?"Using the saved course copy.":""};
  }
  function updateTestSummary() {
    if(view!=="test"||session)return;const plan=testPlan();
    if($("demo-test-total"))$("demo-test-total").textContent=plan.count?` (${plan.count})`:"";
    if($("demo-test-source-status")){$("demo-test-source-status").textContent=plan.label;$("demo-test-source-status").hidden=!plan.label;}
    const load=document.querySelector('[data-action="load-test-course"]');if(load){const loaded=courseMatchesInput()&&!courseError&&!courseBusy;load.disabled=courseBusy||loaded||!testCourseInput.trim();load.textContent=testLoadLabel();}
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
    if(cached&&!cached.stale){courseBusy=false;retainTestSetup();if(!session&&view==="test")render();return;}
    if(!session&&view==="test")render();
    try{const catalog=await courseClient.load(input);if(revision!==courseRevision)return;testCatalog=catalog;}
    catch(error){if(revision===courseRevision)courseError=String(error.message||"Course could not be loaded. Try again.");}
    finally{if(revision===courseRevision){courseBusy=false;if(testCatalog)retainTestSetup();if(!session&&view==="test")render();}}
  }
  function workspaceA() {
    return `<div class="app-frame"><div class="frame-toolbar">${tabs()}<div class="spacer"></div><span class="counter">${items.length} saved items</span><button class="quiet delete-all" data-action="delete-all">Delete all</button></div>${libraryPane()}${view==="study"?detail():activity(view==="test")}${overlays()}</div>`;
  }
  function workspaceB() {
    return `<div class="app-frame"><div class="frame-toolbar"><h2>Saved for later</h2><span class="counter">${items.length}</span><div class="spacer"></div><button class="quiet" data-action="collection-select">${selectionMode?"Done selecting":"Select items"}</button><button data-action="test-modal">Course test</button><button class="primary" data-action="practice-modal">Practice</button></div><div class="collection-filters">${filterFields(true)}</div><div class="collection-body"><div class="collection-grid" id="demo-library-list">${filtered().map(item=>row(item,selectionMode)).join("")}</div></div><div class="collection-footer"><span id="collection-count">${selectionMode?`${selected.size} selected`:`${filtered().length} items`}</span><button class="quiet" data-action="delete-all">Delete all</button>${selectionMode ? `<button class="primary" data-action="practice-modal"${!selected.size?" disabled":""}>Practise selected</button>` : `<span>Core 2000 · Step 1</span>`}</div>${drawer?`<aside class="drawer" aria-label="Item details"><div class="drawer-head"><span>Item details</span><button class="close-button quiet" data-action="close-drawer" aria-label="Close item details">${icon("close")}</button></div>${detail()}</aside>`:""}${overlays()}</div>`;
  }
  function workspaceC() {
    const list = filtered();
    const navigation=`<nav class="item-navigation" aria-label="Saved words and sentences"><button data-action="previous"${list.length?"":" disabled"}>Previous</button><button data-action="next"${list.length?"":" disabled"}>${nextSavedLabel()}</button></nav>`;
    const desk = `<section class="focus-desk">${view==="study"?`<div class="focus-top">${Runtime&&current?`<div class="focus-study-actions"><button type="button" class="quiet" data-action="note">${icon("note")}Note</button><button type="button" class="quiet" data-action="delete">${icon("trash")}Delete</button></div>`:""}</div><div class="focus-main">${detail(true)}</div><footer class="focus-bottom">${navigation}<button class="primary" data-action="practise-item"${current?"":" disabled"}>Practice this ${noun([getItem(current)])}</button></footer>`:view==='kana'?(globalThis.IKnowFocusKana?.render()||''):activity(view==="test")}</section>`;
    return `<div class="app-frame"><nav class="focus-rail" aria-label="Study activity">${[["study","book","Study"],["practice","listen","Practice"],["test","test","Test"],["kana","kana","Kana"]].map(([id,graphic,label])=>`<button data-view="${id}" aria-pressed="${view===id}">${icon(graphic)}${label}</button>`).join("")}<button data-action="browse" aria-expanded="${libraryOpen&&view==="study"}" aria-controls="focus-library">${icon("library")}Library</button></nav><div class="focus-body">${libraryOpen&&view==="study"?focusLibrary():""}${desk}</div>${overlays()}</div>`;
  }
  function focusLibrary() {
    const courses=new Map(items.map(item=>[item.courseId,item.courseTitle||`Course ${item.courseId}`]));
    return `<aside class="focus-library" id="focus-library" aria-label="Saved for later"><div class="focus-library-controls"><div class="focus-library-heading"><h2>Saved for later <span class="count">${filtered().length}</span></h2>${Runtime?`<button type="button" class="quiet" data-action="delete-all"${items.length?"":" disabled"}>Delete all</button>`:""}</div><div class="library-search"><input type="search" id="demo-search" value="${escape(search)}" placeholder="Find a word or sentence" aria-label="Find a word or sentence" autocomplete="off"><div class="library-filters"><select id="demo-course" aria-label="Course"><option value="">All courses</option>${[...courses].map(([id,title])=>`<option value="${escape(id)}"${course===id?' selected':''}>${escape(title)}</option>`).join('')}</select>${kindSelect()}</div></div></div><div id="demo-library-list" class="library-list">${filtered().map(item=>row(item)).join("")||'<p class="no-results">No words or sentences found.</p>'}</div></aside>`;
  }
  function navigateItem(step) {
    const list=filtered();if(!list.length)return;
    const at=list.findIndex(item=>item.key===current);current=list[(at<0?step<0?list.length-1:0:(at+step+list.length)%list.length)].key;
    revealed=false;render();
  }
  function pickerMarkup() {
    const query=pickerSearch.trim().toLowerCase();
    const list=items.filter(item=>!query||[item.japanese,item.romaji,item.english,germanMeaning(item)].join(" ").toLowerCase().includes(query));
    return `<div class="overlay"><section class="picker-modal" role="dialog" aria-modal="true" aria-labelledby="picker-title"><div class="modal-head"><h2 id="picker-title">${pickerPurpose==="browse"?"Your library":"Choose words &amp; sentences"}</h2>${close}</div><div class="picker-search"><input type="search" id="picker-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(pickerSearch)}"></div><div class="picker-actions"><span>${list.length} saved</span>${pickerPurpose==="browse"?"":`<div><button class="quiet" data-action="select-all">Select all</button><button class="quiet" data-action="clear-selection">Clear</button></div>`}</div><div class="picker-list" id="picker-list">${list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No words or sentences found.</p>'}</div><div class="picker-bottom"><span id="picker-count">${pickerPurpose==="browse"?`${items.length} saved`:`${selected.size} selected`}</span><button class="primary" data-action="close-picker">${pickerPurpose==="browse"?"Done":"Use selection"}</button></div></section></div>`;
  }
  function sessionMarkup() {
    if(!session)return "";
    if(session.finishedAt)return globalThis.IKnowFocusResults.render(session,{items,language});
    const item=getItem(session.keys[session.index]),exercise=session.exercises[session.index];
    const prompt=mode==="cloze"?exercise.before+" _____ "+exercise.after:item.japanese;
    const solution=mode==="cloze"?exercise.answerJapanese:mode==='listening'?exercise.details.japanese:item.japanese,romaji=mode==="cloze"?exercise.answerRomaji:mode==='listening'?exercise.displayRomaji:item.romaji;
    const solutionMeaning=meaning(mode==='listening'?exercise.details:item);
    const nextKind=mode==='listening'?session.exercises[session.index+1]?.details?.kind:getItem(session.keys[session.index+1])?.kind;
    return `<section class="session-screen" aria-label="Practice session"><div class="session-top"><p class="eyebrow">${session.test?"Course test · ":""}${modeName()}</p><button data-action="end-session">End session</button></div><div class="session-progress"><span>${session.index+1} of ${session.keys.length}</span><progress max="${session.keys.length}" value="${session.index}"></progress></div><div class="session-content">${mode==="listening"?player():`<p class="session-word" lang="ja">${escape(prompt)}</p>`}${mode==="review"?`<div class="session-review"><p class="small">Choose the meaning</p>${exercise.choices.map(option=>`<button data-review="${escape(option.id)}">${escape(option.label)}</button>`).join("")}</div>`:`<form id="demo-answer" class="answer-form"><label for="listening-answer">${mode==="listening"?"Your answer":"Missing word"}</label><div class="answer-row"><input type="text" id="listening-answer" value="${escape(session.lastSubmitted[session.index]||'')}" placeholder="Japanese / Kana / Romaji" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="primary" type="submit"${session.lastSubmitted[session.index]?.trim()?'':' disabled'}>Check answer</button></div><p id="demo-feedback" class="feedback" role="status"></p><button class="quiet reveal-demo" type="button" data-action="show-answer">Show answer</button></form>`}<div class="session-solution" id="demo-solution" hidden><p class="japanese" lang="ja">${escape(solution)}</p><p class="kana">${escape(romaji)}</p>${mode==="cloze"?`<p class="kana" lang="ja">${escape(exercise.details.japanese)}</p>`:""}<p class="solution-meaning">${escape(solutionMeaning)}</p><div class="session-next"><button class="primary" data-action="next-question">${session.index+1===session.keys.length?"Finish":nextKind==='sentence'?"Next sentence":"Next word"}</button></div></div></div></section>`;
  }
  function player() {
    return `<div class="audio-player" id="demo-player" data-playing="false"><div class="audio-top"><button class="play-circle" data-action="play-session" aria-label="Play audio">${icon("play")}</button><span id="demo-play-label">Play audio</span><span class="waveform" aria-hidden="true">${[13,26,38,20,33,40,24,36,18,31,39,23,16].map((height,i)=>`<i style="--h:${height}px;--d:${i*.05}s"></i>`).join("")}</span></div><div class="audio-meta"><progress id="demo-audio-progress" max="1" value="0"></progress><span id="demo-audio-time">0:00</span>${globalThis.IKnowReaderVolumeControls.button(["original"])}</div></div>`;
  }
  function overlays() {
    return `${setupModal?`<div class="overlay setup-overlay">${activity(view==="test",true)}</div>`:""}${picker?pickerMarkup():""}${session?sessionMarkup():""}`;
  }
  function render() {
    const hash = "#" + view;
    if(location.hash !== hash)history.replaceState(history.state,"",location.pathname+location.search+hash);
    globalThis.IKnowReaderVolumeControls?.close();stopAudio();
    answerComposing=false;
    menuCleanup?.();menuCleanup=null;
    resultsCleanup?.();resultsCleanup=null;
    kanaCleanup?.();kanaCleanup=null;
    compareRevision++;compareAnimation?.cancel();compareAnimation=null;
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
    if($("focus-compare"))globalThis.IKnowFocusAudio?.mount($("focus-compare"),{key:current,audioUrl:getItem(current).audioUrl,stopOtherAudio:stopAudio});
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
  function toggleCompare() {
    const panel=$("focus-compare"),button=document.querySelector('[data-action="compare"]');if(!panel||!button)return;
    const revision=++compareRevision,from=panel.hidden?0:panel.getBoundingClientRect().height,opacity=panel.hidden?0:Number(getComputedStyle(panel).opacity);
    compareAnimation?.cancel();compareAnimation=null;compareOpen=!compareOpen;
    if(!compareOpen)globalThis.IKnowFocusAudio?.stopMedia();
    button.setAttribute("aria-expanded",String(compareOpen));panel.inert=!compareOpen;panel.setAttribute("aria-hidden",String(!compareOpen));
    document.querySelector(".focus-card").dataset.compareOpen=String(compareOpen);
    panel.hidden=false;panel.style.height="auto";const to=compareOpen?panel.scrollHeight:0;
    const finish=()=>{if(revision!==compareRevision||!panel.isConnected)return;panel.style.height="";panel.style.opacity="";panel.hidden=!compareOpen;compareAnimation=null;};
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){finish();return;}
    panel.style.height=from+"px";panel.style.opacity=String(opacity);
    const animation=panel.animate([{height:from+"px",opacity},{height:to+"px",opacity:compareOpen?1:0}],{duration:260,easing:"cubic-bezier(.22,.68,.2,1)",fill:"forwards"});compareAnimation=animation;
    animation.finished.then(()=>{finish();animation.cancel();}).catch(()=>{});
  }
  function updateReading() {
    const words=romajiFor(getItem(current)).split(/\s+/).filter(Boolean),tokens=tokenReveals.get(current)||new Set();
    for(const button of document.querySelectorAll("[data-reading-index]")){const shown=tokens.has(Number(button.dataset.readingIndex));button.classList.toggle("revealed",shown);button.setAttribute("aria-pressed",String(shown));button.textContent=shown?button.dataset.reading:"•••";}
    const control=document.querySelector('[data-action="reveal-reading"]');if(control)control.textContent=tokens.size===words.length?"Hide Romaji":"Show Romaji";
  }
  function updateLists() {
    if(!$("demo-library-list"))return;
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
    if($("collection-count"))$("collection-count").textContent=selectionMode?`${selected.size} selected`:`${filtered().length} items`;
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
        return old&&JSON.stringify(old)===JSON.stringify(next)?old:next;
      });
    }else if(previous.learning.records!==snapshot.learning.records){
      items=items.map(item=>{const strength=Runtime.strength(item.key,snapshot.learning,mode);return item.strength===strength?item:{...item,strength};});
    }
    const available=new Set(items.map(record=>record.key));current=available.has(oldCurrent)?oldCurrent:items[0]?.key||'';
    for(const key of selected)if(!available.has(key))selected.delete(key);
    practiceAttempts=snapshot.preferences.attempts;practiceGapPosition=snapshot.preferences.gapPosition;
    language=snapshot.reading.translationLanguage;document.documentElement.dataset.ikrTheme=snapshot.appTheme;
  }
  const detailSignature=item=>item?JSON.stringify([item.key,item.kind,item.japanese,item.kana,item.romaji,item.english,item.german,item.courseTitle,item.audioUrl]):'';
  function receiveRuntimeSnapshot(snapshot){
    const before=runtimeSnapshot,oldItems=items,previous=items.find(record=>record.key===current),oldLanguage=language;
    applyRuntimeSnapshot(snapshot);
    if(session||runtimeBusy)return;
    if(view!=='study'){
      if(oldLanguage!==language||before?.appTheme!==snapshot.appTheme)refreshHeader();
      if(oldLanguage!==language){if(view==='test')updateTestSummary();else if(view==='practice'&&practiceSource==='course')updatePracticeSummary();}
      return;
    }
    const next=items.find(record=>record.key===current);
    const readingChanged=oldLanguage!==language||before?.reading.romajiStyle!==snapshot.reading.romajiStyle;
    if(oldItems!==items)updateLists();
    const select=$('demo-course');if(select&&before?.library!==snapshot.library){
      const courses=new Map(items.map(item=>[item.courseId,item.courseTitle||`Course ${item.courseId}`]));
      const signature=JSON.stringify([...courses]);
      if(select.dataset.courseSignature!==signature){select.innerHTML='<option value="">All courses</option>'+[...courses].map(([id,title])=>`<option value="${escape(id)}"${course===id?' selected':''}>${escape(title)}</option>`).join('');select.dataset.courseSignature=signature;}
    }
    if(previous?.notes!==next?.notes&&detailSignature(previous)===detailSignature(next)&&!readingChanged)updateInlineNote();
    if(detailSignature(previous)!==detailSignature(next)||readingChanged){
      globalThis.IKnowFocusAudio?.unmount();compareOpen=false;compareKey=current;globalThis.IKnowFocusAudio?.reset();
      const main=document.querySelector('.focus-main');if(main){main.innerHTML=detail(true);if($('focus-compare'))globalThis.IKnowFocusAudio?.mount($('focus-compare'),{key:current,audioUrl:next.audioUrl,stopOtherAudio:stopAudio});}
      const studyActions=document.querySelector('.focus-study-actions');if(!next)studyActions?.remove();
      else if(!studyActions){const actions=document.createElement('div');actions.className='focus-study-actions';actions.innerHTML=`<button type="button" class="quiet" data-action="note">${icon('note')}Note</button><button type="button" class="quiet" data-action="delete">${icon('trash')}Delete</button>`;document.querySelector('.focus-top')?.append(actions);}
      const practise=document.querySelector('.focus-bottom>[data-action="practise-item"]');if(practise){practise.disabled=!next;practise.textContent=`Practice this ${noun([next])}`;}
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
    const oldStrengths=new Map(items.map(record=>[record.key,record.strength]));
    const nextItems=savedByAdded(data[Store.KEY]).map(record=>({...record,strength:learning.records[record.key]?.review?globalThis.IKnowReaderStudyLearning.strength(learning.records[record.key].review):oldStrengths.get(record.key)||'new'}));
    previewLibrary=structuredClone(data[Store.KEY]);previewLearning=structuredClone(learning);
    previewSettings=Object.fromEntries([Core.STORAGE_KEY,'iknowReaderTheme','iknowReaderPanelTheme'].filter(key=>data[key]!==undefined).map(key=>[key,structuredClone(data[key])]));
    items=nextItems;current=items.some(record=>record.key===current)?current:items[0]?.key||'';
    for(const key of selected)if(!items.some(record=>record.key===key))selected.delete(key);
    const preferences=data[Store.PREFERENCES_KEY];if(preferences){practiceAttempts=preferences.attempts||practiceAttempts;practiceGapPosition=preferences.gapPosition||practiceGapPosition;}
    if(['en','de','both'].includes(data[Core.STORAGE_KEY]?.translationLanguage))language=data[Core.STORAGE_KEY].translationLanguage;
    const theme=data.iknowReaderTheme;if(['paper','midnight','tokyo','forest'].includes(theme)){document.documentElement.dataset.ikrTheme=theme;try{localStorage.setItem('ikr-layout-review:theme',theme);}catch{}}
  }
  async function readStoredPreview(){
    const data=await globalThis.IKnowFocusBackup.loadSnapshot();if(!data)return false;
    const Store=globalThis.IKnowReaderStudyStore,Core=globalThis.IKnowReaderCore,Learning=globalThis.IKnowReaderStudyLearningStore;
    const checked=await Store.createBackend({async get(keys){return Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,data[key]]));},async set(){throw Error('Unexpected preview restore write.');}}).exportBackup();
    applyBackupSnapshot({[Store.KEY]:checked.library,[Learning.KEY]:{schemaVersion:1,records:checked.learning?.records||{},session:null},[Store.PREFERENCES_KEY]:checked.settings.study,
      [Core.STORAGE_KEY]:checked.settings.reading,iknowReaderTheme:checked.settings.appTheme,iknowReaderPanelTheme:checked.settings.panelTheme});
    return true;
  }
  let releaseAudioVolume=null;
  function stopAudio() {releaseAudioVolume?.();releaseAudioVolume=null;if(audio){audio.pause();audio.src="";audio=null;}}
  function play(record, withPlayer = false) {
    globalThis.IKnowFocusAudio?.stopMedia();
    if(audio){stopAudio();if($("demo-player"))$("demo-player").dataset.playing="false";if($("demo-play-label"))$("demo-play-label").textContent="Play audio";return;}
    if(!record.audioUrl){toast("This word or sentence has no recording.");return;}
    const active=new Audio(record.audioUrl);audio=active;active.preload="none";releaseAudioVolume=globalThis.IKnowReaderCore.audioVolume().bind(active,"original");
    const reset=()=>{if(audio===active){releaseAudioVolume?.();releaseAudioVolume=null;audio=null;}if($("demo-player"))$("demo-player").dataset.playing="false";if($("demo-play-label"))$("demo-play-label").textContent="Play again";};
    if(withPlayer){$("demo-player").dataset.playing="true";$("demo-play-label").textContent="Playing";active.addEventListener("timeupdate",()=>{if($("demo-audio-progress"))$("demo-audio-progress").value=active.duration?active.currentTime/active.duration:0;if($("demo-audio-time"))$("demo-audio-time").textContent=`0:${String(Math.floor(active.currentTime)).padStart(2,"0")}`;});}
    active.addEventListener("ended",reset);active.play().catch(()=>{reset();toast("Could not play the recording. Try again.");});
  }
  function openPicker(purpose) {picker=true;pickerPurpose=purpose;pickerSearch="";render();$("picker-search").focus({preventScroll:true});}
  function resultRecord(index,outcome,submitted="") {
    const item=getItem(session.keys[index]),exercise=session.exercises[index];
    const expected=session.mode==="review"?exercise.choices.find(choice=>choice.id===exercise.correctId)?.label||meaning(item):session.mode==="cloze"?[exercise.answerJapanese,exercise.answerRomaji].filter(Boolean).join(" · "):exercise.displayRomaji||exercise.details.japanese;
    return {key:item.key,japanese:item.japanese,expected,submitted:String(submitted||"").slice(0,5000),outcome,attempts:session.answerAttempts[index],attemptsHistory:structuredClone(session.answerHistory?.[index]||[])};
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
    const exercises=chosen.map(key=>records.has(key)?exerciseFor(records.get(key),sourcePool):null);if(exercises.some(exercise=>!exercise)){toast("Some questions are unavailable for this exercise. Change your selection.");return;}
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
    if(mode==="listening")return Practice.buildListening(record,{romajiStyle});
    return reviewQuestion(record,pool);
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest("button");if(!button||button.disabled||runtimeBusy)return;
    if(session&&!button.closest(".session-screen")){
      const resultNavigation=session.finishedAt&&button.closest(".focus-rail")&&(button.dataset.view||button.dataset.action==="browse");
      if(!resultNavigation)return;
      // A finished report can be left through the rail without ending another
      // round or changing its grades, saved selection or original test report.
      session=null;picker=false;setupModal=false;drawer=false;
      if(button.dataset.action==="browse"){view="study";libraryOpen=true;render();return;}
    }
    if(button.dataset.choiceStep){const group=button.closest('[data-choice]');if(group)stepChoice(group.dataset.choice,button.dataset.choiceStep);return;}
    if(button.dataset.practiceSource){practiceSource=button.dataset.practiceSource;retainPracticeSetup();if(practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else render();return;}
    if(button.dataset.view){view=button.dataset.view;drawer=false;if(view==="test"&&!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else if(view==='practice'&&practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else render();return;}
    if(button.dataset.mode){mode=button.dataset.mode;retainPracticeSetup();if(Runtime&&runtimeSnapshot)items=items.map(item=>({...item,strength:Runtime.strength(item.key,runtimeSnapshot.learning,mode)}));render();return;}
    if(button.dataset.reading){const tokens=tokenReveals.get(current)||new Set(),index=Number(button.dataset.readingIndex);tokens.has(index)?tokens.delete(index):tokens.add(index);tokenReveals.set(current,tokens);updateReading();return;}
    if(button.dataset.item){const key=button.dataset.item;if(button.dataset.pickerRow){if(pickerPurpose==="browse"){current=key;picker=false;view="study";revealed=false;render();return;}selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("picker-count").textContent=`${selected.size} selected`;return;}if(version==="b"&&selectionMode){selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("collection-count").textContent=`${selected.size} selected`;const practise=document.querySelector(".collection-footer .primary");if(practise)practise.disabled=!selected.size;return;}current=key;view="study";revealed=false;if(version==="b")drawer=true;render();return;}
    if(button.dataset.review){if(!session||session.finishedAt)return;const exercise=session.exercises[session.index],correct=button.dataset.review===exercise.correctId,submitted=exercise.choices.find(choice=>choice.id===button.dataset.review)?.label||button.textContent;void answerQuestion(correct,submitted,false,button);return;}
    switch(button.dataset.action){
      case "choose":openPicker("practice");break;
      case "browse":if(view!=="study"){view="study";libraryOpen=true;}else libraryOpen=!libraryOpen;render();break;
      case "close-overlay":picker=false;setupModal=false;render();break;
      case "close-picker":picker=false;render();break;
      case "select-all":items.forEach(item=>selected.add(item.key));render();break;
      case "clear-selection":selected.clear();render();break;
      case "collection-select":selectionMode=!selectionMode;drawer=false;render();break;
      case "close-drawer":drawer=false;render();break;
      case "practice-modal":view="practice";setupModal=true;drawer=false;render();break;
      case "test-modal":view="test";setupModal=true;drawer=false;if(!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else render();break;
      case "load-test-course":void loadTestCourse();break;
      case "load-practice-course":void loadPracticeCourse();break;
      case "reveal-reading":{const words=romajiFor(getItem(current)).split(/\s+/).filter(Boolean),tokens=tokenReveals.get(current)||new Set();tokenReveals.set(current,tokens.size===words.length?new Set():new Set(words.map((_,index)=>index)));updateReading();break;}
      case "play":play(getItem(current));break;
      case "play-session":{const record=getItem(session.keys[session.index]),exercise=session.exercises[session.index];play(session.mode==='listening'?{...record,...exercise.details}:record,true);break;}
      case "practise-item":selected.clear();selected.add(current);practiceSource='saved';retainPracticeSetup();view="practice";if(version==="b")setupModal=true;drawer=false;render();break;
      case "next":navigateItem(1);break;
      case "previous":navigateItem(-1);break;
      case "start":{
        const test=view==='test';if(test){if(testPlan().ready)startRound(testCatalog.records.filter(item=>testContent==='both'||item.kind===testContent).map(item=>item.key),true);break;}
        if(practiceSource==='course'){const plan=practiceCoursePlan();if(plan.ready)startRound(plan.records.map(item=>item.key),false,practiceCatalog.records,{shuffle:practiceOrder==='shuffle',catalog:practiceCatalog});}
        else startRound(items.filter(item=>selected.has(item.key)).map(item=>item.key),false,null,{shuffle:practiceOrder==='shuffle'});
        break;
      }
      case "end-session":finishRound();break;
      case "show-answer":void answerQuestion(false,$("listening-answer")?.value||"",true);break;
      case "next-question":if(!session||session.finishedAt||!session.results.some(result=>result.key===session.keys[session.index]))break;if(session.index+1>=session.keys.length)finishRound();else{session.index++;Rounds?.persistView(session);render();}break;
      case "result-back-study":session=null;view="study";render();break;
      case "result-new-round":session=null;render();break;
      case "result-practice-mistakes":{if(!session?.finishedAt)break;const summary=globalThis.IKnowFocusResults.summarize(session),keys=summary.reviewKeys;if(!keys.length)break;const fromTest=session.test||session.fromTest,pool=session.pool;mode=session.mode;view="practice";session=null;void startRound(keys,false,pool).then(()=>{if(session){session.fromTest=fromTest;Rounds?.persistView(session);}});break;}
      case "result-test-report":if(previousTestReport){session=structuredClone(previousTestReport);mode=session.mode;view="test";render();}break;
      case "delete":case "delete-all":if(Runtime)libraryActions.openDelete({all:button.dataset.action==='delete-all'});else toast("Delete controls are shown for layout review. Demo items are kept.");break;
      case "backup":backupController?.open();break;
      case "note":case "edit-note":openInlineNote();break;
      case "cancel-note":cancelInlineNote();break;
      case "save-note":void saveInlineNote();break;
      case "compare":toggleCompare();break;
    }
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="demo-kind"){kind=event.target.value;updateLists();}
    if(event.target.id==="demo-course"){course=event.target.value;updateLists();}
    if(event.target.id==="demo-strength"){strength=event.target.value;updateLists();}
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
    if(event.target.id==="picker-search"){pickerSearch=event.target.value;const query=pickerSearch.toLowerCase();const list=items.filter(item=>[item.japanese,item.romaji,item.english,germanMeaning(item)].join(" ").toLowerCase().includes(query));$("picker-list").innerHTML=list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No words or sentences found.</p>';}
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
  window.addEventListener("hashchange",()=>{
    if(runtimeBusy||session&&!session.finishedAt){history.replaceState(history.state,"",location.pathname+location.search+"#"+view);return;}
    view=routeView();session=null;picker=false;setupModal=false;drawer=false;
    if(view==="test"&&!testCatalog&&!courseBusy&&!courseError)void loadTestCourse();else if(view==='practice'&&practiceSource==='course'&&!practiceCatalog&&!practiceCourseBusy&&!practiceCourseError)void loadPracticeCourse();else render();
  });
  async function init(){
    if(globalThis.IKnowStudyWorkspaceProduction){
      try{if(!Runtime)throw Error('The Study data connection is unavailable. Reload Reading Helper.');await initRuntime();}
      catch(error){$('demo').innerHTML='<p class="no-results"></p>';$('demo').querySelector('p').textContent=String(error.message||'The library could not be loaded.');console.error(error);}
      return;
    }
    try{const saved=localStorage.getItem("ikr-layout-review:theme");if(["paper","midnight","tokyo","forest"].includes(saved))document.documentElement.dataset.ikrTheme=saved;}catch{}
    try{
      const response=await fetch('/library.json');if(!response.ok)throw Error('Library unavailable');const library=await response.json();
      previewLibrary={schemaVersion:1,records:Object.fromEntries(Object.entries(library.records).slice(0,18))};
      items=savedByAdded(previewLibrary).map((item,index)=>({...item,strength:['new','learning','strong','new','weak','learning'][index%6]}));current=items[0]?.key||'';
      let restoreError='';try{await readStoredPreview();}catch(error){restoreError=String(error.message||'The imported preview library could not be restored.');}
      items.slice(0,4).forEach(item=>selected.add(item.key));
      restoreStudySelection();
      backupController=globalThis.IKnowFocusBackup.create({getSnapshot:backupSnapshot,onImport:async data=>{
        await globalThis.IKnowFocusBackup.saveSnapshot(data);
        applyBackupSnapshot(data);view='study';session=null;picker=false;setupModal=false;course='';kind='';strength='';search='';libraryOpen=true;libraryScroll.clear();render();
      }});
      restoreTestSetup();restorePracticeSetup();view=routeView();
      if(view==="test")void loadTestCourse();else if(view==='practice'&&practiceSource==='course')void loadPracticeCourse();else render();
      if(restoreError)toast(restoreError);
    }catch(error){$('demo').innerHTML='<p class="no-results">The library could not be loaded. Refresh to try again.</p>';console.error(error);}
  }
  init();
})();
