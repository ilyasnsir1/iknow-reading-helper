/* Isolated visual study alternatives. No extension storage, helper or publishing. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const Practice = globalThis.IKnowReaderStudyPractice;
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
  };
  const icon = name => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  const explanations = {a:"Library and activities in one workspace.",b:"A collection first. Open an item when you need it.",c:"One item at a time. Keep the library within reach."};
  const german = {
    "それ":"das, jenes", "見る":"sehen, anschauen", "円":"Kreis", "多い":"viel, zahlreich", "家":"Haus, Zuhause", "これ":"dies, dieses", "新しい":"neu", "私":"ich", "仕事":"Arbeit, Beruf",
    "それはとてもいい話だ。":"Das ist eine wirklich schöne Geschichte.", "私は絵を見るのが好きです。":"Ich schaue mir gern Bilder an.", "そこに大きな円を描いて。":"Zeichne dort einen großen Kreis.", "京都にはお寺が多い。":"In Kyoto gibt es viele Tempel.", "家に遊びにきてください。":"Komm mich zu Hause besuchen.", "これをください。":"Das hätte ich bitte.", "彼の車は新しい。":"Sein Auto ist neu.", "私が行きましょう。":"Dann gehe ich.", "3月は仕事が忙しい。":"Im März habe ich viel Arbeit."
  };
  let items = [], current = "", version = "c", view = "study", mode = "review", language = "en", search = "", kind = "", strength = "", drawer = false, selectionMode = false, picker = false, pickerPurpose = "practice", pickerSearch = "", setupModal = false, session = null, revealed = false, audio = null, toastTimer;
  const selected = new Set();
  const getItem = key => items.find(item => item.key === key) || items[0];
  const meaning = item => language === "de" ? german[item.japanese] || item.german || item.english : item.english;
  const subtitle = item => item.kind === "word" ? "Word" : "Sentence";
  const strengthLabel = value => ({new:"New",weak:"Weak",learning:"Learning",strong:"Strong"}[value]);
  const close = `<button class="close-button quiet" type="button" data-action="close-overlay" aria-label="Close">${icon("close")}</button>`;
  const modeName = () => ({review:"Review",cloze:"Fill the gap",listening:"Listening"}[mode]);
  function filtered() {
    const query = search.trim().toLowerCase();
    return items.filter(item => (!kind || item.kind === kind) && (!strength || item.strength === strength) && (!query || [item.japanese,item.kana,item.romaji,item.english,german[item.japanese]].join(" ").toLowerCase().includes(query)));
  }
  function header() {
    return `<header class="app-header"><div class="brand"><img src="/extension/icons/icon128.png" alt="" width="43" height="43"><div><p class="eyebrow">iKnow! Reading Helper</p><h1>Your study space</h1></div></div><div class="app-actions"><select aria-label="Meaning language" id="demo-language"><option value="en"${language === "en" ? " selected" : ""}>English</option><option value="de"${language === "de" ? " selected" : ""}>German</option><option value="both"${language === "both" ? " selected" : ""}>Both</option></select><button class="quiet backup-button" data-action="backup">${icon("backup")}Backup</button><a href="https://iknow.jp/courses/19053" target="_blank" rel="noopener noreferrer">Open course</a><label class="theme-field">${icon("moon")}<select id="demo-theme" aria-label="Theme"><option value="paper">Original</option><option value="midnight">Midnight</option><option value="tokyo">Tokyo Neon</option><option value="forest">Kyoto Forest</option></select></label></div></header>`;
  }
  function tabs() {
    return `<div class="tabs" role="group" aria-label="Study activity">${[["study","Study"],["practice","Practice"],["test","Course test"]].map(([id,label])=>`<button type="button" data-view="${id}" aria-pressed="${view===id}">${label}</button>`).join("")}</div>`;
  }
  function filterFields(collection = false) {
    return `<input type="search" id="demo-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(search)}" autocomplete="off"><${collection ? "div" : "div"} class="${collection ? "sr-only" : "library-filters"}">${!collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>` : ""}${!collection ? kindSelect() : ""}</div>${collection ? `<select id="demo-course" aria-label="Course"><option>All courses</option><option>Core 2000 · Step 1</option></select>${kindSelect()}<select id="demo-strength" aria-label="Learning strength"><option value="">All strengths</option>${["new","weak","learning","strong"].map(s=>`<option value="${s}"${strength===s?" selected":""}>${strengthLabel(s)}</option>`).join("")}</select>` : ""}`;
  }
  function kindSelect() {
    return `<select id="demo-kind" aria-label="Item type"><option value="">All items</option><option value="word"${kind==="word"?" selected":""}>Words</option><option value="sentence"${kind==="sentence"?" selected":""}>Sentences</option></select>`;
  }
  function row(item, checkboxes = false, pickerRow = false) {
    const checked = selected.has(item.key);
    return `<button class="library-row" type="button" data-item="${escape(item.key)}"${pickerRow ? ' data-picker-row="true"' : ""} aria-current="${!checkboxes && current===item.key}">${checkboxes ? `<input type="checkbox" aria-label="Select ${escape(item.japanese)}" tabindex="-1"${checked?" checked":""}>` : ""}<span class="item-main"><span class="jp" lang="ja">${escape(item.japanese)}</span><span class="en">${escape(meaning(item))}</span><span class="strength" data-strength="${item.strength}">${strengthLabel(item.strength)}</span></span></button>`;
  }
  function libraryPane() {
    return `<aside class="library-pane" aria-label="Saved for later"><div class="library-heading"><h2>Saved for later <span>${items.length}</span></h2><button class="quiet" data-action="delete-all">Delete all</button></div><div class="library-search">${filterFields()}</div><div class="library-list" id="demo-library-list">${filtered().map(item=>row(item)).join("")}</div><div class="library-bottom">${items.length} saved items</div></aside>`;
  }
  function reading(item) {
    return `<div class="detail-reading"><div class="row-label"><span>Reading</span><button type="button" class="quiet" data-action="reveal-reading">${revealed ? "Hide Romaji" : "Reveal Romaji"}</button></div><div class="romaji">${item.romaji.split(/\s+/).filter(Boolean).map(word=>`<button type="button" data-reading="${escape(word)}" class="${revealed?"revealed":""}">${revealed?escape(word):"•••"}</button>`).join("")}</div></div>`;
  }
  function meanings(item, focus = false) {
    const english = `<p lang="en">${escape(item.english)}</p>`;
    const deutsch = `<p lang="de">${escape(german[item.japanese] || item.german || "German not prepared in this demo.")}</p>`;
    return `<${focus ? "div" : "details"} class="meaning"${focus ? "" : " open"}>${focus ? "" : `<summary>${icon("chevron")}Meaning</summary>`}${language==="de" ? deutsch : language==="both" ? english+deutsch : english}</${focus ? "div" : "details"}>`;
  }
  function detail(focus = false) {
    const item = getItem(current);
    if (!item) return "";
    if(focus) return `<article class="focus-card"><p class="eyebrow">${subtitle(item)} · Core 2000 · Step 1</p><h2 class="japanese" lang="ja">${escape(item.japanese)}</h2><p class="kana" lang="ja">${escape(item.kana)}</p>${reading(item)}${meanings(item,true)}<div class="practice-tools"><button data-action="play" class="audio-mini">${icon("listen")}Listen to original</button><button data-action="compare" class="quiet">Listen & compare</button></div></article>`;
    return `<article class="detail"><div class="detail-inner"><div class="detail-top"><p class="eyebrow">${subtitle(item)} · Core 2000 · Step 1</p><button class="quiet delete-item" data-action="delete">${icon("trash")}Delete</button></div><h2 class="japanese" lang="ja">${escape(item.japanese)}</h2><p class="kana" lang="ja">${escape(item.kana)}</p>${reading(item)}${meanings(item)}<div class="practice-tools"><button class="primary" data-action="practise-item">Practise this ${item.kind}</button><button class="quiet" data-action="play">${icon("listen")}Listen to original</button></div><div class="detail-note"><label for="demo-note">A note to yourself</label><textarea id="demo-note" rows="2" placeholder="A reminder, an example, or a way to remember it."></textarea></div><div class="detail-footer"><span>${items.findIndex(i=>i.key===current)+1} of ${items.length} saved items</span><button class="quiet" data-action="next">Next item</button></div></div></article>`;
  }
  function activity(test = false, modal = false) {
    const count = selected.size;
    const heading=`<div class="activity-heading"><div><p class="eyebrow">${test ? "Check your progress" : "Your pace"}</p><h2>${test ? "Course test" : "Practice"}</h2></div>${modal ? close : `<small>${count} selected</small>`}</div>`;
    const modes=`<div class="mode-grid" role="group" aria-label="Practice mode">${[["review","book","Review","Find the meaning."],["cloze","gap","Fill the gap","Complete the sentence."],["listening","listen","Listening","Listen, then write."]].map(([id,graphic,label,description])=>`<button class="mode-card" data-mode="${id}" aria-pressed="${mode===id}">${icon(graphic)}<span>${label}</span><small>${description}</small></button>`).join("")}</div>`;
    const options=`<div class="setup-fields"><label>Attempts<select id="demo-attempts"><option value="retry">Retry allowed</option><option value="single">One attempt</option></select></label>${mode==="cloze" ? `<label>Gap position<select id="demo-gap-position"><option value="random">Random word</option><option value="first">First word</option></select></label>` : ""}</div>`;
    const selection=`<div class="activity-selection"><div><p>${count ? `${count} item${count===1?"":"s"} selected` : "Choose what you want to practise"}</p><small>${[...selected].map(key=>getItem(key)).filter(Boolean).filter(i=>i.kind==="word").length} words · ${[...selected].map(key=>getItem(key)).filter(Boolean).filter(i=>i.kind==="sentence").length} sentences</small></div><button data-action="choose">Choose items</button></div>`;
    const course=`<div class="setup-course"><h3>Japanese Core 2000 · Step 1</h3><p class="small">Vocabulary and sentences from this demo course.</p><div class="setup-fields"><label>Course<select><option>Core 2000 · Step 1</option></select></label><label>Content<select id="demo-test-content"><option value="word">Vocabulary</option><option value="sentence">Sentences</option><option value="both">Vocabulary & sentences</option></select></label></div></div>`;
    return `<section class="activity-pane"><div class="activity-inner">${heading}${test?course:modes+options+selection}<div class="setup-start"><button class="primary" data-action="start"${!test&&!count?" disabled":""}>${test ? "Start test" : "Start session"}</button></div></div></section>`;
  }
  function workspaceA() {
    return `<div class="app-frame"><div class="frame-toolbar">${tabs()}<div class="spacer"></div><span class="counter">${items.length} saved items</span><button class="quiet delete-all" data-action="delete-all">Delete all</button></div>${libraryPane()}${view==="study"?detail():activity(view==="test")}${overlays()}</div>`;
  }
  function workspaceB() {
    return `<div class="app-frame"><div class="frame-toolbar"><h2>Saved for later</h2><span class="counter">${items.length}</span><div class="spacer"></div><button class="quiet" data-action="collection-select">${selectionMode?"Done selecting":"Select items"}</button><button data-action="test-modal">Course test</button><button class="primary" data-action="practice-modal">Practice</button></div><div class="collection-filters">${filterFields(true)}</div><div class="collection-body"><div class="collection-grid" id="demo-library-list">${filtered().map(item=>row(item,selectionMode)).join("")}</div></div><div class="collection-footer"><span id="collection-count">${selectionMode?`${selected.size} selected`:`${filtered().length} items`}</span><button class="quiet" data-action="delete-all">Delete all</button>${selectionMode ? `<button class="primary" data-action="practice-modal"${!selected.size?" disabled":""}>Practise selected</button>` : `<span>Core 2000 · Step 1</span>`}</div>${drawer?`<aside class="drawer" aria-label="Item details"><div class="drawer-head"><span>Item details</span><button class="close-button quiet" data-action="close-drawer" aria-label="Close item details">${icon("close")}</button></div>${detail()}</aside>`:""}${overlays()}</div>`;
  }
  function workspaceC() {
    return `<div class="app-frame"><nav class="focus-rail" aria-label="Study activity">${[["study","book","Study"],["practice","listen","Practice"],["test","test","Test"]].map(([id,graphic,label])=>`<button data-view="${id}" aria-pressed="${view===id}">${icon(graphic)}${label}</button>`).join("")}<button data-action="browse">${icon("library")}Library</button></nav><section class="focus-desk">${view==="study"?`<div class="focus-top"><span>${items.findIndex(i=>i.key===current)+1} of ${items.length} saved items</span><button class="quiet" data-action="browse">Choose an item</button></div><div class="focus-main">${detail(true)}</div><div class="focus-bottom"><small>${icon("note")}Your own library</small><div class="secondary-actions"><button class="quiet" data-action="note">Add a note</button><button data-action="next">Next item</button><button class="primary" data-action="practise-item">Practise this item</button></div></div>`:activity(view==="test")}</section>${overlays()}</div>`;
  }
  function pickerMarkup() {
    const query=pickerSearch.trim().toLowerCase();
    const list=items.filter(item=>!query||[item.japanese,item.romaji,item.english,german[item.japanese]].join(" ").toLowerCase().includes(query));
    return `<div class="overlay"><section class="picker-modal" role="dialog" aria-modal="true" aria-labelledby="picker-title"><div class="modal-head"><h2 id="picker-title">${pickerPurpose==="browse"?"Your library":"Choose items"}</h2>${close}</div><div class="picker-search"><input type="search" id="picker-search" placeholder="Find a word or sentence" aria-label="Find a word or sentence" value="${escape(pickerSearch)}"></div><div class="picker-actions"><span>${list.length} items</span>${pickerPurpose==="browse"?"":`<div><button class="quiet" data-action="select-all">Select all</button><button class="quiet" data-action="clear-selection">Clear</button></div>`}</div><div class="picker-list" id="picker-list">${list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No items found.</p>'}</div><div class="picker-bottom"><span id="picker-count">${pickerPurpose==="browse"?`${items.length} saved items`:`${selected.size} selected`}</span><button class="primary" data-action="close-picker">${pickerPurpose==="browse"?"Done":"Use selection"}</button></div></section></div>`;
  }
  function sessionMarkup() {
    if(!session)return "";
    const item=getItem(session.keys[session.index]),exercise=session.exercises[session.index];
    const prompt=mode==="cloze"?exercise.before+" _____ "+exercise.after:item.japanese;
    const solution=mode==="cloze"?exercise.answerJapanese:item.japanese,romaji=mode==="cloze"?exercise.answerRomaji:item.romaji;
    return `<section class="session-screen" aria-label="Practice session"><div class="session-top"><p class="eyebrow">${session.test?"Course test · ":""}${modeName()}</p><button data-action="end-session">End session</button></div><div class="session-progress"><span>${session.index+1} of ${session.keys.length}</span><progress max="${session.keys.length}" value="${session.index}"></progress></div><div class="session-content">${mode==="listening"?player():`<p class="session-word" lang="ja">${escape(prompt)}</p>`}${mode==="review"?`<div class="session-review"><p class="small">Choose the meaning</p>${exercise.choices.map(option=>`<button data-review="${escape(option.id)}">${escape(option.label)}</button>`).join("")}</div>`:`<form id="demo-answer" class="answer-form"><label for="listening-answer">${mode==="listening"?"Your answer":"Missing word"}</label><div class="answer-row"><input type="text" id="listening-answer" placeholder="Japanese / Kana / Romaji" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="primary" type="submit">Check answer</button></div><p id="demo-feedback" class="feedback" role="status"></p><button class="quiet reveal-demo" type="button" data-action="show-answer">Show answer</button></form>`}<div class="session-solution" id="demo-solution" hidden><p class="japanese" lang="ja">${escape(solution)}</p><p class="kana">${escape(romaji)}</p>${mode==="cloze"?`<p class="kana" lang="ja">${escape(exercise.details.japanese)}</p>`:""}<p class="solution-meaning">${escape(meaning(item))}</p><div class="session-next"><button class="primary" data-action="next-question">${session.index+1===session.keys.length?"Finish":"Next item"}</button></div></div></div></section>`;
  }
  function player() {
    return `<div class="audio-player" id="demo-player" data-playing="false"><div class="audio-top"><button class="play-circle" data-action="play-session" aria-label="Play audio">${icon("play")}</button><span id="demo-play-label">Play audio</span><span class="waveform" aria-hidden="true">${[13,26,38,20,33,40,24,36,18,31,39,23,16].map((height,i)=>`<i style="--h:${height}px;--d:${i*.05}s"></i>`).join("")}</span></div><div class="audio-meta"><progress id="demo-audio-progress" max="1" value="0"></progress><span id="demo-audio-time">0:00</span></div></div>`;
  }
  function overlays() {
    return `${setupModal?`<div class="overlay setup-overlay">${activity(view==="test",true)}</div>`:""}${picker?pickerMarkup():""}${session?sessionMarkup():""}`;
  }
  function render() {
    stopAudio();
    const scroll=$("demo-library-list")?.scrollTop||0;
    $("demo").dataset.layout=version;
    $("demo").innerHTML=header()+({a:workspaceA,b:workspaceB,c:workspaceC}[version])();
    $("demo-theme").value=document.documentElement.dataset.ikrTheme;
    $("demo-library-list")?.scrollTo(0,scroll);
    document.querySelectorAll("[data-version]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.version===version)));
    $("layout-description").textContent=explanations[version];
  }
  function updateLists() {
    $("demo-library-list").innerHTML=filtered().map(item=>row(item,version==="b"&&selectionMode)).join("")||'<p class="no-results">No items found.</p>';
    if($("collection-count"))$("collection-count").textContent=selectionMode?`${selected.size} selected`:`${filtered().length} items`;
  }
  function toast(message) {
    document.querySelector(".toast")?.remove();clearTimeout(toastTimer);
    const node=document.createElement("p");node.className="toast";node.textContent=message;node.setAttribute("role","status");document.querySelector(".app-frame").append(node);
    toastTimer=setTimeout(()=>node.remove(),2600);
  }
  function stopAudio() {if(audio){audio.pause();audio.src="";audio=null;}}
  function play(record, withPlayer = false) {
    if(audio){stopAudio();if($("demo-player"))$("demo-player").dataset.playing="false";if($("demo-play-label"))$("demo-play-label").textContent="Play audio";return;}
    if(!record.audioUrl){toast("This demo item has no recording.");return;}
    const active=new Audio(record.audioUrl);audio=active;active.preload="none";
    const reset=()=>{if(audio===active)audio=null;if($("demo-player"))$("demo-player").dataset.playing="false";if($("demo-play-label"))$("demo-play-label").textContent="Play again";};
    if(withPlayer){$("demo-player").dataset.playing="true";$("demo-play-label").textContent="Playing";active.addEventListener("timeupdate",()=>{if($("demo-audio-progress"))$("demo-audio-progress").value=active.duration?active.currentTime/active.duration:0;if($("demo-audio-time"))$("demo-audio-time").textContent=`0:${String(Math.floor(active.currentTime)).padStart(2,"0")}`;});}
    active.addEventListener("ended",reset);active.play().catch(()=>{reset();toast("Could not play the recording. Try again.");});
  }
  function openPicker(purpose) {picker=true;pickerPurpose=purpose;pickerSearch="";render();$("picker-search").focus({preventScroll:true});}
  function showSolution() {$("demo-solution").hidden=false;document.querySelectorAll('#demo-answer input,#demo-answer button,.session-review button').forEach(control=>{control.disabled=true;});}
  function exerciseFor(record) {
    if(mode==="cloze")return Practice.buildCloze(record,{gapPosition:$("demo-gap-position")?.value||"random",romajiStyle:"source"});
    if(mode==="listening")return Practice.buildListening(record,{romajiStyle:"source"});
    const prepared=items.map(item=>({...item,german:german[item.japanese]||item.german}));
    return Practice.buildReviewQuestion(prepared.find(item=>item.key===record.key),prepared,{language:language==="de"?"de":"en"});
  }
  document.addEventListener("click",event=>{
    const versionButton=event.target.closest("[data-version]");
    if(versionButton){version=versionButton.dataset.version;view="study";setupModal=false;picker=false;session=null;drawer=false;selectionMode=false;revealed=false;render();try{localStorage.setItem("ikr-layout-review:version",version);}catch{}return;}
    const button=event.target.closest("button");if(!button||button.disabled)return;
    if(button.dataset.view){view=button.dataset.view;drawer=false;render();return;}
    if(button.dataset.mode){mode=button.dataset.mode;render();return;}
    if(button.dataset.reading){button.textContent=button.classList.toggle("revealed")?button.dataset.reading:"•••";return;}
    if(button.dataset.item){const key=button.dataset.item;if(button.dataset.pickerRow){if(pickerPurpose==="browse"){current=key;picker=false;view="study";revealed=false;render();return;}selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("picker-count").textContent=`${selected.size} selected`;return;}if(version==="b"&&selectionMode){selected.has(key)?selected.delete(key):selected.add(key);button.querySelector("input").checked=selected.has(key);$("collection-count").textContent=`${selected.size} selected`;const practise=document.querySelector(".collection-footer .primary");if(practise)practise.disabled=!selected.size;return;}current=key;view="study";revealed=false;if(version==="b")drawer=true;render();return;}
    if(button.dataset.review){const exercise=session.exercises[session.index];if(button.dataset.review===exercise.correctId)showSolution();else{button.style.borderColor="var(--ikr-danger)";button.setAttribute("aria-label",button.textContent+", incorrect");if(session.attempts==="single")showSolution();}return;}
    switch(button.dataset.action){
      case "choose":openPicker("practice");break;
      case "browse":openPicker("browse");break;
      case "close-overlay":picker=false;setupModal=false;render();break;
      case "close-picker":picker=false;render();break;
      case "select-all":items.forEach(item=>selected.add(item.key));render();break;
      case "clear-selection":selected.clear();render();break;
      case "collection-select":selectionMode=!selectionMode;drawer=false;render();break;
      case "close-drawer":drawer=false;render();break;
      case "practice-modal":view="practice";setupModal=true;drawer=false;render();break;
      case "test-modal":view="test";setupModal=true;drawer=false;render();break;
      case "reveal-reading":revealed=!revealed;render();break;
      case "play":play(getItem(current));break;
      case "play-session":play(getItem(session.keys[session.index]),true);break;
      case "practise-item":selected.clear();selected.add(current);view="practice";if(version==="b")setupModal=true;drawer=false;render();break;
      case "next":current=items[(items.findIndex(i=>i.key===current)+1)%items.length].key;revealed=false;render();break;
      case "start":{const test=view==="test",content=$("demo-test-content")?.value||"word";const keys=test?items.filter(item=>content==="both"||item.kind===content).map(item=>item.key):[...selected];if(!keys.length)return;if(test)mode="review";const exercises=keys.map(key=>exerciseFor(getItem(key)));if(exercises.some(exercise=>!exercise)){toast("Some selected items are unavailable for this activity. Choose different items.");return;}session={keys,index:0,test,exercises,attempts:test?"single":$("demo-attempts")?.value||"retry"};setupModal=false;picker=false;render();break;}
      case "end-session":session=null;render();break;
      case "show-answer":showSolution();break;
      case "next-question":if(session.index+1>=session.keys.length){session=null;render();toast("Demo session complete.");}else{session.index++;render();}break;
      case "delete":case "delete-all":toast("Delete controls are shown for layout review. Demo items are kept.");break;
      case "backup":toast("This preview does not change your backup or library.");break;
      case "note":toast("Your notes would open here.");break;
      case "compare":toast("Recording is available on the current study page.");break;
    }
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="demo-theme"){document.documentElement.dataset.ikrTheme=event.target.value;try{localStorage.setItem("ikr-layout-review:theme",event.target.value);}catch{}event.target.blur();return;}
    if(event.target.id==="demo-language"){language=event.target.value;render();return;}
    if(event.target.id==="demo-kind"){kind=event.target.value;updateLists();}
    if(event.target.id==="demo-strength"){strength=event.target.value;updateLists();}
  });
  document.addEventListener("input",event=>{
    if(event.target.id==="demo-search"){search=event.target.value;updateLists();}
    if(event.target.id==="picker-search"){pickerSearch=event.target.value;const query=pickerSearch.toLowerCase();const list=items.filter(item=>[item.japanese,item.romaji,item.english,german[item.japanese]].join(" ").toLowerCase().includes(query));$("picker-list").innerHTML=list.map(item=>row(item,pickerPurpose!=="browse",true)).join("")||'<p class="no-results">No items found.</p>';}
  });
  document.addEventListener("submit",event=>{
    if(event.target.id!=="demo-answer")return;event.preventDefault();
    const exercise=session.exercises[session.index],answer=$("listening-answer").value;
    const correct=mode==="cloze"?Practice.checkAnswer(exercise,answer):Practice.checkListening(exercise,answer);
    $("demo-feedback").textContent=correct?"Correct":"Incorrect";$("demo-feedback").dataset.correct=String(correct);if(correct||session.attempts==="single")showSolution();
  });
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&(picker||setupModal||drawer)){picker=false;setupModal=false;drawer=false;render();}});
  async function init(){
    try{const saved=localStorage.getItem("ikr-layout-review:theme");if(["paper","midnight","tokyo","forest"].includes(saved))document.documentElement.dataset.ikrTheme=saved;const layout=new URLSearchParams(location.search).get("layout")||localStorage.getItem("ikr-layout-review:version");if(["a","b","c"].includes(layout))version=layout;}catch{}
    try{const response=await fetch("/library.json");if(!response.ok)throw Error("Library unavailable");const library=await response.json();items=Object.values(library.records).slice(0,18).map((item,index)=>({...item,strength:["new","learning","strong","new","weak","learning"][index%6]}));current=items[0].key;items.slice(0,4).forEach(item=>selected.add(item.key));render();}catch(error){$("demo").innerHTML='<p class="no-results">The demo library could not be loaded. Refresh to try again.</p>';console.error(error);}
  }
  init();
})();
