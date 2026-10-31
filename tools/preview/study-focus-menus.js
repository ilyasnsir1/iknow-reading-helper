/* Compact, palette-aware header choices. No native dropdown surfaces. */
(() => {
  "use strict";
  const choices = Object.freeze({
    language: [{ value: "en", label: "English" }, { value: "de", label: "German" }, { value: "both", label: "Both" }],
    theme: [{ value: "paper", label: "Original", swatch: ["#fff6e9", "#c99065"] }, { value: "midnight", label: "Midnight", swatch: ["#263344", "#a2afcf"] }, { value: "tokyo", label: "Tokyo Neon", swatch: ["#392747", "#c6a1eb"] }, { value: "forest", label: "Kyoto Forest", swatch: ["#2a4034", "#b5c6a4"] }]
  });
  const labels = { language: "Meaning language", theme: "Theme" };
  const moon = '<svg class="focus-menu-moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 12A6.1 6.1 0 0 1 8 4a6.5 6.5 0 1 0 8 8Z"/></svg>';
  const chevron = '<svg class="focus-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6"/></svg>';
  const check = '<svg class="focus-menu-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';
  const swatch = option => option.swatch ? `<svg class="focus-menu-swatch" data-swatch="${option.value}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="${option.swatch[0]}"/><path d="M3.636 16.364A9 9 0 0 0 16.364 3.636Z" fill="${option.swatch[1]}"/><circle cx="10" cy="10" r="9" fill="none" stroke="#9f94ab66" stroke-width=".6"/></svg>` : "";
  let lastCleanup = null;
  function render(input = {}) {
    const kinds = input.kind === "language" || input.kind === "theme" ? [input.kind] : ["language", "theme"];
    return kinds.map(kind => {
      const value = choices[kind].some(option => option.value === input[kind]) ? input[kind] : choices[kind][0].value;
      const selected = choices[kind].find(option => option.value === value), id = "focus-" + kind;
      return `<div class="focus-menu focus-menu-${kind}" data-focus-menu="${kind}" data-value="${value}"><button type="button" id="${id}-trigger" class="focus-menu-trigger" aria-label="${labels[kind]}, ${selected.label}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list"${kind === "language" && input.languageDisabled ? " disabled" : ""}>${kind === "theme" ? moon : ""}<span class="focus-menu-label">${selected.label}</span>${chevron}</button><div class="focus-menu-list" id="${id}-list" role="listbox" aria-label="${labels[kind]}" hidden>${choices[kind].map(option => `<button type="button" class="focus-menu-option" role="option" tabindex="-1" aria-selected="${option.value === value}" data-menu-kind="${kind}" data-menu-value="${option.value}">${swatch(option)}<span class="focus-menu-label">${option.label}</span>${check}</button>`).join("")}</div></div>`;
    }).join("");
  }
  function mount(container, callbacks = {}) {
    lastCleanup?.();
    if (!container?.querySelectorAll) return () => {};
    const menus = [...container.querySelectorAll("[data-focus-menu]")];
    let opened = null, cleaned = false;
    const parts = menu => ({ trigger: menu.querySelector(".focus-menu-trigger"), list: menu.querySelector(".focus-menu-list"), options: [...menu.querySelectorAll(".focus-menu-option")] });
    function close(restoreFocus = false) {
      if (!opened) return;
      const { trigger, list } = parts(opened);
      list.hidden = true; trigger.setAttribute("aria-expanded", "false"); opened = null;
      if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    }
    function open(menu, edge = "selected") {
      const { trigger, list, options } = parts(menu);
      if (trigger.disabled) return;
      close(); opened = menu; list.hidden = false; trigger.setAttribute("aria-expanded", "true");
      const next = edge === "first" ? options[0] : edge === "last" ? options.at(-1) : options.find(option => option.getAttribute("aria-selected") === "true") || options[0];
      next?.focus({ preventScroll: true });
    }
    function select(option, keyboard) {
      const menu = option.closest("[data-focus-menu]"), kind = menu.dataset.focusMenu;
      if (!menus.includes(menu) || parts(menu).trigger.disabled) return;
      const value = option.dataset.menuValue, selected = choices[kind]?.find(item => item.value === value);
      if (!selected) return;
      const { trigger, options } = parts(menu);
      menu.dataset.value = value; trigger.querySelector(".focus-menu-label").textContent = selected.label;
      trigger.setAttribute("aria-label", `${labels[kind]}, ${selected.label}`);
      options.forEach(item => item.setAttribute("aria-selected", String(item.dataset.menuValue === value)));
      close();
      if (kind === "theme") callbacks.onTheme?.(value);
      else callbacks.onLanguage?.(value);
      // The language callback can redraw the header. Keep keyboard navigation
      // at the corresponding new trigger without creating a mouse focus ring.
      if (keyboard) queueMicrotask(() => document.getElementById(`focus-${kind}-trigger`)?.focus({ preventScroll: true }));
    }
    function click(event) {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest(".focus-menu-trigger"), option = event.target.closest(".focus-menu-option");
      if (trigger && container.contains(trigger)) {
        const menu = trigger.closest("[data-focus-menu]");
        if (opened === menu) close(); else open(menu);
      } else if (option && container.contains(option)) select(option, event.detail === 0);
    }
    function keydown(event) {
      if (!(event.target instanceof Element)) return;
      const menu = event.target.closest("[data-focus-menu]");
      if (!menu || !menus.includes(menu)) return;
      const { trigger, options } = parts(menu);
      if (trigger.disabled) return;
      if (event.key === "Escape") { if (opened) { event.preventDefault(); close(true); } return; }
      if (event.key === "Tab") { close(true); return; }
      if (event.target === trigger) {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); open(menu, event.key === "Home" ? "first" : event.key === "End" || event.key === "ArrowUp" ? "last" : "selected");
        }
        return;
      }
      const at = options.indexOf(event.target);
      if (at < 0) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[index].focus({ preventScroll: true });
      } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(options[at], true); }
      else if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
        const next = [...options.slice(at + 1), ...options.slice(0, at + 1)].find(item => item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
        if (next) { event.preventDefault(); next.focus({ preventScroll: true }); }
      }
    }
    function outside(event) { if (opened && !opened.contains(event.target)) close(); }
    function focusout(event) { if (opened && event.relatedTarget && !opened.contains(event.relatedTarget)) close(); }
    function cleanup() {
      if (cleaned) return; cleaned = true; close();
      container.removeEventListener("click", click); container.removeEventListener("keydown", keydown); container.removeEventListener("focusout", focusout);
      document.removeEventListener("pointerdown", outside, true);
      if (lastCleanup === cleanup) lastCleanup = null;
    }
    container.addEventListener("click", click); container.addEventListener("keydown", keydown); container.addEventListener("focusout", focusout);
    document.addEventListener("pointerdown", outside, true); lastCleanup = cleanup;
    return cleanup;
  }
  globalThis.IKnowFocusMenus = Object.freeze({ render, mount });
})();
