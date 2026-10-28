/* Original walk base plus a bounded near-arm drawing. Never removes base pixels. */
(() => {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";
  const positions = Object.freeze([
    Object.freeze([-1.6, -4.52]), Object.freeze([-173.24, -4.52]),
    Object.freeze([-1.6, -166.77]), Object.freeze([-173.24, -166.77])
  ]);
  const regions = Object.freeze([
    "M93 112 L108 106 L122 108 L140 118 L140 136 L127 142 L115 148 L99 147 L92 137 Z",
    "M94 112 L108 106 L125 108 L141 119 L143 137 L131 143 L116 142 L110 136 L98 132 Z",
    "M93 112 L107 105 L122 106 L140 116 L143 134 L131 141 L116 142 L102 138 L94 132 Z",
    "M94 112 L108 107 L124 109 L141 120 L143 136 L132 143 L117 143 L108 137 L98 133 Z"
  ]);
  // Per-frame x, y, width, height in the registered 176 px viewport.
  const bounds = Object.freeze([13.96, 13.96, 15.23, 15.23].map(y =>
    Object.freeze([10.28, y, 155.44, 167 - y])));
  let serial = 0;

  function validResource(value, filename) {
    if (typeof value !== "string") return false;
    const runtimeId = globalThis.chrome?.runtime?.id;
    if (!runtimeId) return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
    try {
      const url = new URL(value);
      return url.protocol === "chrome-extension:" && url.hostname === runtimeId &&
        url.pathname === `/assets/${filename}` && !url.search && !url.hash;
    } catch { return false; }
  }

  function mount(container, { original, edited, sampling = "auto" } = {}) {
    if (!validResource(original, "reading-fox-walk-v3.png") ||
        !validResource(edited, "reading-fox-near-arm-v1.png")) return false;
    if (container?.nodeType !== 1 || typeof container.ownerDocument?.createElementNS !== "function") return false;
    if (container.hasAttribute("data-ikr-near-arm-mounted")) return true;

    const doc = container.ownerDocument;
    const create = (tag, attrs = {}) => {
      const element = doc.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      return element;
    };
    const unique = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const prefix = `ikr-near-arm-${++serial}-${unique}`;
    const fragment = doc.createDocumentFragment();
    const definitions = create("svg", {
      class: "ikr-near-arm-definitions", width: 0, height: 0,
      "aria-hidden": "true", focusable: "false",
      style: "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"
    });
    const defs = create("defs");
    definitions.append(defs);
    const originalId = `${prefix}-original`, editedId = `${prefix}-edited`;
    for (const [id, href] of [[originalId, original], [editedId, edited]]) {
      defs.append(create("image", {
        id, href, x: 0, y: 0, width: 351.12, height: 351.12,
        preserveAspectRatio: "none", style: `image-rendering:${id === editedId && sampling !== "pixelated" ? "auto" : "pixelated"}`
      }));
    }
    fragment.append(definitions);
    for (let index = 0; index < 4; index++) {
      const [x, y] = positions[index], [bx, by, width, height] = bounds[index];
      const cellId = `${prefix}-cell-${index}`, armId = `${prefix}-arm-${index}`;
      const cell = create("clipPath", { id: cellId, clipPathUnits: "userSpaceOnUse" });
      cell.append(create("rect", { x: bx, y: by, width, height }));
      defs.append(cell);
      const frame = create("svg", {
        class: `ikr-walk-frame ikr-walk-frame-${index}`,
        "data-ikr-near-arm": "1", "data-ikr-near-arm-pose": index,
        viewBox: "0 0 176 176", width: 176, height: 176,
        "aria-hidden": "true", focusable: "false", style: "background:none;image-rendering:pixelated"
      });
      const fullCell = create("g", { "clip-path": `url(#${cellId})` });
      // The original full frame remains beneath every overlay, including all legs.
      fullCell.append(create("use", { href: `#${originalId}`, x, y }));
      if (edited !== original) {
        const armClip = create("clipPath", { id: armId, clipPathUnits: "userSpaceOnUse" });
        armClip.append(create("path", { d: regions[index] }));
        defs.append(armClip);
        const overlay = create("g", {
          class: "ikr-near-arm-overlay", "clip-path": `url(#${armId})`,
          "data-ikr-near-arm-overlay": index
        });
        overlay.append(create("use", { href: `#${editedId}`, x, y }));
        fullCell.append(overlay);
      }
      frame.append(fullCell);
      fragment.append(frame);
    }
    container.append(fragment);
    container.setAttribute("data-ikr-near-arm-mounted", "1");
    return true;
  }

  const api = Object.freeze({ mount, regions, positions, bounds, atlasSize: 351.12, frameSize: 176 });
  globalThis.IKnowReaderNearArmArt = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})();
