/* Reorder the two existing course panels without rebuilding their contents. */
(() => {
  "use strict";
  const STORAGE_KEY = "iknowReaderPanelOrder";
  const normalize = value => value === "course-first" ? value : "reading-first";
  function create({ toolbar, before }) {
    const slot = document.createElement("div");
    slot.className = "ikr-owned ikr-panel-slot";
    const stack = document.createElement("div");
    stack.className = "ikr-owned ikr-panel-stack";
    before.before(slot); slot.append(stack); stack.append(toolbar);
    const status = document.createElement("span");
    status.className = "ikr-panel-order-status";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    stack.append(status);
    const listeners = new AbortController(), handles = new Map(), layoutAnimations = new Set();
    let course = null, order = "reading-first", destroyed = false, touched = false;
    let drag = null, deferredOrder = null, swallowPointerClick = false, write = Promise.resolve();
    let follow = false, pinned = false, naturalHeight = 0, frame = null, needsMeasure = false, observedSize = "";
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const panels = () => course ? [toolbar, course] : [toolbar];
    const setStyle = (name, value) => { if (stack.style.getPropertyValue(name) !== value) stack.style.setProperty(name, value); };
    function releaseFollow() {
      if (!pinned) return;
      pinned = false; delete stack.dataset.pinned; slot.style.removeProperty("height");
      for (const name of ["--ikr-pin-left", "--ikr-pin-top", "--ikr-pin-width", "--ikr-pin-height"]) stack.style.removeProperty(name);
      stack.scrollTop = 0;
    }
    function followTop() {
      let bottom = 0;
      for (const header of document.querySelectorAll("section.fixed-container, header, #header, .site-header, .navbar-fixed-top")) {
        if (header.closest(".ikr-owned")) continue;
        const style = getComputedStyle(header), rect = header.getBoundingClientRect();
        if (["fixed", "sticky"].includes(style.position) && rect.top <= 1 && rect.bottom > 0 && rect.height < Math.min(300, innerHeight * .5)) {
          // iKnow's header image has a transparent shadow tail below its
          // actual content. Join at the visible edge, not that empty tail.
          const content = header.matches("section.fixed-container") ? header.querySelector(":scope > .container_12")?.getBoundingClientRect() : null;
          bottom = Math.max(bottom, content?.height > 0 ? Math.min(rect.bottom, content.bottom) : rect.bottom);
        }
      }
      return Math.ceil(bottom);
    }
    function updateFollowLayout(measure = false) {
      if (destroyed || !slot.isConnected) return;
      if (!follow) { releaseFollow(); return; }
      const top = followTop(), bounds = slot.getBoundingClientRect();
      if (bounds.top >= top) { releaseFollow(); return; }
      // iKnow clips its content ancestors. Keep the same connected stack and
      // reserve its natural height instead of moving it to another DOM parent.
      if (!pinned || measure) {
        if (pinned) delete stack.dataset.pinned;
        naturalHeight = stack.getBoundingClientRect().height;
        slot.style.height = `${naturalHeight}px`;
      }
      const viewport = window.visualViewport;
      const x0 = viewport?.offsetLeft || 0, y0 = viewport?.offsetTop || 0;
      const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
      const panelWidth = Math.max(0, Math.min(bounds.width, width - 16));
      const left = Math.max(x0 + 8, Math.min(bounds.left, x0 + width - panelWidth - 8));
      const pinTop = Math.max(y0, top), available = Math.max(80, y0 + height - pinTop - 8);
      setStyle("--ikr-pin-left", `${Math.round(left)}px`); setStyle("--ikr-pin-width", `${panelWidth}px`);
      setStyle("--ikr-pin-height", `${available}px`); setStyle("--ikr-pin-top", `${pinTop}px`);
      stack.dataset.pinned = "true"; pinned = true;
      // Let the stack leave with its course instead of covering the footer.
      const parentBottom = slot.parentElement.getBoundingClientRect().bottom;
      const fixedHeight = stack.getBoundingClientRect().height;
      setStyle("--ikr-pin-top", `${Math.round(Math.min(pinTop, parentBottom - fixedHeight - 8))}px`);
      observedSize = `${stack.getBoundingClientRect().width}:${fixedHeight}`;
    }
    function scheduleFollow(measure = false) {
      needsMeasure ||= measure;
      if (frame !== null || destroyed) return;
      frame = requestAnimationFrame(() => { frame = null; const value = needsMeasure; needsMeasure = false; updateFollowLayout(value); });
    }
    window.addEventListener("scroll", () => { if (follow) scheduleFollow(); }, { passive: true, signal: listeners.signal });
    window.addEventListener("resize", () => scheduleFollow(true), { passive: true, signal: listeners.signal });
    window.visualViewport?.addEventListener("resize", () => scheduleFollow(true), { passive: true, signal: listeners.signal });
    window.visualViewport?.addEventListener("scroll", () => scheduleFollow(), { passive: true, signal: listeners.signal });
    const sizeObserver = new ResizeObserver(() => {
      const rect = stack.getBoundingClientRect(), size = `${rect.width}:${rect.height}`;
      if (size !== observedSize) { observedSize = size; if (follow) scheduleFollow(true); }
    });
    sizeObserver.observe(stack);
    function animateMove(panel, delta) {
      if (motion.matches || Math.abs(delta) < 1) return;
      const animation = panel.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 190, easing: "cubic-bezier(.2,.75,.25,1)" });
      layoutAnimations.add(animation);
      void animation.finished.catch(() => {}).finally(() => layoutAnimations.delete(animation));
    }
    function move(panel, reference) {
      if (typeof stack.moveBefore === "function") { stack.moveBefore(panel, reference); return; }
      // Older Chromium can recreate CSS timelines when a connected node moves.
      const active = document.activeElement;
      const times = [panel, ...panel.querySelectorAll("*")].flatMap(target => target.getAnimations().filter(animation => typeof animation.animationName === "string").map(animation => ({ target, name: animation.animationName, time: animation.currentTime, state: animation.playState, rate: animation.playbackRate })));
      stack.insertBefore(panel, reference);
      for (const entry of times) {
        const animation = entry.target.getAnimations().find(candidate => candidate.animationName === entry.name);
        if (!animation || entry.time === null) continue;
        animation.playbackRate = entry.rate; animation.currentTime = entry.time;
        if (entry.state === "paused") animation.pause(); else if (entry.state === "running") animation.play();
      }
      if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    }
    function announce() { status.textContent = order === "course-first" ? "Course panel is above reading controls." : "Reading controls are above the course panel."; }
    function apply(value, animate = false, positions = null) {
      order = normalize(value); stack.dataset.order = order;
      if (!course?.isConnected) return;
      const first = order === "course-first" ? course : toolbar, second = first === course ? toolbar : course;
      if (first.nextElementSibling !== second) {
        const rects = positions || new Map(panels().map(panel => [panel, panel.getBoundingClientRect().top]));
        move(first, second);
        document.dispatchEvent(new Event("ikr:panels-reordered"));
        if (animate) for (const panel of panels()) animateMove(panel, rects.get(panel) - panel.getBoundingClientRect().top);
      }
      for (const [panel, handle] of handles) {
        const above = panel === first;
        handle.setAttribute("aria-label", `Move ${panel === toolbar ? "reading controls" : "course panel"} ${above ? "below" : "above"}`);
      }
      if (follow) scheduleFollow(true);
    }
    function persist() {
      const value = order;
      write = write.catch(() => {}).then(() => chrome.storage.local.set({ [STORAGE_KEY]: value })).catch(() => {
        if (!destroyed) status.textContent = "Panel order could not be saved. Move a panel again to retry.";
      });
    }
    function choose(value, positions) {
      touched = true; deferredOrder = null; apply(value, true, positions); announce(); persist();
    }
    function stop(commit) {
      if (!drag) return;
      const current = drag; drag = null;
      const positions = new Map(panels().map(panel => [panel, panel.getBoundingClientRect().top]));
      current.panel.classList.remove("ikr-panel-dragging"); current.panel.style.removeProperty("--ikr-panel-drag-y");
      delete stack.dataset.drop; delete stack.dataset.dragging;
      current.handle.setAttribute("aria-pressed", "false");
      if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
      if (current.moved || !commit) swallowPointerClick = true;
      if (commit && current.candidate && current.candidate !== order) choose(current.candidate, positions);
      else {
        if (current.moved) animateMove(current.panel, positions.get(current.panel) - current.panel.getBoundingClientRect().top);
        if (deferredOrder !== null) { const next = deferredOrder; deferredOrder = null; apply(next, true); }
      }
    }
    function addHandle(panel) {
      if (handles.has(panel)) return;
      panel.classList.add("ikr-panel-draggable");
      const handle = document.createElement("button");
      handle.type = "button"; handle.className = "ikr-panel-handle";
      handle.title = "Drag to reorder, or click to swap";
      handle.setAttribute("aria-pressed", "false");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 12 18"); icon.setAttribute("aria-hidden", "true");
      for (const y of [4, 9, 14]) for (const x of [3, 9]) {
        const dot = document.createElementNS(icon.namespaceURI, "circle"); dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", "1.1"); icon.append(dot);
      }
      // Anchor the grip to the panel itself in every preparation/scene state.
      // A folded card's right-hand header must not become its layout parent.
      handle.append(icon); panel.prepend(handle); handles.set(panel, handle);
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary || !course || course.hidden) return;
        event.preventDefault();
        swallowPointerClick = false;
        for (const animation of layoutAnimations) animation.cancel(); layoutAnimations.clear();
        handle.focus({ preventScroll: true }); handle.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, panel, handle, start: event.clientY, moved: false, candidate: null };
      }, { signal: listeners.signal });
      handle.addEventListener("lostpointercapture", () => stop(false), { signal: listeners.signal });
      handle.addEventListener("click", event => {
        if (event.detail > 0 && swallowPointerClick) { swallowPointerClick = false; event.preventDefault(); return; }
        if (!course || course.hidden) { event.preventDefault(); return; }
        choose(order === "reading-first" ? "course-first" : "reading-first");
      }, { signal: listeners.signal });
      handle.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !course || course.hidden) return;
        event.preventDefault();
        const first = ["ArrowUp", "Home"].includes(event.key);
        const next = (panel === course) === first ? "course-first" : "reading-first";
        if (next !== order) choose(next);
      }, { signal: listeners.signal });
    }
    document.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const delta = event.clientY - drag.start;
      if (!drag.moved && Math.abs(delta) < 6) return;
      event.preventDefault(); drag.moved = true;
      drag.handle.setAttribute("aria-pressed", "true");
      stack.dataset.dragging = "true"; drag.panel.classList.add("ikr-panel-dragging");
      drag.panel.style.setProperty("--ikr-panel-drag-y", `${delta}px`);
      const other = drag.panel === toolbar ? course : toolbar, rect = other.getBoundingClientRect(), bounds = stack.getBoundingClientRect();
      const wasFirst = (order === "course-first") === (drag.panel === course);
      const crossed = wasFirst ? event.clientY >= rect.top + rect.height / 2 : event.clientY <= rect.top + rect.height / 2;
      const inside = event.clientX >= bounds.left - 36 && event.clientX <= bounds.right + 36 && event.clientY >= bounds.top - 48 && event.clientY <= bounds.bottom + 48;
      drag.candidate = inside && crossed ? (order === "course-first" ? "reading-first" : "course-first") : null;
      if (drag.candidate) stack.dataset.drop = wasFirst ? "bottom" : "top"; else delete stack.dataset.drop;
    }, { passive: false, signal: listeners.signal });
    document.addEventListener("pointerup", event => { if (event.pointerId === drag?.id) stop(true); }, { signal: listeners.signal });
    document.addEventListener("pointercancel", event => { if (event.pointerId === drag?.id) stop(false); }, { signal: listeners.signal });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && drag) { event.preventDefault(); stop(false); } }, { signal: listeners.signal });
    const onStorage = (changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY] || destroyed) return;
      const next = normalize(changes[STORAGE_KEY].newValue);
      if (drag) deferredOrder = next; else apply(next, true);
    };
    chrome.storage.onChanged.addListener(onStorage);
    void chrome.storage.local.get(STORAGE_KEY).then(stored => { if (!destroyed && !touched) apply(stored[STORAGE_KEY]); }).catch(() => {});
    function refresh() {
      if (destroyed) return;
      course = stack.querySelector(":scope > .ikr-preparation");
      addHandle(toolbar); if (course) addHandle(course);
      for (const handle of handles.values()) handle.hidden = !course || course.hidden;
      if (drag && (!course || course.hidden)) stop(false);
      if (!drag) apply(order);
    }
    refresh();
    return Object.freeze({
      refresh,
      setFollow(value) {
        const next = value === true;
        if (next === follow) return;
        follow = next; stack.dataset.follow = String(follow);
        if (follow) scheduleFollow(true); else releaseFollow();
      },
      destroy() {
        stop(false); destroyed = true; listeners.abort(); chrome.storage.onChanged.removeListener(onStorage);
        if (frame !== null) cancelAnimationFrame(frame);
        sizeObserver.disconnect();
        for (const animation of layoutAnimations) animation.cancel();
        for (const [panel, handle] of handles) { handle.remove(); panel.classList.remove("ikr-panel-draggable"); }
        slot.remove();
      }
    });
  }
  globalThis.IKnowReaderPanelLayout = Object.freeze({ create });
})();
