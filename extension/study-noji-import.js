(() => {
  "use strict";
  const MAX_FILE_BYTES = 4 * 1024 * 1024, MAX_CARDS = 2000, MAX_COLUMNS = 64;
  const INVALID_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
  const draftCard = value => ({ text: value.trim().normalize("NFC") });

  function parseDelimited(source, separator) {
    const rows = [];
    let row = [], value = "", quoted = false, closed = false;
    function cell() {
      row.push(value.trim()); value = ""; closed = false;
      if (row.length > MAX_COLUMNS) throw Error("The file has too many columns.");
    }
    function line() {
      cell();
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (rows.length > MAX_CARDS + 1) throw Error("Choose a file with up to 2,000 cards.");
    }
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (quoted) {
        if (char !== '"') value += char;
        else if (source[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else if (char === separator) cell();
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[index + 1] === "\n") index++;
        line();
      } else if (char === '"' && !value.trim() && !closed) { quoted = true; value = ""; }
      else if (closed && /[ \t]/u.test(char)) continue;
      else if (closed || char === '"') throw Error("A quoted field could not be read.");
      else value += char;
    }
    if (quoted) throw Error("A quoted field was not closed.");
    if (value || row.length || closed) line();
    return rows;
  }

  function parse(source) {
    if (typeof source !== "string" || new TextEncoder().encode(source).length > MAX_FILE_BYTES) throw Error("Choose a CSV file smaller than 4 MiB.");
    const attempts = [];
    for (const separator of [",", ";", "\t"]) {
      try {
        const rows = parseDelimited(source.replace(/^\uFEFF/u, ""), separator);
        if (!rows.length) continue;
        const width = Math.max(...rows.map(row => row.length)), multi = rows.filter(row => row.length > 1).length;
        if (multi) attempts.push({ rows, width, multi });
      } catch {}
    }
    attempts.sort((a, b) => b.multi - a.multi || a.width - b.width);
    if (!attempts.length) throw Error("Choose a valid CSV with at least two columns and up to 2,000 cards.");
    return attempts[0];
  }

  function cardStatus(back, front, seen) {
    if (!back || !front || back.length > 5000 || front.length > 5000 || INVALID_TEXT.test(back) || INVALID_TEXT.test(front)) return "Incomplete";
    const identity = JSON.stringify([back, front]);
    if (seen.has(identity)) return "Duplicate";
    seen.add(identity); return "";
  }

  function hasColumnHeadings(row) {
    const values = row.map(value => value.trim().normalize("NFC").toLowerCase());
    return values.some(value => ["front", "question", "japanese", "romaji", "vorderseite", "frage", "japanisch"].includes(value)) &&
      values.some(value => ["back", "answer", "meaning", "translation", "english", "german", "rückseite", "rueckseite", "antwort", "bedeutung", "übersetzung", "uebersetzung", "deutsch", "englisch"].includes(value));
  }

  function create(importCards) {
    const dialog = document.createElement("dialog");
    dialog.className = "study-noji-dialog";
    dialog.setAttribute("aria-labelledby", "study-noji-title");
    dialog.innerHTML = `<header><h2 id="study-noji-title">Import Noji cards</h2><button class="danger" type="button" data-noji-close>Close</button></header>
      <p class="noji-instructions">In Noji, open your deck settings and export it as CSV.</p>
      <form>
        <label>CSV file<input type="file" accept=".csv,text/csv"></label>
        <div class="noji-import-fields" hidden>
          <label>Deck name<input name="title" maxlength="120" required></label>
          <div class="noji-mapping" hidden>
            <div><span>Front</span><button type="button" data-column="meaning" draggable="true"></button></div>
            <button class="noji-swap" type="button" aria-label="Swap columns">Swap</button>
            <div><span>Back</span><button type="button" data-column="japanese" draggable="true"></button></div>
          </div>
          <p class="noji-mapping-hint" hidden>Drag a column across or click to swap.</p>
          <div class="noji-fields noji-extra-columns" hidden>
            <label>Back column<select name="japanese"></select></label>
            <label>Front column<select name="meaning"></select></label>
          </div>
          <fieldset class="noji-choice"><legend>Deck language</legend><label><input type="radio" name="language" value="de" checked><span>German</span></label><label><input type="radio" name="language" value="en"><span>English</span></label></fieldset>
          <label class="noji-checkbox"><input type="checkbox" name="header">Skip the first row (column headings)</label>
          <ol class="noji-preview" aria-label="Cards to review"></ol>
        </div>
        <div class="noji-actions"><p role="status" aria-live="polite"></p><button type="submit" class="primary" disabled>Import cards</button></div>
      </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form"), fields = dialog.querySelector(".noji-import-fields");
    const file = form.querySelector('input[type="file"]'), status = form.querySelector('[role="status"]');
    const submit = form.querySelector('button[type="submit"]'), close = dialog.querySelector("[data-noji-close]");
    const list = dialog.querySelector(".noji-preview");
    const instructions = dialog.querySelector(".noji-instructions");
    const mapping = dialog.querySelector(".noji-mapping"), chips = [...mapping.querySelectorAll("[data-column]")];
    const field = name => form.elements.namedItem(name);
    let parsed = null, rows = [], shown = [], cards = [], busy = false, revision = 0, dragged = null, editingRow = null;
    let columns = { japanese: 0, meaning: 1 };

    function announce(message, error = false) {
      status.textContent = message; status.dataset.error = String(error);
    }
    function setBusy(next) {
      busy = next; file.disabled = next; fields.inert = next; close.disabled = next;
      submit.disabled = next || !cards.length || cards.length > MAX_CARDS || !field("title").value.trim();
    }
    function updateCards() {
      const seen = new Set();
      cards = [];
      let skipped = 0, excluded = 0;
      for (const [index, row] of shown.entries()) {
        const draft = row.drafts[columns.japanese];
        const japanese = draft.text.trim().normalize("NFC");
        const meaning = (row.cells[columns.meaning] || "").trim().normalize("NFC");
        const kind = row.kind || (/[。！？!?][」』）)]*$/u.test(japanese) ? "sentence" : "word");
        const issue = row.included ? cardStatus(japanese, meaning, seen) : "";
        if (row.issue.textContent !== issue) row.issue.textContent = issue;
        if (!row.included) excluded++;
        else if (issue) skipped++;
        else cards.push({ japanese, meaning, kind, cardMode: "original" });
        row.summaryJapanese.textContent = meaning || "Front missing";
        row.summaryMeaning.textContent = japanese || "Back missing";
        row.item.dataset.included = String(row.included);
        row.item.dataset.editing = String(row === editingRow);
        row.editor.hidden = row !== editingRow;
        row.editor.dataset.mode = "original";
        row.editButton.textContent = row === editingRow ? "Done" : "Edit";
        row.editButton.setAttribute("aria-expanded", String(row === editingRow));
        row.editButton.setAttribute("aria-label", `${row === editingRow ? "Done editing" : "Edit"} card ${index + 1}`);
        for (const name of ["japanese", "meaning"]) {
          const label = name === "japanese" ? "Back" : "Front";
          row.captions[name].textContent = label;
          row.inputs[name].setAttribute("aria-label", `${label} for card ${index + 1}`);
        }
      }
      const count = cards.length > MAX_CARDS ? "Choose up to 2,000 cards." : `${cards.length} ready to import.`;
      announce(count + (excluded ? ` ${excluded} unchecked.` : "") +
        (skipped ? ` ${skipped} incomplete or duplicate rows skipped.` : ""), !cards.length || cards.length > MAX_CARDS);
      setBusy(busy);
    }

    function update() {
      if (!parsed) return;
      const header = field("header").checked;
      const columnName = index => {
        const heading = header ? parsed.rows[0][index] : "";
        return heading ? `${index + 1}. ${heading.slice(0, 50)}` : `Column ${index + 1}`;
      };
      for (const name of ["japanese", "meaning"]) {
        [...field(name).options].forEach((option, index) => { option.textContent = columnName(index); });
        field(name).value = String(columns[name]);
      }
      for (const chip of chips) {
        chip.textContent = columnName(columns[chip.dataset.column]);
        chip.setAttribute("aria-label", `${chip.dataset.column === "japanese" ? "Back" : "Front"}: ${chip.textContent}. Swap columns`);
      }
      shown = rows.slice(header ? 1 : 0);
      if (!shown.includes(editingRow)) editingRow = null;
      const items = document.createDocumentFragment();
      shown.forEach((row, index) => {
        const column = columns.japanese;
        const draft = row.drafts[column] ||= draftCard(row.cells[column] || "");
        const item = document.createElement("li"), include = document.createElement("input");
        row.item = item;
        const summary = document.createElement("div"); summary.className = "noji-card-summary";
        include.type = "checkbox"; include.checked = row.included;
        include.setAttribute("aria-label", `Import card ${index + 1}`);
        include.addEventListener("change", () => { row.included = include.checked; updateCards(); });
        const text = document.createElement("div"); text.className = "noji-card-text";
        row.summaryJapanese = document.createElement("span"); row.summaryJapanese.className = "noji-card-japanese";
        row.summaryMeaning = document.createElement("span"); row.summaryMeaning.className = "noji-card-meaning";
        text.append(row.summaryJapanese, row.summaryMeaning);
        row.editor = document.createElement("div"); row.editor.className = "noji-card-editor";
        row.editor.id = `noji-card-editor-${index + 1}`;
        row.captions = {}; row.inputs = {};
        for (const name of ["japanese", "meaning"]) {
          const input = document.createElement("textarea"), column = columns[name];
          const label = document.createElement("label"), caption = document.createElement("span"); label.append(caption);
          label.dataset.nojiField = name;
          row.captions[name] = caption; row.inputs[name] = input;
          input.rows = 1; input.maxLength = 5000; input.value = name === "japanese" ? draft.text : row.cells[column] || "";
          input.setAttribute("aria-label", `${name === "japanese" ? "Back" : "Front"} for card ${index + 1}`);
          input.addEventListener("input", () => {
            row.cells[column] = input.value;
            if (name === "japanese") draft.text = input.value;
            else delete row.drafts[column];
            updateCards();
          });
          label.append(input); row.editor.append(label);
        }
        row.editButton = document.createElement("button"); row.editButton.type = "button"; row.editButton.className = "quiet noji-card-edit";
        row.editButton.setAttribute("aria-controls", row.editor.id);
        row.editButton.addEventListener("click", () => { editingRow = editingRow === row ? null : row; updateCards(); });
        summary.append(include, text, row.editButton);
        row.issue = document.createElement("span"); row.issue.className = "noji-row-issue";
        text.append(row.issue);
        item.append(summary, row.editor); items.append(item);
      });
      list.replaceChildren(items);
      updateCards();
    }

    function swapColumns() {
      if (busy || !parsed) return;
      columns = { japanese: columns.meaning, meaning: columns.japanese };
      update();
    }

    mapping.querySelector(".noji-swap").addEventListener("click", swapColumns);
    for (const chip of chips) {
      chip.addEventListener("click", swapColumns);
      chip.addEventListener("dragstart", event => {
        if (busy) { event.preventDefault(); return; }
        dragged = chip;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", chip.dataset.column);
        mapping.dataset.dragging = chip.dataset.column;
      });
      chip.addEventListener("dragover", event => {
        if (dragged && dragged !== chip) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
      });
      chip.addEventListener("drop", event => {
        if (!dragged || dragged === chip) return;
        event.preventDefault(); swapColumns();
      });
      chip.addEventListener("dragend", () => { dragged = null; delete mapping.dataset.dragging; });
    }
    file.addEventListener("change", async () => {
      const current = ++revision, selected = file.files[0];
      parsed = null; rows = []; shown = []; cards = []; editingRow = null; fields.hidden = true; instructions.hidden = false; list.replaceChildren(); setBusy(false);
      if (!selected) { announce(""); return; }
      announce("Reading CSV…");
      try {
        if (selected.size > MAX_FILE_BYTES) throw Error("Choose a CSV file smaller than 4 MiB.");
        const data = parse(await selected.text());
        if (current !== revision || !dialog.open) return;
        parsed = data;
        rows = data.rows.map(cells => ({ cells: [...cells], included: true, drafts: {} }));
        mapping.hidden = dialog.querySelector(".noji-mapping-hint").hidden = data.width !== 2;
        dialog.querySelector(".noji-extra-columns").hidden = data.width === 2;
        const headers = data.rows[0].map(value => value.toLowerCase());
        field("header").checked = hasColumnHeadings(data.rows[0]);
        const frontIndex = headers.findIndex(value => ["front", "question", "vorderseite", "frage"].includes(value));
        const backIndex = headers.findIndex(value => ["back", "answer", "rückseite", "rueckseite", "antwort"].includes(value));
        const front = frontIndex >= 0 ? frontIndex : 0;
        columns = { japanese: backIndex >= 0 && backIndex !== front ? backIndex : front === 0 ? 1 : 0, meaning: front };
        for (const name of ["japanese", "meaning"]) {
          field(name).replaceChildren(...Array.from({ length: data.width }, (_, column) => new Option("", String(column))));
        }
        field("title").value = selected.name.replace(/\.csv$/iu, "").slice(0, 120);
        instructions.hidden = true; fields.hidden = false; update();
      } catch (error) {
        if (current === revision && dialog.open) announce(error.message, true);
      }
    });
    field("header").addEventListener("change", update);
    for (const name of ["japanese", "meaning"]) {
      field(name).addEventListener("change", () => {
        const other = name === "japanese" ? "meaning" : "japanese";
        const selected = Number(field(name).value);
        if (selected === columns[other]) columns[other] = columns[name];
        columns[name] = selected;
        update();
      });
    }
    field("title").addEventListener("input", () => setBusy(busy));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submit.disabled || busy) return;
      setBusy(true); announce("Importing cards…");
      try {
        const result = await importCards({ title: field("title").value, language: field("language").value, cards });
        dialog.close(); return result;
      } catch (error) { announce(error.message, true); }
      finally { setBusy(false); }
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { revision++; });
    return { open() {
      if (dialog.open) return;
      form.reset(); parsed = null; rows = []; shown = []; cards = []; editingRow = null; fields.hidden = true; instructions.hidden = false; setBusy(false); announce(""); dialog.showModal();
    } };
  }
  const api = Object.freeze({ parse, draftCard, create });
  globalThis.IKnowNojiImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
