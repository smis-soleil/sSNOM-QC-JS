// The Streamlit-style "shell" around the app: collapsible/resizable sidebar,
// header buttons (light/dark theme, print), copy buttons and element fullscreen. Preferences persist in localStorage like Streamlit's.
import { icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const MOBILE = window.matchMedia("screen and (max-width: 767.98px)");

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};

// ---- Sidebar ------------------------------------------------------------

function setCollapsed(collapsed, persist = true) {
  $("app").classList.toggle("sidebar-collapsed", collapsed);
  $("expand-btn").hidden = !collapsed;
  $("sidebar").setAttribute("aria-expanded", String(!collapsed));
  // Hidden sidebar content must not be reachable by keyboard.
  $("sidebar").inert = collapsed;
  if (persist && !MOBILE.matches) store.set("ssnomqc-sidebar-collapsed", collapsed ? "1" : "0");
  window.dispatchEvent(new Event("app:layout"));
}

function setupSidebar() {
  // Streamlit's initial_sidebar_state="auto": collapsed on small screens.
  setCollapsed(MOBILE.matches || store.get("ssnomqc-sidebar-collapsed") === "1", false);
  $("collapse-btn").addEventListener("click", () => setCollapsed(true));
  $("expand-btn").addEventListener("click", () => setCollapsed(false));
  MOBILE.addEventListener("change", (e) => { if (e.matches) setCollapsed(true, false); });

  const root = document.documentElement;
  const resizer = $("sidebar-resizer");
  const setWidth = (w) => {
    const width = Math.round(Math.min(600, Math.max(200, w)));
    root.style.setProperty("--sidebar-width", `${width}px`);
    return width;
  };
  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    $("app").classList.add("resizing");
    const move = (ev) => setWidth(ev.clientX);
    const up = () => {
      resizer.removeEventListener("pointermove", move);
      $("app").classList.remove("resizing");
      store.set("ssnomqc-sidebar-width", String(Math.round($("sidebar").getBoundingClientRect().width)));
      window.dispatchEvent(new Event("app:layout"));
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up, { once: true });
  });
  resizer.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const w = setWidth($("sidebar").getBoundingClientRect().width + (e.key === "ArrowRight" ? 16 : -16));
    store.set("ssnomqc-sidebar-width", String(w));
    window.dispatchEvent(new Event("app:layout"));
  });
}

// ---- Header actions: light / dark theme and print ---------------------------

const PREFERS_DARK = window.matchMedia("(prefers-color-scheme: dark)");

// No saved choice: follow the system theme; the matching icon shows as active.
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  const effective = choice === "light" || choice === "dark" ? choice : (PREFERS_DARK.matches ? "dark" : "light");
  document.querySelectorAll("[data-theme-choice]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.themeChoice === effective));
  });
}

function setupHeaderActions(prepareForPrint, copyFigures) {
  applyTheme(store.get("ssnomqc-theme"));
  PREFERS_DARK.addEventListener("change", () => applyTheme(store.get("ssnomqc-theme")));
  document.querySelectorAll("[data-theme-choice]").forEach((b) => {
    b.addEventListener("click", () => {
      store.set("ssnomqc-theme", b.dataset.themeChoice);
      applyTheme(b.dataset.themeChoice);
    });
  });
  const copyBtn = $("copy-figures-btn");
  copyBtn.addEventListener("click", async () => {
    const show = (name, label) => {
      copyBtn.innerHTML = icon(name);
      copyBtn.title = label;
      setTimeout(() => { copyBtn.innerHTML = icon("copy"); copyBtn.title = "Copy figures to clipboard"; }, 1500);
    };
    try {
      await copyFigures();
      show("check", "Figures copied");
    } catch (e) {
      console.error(e);
      show("cancel", "Copy failed");
    }
  });
  $("print-btn").addEventListener("click", async () => {
    try { await prepareForPrint?.(); } finally { window.print(); }
  });
}

// ---- Copy buttons on code blocks ------------------------------------------

function setupCopyButtons() {
  document.querySelectorAll(".code-block").forEach((block) => {
    const btn = block.querySelector(".copy-btn");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector("code").textContent);
        btn.innerHTML = icon("check", 16);
        setTimeout(() => { btn.innerHTML = icon("copy", 16); }, 1500);
      } catch { /* clipboard blocked */ }
    });
  });
}

// ---- Element fullscreen -------------------------------------------------------

export function setupFullscreen(onChange) {
  document.querySelectorAll(".figure").forEach((fig) => {
    const btn = fig.querySelector(".fs-btn");
    btn.addEventListener("click", () => toggle(fig, !fig.classList.contains("fullscreen")));
  });
  document.addEventListener("keydown", (e) => {
    const fig = document.querySelector(".figure.fullscreen");
    if (e.key === "Escape" && fig) toggle(fig, false);
  });
  function toggle(fig, on) {
    fig.classList.toggle("fullscreen", on);
    document.body.classList.toggle("has-fullscreen", on);
    const btn = fig.querySelector(".fs-btn");
    btn.innerHTML = icon(on ? "fullscreenExit" : "fullscreen", 18);
    btn.setAttribute("aria-label", on ? "Close fullscreen" : "Fullscreen");
    btn.title = btn.getAttribute("aria-label");
    onChange();
  }
}

function setupPrivacy() {
  const dialog = $("privacy-dialog");
  $("privacy-btn").addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
}

export function setupChrome({ prepareForPrint, copyFigures } = {}) {
  setupSidebar();
  setupHeaderActions(prepareForPrint, copyFigures);
  setupCopyButtons();
  setupPrivacy();
}
