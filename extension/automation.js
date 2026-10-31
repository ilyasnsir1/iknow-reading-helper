/* Non-blocking, local-only preparation UI for course pages. */
(() => {
  "use strict";
  const Core = globalThis.IKnowReaderCore;
  if (!Core || !globalThis.chrome?.runtime) return;
  const titles = {
    model: "Starting local preparation",
    language: "Preparing German and meaning groups",
    translation: "Preparing German and meaning groups",
    translate: "Preparing German and meaning groups",
    groups: "Matching meaning groups",
    audio: "Matching words to audio",
    align: "Matching words to audio",
    done: "Preparation saved"
  };
  const stageIndex = stage => ({ model: 0, language: 1, translation: 1, translate: 1, groups: 1, audio: 2, align: 2, done: 3 }[stage] ?? 0);
  const processingStage = stage => ["language", "translation", "translate", "groups"].includes(stage) ? "language" :
    ["audio", "align"].includes(stage) ? "audio" : null;
  function preparationSteps(features) {
    const steps = [];
    if (features.german || features.colors) steps.push({ key: "language", label: features.german && features.colors ? "German & colors" : features.german ? "German" : "Meaning colors" });
    if (features.audio) steps.push({ key: "audio", label: "Audio timings" });
    return steps;
  }
  const selected = features => Object.values(Core.normalizeFeatures(features)).some(Boolean);
  const hasMissing = (summary, features) => ((features.german && (summary?.translationExcluded > 0 || summary?.wordExcluded > 0)) || (features.colors && summary?.groupsExcluded > 0) || (features.audio && summary?.audioExcluded > 0));
  // Atlas switches must not expose an image's first network/decode frame. Keep
  // the decoded image alive and reuse one promise per resource on this page.
  const sceneImages = new Map();
  const sceneAssets = ["reading-fox-v1.png", "reading-fox-motion-v1.png", "reading-fox-actions-v1.png", "reading-fox-breeze-v1.png", "reading-fox-walk-v3.png", "reading-fox-stand-v1.png", "reading-fox-near-arm-v1.png"];
  function warmSceneImage(url) {
    if (sceneImages.has(url)) return sceneImages.get(url).ready;
    const image = new Image();
    let resolve;
    const entry = { image, ready: new Promise(done => { resolve = done; }) };
    sceneImages.set(url, entry);
    let finished = false;
    const settle = ok => {
      if (finished) return;
      finished = true; clearTimeout(timeout); image.onload = image.onerror = null;
      resolve(ok);
    };
    const timeout = setTimeout(() => settle(false), 8000);
    image.onload = () => {
      if (typeof image.decode !== "function") { settle(true); return; }
      void image.decode().then(() => settle(true), () => settle(image.complete && image.naturalWidth > 0));
    };
    image.onerror = () => settle(false);
    image.src = url;
    return entry.ready;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  // The selected vector is embedded so its first paint needs no asset fetch.
  // Prefix every definition for independent controllers and host-page SVGs.
  const templeMarkup = "<svg class=\"ikr-preparation-temple\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"12 12 216 216\" shape-rendering=\"geometricPrecision\">\n<defs>\n <linearGradient id=\"roof\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop stop-color=\"#304d59\"/><stop offset=\".5\" stop-color=\"#1c3543\"/><stop offset=\"1\" stop-color=\"#102735\"/></linearGradient>\n <linearGradient id=\"wood\" x1=\"0\" x2=\"1\"><stop stop-color=\"#863d2f\"/><stop offset=\".42\" stop-color=\"#b3654b\"/><stop offset=\"1\" stop-color=\"#974b37\"/></linearGradient>\n <linearGradient id=\"paper\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#faf1d8\"/><stop offset=\"1\" stop-color=\"#dbcaac\"/></linearGradient>\n <linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop stop-color=\"#d5cfc1\"/><stop offset=\"1\" stop-color=\"#b8b4aa\"/></linearGradient>\n <radialGradient id=\"light\"><stop stop-color=\"#ffeab0\"/><stop offset=\"1\" stop-color=\"#e2ad59\"/></radialGradient>\n <clipPath id=\"doorway\"><path d=\"M65 137H175V194H65Z\"/></clipPath>\n <linearGradient id=\"courtyard-light\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop stop-color=\"#e5b269\" stop-opacity=\".8\"/><stop offset=\"1\" stop-color=\"#e5b269\" stop-opacity=\"0\"/></linearGradient>\n</defs>\n<ellipse cx=\"120\" cy=\"221\" rx=\"94\" ry=\"5\" fill=\"#162d3d\" opacity=\".09\"/>\n<path d=\"M42 204H198L213 217H27Z\" fill=\"url(#stone)\" stroke=\"#30414a\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/>\n<path d=\"M33 212H207M54 205L50 211M187 205L191 211M90 212V217M150 212V217\" fill=\"none\" stroke=\"#a19f98\" stroke-width=\"1.4\"/>\n<path d=\"M47 197H193V205H47Z\" fill=\"#19313f\"/><path d=\"M47 197H193V200H47Z\" fill=\"#b49661\"/>\n<path d=\"M58 130H182V197H58Z\" fill=\"#634533\"/>\n<path d=\"M65 137H175V194H65Z\" fill=\"url(#paper)\"/>\n<path d=\"M103 140H137V195H103Z\" fill=\"#243943\"/>\n<path class=\"ikr-pavilion-temple-light\" d=\"M97 138H143V195H97Z\" fill=\"url(#light)\" opacity=\".3\"/>\n<path class=\"ikr-pavilion-pavilion-courtyard-light\" d=\"M101 193H139L159 217H81Z\" fill=\"url(#courtyard-light)\" opacity=\"0\"/>\n<path d=\"M109 146H113V190H109ZM127 146H131V190H127Z\" fill=\"#b2864d\" opacity=\".4\"/>\n<g clip-path=\"url(#doorway)\">\n<g class=\"ikr-pavilion-door-left\"><path d=\"M65 137H120V194H65Z\" fill=\"url(#paper)\" stroke=\"#735a3f\" stroke-width=\"1.8\"/><path d=\"M73 139V192M82 139V192M91 139V192M100 139V192M109 139V192M66 150H119M66 163H119M66 176H119M66 189H119\" fill=\"none\" stroke=\"#90754e\" stroke-width=\"1.4\"/><path d=\"M116 158V170\" stroke=\"#675843\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></g>\n<g class=\"ikr-pavilion-door-right\"><path d=\"M120 137H175V194H120Z\" fill=\"url(#paper)\" stroke=\"#735a3f\" stroke-width=\"1.8\"/><path d=\"M129 139V192M138 139V192M147 139V192M156 139V192M165 139V192M121 150H174M121 163H174M121 176H174M121 189H174\" fill=\"none\" stroke=\"#90754e\" stroke-width=\"1.4\"/><path d=\"M124 158V170\" stroke=\"#675843\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></g>\n</g>\n<path d=\"M51 128H63V198H51ZM177 128H189V198H177Z\" fill=\"url(#wood)\" stroke=\"#633c32\" stroke-width=\"1.7\"/>\n<path d=\"M53 133H56V194H53ZM179 133H182V194H179Z\" fill=\"#d38a61\" opacity=\".5\"/>\n<path d=\"M48 192H66V198H48ZM174 192H192V198H174Z\" fill=\"#273d44\"/><path d=\"M48 130H192V138H48Z\" fill=\"#754437\"/><path d=\"M48 130H192V133H48Z\" fill=\"#d6b778\"/>\n<path d=\"M72 83H168V111H72Z\" fill=\"url(#wood)\" stroke=\"#263b43\" stroke-width=\"1.8\"/>\n<path d=\"M84 86H156V108H84Z\" fill=\"#493f32\"/>\n<path d=\"M89 89H151V105H89Z\" fill=\"url(#paper)\"/>\n<path d=\"M97 89V105M108 89V105M120 89V105M132 89V105M143 89V105\" stroke=\"#8f744f\" stroke-width=\"1.5\"/>\n<path d=\"M62 105H178V115H62Z\" fill=\"#8d4c39\"/><path d=\"M67 112V122M78 112V123M162 112V123M173 112V122\" stroke=\"#bb8052\" stroke-width=\"4\"/>\n<path d=\"M18 112Q40 118 64 109Q88 100 120 80Q152 100 176 109Q200 118 222 112L216 126Q193 137 169 128L120 104L71 128Q47 137 24 126Z\" fill=\"#142b38\" stroke=\"#112634\" stroke-width=\"1.9\" stroke-linejoin=\"round\"/>\n<path d=\"M18 112Q44 120 68 108L120 80L172 108Q196 120 222 112Q208 129 183 122L120 98L57 122Q32 129 18 112Z\" fill=\"url(#roof)\"/>\n<path d=\"M19 113Q43 124 69 113L120 88L171 113Q197 124 221 113\" fill=\"none\" stroke=\"#b79a62\" stroke-width=\"1.9\"/>\n<path d=\"M44 119L78 110M60 121L91 107M77 119L105 103M135 103L163 119M149 107L180 121M162 110L196 119\" stroke=\"#607b85\" stroke-width=\"1.4\" opacity=\".8\"/>\n<path d=\"M27 128Q48 136 69 128L120 104L171 128Q192 136 213 128\" fill=\"none\" stroke=\"#ad7248\" stroke-width=\"2.2\"/>\n<path d=\"M42 63Q63 72 87 57L120 35L153 57Q177 72 198 63L190 79Q170 90 148 78L120 60L92 78Q70 90 50 79Z\" fill=\"#132b39\" stroke=\"#112634\" stroke-width=\"1.9\" stroke-linejoin=\"round\"/>\n<path d=\"M42 63Q66 74 88 58L120 35L152 58Q174 74 198 63Q181 82 159 70L120 48L81 70Q59 82 42 63Z\" fill=\"url(#roof)\"/>\n<path d=\"M43 64Q65 79 89 64L120 43L151 64Q175 79 197 64\" fill=\"none\" stroke=\"#b79a62\" stroke-width=\"1.9\"/>\n<path d=\"M67 73L90 64M81 72L103 59M137 59L159 72M150 64L173 73\" fill=\"none\" stroke=\"#607b85\" stroke-width=\"1.4\" opacity=\".8\"/>\n<path d=\"M119 24V37M113 29H127\" stroke=\"#213947\" stroke-width=\"2.2\" stroke-linecap=\"round\"/><circle cx=\"120\" cy=\"22\" r=\"3\" fill=\"#b49661\" stroke=\"#263d47\" stroke-width=\"1.4\"/>\n<g class=\"ikr-pavilion-temple-bell\"><path d=\"M198 129V137\" stroke=\"#7d6849\" stroke-width=\"1.9\"/><path d=\"M193 143Q193 136 198 136Q203 136 203 143L205 146H191Z\" fill=\"#b6975c\" stroke=\"#4d4939\" stroke-width=\"1.4\"/><path d=\"M198 147V152\" stroke=\"#756143\" stroke-width=\"1.8\"/><path d=\"M195 151L201 153L200 166L195 163Z\" fill=\"#b35d43\"/></g>\n<g class=\"ikr-pavilion-pavilion-lantern\"><path d=\"M40 130V139\" stroke=\"#6c5840\" stroke-width=\"1.8\"/><path d=\"M34 139Q40 136 46 139L45 142H35Z\" fill=\"#223b45\"/><path d=\"M35 142Q29 151 35 161Q40 164 45 161Q51 151 45 142Z\" fill=\"#b35d43\" stroke=\"#653e30\" stroke-width=\"1.4\"/><path class=\"ikr-pavilion-pavilion-lantern-light\" d=\"M36 144Q33 151 36 159Q40 161 44 159Q47 151 44 144Z\" fill=\"#ffd78d\" opacity=\".25\"/><path d=\"M32 148H48M32 154H48\" stroke=\"#8b4936\" stroke-width=\"1.3\"/><path d=\"M35 161H45V164H35Z\" fill=\"#263b43\"/><path d=\"M40 164V170\" stroke=\"#b49661\" stroke-width=\"1.8\"/></g>\n<g class=\"ikr-pavilion-pavilion-leaf ikr-pavilion-pavilion-leaf-one\" opacity=\"0\"><path d=\"M0 0L3 -5L5 -1L10 -2L7 2L10 6L5 5L2 9L1 4L-3 3Z\" fill=\"#b76a41\"/><path d=\"M1 1L5 7\" stroke=\"#754c36\" stroke-width=\"1.3\"/></g>\n<g class=\"ikr-pavilion-pavilion-leaf ikr-pavilion-pavilion-leaf-two\" opacity=\"0\"><path d=\"M0 0Q5 -6 11 -3Q10 5 3 6Z\" fill=\"#c99d58\"/><path d=\"M1 3L9 -2\" stroke=\"#94733f\" stroke-width=\"1.3\"/></g>\n<g class=\"ikr-pavilion-pavilion-leaf ikr-pavilion-pavilion-leaf-three\" opacity=\"0\"><path d=\"M0 0L3 -5L5 -1L10 -2L7 2L10 6L5 5L2 9L1 4L-3 3Z\" fill=\"#a6533b\"/><path d=\"M1 1L5 7\" stroke=\"#754c36\" stroke-width=\"1.3\"/></g>\n</svg>";
  let templeInstance = 0;
  function createTemple() {
    const svg = document.importNode(new DOMParser().parseFromString(templeMarkup, "image/svg+xml").documentElement, true);
    const prefix = `ikr-pavilion-${++templeInstance}-`, definitions = new Map();
    for (const element of svg.querySelectorAll("[id]")) {
      const id = element.id; definitions.set(id, prefix + id); element.id = prefix + id;
    }
    for (const element of [svg, ...svg.querySelectorAll("*")]) for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(#([^)]+)\)/g, (match, id) => definitions.has(id) ? `url(#${definitions.get(id)})` : match);
      if (attribute.localName === "href" && value.startsWith("#") && definitions.has(value.slice(1))) value = "#" + definitions.get(value.slice(1));
      if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value);
    }
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    return svg;
  }
  function create({ anchor, onFeatureChange, onResumeSelection } = {}) {
    let options = { courseId: null, course: null, availability: null, enabled: true, complete: false, features: Core.normalizeFeatures({}) };
    let state = { status: "idle", stage: "model", completed: 0, total: 0 };
    let port = null, attempted = false, destroyed = false;
    let minimized = false, detailsOpen = false, lastSource = null, sourceKey = "";
    let featuresInitialized = false;
    const ViewState = globalThis.IKnowReaderViewState;
    let viewId = "", viewReady = !ViewState, viewGeneration = 0;
    let preparedDuringVisit = false, completion = null;
    let sceneReady = false, sceneWarming = false;
    let sceneFrame = 0, deferredRender = false, knownSceneAnimations = [];
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pausedSceneAnimations = new Set();
    const card = node("section", "ikr-owned ikr-preparation");
    card.dataset.sceneReady = "false";
    card.hidden = true; card.setAttribute("aria-label", "Course preparation");
    const art = node("div", "ikr-preparation-art"); art.setAttribute("aria-hidden", "true");
    art.append(createTemple());
    const scene = node("div", "ikr-saved-scene"); scene.setAttribute("role", "group"); scene.setAttribute("aria-label", "Reading fox");
    scene.style.setProperty("--ikr-fox-sprite", `url("${chrome.runtime.getURL("assets/reading-fox-v1.png")}")`);
    scene.style.setProperty("--ikr-fox-motion", `url("${chrome.runtime.getURL("assets/reading-fox-motion-v1.png")}")`);
    scene.style.setProperty("--ikr-fox-actions", `url("${chrome.runtime.getURL("assets/reading-fox-actions-v1.png")}")`);
    scene.style.setProperty("--ikr-fox-breeze", `url("${chrome.runtime.getURL("assets/reading-fox-breeze-v1.png")}")`);
    scene.style.setProperty("--ikr-fox-walk", `url("${chrome.runtime.getURL("assets/reading-fox-walk-v3.png")}")`);
    scene.style.setProperty("--ikr-fox-stand", `url("${chrome.runtime.getURL("assets/reading-fox-stand-v1.png")}")`);
    scene.append(node("span", "ikr-scene-ground"));
    const sceneCounts = new Map(), sceneProps = new Map();
    for (const [index, [key, label]] of [["german", "German"], ["colors", "Colors"], ["audio", "Audio"]].entries()) {
      const prop = node("span", `ikr-scene-prop ikr-scene-prop-${index}`), count = node("span", "ikr-scene-prop-count");
      prop.append(node("span", "ikr-scene-prop-label", label), count); scene.append(prop); sceneCounts.set(key, count); sceneProps.set(key, prop);
    }
    for (const [index, label] of ["German", "Meaning colors", "Audio timings"].entries()) {
      const option = node("span", `ikr-scene-prop ikr-scene-option ikr-scene-option-${index}`);
      option.append(node("span", "ikr-scene-option-box"), node("span", "", label)); scene.append(option); sceneProps.set(`option-${index}`, option);
    }
    const prepareProp = node("span", "ikr-scene-prop ikr-scene-prop-button", "Prepare selection"); scene.append(prepareProp); sceneProps.set("button", prepareProp);
    const windLayer = node("div", "ikr-wind-layer");
    const wind = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wind.setAttribute("class", "ikr-scene-wind"); wind.setAttribute("viewBox", "0 0 140 110"); wind.setAttribute("shape-rendering", "crispEdges");
    // Filled two/four-pixel steps, rather than smooth stroked curves.
    for (const d of [
      "M92 48H120V44H128V48H132V56H128V60H116V56H124V52H92Z",
      "M64 68H128V64H136V68H140V72H64Z M48 68H56V72H48Z",
      "M92 84H116V80H124V84H128V88H92Z M132 52H136V56H132Z M80 84H84V88H80Z"
    ]) {
      const line = document.createElementNS(wind.namespaceURI, "path"); line.setAttribute("d", d); wind.append(line);
    }
    const puff = document.createElementNS(wind.namespaceURI, "svg");
    puff.setAttribute("class", "ikr-mouth-puff"); puff.setAttribute("viewBox", "0 0 64 48"); puff.setAttribute("shape-rendering", "crispEdges");
    const puffBody = document.createElementNS(wind.namespaceURI, "path");
    puffBody.setAttribute("d", "M2 18H14V14H22V18H30V22H2Z M12 28H28V24H34V28H40V32H12Z M40 16H44V20H40Z"); puff.append(puffBody);
    windLayer.append(puff, wind); scene.append(windLayer);
    const actor = node("span", "ikr-scene-actor"), walk = node("span", "ikr-scene-walk"), reading = node("span", "ikr-scene-read");
    const nearArmMounted = globalThis.IKnowReaderNearArmArt?.mount(walk, {
      original: chrome.runtime.getURL("assets/reading-fox-walk-v3.png"),
      edited: chrome.runtime.getURL("assets/reading-fox-near-arm-v1.png")
    });
    if (!nearArmMounted) for (const index of [0, 1, 2, 3]) walk.append(node("span", `ikr-walk-frame ikr-walk-frame-${index}`));
    for (const pose of ["idle", "blink", "happy", "wave"]) {
      const image = node("span", `ikr-ready-pose ikr-ready-pose-${pose}`); image.setAttribute("aria-hidden", "true"); reading.append(image);
    }
    const foxInteract = node("button", "ikr-fox-interact"); foxInteract.type = "button";
    foxInteract.setAttribute("aria-label", "Say hello to the fox");
    const foxSpeech = node("span", "ikr-fox-speech");
    foxSpeech.hidden = true;
    foxSpeech.setAttribute("role", "status"); foxSpeech.setAttribute("aria-live", "polite"); foxSpeech.setAttribute("aria-atomic", "true");
    reading.append(foxInteract, foxSpeech);
    actor.append(walk);
    for (const pose of ["neutral", "inhale", "blow", "release"]) actor.append(node("span", `ikr-breeze-pose ikr-breeze-${pose}`));
    for (const pose of ["crouch", "air", "land", "ouch"]) actor.append(node("span", `ikr-action-pose ikr-action-${pose}`));
    for (const pose of ["fold", "rise"]) actor.append(node("span", `ikr-stand-pose ikr-stand-${pose}`));
    actor.append(reading, node("span", "ikr-scene-ouch-mark", "Ouch!"));
    scene.append(node("span", "ikr-scene-shadow"), node("span", "ikr-scene-landing-book"), actor, node("span", "ikr-scene-dust"), node("span", "ikr-static-fox"));
    const books = node("span", "ikr-scene-books"); for (let index = 0; index < 3; index++) books.append(node("span")); scene.append(books);
    // All scene art is decorative; only the seated fox button and its brief
    // response belong to the accessibility tree. The actual saved counts live
    // in the Details panel, independent of these animated duplicates.
    for (const child of scene.children) if (child !== actor) child.setAttribute("aria-hidden", "true");
    for (const child of actor.children) if (child !== reading) child.setAttribute("aria-hidden", "true");
    let foxReactionTimer = null, foxReactionIndex = 0;
    const foxReplies = ["Hi there!", "One more page!", "You've got this!"];
    function clearFoxReaction() {
      if (foxReactionTimer !== null) clearTimeout(foxReactionTimer);
      foxReactionTimer = null; delete reading.dataset.reaction; foxSpeech.textContent = ""; foxSpeech.hidden = true;
    }
    foxInteract.addEventListener("click", () => {
      if (destroyed || card.dataset.saved !== "true" || detailsOpen || minimized || !options.enabled || document.hidden) return;
      const style = getComputedStyle(reading);
      if (style.visibility === "hidden" || Number(style.opacity) < .5) return;
      clearFoxReaction();
      reading.dataset.reaction = "wave";
      foxSpeech.textContent = foxReplies[foxReactionIndex++ % foxReplies.length];
      foxSpeech.hidden = false;
      foxReactionTimer = setTimeout(clearFoxReaction, 1800);
    });
    foxInteract.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !reading.dataset.reaction) return;
      event.preventDefault(); event.stopPropagation(); clearFoxReaction();
    });
    const copy = node("div", "ikr-preparation-copy");
    const heading = node("h2", "ikr-preparation-title", titles.model);
    heading.setAttribute("aria-live", "polite");
    const phaseContext = node("p", "ikr-preparation-phase"); phaseContext.hidden = true;
    const detail = node("p", "ikr-preparation-detail"); detail.setAttribute("role", "status"); detail.setAttribute("aria-live", "polite");
    const progress = node("progress", "ikr-preparation-progress"); progress.setAttribute("aria-label", "Current step progress");
    const progressRow = node("div", "ikr-preparation-progress-row");
    const eta = node("span", "ikr-preparation-eta");
    // Keep this beside the bar, without a live countdown or a screen-reader
    // announcement on every sentence. The estimate measures this step only.
    progressRow.append(progress, eta);
    let progressEstimate = null;
    function estimateProgress(active, savedProgress) {
      const count = savedProgress?.ready, total = savedProgress?.total;
      const stage = processingStage(state.stage);
      const at = Date.now();
      if (!active || state.status !== "running" || !stage || !Number.isFinite(count) || !Number.isFinite(total) || total <= 0) {
        progressEstimate = null;
        return active && state.status === "running" ? "Time estimate starts with this step" : "";
      }
      const key = `${options.courseId}:${state.requestId || ""}:${stage}`;
      let sample = progressEstimate;
      if (!sample || sample.key !== key || sample.total !== total || count < sample.completed || at < sample.at) {
        sample = progressEstimate = { key, total, completed: count, at, units: 0, milliseconds: 0 };
      } else if (count > sample.completed) {
        const delta = count - sample.completed, duration = at - sample.at;
        // Checkpoint restores and near-instant cache jumps are not processing
        // speed samples. A pause, retry or stage switch starts a fresh sample.
        if (Number.isInteger(delta) && delta <= 4 && duration >= 150 && duration <= 300000) {
          sample.units += delta; sample.milliseconds += duration;
        } else { sample.units = 0; sample.milliseconds = 0; }
        sample.completed = count; sample.at = at;
      }
      if (count >= total) return "Finishing this step…";
      if (sample.units < 3 || sample.milliseconds < 1000) return "Estimating this step…";
      const seconds = Math.ceil((total - count) * sample.milliseconds / sample.units / 1000);
      const amount = seconds < 60 ? "less than a minute" : seconds < 3600 ? `${Math.ceil(seconds / 60)} min` :
        `${Math.floor(seconds / 3600)} hr ${Math.ceil(seconds % 3600 / 60)} min`;
      return `About ${amount} for this step`;
    }
    const steps = node("ol", "ikr-preparation-steps");
    for (const label of ["Start", "German & colors", "Audio"]) steps.append(node("li", "", label));
    const featureControls = node("div", "ikr-preparation-features");
    const featureInputs = new Map();
    for (const [feature, key, label] of [["german", "prepareGerman", "German"], ["colors", "prepareColors", "Meaning colors"], ["audio", "prepareAudio", "Audio timings"]]) {
      const wrapper = node("label", "ikr-feature-option"), input = node("input");
      input.type = "checkbox"; input.dataset.feature = feature;
      input.addEventListener("change", () => { onFeatureChange?.(key, input.checked); });
      wrapper.append(input, node("span", "", label)); featureControls.append(wrapper); featureInputs.set(feature, input);
    }
    const saved = node("div", "ikr-saved-modules"); saved.setAttribute("role", "group"); saved.setAttribute("aria-label", "Saved on this device");
    saved.id = `ikr-saved-details-${crypto.randomUUID()}`;
    const savedBadges = new Map();
    for (const [key, label] of [["german", "German"], ["colors", "Colors"], ["audio", "Audio"]]) {
      const badge = node("span", "ikr-saved-module"); badge.dataset.module = key;
      const name = node("span", "ikr-saved-module-name", label), value = node("span", "ikr-saved-module-value");
      badge.append(name, value);
      saved.append(badge); savedBadges.set(key, { badge, value, label });
    }
    copy.append(heading, phaseContext, detail, saved, featureControls, progressRow, steps);
    const actions = node("div", "ikr-preparation-actions");
    const cancel = node("button", "", "Pause"), retry = node("button", "", "Resume"), setup = node("button", "ikr-preparation-setup", "Set up");
    for (const button of [cancel, retry, setup]) button.type = "button";
    actions.append(cancel, retry, setup);
    const details = node("button", "ikr-scene-details", "Details"), replay = node("button", "ikr-scene-replay");
    details.type = replay.type = "button";
    details.setAttribute("aria-controls", saved.id); details.setAttribute("aria-expanded", "false");
    replay.setAttribute("aria-label", "Replay animation"); replay.title = "Replay animation";
    const replayIcon = document.createElementNS(wind.namespaceURI, "svg"); replayIcon.setAttribute("viewBox", "0 0 16 16"); replayIcon.setAttribute("aria-hidden", "true"); replayIcon.setAttribute("focusable", "false");
    const replayPath = document.createElementNS(wind.namespaceURI, "path"); replayPath.setAttribute("d", "M14 8a6 6 0 1 1-6-6c1.67 0 3.27.67 4.47 1.87L14 5.33M14 2v3.33h-3.33"); replayIcon.append(replayPath); replay.append(replayIcon);
    const queue = node("button", "ikr-preparation-queue", "Queue"); queue.type = "button"; actions.append(details, queue, replay);
    const minimize = node("button", "ikr-preparation-minimize"); minimize.type = "button";
    const chevron = document.createElementNS(wind.namespaceURI, "svg"); chevron.setAttribute("viewBox", "0 0 16 16"); chevron.setAttribute("aria-hidden", "true");
    const chevronPath = document.createElementNS(wind.namespaceURI, "path"); chevronPath.setAttribute("d", "m4 10 4-4 4 4"); chevron.append(chevronPath); minimize.append(chevron);
    minimize.setAttribute("aria-label", "Collapse progress"); minimize.setAttribute("aria-expanded", "true");
    const header = node("div", "ikr-preparation-header"), savedStatus = node("h2", "ikr-saved-status");
    const statusBook = document.createElementNS(wind.namespaceURI, "svg"); statusBook.setAttribute("viewBox", "0 0 20 20"); statusBook.setAttribute("aria-hidden", "true");
    for (const [d, className] of [["M10 5c-2-2-5-2-7-1v12c2-1 5-1 7 1 2-2 5-2 7-1V4c-2-1-5-1-7 1Zm0 0v12", ""], ["M14 4v5l1-1 1 1V4", "ikr-bookmark"]]) {
      const line = document.createElementNS(wind.namespaceURI, "path"); line.setAttribute("d", d); if (className) line.setAttribute("class", className); statusBook.append(line);
    }
    savedStatus.append(statusBook, node("span", "", "Saved"));
    header.append(savedStatus, actions, minimize);
    card.append(art, copy, scene, header);

    function mount() { if (anchor?.isConnected && !card.isConnected) anchor.after(card); }
    function restoreView(id) {
      const key = String(id || "");
      if (key === viewId) return;
      viewId = key; const generation = ++viewGeneration;
      minimized = false; detailsOpen = false; viewReady = !ViewState;
      cancelCompletion(); preparedDuringVisit = false;
      if (!ViewState) return;
      void ViewState.load("course", key).then(value => {
        if (destroyed || generation !== viewGeneration) return;
        minimized = value.collapsed === true; viewReady = true; render();
      }).catch(() => {
        if (destroyed || generation !== viewGeneration) return;
        viewReady = true; render();
      });
    }
    function setCollapsed(value) {
      minimized = Boolean(value);
      if (minimized) cancelCompletion();
      if (ViewState && viewReady && viewId) void ViewState.save("course", viewId, { collapsed: minimized });
    }
    function cancelCompletion() {
      const current = completion; completion = null;
      if (current) {
        clearTimeout(current.timer);
        for (const animation of current.animations) animation.cancel();
      }
      card.style.removeProperty("height");
      card.style.removeProperty("min-height");
      delete card.dataset.completion;
    }
    function beginCompletion() {
      const current = completion = { phase: "hold", animations: [], timer: null };
      current.timer = setTimeout(() => {
        if (completion !== current || destroyed) return;
        current.phase = "fade"; card.dataset.completion = "fade";
        const outgoing = [art, copy, actions, minimize].map(element => element.animate(
          [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }],
          { duration: 180, easing: "ease-out", fill: "forwards" }
        ));
        current.animations.push(...outgoing);
        void Promise.all(outgoing.map(animation => animation.finished.catch(() => {}))).then(() => {
          if (completion !== current || destroyed) return;
          const previousHeight = card.getBoundingClientRect().height;
          current.phase = "reveal";
          for (const animation of outgoing) animation.cancel();
          render();
          const nextHeight = card.getBoundingClientRect().height;
          card.style.minHeight = "0px";
          card.style.height = `${previousHeight}px`;
          const grow = card.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
            { duration: 340, easing: "cubic-bezier(.2,.7,.25,1)", fill: "forwards" });
          const incoming = [header, scene].map(element => element.animate([{ opacity: 0 }, { opacity: 1 }],
            { duration: 260, easing: "ease-in-out", fill: "both" }));
          current.animations.push(grow, ...incoming);
          void grow.finished.catch(() => {}).then(() => {
            if (completion !== current || destroyed) return;
            cancelCompletion();
            // Start the accepted scene only once the container has settled.
            // Initial saved-course loads skip the completion choreography.
            for (const animation of scene.getAnimations({ subtree: true })) animation.currentTime = 0;
            render();
          });
        });
      }, 450);
    }
    function emit(type, values = {}) {
      return chrome.runtime.sendMessage({ type: `ikr:auto:${type}`, courseId: String(options.courseId), ...values });
    }
    const sceneEffects = new Map();
    function ensureSceneAssets() {
      if (sceneWarming || sceneReady) return;
      sceneWarming = true; card.dataset.sceneAssetState = "loading";
      void Promise.all(sceneAssets.map(name => warmSceneImage(chrome.runtime.getURL(`assets/${name}`)))).then(results => {
        if (destroyed) return;
        sceneReady = true;
        card.dataset.sceneReady = "true";
        card.dataset.sceneAssetState = results.every(Boolean) ? "ready" : "error";
        // A missing local image must not leave the card permanently paused.
        // Existing artwork/fallbacks remain unchanged after a bounded wait.
        render();
      });
    }
    function bindSceneEffect(element, name, key, makeFrames) {
      const animation = element.getAnimations().find(candidate => candidate.animationName === name);
      const current = sceneEffects.get(element);
      if (animation && (current?.animation !== animation || current.key !== key)) {
        animation.effect.setKeyframes(makeFrames());
        sceneEffects.set(element, { animation, key });
      } else if (!animation) sceneEffects.delete(element);
    }
    function positionScene() {
      if (destroyed || document.hidden) return;
      if (scene.clientWidth < 1 || scene.clientHeight < 1) return;
      const floor = Math.max(28, scene.clientHeight - 176);
      const floorPx = `${floor}px`;
      if (card.style.getPropertyValue("--ikr-floor-y") !== floorPx) card.style.setProperty("--ikr-floor-y", floorPx);
      const layout = { width: scene.clientWidth, mouthX: 166, props: {} };
      for (const [key, prop] of sceneProps) layout.props[key] = { x: prop.offsetLeft, y: prop.offsetTop };
      layout.entry = { x: -196, y: floor };
      layout.breeze = { x: 12, y: floor };
      layout.rest = { x: (scene.clientWidth - 176) / 2, y: floor };
      // Complete every layout read before publishing any values. Set literal
      // transforms on the existing CSS timeline so live painting follows the
      // same path as layout, without restarting its clock or pose animations.
      const set = (key, value) => { const px = `${Number(value.toFixed(2))}px`; if (scene.style.getPropertyValue(key) !== px) scene.style.setProperty(key, px); };
      for (const key of ["entry", "breeze", "rest"]) {
        const point = layout[key], prefix = `--ikr-${key}`;
        set(`${prefix}-x`, point.x); set(`${prefix}-y`, point.y);
      }
      set("--ikr-mouth-x", layout.mouthX);
      const key = JSON.stringify(layout), motion = globalThis.IKnowReaderSceneMotion;
      if (motion) {
        bindSceneEffect(actor, "ikr-loop-journey", key, () => motion.keyframes(layout));
        for (const [propKey, prop] of sceneProps) bindSceneEffect(prop, "ikr-breeze-prop", key, () => motion.propKeyframes(layout, propKey));
        bindSceneEffect(wind, "ikr-breeze-wind", key, () => motion.windKeyframes(layout));
      }
    }
    const sceneResize = new ResizeObserver(() => { if (card.dataset.saved === "true" && !document.hidden) scheduleSceneFrame(); });
    sceneResize.observe(scene);
    function syncSceneMotion(fullySaved) {
      if (!fullySaved || motionPreference.matches) { pausedSceneAnimations.clear(); return; }
      // Leave a disappearing tab without synchronously querying its animation
      // tree or layout. The visible render already collected these clocks.
      const animations = document.hidden ? knownSceneAnimations : scene.getAnimations({ subtree: true });
      if (!document.hidden) knownSceneAnimations = animations;
      if (!sceneReady || detailsOpen || minimized || !options.enabled || document.hidden || completion?.phase === "reveal") {
        for (const animation of animations) {
          if (animation.playState === "running" || animation.pending) animation.pause();
          if (!sceneReady) animation.currentTime = 0;
          if (animation.playState === "paused" || animation.pending) pausedSceneAnimations.add(animation);
        }
      } else {
        for (const animation of pausedSceneAnimations) if (animations.includes(animation) && animation.playState === "paused") animation.play();
        pausedSceneAnimations.clear();
      }
    }
    function render() {
      if (destroyed) return;
      if (document.hidden) { deferredRender = true; syncSceneMotion(card.dataset.saved === "true"); return; }
      deferredRender = false;
      if (sceneFrame) { cancelAnimationFrame(sceneFrame); sceneFrame = 0; }
      mount();
      const initialized = !options.initializing && Boolean(options.course && options.availability) && viewReady;
      card.hidden = !options.enabled || !initialized;
      if (!initialized) { cancelCompletion(); preparedDuringVisit = false; return; }
      card.dataset.status = state.status;
      card.dataset.minimized = String(minimized);
      const active = ["running", "connecting"].includes(state.status);
      const jobFeatures = state.status !== "idle" && selected(state.features) ? state.features : options.features;
      const phases = preparationSteps(jobFeatures), phaseIndex = phases.findIndex(phase => phase.key === processingStage(state.stage));
      const partial = hasMissing(state.summary, jobFeatures);
      const queued = state.status === "queued" || state.code === "queue_active";
      const any = selected(options.features);
      const resumable = !any && selected(state.features) &&
        (["cancelled", "error"].includes(state.status) || state.status === "complete" && hasMissing(state.summary, state.features));
      const availability = options.availability;
      const savedProgress = Core.preparationProgress(state, availability, jobFeatures);
      // Stored modules stay saved, while a failed dependency in the last
      // explicit job must retain its own visible, manual retry path.
      const targetSaved = availability?.complete === true && ["idle", "complete"].includes(state.status) &&
        !(state.status === "complete" && partial);
      if (active) preparedDuringVisit = true;
      if (completion && (!targetSaved || !options.enabled || minimized || motionPreference.matches || document.hidden)) cancelCompletion();
      if (targetSaved && preparedDuringVisit && !completion) {
        preparedDuringVisit = false;
        if (!minimized && options.enabled && !document.hidden && !motionPreference.matches && typeof card.animate === "function") beginCompletion();
      } else if (!targetSaved && ["idle", "cancelled", "error"].includes(state.status)) preparedDuringVisit = false;
      const completing = Boolean(completion), holding = completing && completion.phase !== "reveal";
      const fullySaved = targetSaved && !holding;
      if (completion) card.dataset.completion = completion.phase;
      else delete card.dataset.completion;
      if (!fullySaved) {
        detailsOpen = false;
        if (document.activeElement === details || document.activeElement === replay) queue.focus({ preventScroll: true });
      }
      card.dataset.saved = String(fullySaved); card.dataset.details = String(detailsOpen);
      if (!fullySaved || detailsOpen || minimized || !options.enabled) clearFoxReaction();
      details.hidden = !fullySaved; details.setAttribute("aria-expanded", String(detailsOpen));
      details.textContent = detailsOpen ? "Back to fox" : "Details";
      details.setAttribute("aria-label", detailsOpen ? "Back to fox" : "Details");
      if (fullySaved && motionPreference.matches && document.activeElement === replay) details.focus({ preventScroll: true });
      replay.hidden = !fullySaved || motionPreference.matches;
      saved.hidden = fullySaved && !detailsOpen; featureControls.hidden = fullySaved;
      detail.hidden = fullySaved;
      for (const [key, count] of sceneCounts) { const module = availability?.modules?.[key]; count.textContent = module ? `${module.ready}/${module.total} sentences` : ""; }
      for (const [key, { badge, value, label }] of savedBadges) {
        const module = availability?.modules?.[key];
        badge.dataset.status = module?.status || "checking";
        const words = key === "german" && module?.wordsReady < module?.wordsTotal ? `, ${module.wordsReady}/${module.wordsTotal} words` : "";
        value.textContent = !module ? "Checking…" : module.status === "missing" ? "Not saved" : `${module.ready}/${module.total} sentences${words}`;
        badge.title = module ? `${module.ready}/${module.total} sentences${key === "german" ? ` · ${module.wordsReady}/${module.wordsTotal} words` : ""}` : "";
        badge.setAttribute("aria-label", `${label}: ${!module ? "checking saved data" : badge.dataset.status === "ready" ? "saved" : badge.dataset.status === "partial" ? "partly saved" : "not saved"}${module ? `, ${badge.title}` : ""}`);
      }
      for (const [feature, input] of featureInputs) {
        const saved = availability?.complete === true || availability?.modules?.[feature]?.status === "ready";
        input.checked = (options.displayFeatures || options.features)[feature];
        input.disabled = active || saved;
        input.parentElement.title = saved ? "Already saved for this course" : active ? "Preparation is running" : "";
      }
      const missing = state.code === "helper_missing";
      if (queued) {
        heading.textContent = "Series preparation is running";
        detail.textContent = "View progress in the queue.";
      } else if (state.status === "idle") {
        const partly = Object.values(availability?.modules || {}).some(module => module.status !== "missing");
        heading.textContent = availability?.complete ? "Course saved" : partly ? "Partly saved" : "Romaji ready";
        detail.textContent = availability?.complete ? "" : any && options.complete ? "Your selection is already saved." : "Choose extras to prepare.";
      } else if (state.status === "error") {
        heading.textContent = missing ? "Set up the local helper" : "Preparation interrupted";
        detail.textContent = missing ? "The local helper is not installed yet. You can keep using the course." : state.message || "Completed results remain saved.";
      } else if (state.status === "cancelled") {
        heading.textContent = "Preparation paused";
        detail.textContent = state.code === "network_unavailable" ? state.message : "Completed results are saved. Resume whenever you like.";
      } else if (state.status === "complete") {
        heading.textContent = partial ? "Preparation partly saved" : availability?.complete ? "Course saved" : "Selection saved";
        const notices = [];
        const count = n => `${n} ${n === 1 ? "sentence" : "sentences"}`;
        if (jobFeatures.german && state.summary?.translationExcluded > 0) notices.push(`${count(state.summary.translationExcluded)} still in English`);
        if (jobFeatures.german && state.summary?.wordExcluded > 0) notices.push(`${state.summary.wordExcluded} ${state.summary.wordExcluded === 1 ? "word meaning missing" : "word meanings missing"}`);
        if (jobFeatures.audio && state.summary?.audioExcluded > 0) notices.push(`${count(state.summary.audioExcluded)} without audio timings`);
        if (jobFeatures.colors && state.summary?.groupsExcluded > 0) notices.push(`${count(state.summary.groupsExcluded)} without ${jobFeatures.german && availability?.modules.colors.status === "ready" ? "German color links" : "meaning colors"}`);
        detail.textContent = notices.join(" · ");
      } else {
        heading.textContent = phaseIndex >= 0 ? `Step ${phaseIndex + 1} of ${phases.length} · ${phases[phaseIndex].label}` :
          phases.length ? `Getting ready · ${phases.length} ${phases.length === 1 ? "step" : "steps"}` : titles[state.stage] || "Preparing your course";
        const count = savedProgress ? `${savedProgress.ready} of ${savedProgress.total} ${savedProgress.total === 1 ? "sentence" : "sentences"} ready` : "";
        const words = processingStage(state.stage) === "language" && jobFeatures.german && availability?.modules.german && availability.modules.german.wordsReady < availability.modules.german.wordsTotal ? ` · ${availability.modules.german.wordsReady} of ${availability.modules.german.wordsTotal} word meanings ready` : "";
        detail.textContent = count ? count + words :
          state.stage === "model" ? (state.message || "Starting the local helper…") : "You can keep studying while this runs.";
      }
      if (holding) { heading.textContent = "Preparation complete"; detail.textContent = ""; }
      phaseContext.hidden = true; phaseContext.textContent = "";
      if (!holding && !fullySaved && !queued && phases.length) {
        if (active && phaseIndex < 0) {
          phaseContext.textContent = phases.map((phase, index) => `${index === 0 ? "First" : "Then"}: ${phase.label}`).join(" · ");
        } else if (active && phaseIndex < phases.length - 1) {
          phaseContext.textContent = `Next: ${phases[phaseIndex + 1].label} (estimated when it starts)`;
        } else if (state.status === "idle" && any && !options.complete) {
          phaseContext.textContent = `${phases.length} ${phases.length === 1 ? "step" : "steps"}: ${phases.map(phase => phase.label).join(" → ")}`;
        }
        phaseContext.hidden = !phaseContext.textContent;
      }
      progress.hidden = !active && !holding;
      progressRow.hidden = !active && !holding;
      eta.textContent = holding ? "100%" : estimateProgress(active, savedProgress);
      if (holding) { progress.max = 1; progress.value = 1; }
      else if (savedProgress?.total > 0) { progress.max = savedProgress.total; progress.value = savedProgress.ready; }
      else progress.removeAttribute("value");
      steps.hidden = !active && !holding;
      const current = stageIndex(state.stage);
      [...steps.children].forEach((step, index) => { step.dataset.state = index < current ? "done" : index === current ? "active" : "pending"; });
      steps.children[1].hidden = !jobFeatures.german && !jobFeatures.colors;
      steps.children[1].textContent = jobFeatures.german && jobFeatures.colors ? "German & colors" : jobFeatures.german ? "German" : "Colors";
      steps.children[2].hidden = !jobFeatures.audio;
      cancel.hidden = !active;
      queue.disabled = completing;
      retry.hidden = fullySaved || active || completing || queued || (state.status === "complete" && !partial);
      retry.disabled = !any && !resumable || (state.status === "idle" && options.complete);
      retry.textContent = state.status === "idle" ? "Prepare selection" : missing || state.status === "error" ? "Try again" : state.status === "complete" && partial ? "Retry missing" : "Resume";
      setup.hidden = !missing;
      minimize.dataset.collapsed = String(minimized);
      minimize.setAttribute("aria-label", minimized ? "Expand progress" : "Collapse progress");
      minimize.setAttribute("aria-expanded", String(!minimized));
      card.setAttribute("aria-busy", String(active));
      if (fullySaved) { ensureSceneAssets(); positionScene(); }
      syncSceneMotion(fullySaved);
    }
    function finish() {
      if (state.status !== "complete") {
        state = { ...state, status: "complete", stage: "done" };
      }
      render();
    }
    function receive(next) {
      if (destroyed || String(next?.courseId) !== String(options.courseId)) return;
      if (next.features && selected(options.features) && Core.featuresKey(next.features) !== Core.featuresKey(options.features) && next.status !== "queued") return;
      if (options.complete && !attempted && selected(options.features)) return;
      if (next.status === "idle" && attempted) return;
      state = { ...state, ...next };
      render();
    }
    function subscribe() {
      try {
        if (!port) {
          port = chrome.runtime.connect({ name: "ikr:auto" });
          port.onMessage.addListener(message => { if (message.type === "state") receive(message.state); });
          port.onDisconnect.addListener(() => {
            // Read lastError so an extension reload does not create an uncaught console error.
            const message = chrome.runtime.lastError?.message; port = null;
            if (!destroyed && ["running", "connecting"].includes(state.status)) {
              state = { ...state, status: "error", code: "extension_reloaded", message: "Connection interrupted. Please reload the course page." };
              render();
            }
          });
        }
        port.postMessage({ type: "subscribe", courseId: String(options.courseId) });
      } catch { /* A manual retry surfaces the actionable connection error. */ }
    }
    function expectedSource() {
      return Core.expectedSource(options.course);
    }
    async function start(force = false, requested = options.features) {
      const features = Core.normalizeFeatures(requested);
      if (!options.course || !options.courseId || !options.enabled || !selected(features) || (options.complete && !force) || destroyed) return;
      attempted = true;
      progressEstimate = null;
      state = { status: "connecting", stage: "model", completed: 0, total: 0, features };
      render();
      try {
        subscribe();
        const response = await emit("start", { source: options.course, expected: expectedSource(), features, force, manual: true });
        if (response?.state) receive(response.state);
        else if (!response?.ok) throw new Error("connection");
      } catch {
        if (destroyed) return;
        state = { ...state, status: "error", code: "connection_failed", message: "Could not start preparation. Please reload the extension and course page." };
        render();
      }
    }
    cancel.addEventListener("click", () => {
      state = { ...state, status: "cancelled" }; render();
      void emit("cancel").catch(() => {});
    });
    retry.addEventListener("click", () => {
      const features = selected(options.features) ? options.features : state.features;
      if (!selected(options.features) && selected(state.features)) onResumeSelection?.(state.features);
      void start(true, features);
    });
    setup.addEventListener("click", () => { void emit("setup").catch(() => {}); });
    queue.addEventListener("click", () => { void chrome.runtime.sendMessage({ type: "ikr:queue:open" }).catch(() => {}); });
    details.addEventListener("click", () => { setCollapsed(false); detailsOpen = !detailsOpen; render(); });
    replay.addEventListener("click", () => {
      if (motionPreference.matches) return;
      clearFoxReaction();
      setCollapsed(false); detailsOpen = false; render();
      for (const animation of scene.getAnimations({ subtree: true })) { animation.currentTime = 0; if (sceneReady) animation.play(); }
      syncSceneMotion(card.dataset.saved === "true");
    });
    minimize.addEventListener("click", () => { setCollapsed(!minimized); render(); });
    motionPreference.addEventListener("change", render);
    function scheduleSceneFrame() {
      if (destroyed || document.hidden || sceneFrame) return;
      sceneFrame = requestAnimationFrame(() => {
        sceneFrame = 0;
        if (destroyed || document.hidden) return;
        if (deferredRender) render();
        else { if (card.dataset.saved === "true") positionScene(); syncSceneMotion(card.dataset.saved === "true"); }
      });
    }
    const onVisibility = () => {
      if (document.hidden) {
        if (sceneFrame) { cancelAnimationFrame(sceneFrame); sceneFrame = 0; }
        clearFoxReaction();
        if (completion) { cancelCompletion(); deferredRender = true; }
        syncSceneMotion(card.dataset.saved === "true");
        return;
      }
      scheduleSceneFrame();
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("ikr:panels-reordered", onVisibility);
    return Object.freeze({
      update(next) {
        if (destroyed) return;
        const previous = options;
        options = { ...options, ...next };
        restoreView(options.courseId);
        options.features = Core.normalizeFeatures(options.features);
        const requestedChanged = Core.featuresKey(previous.displayFeatures || previous.features) !== Core.featuresKey(options.displayFeatures || options.features);
        const dependencyChanged = Core.featuresKey(previous.features) !== Core.featuresKey(options.features);
        const featureChanged = featuresInitialized && (requestedChanged || dependencyChanged && ["running", "connecting"].includes(state.status));
        featuresInitialized = true;
        if (next.anchor) anchor = next.anchor;
        if (options.course && options.course !== lastSource) {
          lastSource = options.course;
          const key = Core.fingerprint(JSON.stringify((options.course.goal_items || []).map(entry => [entry.item?.id, entry.item?.cue, entry.item?.response, entry.sound, (entry.sentences || []).map(sentence => [sentence.cue, sentence.response, sentence.sound])])));
          if (sourceKey !== key || String(previous.courseId) !== String(options.courseId)) {
            progressEstimate = null;
            sourceKey = key; attempted = false; state = { status: "idle", stage: "model", completed: 0, total: 0 };
            subscribe();
          }
        }
        if (featureChanged) {
          progressEstimate = null;
          if (["running", "connecting"].includes(state.status)) void emit("cancel", { reason: "settings" }).catch(() => {});
          attempted = false;
          state = { status: "idle", stage: "model", completed: 0, total: 0 };
        }
        if (previous.complete && !options.complete && state.status === "complete") {
          state = { status: "idle", stage: "model", completed: 0, total: 0 };
          attempted = false;
        }
        if (!options.enabled && ["running", "connecting"].includes(state.status)) {
          state = { ...state, status: "cancelled" }; void emit("cancel", { reason: "settings" }).catch(() => {});
        }
        if (state.status === "cancelled" && !previous.enabled && options.enabled) attempted = false;
        if (!selected(options.features)) {
          if (!["running", "connecting", "queued", "cancelled", "error"].includes(state.status) && !hasMissing(state.summary, state.features || {})) state = { status: "idle", stage: "model", completed: 0, total: 0 };
          render();
        }
        else if (options.complete) {
          if (attempted) { if (!["running", "connecting"].includes(state.status)) finish(); else render(); }
          else { state = { ...state, status: "idle" }; render(); }
        } else render();
      },
      destroy() {
        destroyed = true; viewGeneration++; if (sceneFrame) cancelAnimationFrame(sceneFrame); sceneFrame = 0; cancelCompletion(); clearFoxReaction(); sceneResize.disconnect(); sceneEffects.clear(); pausedSceneAnimations.clear(); knownSceneAnimations = []; motionPreference.removeEventListener("change", render); document.removeEventListener("visibilitychange", onVisibility); document.removeEventListener("ikr:panels-reordered", onVisibility); port?.disconnect(); port = null; card.remove();
      }
    });
  }
  globalThis.IKnowReaderAutomation = Object.freeze({ create });
})();
