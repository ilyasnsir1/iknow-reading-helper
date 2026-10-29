/* Local maintainer drafts. The native helper independently authorizes every call. */
(() => {
  "use strict";
  const Viewer = globalThis.IKnowReaderChangelog, trigger = document.getElementById("edit-changelog");
  if (!Viewer || !trigger || !globalThis.chrome?.runtime?.sendMessage) return;
  const el = (tag, name, value) => { const node = document.createElement(tag); if (name) node.className = name; if (value !== undefined) node.textContent = value; return node; };
  const request = async (action, values = {}) => {
    const result = await chrome.runtime.sendMessage({ type: "ikr:changelog:author", action, ...values, ...(["save", "image:add", "image:remove"].includes(action) ? { manual: true } : {}) });
    if (!result?.ok) throw Error(result?.error || "The editor is unavailable. Your changelog is unchanged.");
    return result;
  };
  let dialog, form, sidebar, notice, working, revision, selected = 0, busy = false, sourceChanged = false;
  const imageOverrides = new Map(), ownedImages = new Set(), removedImages = new Set(), newImages = new Set();
  let fields = null;
  function status(message, error = false) { notice.textContent = message; notice.dataset.error = String(error); }
  function setBusy(value) { busy = value; dialog.querySelectorAll("button,input,textarea,select").forEach(node => { node.disabled = value || node.dataset.editorLocked === "true"; }); if (!value) updateSidebar(); }
  async function loadImages(images = []) {
    ownedImages.clear();
    const references = new Set(working.entries.flatMap(entry => entry.changes.flatMap(change => (change.images || []).map(image => image.src))));
    for (const image of images) {
      ownedImages.add(image.src);
      if (!references.has(image.src) || imageOverrides.has(image.src)) continue;
      const result = await request("image:get", { src: image.src }), data = result.image;
      if (!data || !["image/png", "image/jpeg", "image/webp"].includes(data.mime) || typeof data.base64 !== "string" || data.base64.length > 850000) throw Error("An image could not be read.");
      const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
      imageOverrides.set(image.src, URL.createObjectURL(new Blob([bytes], { type: data.mime })));
    }
  }
  function renderDraft(explicit = false) {
    if (!sourceChanged || explicit) Viewer.render(working, { imageOverrides });
    const line = document.getElementById("changelog-draft-status");
    line.textContent = sourceChanged ? "Your draft was made before a newer update. Review it before publishing." : "Your draft · Visible only to you until the next release."; line.hidden = false;
  }
  function input(label, value = "", options = {}) {
    const wrap = el("label", "", label), node = el(options.multiline ? "textarea" : "input");
    if (!options.multiline) node.type = options.type || "text";
    node.value = value || ""; node.maxLength = options.max || 2000; wrap.append(node); return { wrap, node };
  }
  function select(label, values, value) {
    const wrap = el("label", "", label), node = el("select");
    for (const [key, text] of values) { const option = el("option", "", text); option.value = key; node.append(option); }
    node.value = value; wrap.append(node); return { wrap, node };
  }
  function action(text, callback, className = "editor-action") { const button = el("button", className, text); button.type = "button"; button.addEventListener("click", () => { if (!busy) void callback(); }); return button; }
  function readForm() {
    if (!fields || !working?.entries[selected]) return;
    const entry = working.entries[selected];
    entry.title = fields.title.value.trim(); entry.summary = fields.summary.value.trim(); entry.status = fields.state.value;
    entry.version = fields.version.value.trim() || null; entry.date = fields.date.value || null;
    for (const [index, change] of entry.changes.entries()) {
      const row = fields.changes[index]; if (!row) continue;
      const bullets = row.notes.value.split(/\r?\n/u).map(line => line.replace(/^\s*[-•]\s*/u, "").trim()).filter(Boolean);
      change.type = row.type.value; change.title = row.title.value.trim(); change.description = bullets[0] || ""; change.details = bullets.slice(1);
      change.images?.forEach((image, imageIndex) => { const nodes = row.images[imageIndex]; image.alt = nodes.alt.value.trim(); image.caption = nodes.caption.value.trim(); });
    }
  }
  function updateSidebar() {
    sidebar.replaceChildren();
    for (const [index, entry] of working.entries.entries()) {
      const button = action(entry.version || "Next update", () => { readForm(); selected = index; renderForm(); }, "editor-entry");
      button.setAttribute("aria-pressed", String(index === selected)); button.append(el("span", "", entry.title)); button.disabled = busy; sidebar.append(button);
    }
  }
  async function upload(file, change) {
    readForm(); setBusy(true); status("Adding image…");
    try {
      if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 6 * 1024 * 1024) throw Error("Choose a PNG, JPG or WebP image smaller than 6 MB.");
      let blob = file;
      if (file.size > 600 * 1024) {
        const picture = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(picture.width, picture.height));
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(picture.width * scale)); canvas.height = Math.max(1, Math.round(picture.height * scale));
        canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height); picture.close();
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .82));
      }
      if (!blob || blob.size > 600 * 1024) throw Error("This image is still too large. Try a smaller screenshot.");
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      const result = await request("image:add", { base64: btoa(binary), mime: blob.type, fileName: file.name, expectedRevision: revision });
      revision = result.revision;
      const image = result.image; if (!image?.src) throw Error("The image could not be added.");
      newImages.add(image.src); change.images ||= []; change.images.push({ src: image.src, alt: image.alt || "Update screenshot", caption: "" });
      await loadImages(result.images); status("Image added. Save draft when you're ready."); renderForm();
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  }
  function renderForm() {
    updateSidebar(); form.replaceChildren();
    const entry = working.entries[selected]; if (!entry) return;
    const title = input("Title", entry.title, { max: 160 }), summary = input("Short summary", entry.summary), version = input("Version", entry.version, { max: 30 }), date = input("Date", entry.date, { type: "date" });
    const state = select("Status", [["unreleased", "Next update"], ["released", "Released"]], entry.status), meta = el("div", "editor-row"); meta.append(state.wrap, version.wrap);
    form.append(title.wrap, summary.wrap, meta, date.wrap);
    fields = { title: title.node, summary: summary.node, version: version.node, date: date.node, state: state.node, changes: [] };
    const changes = el("div", "editor-changes");
    for (const [index, change] of entry.changes.entries()) {
      const section = el("section", "editor-change"), head = el("div", "editor-change-head"), type = select("", [["added", "Added"], ["fixed", "Fixed"], ["improved", "Improved"]], change.type);
      const remove = action("Remove note", () => { readForm(); entry.changes.splice(index, 1); renderForm(); }, "editor-text-action"); remove.dataset.editorLocked = String(entry.changes.length <= 1); remove.disabled = entry.changes.length <= 1;
      head.append(type.wrap, remove);
      const changeTitle = input("Heading", change.title, { max: 160 }), notes = input("Notes · one bullet per line", [change.description, ...(change.details || [])].join("\n"), { multiline: true, max: 12000 });
      section.append(head, changeTitle.wrap, notes.wrap);
      const images = el("div", "editor-images"), imageFields = [];
      for (const [imageIndex, image] of (change.images || []).entries()) {
        const row = el("div", "editor-image"), picture = el("img"); picture.src = imageOverrides.get(image.src) || image.src; picture.alt = image.alt;
        const controls = el("div", "editor-image-fields"), alt = input("Image description", image.alt, { max: 500 }), caption = input("Caption", image.caption, { max: 1000 });
        controls.append(alt.wrap, caption.wrap, action("Remove image", () => { readForm(); change.images.splice(imageIndex, 1); if (ownedImages.has(image.src)) removedImages.add(image.src); renderForm(); }, "editor-text-action"));
        row.append(picture, controls); images.append(row); imageFields.push({ alt: alt.node, caption: caption.node });
      }
      const file = el("input", "editor-file"); file.type = "file"; file.accept = "image/png,image/jpeg,image/webp";
      file.addEventListener("change", () => { if (file.files[0]) void upload(file.files[0], change); });
      const addImage = action("Add image", () => file.click()); addImage.dataset.editorLocked = String((change.images || []).length >= 5); addImage.disabled = (change.images || []).length >= 5;
      section.append(images, file, addImage); changes.append(section);
      fields.changes.push({ title: changeTitle.node, notes: notes.node, type: type.node, images: imageFields });
    }
    const addNote = action("Add note", () => { readForm(); entry.changes.push({ type: "added", title: "New change", description: "", details: [], images: [] }); renderForm(); });
    addNote.dataset.editorLocked = String(entry.changes.length >= 20); addNote.disabled = entry.changes.length >= 20; form.append(changes, addNote);
  }
  async function discard() {
    if (busy) return; setBusy(true);
    try { for (const src of newImages) { const result = await request("image:remove", { src, expectedRevision: revision }); revision = result.revision; if (imageOverrides.has(src)) URL.revokeObjectURL(imageOverrides.get(src)); imageOverrides.delete(src); } }
    catch { /* Unreferenced local uploads cannot change the published notes. */ }
    finally { setBusy(false); dialog.close(); trigger.focus(); }
  }
  async function save() {
    readForm(); setBusy(true); status("Saving draft…");
    try {
      const draft = Viewer.validate(working), result = await request("save", { draft, expectedRevision: revision }); let images = result.images;
      revision = result.revision; working = result.draft; sourceChanged = result.sourceChanged === true; newImages.clear();
      for (const src of removedImages) {
        const value = await request("image:remove", { src, expectedRevision: revision }); revision = value.revision; images = value.images;
        if (imageOverrides.has(src)) URL.revokeObjectURL(imageOverrides.get(src)); imageOverrides.delete(src);
      }
      removedImages.clear(); await loadImages(images); renderDraft(true); status("Draft saved. Publishing is a separate step."); dialog.close(); trigger.focus();
    } catch (error) { status(error.message === "Invalid changelog data." ? "Check the title, version and notes before saving." : error.message, true); }
    finally { setBusy(false); }
  }
  function makeDialog() {
    dialog = el("dialog", "changelog-editor"); dialog.id = "changelog-editor"; dialog.setAttribute("aria-labelledby", "editor-title");
    const head = el("header", "editor-head"), copy = el("div"), title = el("h2", "", "Edit changelog"); title.id = "editor-title";
    copy.append(title, el("p", "", "Keep it short. One change per bullet."));
    const close = action("", discard, "editor-close"); close.setAttribute("aria-label", "Close editor");
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path"); svg.setAttribute("viewBox", "0 0 20 20"); path.setAttribute("d", "m6 6 8 8M14 6l-8 8"); svg.append(path); close.append(svg); head.append(copy, close);
    const body = el("div", "editor-body"), aside = el("aside", "editor-sidebar"); sidebar = el("div", "editor-entry-list");
    aside.append(sidebar, action("Add entry", () => { readForm(); working.entries.unshift({ id: "update-" + Date.now().toString(36), version: null, status: "unreleased", date: null, title: "New update", summary: "", changes: [{ type: "added", title: "New change", description: "", details: [], images: [] }] }); selected = 0; renderForm(); }, "editor-action editor-new-entry"));
    form = el("div", "editor-form"); body.append(aside, form);
    const footer = el("footer", "editor-footer"); notice = el("p", "editor-status"); notice.setAttribute("role", "status");
    const saveButton = action("Save draft", save, "editor-action editor-save"); saveButton.id = "save-changelog-draft";
    footer.append(notice, action("Cancel", discard), saveButton); dialog.append(head, body, footer); document.body.append(dialog);
    dialog.addEventListener("cancel", event => { event.preventDefault(); void discard(); });
  }
  trigger.addEventListener("click", async () => {
    trigger.disabled = true;
    try {
      const result = await request("load"); working = Viewer.validate(result.draft); revision = result.revision; sourceChanged = result.sourceChanged === true; selected = 0; newImages.clear(); removedImages.clear();
      await loadImages(result.images); if (!dialog) makeDialog(); renderForm(); status(sourceChanged ? "This draft predates a newer update. Review it before publishing." : "Only you can edit this draft. Nothing is published automatically."); dialog.showModal();
    } catch { const line = document.getElementById("changelog-draft-status"); line.textContent = "The editor could not be opened. Your published changelog is unchanged."; line.hidden = false; }
    finally { trigger.disabled = false; }
  });
  window.addEventListener("pagehide", () => { for (const value of imageOverrides.values()) URL.revokeObjectURL(value); });
  void Viewer.ready.then(async data => {
    if (!data) return;
    try {
      const available = await request("status"); if (available.available !== true || available.role !== "maintainer") return;
      const loaded = await request("load"); working = Viewer.validate(loaded.draft); revision = loaded.revision; sourceChanged = loaded.sourceChanged === true; await loadImages(loaded.images);
      if (JSON.stringify(working) !== JSON.stringify(data)) renderDraft();
      trigger.hidden = false;
    } catch { /* Ordinary readers need neither author configuration nor a helper. */ }
  });
})();
