/* A local decorative scene. It never invokes the updater or native helper. */
(() => {
  "use strict";
  const wrap = document.getElementById("update-notice-wrap"), stage = wrap?.querySelector(".update-fox-window"), fox = wrap?.querySelector(".update-fox-peek");
  if (!stage || !fox) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"), HIDDEN = 58;
  let state = "idle", visible = false, inView = true, ready = false, disposed = false;
  let flow = null, position = { x: 0, y: HIDDEN }, cursor = 0, lastPointer = null, nextCatch = 0;
  const positions = [.92, .05, .5, .82];
  const phase = value => { fox.dataset.phase = value; };
  const pose = value => { fox.dataset.pose = value; };
  const eligible = () => !disposed && visible && state === "available" && inView && !document.hidden && !reduced.matches && ready;
  const xAt = index => Math.round(4 + Math.max(0, stage.clientWidth - 96) * positions[index % positions.length]);
  function place(x, y) { position = { x, y }; fox.style.transform = `translate(${x}px,${y}px)`; }
  function cancelFlow() { const previous = flow; flow = null; previous?.abort(); }
  function pause(milliseconds, signal) {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = value => { clearTimeout(timer); signal.removeEventListener("abort", aborted); resolve(value); };
      const aborted = () => finish(false), timer = setTimeout(() => finish(true), milliseconds);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
  function move(x, y, duration, signal) {
    if (signal.aborted) return Promise.resolve(false);
    // Horizontal travel is allowed only once the entire fox is below the mask.
    if (x !== position.x && (position.y < HIDDEN || y < HIDDEN)) throw Error("The fox must hide before changing places.");
    if (!duration) { place(x, y); return Promise.resolve(true); }
    return new Promise(resolve => {
      const animation = fox.animate([{ transform: `translate(${position.x}px,${position.y}px)` }, { transform: `translate(${x}px,${y}px)` }],
        { duration, easing: y === HIDDEN ? "cubic-bezier(.5,0,1,.5)" : "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
      let settled = false;
      const finish = complete => {
        if (settled) return; settled = true;
        signal.removeEventListener("abort", aborted);
        animation.onfinish = animation.oncancel = null;
        if (complete) place(x, y);
        animation.cancel(); resolve(complete);
      };
      const aborted = () => finish(false);
      animation.onfinish = () => finish(true); animation.oncancel = () => finish(false);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
  function quiet() {
    const shown = visible && inView && ready && !document.hidden && !disposed;
    pose("idle"); place(xAt(0), shown ? 8 : HIDDEN);
    phase(shown ? "static" : "off");
  }
  async function wander(signal, start) {
    for (let turn = start; !signal.aborted; turn++) {
      cursor = turn; const x = xAt(turn), shy = turn % 3 === 1;
      phase("travel");
      if (!await move(x, HIDDEN, turn === start ? 360 : 520, signal) || !await pause(190, signal)) return;
      phase("reveal");
      if (!await move(x, shy ? 16 : 0, 290, signal)) return;
      phase("peek"); maybeCatch();
      if (!await pause(shy ? 700 : 1000, signal)) return;
      pose("blink"); if (!await pause(120, signal)) return;
      pose("idle"); if (!await pause(380, signal)) return;
      if (shy) {
        phase("reveal"); if (!await move(x, 0, 260, signal)) return;
        phase("peek"); maybeCatch(); if (!await pause(650, signal)) return;
      }
      if (turn % 3 === 2) {
        pose("happy"); if (!await pause(240, signal)) return;
        pose("wave"); if (!await pause(580, signal)) return;
        pose("idle");
      }
      if (!await pause(650, signal)) return;
      phase("hide"); if (!await move(x, HIDDEN, 200, signal)) return;
      pose("idle"); if (!await pause(260, signal)) return;
    }
  }
  function begin(caught = false) {
    cancelFlow(); if (!eligible()) { quiet(); return; }
    const controller = new AbortController(), signal = controller.signal; flow = controller;
    void (async () => {
      let start = 0;
      if (caught) {
        phase("caught"); pose("happy");
        if (!await pause(270, signal)) return;
        phase("hide"); if (!await move(position.x, HIDDEN, 190, signal)) return;
        pose("idle"); phase("recovery"); if (!await pause(720, signal)) return;
        start = cursor + 1;
      } else place(xAt(0), HIDDEN);
      await wander(signal, start);
    })().catch(() => { if (flow === controller) { cancelFlow(); quiet(); } });
  }
  function reconcile() {
    if (eligible()) { if (!flow) begin(); }
    else { cancelFlow(); quiet(); }
  }
  function maybeCatch() {
    if (!eligible() || fox.dataset.phase !== "peek" || !lastPointer || performance.now() < nextCatch) return;
    const bounds = stage.getBoundingClientRect(), cx = bounds.left + position.x + 44, cy = bounds.top + position.y + 31;
    if (Math.abs(lastPointer.x - cx) > 45 || Math.abs(lastPointer.y - cy) > 38) return;
    nextCatch = performance.now() + 5000;
    begin(true);
  }
  const onPointer = event => { if (event.pointerType && event.pointerType !== "mouse") return; lastPointer = { x: event.clientX, y: event.clientY }; maybeCatch(); };
  const onLeave = () => { lastPointer = null; };
  const onVisibility = () => { lastPointer = null; reconcile(); };
  const onResize = () => { cancelFlow(); reconcile(); };
  const observer = new IntersectionObserver(entries => {
    const next = entries[entries.length - 1]?.isIntersecting === true;
    if (next !== inView) { inView = next; reconcile(); }
  });
  observer.observe(wrap);
  const resize = new ResizeObserver(onResize); resize.observe(stage);
  document.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", reconcile);
  function dispose() {
    disposed = true; cancelFlow(); pose("idle"); place(position.x, HIDDEN); phase("off");
    observer.disconnect(); resize.disconnect();
    document.removeEventListener("pointermove", onPointer); document.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility); reduced.removeEventListener("change", reconcile);
  }
  addEventListener("pagehide", dispose, { once: true });
  globalThis.IKnowReaderUpdateFox = Object.freeze({ setState(next, shown) {
    const changed = next !== state || shown !== visible; state = next; visible = shown;
    if (changed) reconcile();
  } });
  const image = new Image(); image.src = new URL("assets/reading-fox-v1.png", document.baseURI).href;
  image.decode().then(() => { ready = true; reconcile(); }).catch(() => { phase("off"); });
})();
