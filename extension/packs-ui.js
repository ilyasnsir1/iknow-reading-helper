/* Local, data-only imports for additional course support. */
(() => {
  "use strict";
  const Packs = globalThis.IKnowReaderPacks;
  const button = document.getElementById("import-course-pack");
  const fileInput = document.getElementById("course-pack-file");
  const status = document.getElementById("course-pack-status");
  if (!Packs || !button || !fileInput || !status) return;
  function show(message, error = false) {
    status.textContent = message; status.hidden = !message; status.dataset.error = String(error);
  }
  button.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    button.disabled = true;
    show("Loading course data …");
    try {
      if (file.size > Packs.MAX_BYTES) throw new Error("The course file is too large.");
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("This is not a valid JSON course file."); }
      const pack = Packs.validate(parsed);
      // The worker serializes imports and automatic results, preserving concurrent course updates.
      const response = await chrome.runtime.sendMessage({ type: "ikr:auto:import", courseId: String(pack.course.id), pack });
      if (!response?.ok) throw new Error("Could not save course data. Please reload the extension.");
      show(`Added: ${pack.course.title}`);
    } catch (error) {
      show(error instanceof Error && /file|course|save/i.test(error.message) ? error.message : "Could not save course data.", true);
    } finally {
      button.disabled = false; fileInput.value = "";
    }
  });
})();
