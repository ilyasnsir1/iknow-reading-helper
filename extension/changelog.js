/* Bundled release notes are read-only data, never HTML or remote instructions. */
(() => {
  "use strict";
  const MAX_BYTES = 512 * 1024, MAX_ENTRIES = 100, VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/u;
  const IMAGE = /^changelog-media\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|webp|jpg|jpeg)$/u;
  const $ = id => document.getElementById(id), object = value => value && typeof value === "object" && !Array.isArray(value);
  const fail = () => { throw Error("Invalid changelog data."); };
  function text(value, max, required = false) {
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || required && !value.trim()) fail();
    return value;
  }
  function array(value, max, required = false) { if (!Array.isArray(value) || value.length > max || required && !value.length) fail(); return value; }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail();
    const parsed = new Date(value + "T00:00:00Z"); if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail();
    return value;
  }
  function validate(input) {
    if (!object(input) || input.schemaVersion !== 1) fail();
    const ids = new Set();
    return array(input.entries, MAX_ENTRIES).map(entry => {
      if (!object(entry) || typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(entry.id) || ids.has(entry.id) || !["released", "unreleased"].includes(entry.status)) fail();
      ids.add(entry.id);
      if (entry.version !== null && (typeof entry.version !== "string" || !VERSION.test(entry.version))) fail();
      if (entry.status === "released" && (entry.version === null || entry.date === null)) fail();
      if (entry.date !== null) date(entry.date);
      return { id: entry.id, version: entry.version, status: entry.status, date: entry.date,
        title: text(entry.title, 160, true), summary: text(entry.summary, 2000), changes: array(entry.changes, 20, true).map(change => {
          if (!object(change) || !["fixed", "added", "improved"].includes(change.type)) fail();
          return { type: change.type, title: text(change.title, 160, true), description: text(change.description, 2000, true),
            details: change.details === undefined ? [] : array(change.details, 10).map(value => text(value, 2000, true)),
            images: change.images === undefined ? [] : array(change.images, 5).map(image => {
              if (!object(image) || typeof image.src !== "string" || image.src.length > 200 || !IMAGE.test(image.src) || image.src.includes("..")) fail();
              return { src: image.src, alt: text(image.alt, 500, true), caption: image.caption === undefined ? "" : text(image.caption, 1000) };
            }) };
        }) };
    });
  }
  function el(tag, name, value) { const node = document.createElement(tag); if (name) node.className = name; if (value !== undefined) node.textContent = value; return node; }
  const dialog = $("changelog-image-dialog"), full = $("changelog-image-full"); let returnFocus = null;
  $("changelog-image-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
  dialog.addEventListener("close", () => { full.removeAttribute("src"); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null; });
  function imageFigure(image, imageOverrides) {
    const figure = el("figure"), button = el("button", "changelog-image-button"), picture = el("img");
    const source = imageOverrides?.get(image.src) || image.src;
    button.type = "button"; button.setAttribute("aria-label", "Enlarge image: " + image.alt);
    picture.src = source; picture.alt = image.alt; picture.loading = "lazy"; picture.decoding = "async"; button.append(picture);
    button.addEventListener("click", () => { full.src = source; full.alt = image.alt; $("changelog-image-caption").textContent = image.caption; $("changelog-image-caption").hidden = !image.caption; returnFocus = button; dialog.showModal(); });
    figure.append(button); if (image.caption) figure.append(el("figcaption", "", image.caption)); return figure;
  }
  function typeBadge(type) {
    const badge = el("span", "change-type"), ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
    badge.dataset.type = type; svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", type === "added" ? "M6 2v8M2 6h8" : type === "fixed" ? "m2.5 6 2.3 2.3L9.5 3.6" : "M6 10V2m-3 3 3-3 3 3"); svg.append(path); badge.append(svg, document.createTextNode(type[0].toUpperCase() + type.slice(1))); return badge;
  }
  function renderEntries(entries, imageOverrides) {
    const releases = document.createDocumentFragment(), links = document.createDocumentFragment();
    for (const entry of entries) {
      const article = el("article", "release-entry"); article.id = entry.id;
      const header = el("header", "release-header"), meta = el("div", "release-meta"), label = entry.version ? "Version " + entry.version : "Next update";
      meta.append(el("span", "release-version", label)); const state = el("span", "release-status", entry.status === "released" ? "Released" : "Preview"); state.dataset.status = entry.status; meta.append(state);
      if (entry.date) { const time = el("time", "release-date", new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(entry.date + "T00:00:00Z"))); time.dateTime = entry.date; meta.append(time); }
      header.append(meta, el("h2", "", entry.title)); if (entry.summary) header.append(el("p", "release-summary", entry.summary));
      const changes = el("div", "release-changes");
      for (const change of entry.changes) {
        const section = el("section", "change"), heading = el("div", "change-heading"); heading.append(typeBadge(change.type), el("h3", "", change.title)); section.append(heading, el("p", "change-description", change.description));
        if (change.details.length) { const list = el("ul", "change-details"); change.details.forEach(detail => list.append(el("li", "", detail))); section.append(list); }
        if (change.images.length) { const images = el("div", "change-images"); change.images.forEach(image => images.append(imageFigure(image, imageOverrides))); section.append(images); }
        changes.append(section);
      }
      article.append(header, changes); releases.append(article);
      const link = el("a"); link.href = "#" + entry.id; link.append(el("span", "nav-dot"), document.createTextNode(entry.version || "Next update")); links.append(link);
    }
    $("changelog-entries").replaceChildren(releases); $("changelog-nav").replaceChildren(links);
    $("changelog-count").textContent = entries.length + (entries.length === 1 ? " entry" : " entries");
    $("changelog-status").hidden = Boolean(entries.length); $("changelog-layout").hidden = !entries.length;
    if (!entries.length) $("changelog-status").textContent = "No changelog entries have been published yet.";
    const target = location.hash.slice(1); if (/^[a-z0-9][a-z0-9-]{0,79}$/u.test(target)) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }
  function validateData(input) { return { schemaVersion: 1, entries: validate(input) }; }
  function render(input, options = {}) {
    const data = validateData(input), overrides = options.imageOverrides;
    if (overrides !== undefined) {
      if (!(overrides instanceof Map) || overrides.size > MAX_ENTRIES * 20 * 5) fail();
      for (const [path, value] of overrides) {
        if (typeof path !== "string" || !IMAGE.test(path) || path.includes("..") || typeof value !== "string" ||
            !value.startsWith("blob:" + location.origin + "/") || value.length > 500) fail();
      }
    }
    renderEntries(data.entries, overrides); return data;
  }
  async function load() {
    try {
      const version = globalThis.chrome?.runtime?.getManifest?.().version;
      $("changelog-installed").textContent = typeof version === "string" && VERSION.test(version) ? "Installed · " + version : "Local preview";
      const response = await fetch(new URL("changelog.json", location.href), { cache: "no-cache", redirect: "error" });
      if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_BYTES) fail();
      const raw = await response.text(); if (new TextEncoder().encode(raw).length > MAX_BYTES) fail();
      return render(JSON.parse(raw));
    } catch {
      $("changelog-layout").hidden = true; $("changelog-status").hidden = false; $("changelog-status").dataset.state = "error";
      $("changelog-status").textContent = "The changelog could not be loaded. Please reopen this page or try again after updating Reading Helper.";
      return null;
    }
  }
  const ready = load();
  globalThis.IKnowReaderChangelog = Object.freeze({ ready, render, validate: validateData });
})();
