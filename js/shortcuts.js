// Keyboard shortcuts. Most reuse the on-screen buttons, so they behave
// exactly like clicking them (including disabled states).
const $ = (id) => document.getElementById(id);

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";

export const SHORTCUTS = [
  { keys: ["F"], action: "Open a spectrum file" },
  { keys: ["O"], action: "Next demodulation order" },
  { keys: ["D"], action: "Switch between light and dark theme" },
  { keys: ["S"], action: "Collapse or expand the sidebar" },
  { keys: [MOD, "C"], action: "Copy all figures to the clipboard" },
  { keys: [MOD, "P"], action: "Print" },
  { keys: ["?"], action: "Show keyboard shortcuts" },
];

function isTyping(target) {
  return target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function hasTextSelection() {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
}

function toggleTheme() {
  const darkActive = document.querySelector('[data-theme-choice="dark"]')?.getAttribute("aria-pressed") === "true";
  document.querySelector(`[data-theme-choice="${darkActive ? "light" : "dark"}"]`)?.click();
}

function buildDialog() {
  const dialog = $("shortcuts-dialog");
  const rows = SHORTCUTS.map(({ keys, action }) => {
    const tr = document.createElement("tr");
    const k = document.createElement("td");
    keys.forEach((key, i) => {
      if (i) k.append(" + ");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      k.append(kbd);
    });
    const a = document.createElement("td");
    a.textContent = action;
    tr.append(k, a);
    return tr;
  });
  dialog.querySelector("tbody").replaceChildren(...rows);
  return dialog;
}

export function setupShortcuts({ cycleOrder }) {
  const dialog = buildDialog();

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.shiftKey && !e.altKey) {
      if (key === "p") {
        e.preventDefault(); // our print refreshes the figure snapshots first
        $("print-btn").click();
      } else if (key === "c" && !isTyping(e.target) && !hasTextSelection()) {
        const btn = $("copy-figures-btn");
        if (!btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
    if (e.key === "?") {
      e.preventDefault();
      dialog.showModal();
    } else if (key === "f") {
      e.preventDefault();
      $("file-input").click(); // a key press counts as user activation
    } else if (key === "o") {
      e.preventDefault();
      cycleOrder();
    } else if (key === "d") {
      e.preventDefault();
      toggleTheme();
    } else if (key === "s") {
      e.preventDefault();
      const collapsed = $("app").classList.contains("sidebar-collapsed");
      $(collapsed ? "expand-btn" : "collapse-btn").click();
    }
  });

  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
}
