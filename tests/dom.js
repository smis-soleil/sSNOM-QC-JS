// Test harness: loads the real index.html into jsdom, stubs what jsdom lacks
// (Plotly, dialogs, matchMedia, clipboard, canvas, layout sizes) and imports a
// fresh copy of js/app.js, so each test drives the whole UI like a user.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { makeNeaText } from "./helpers.js";

const ROOT = new URL("..", import.meta.url);
const HTML = readFileSync(fileURLToPath(new URL("index.html", ROOT)), "utf8");
const APP = pathToFileURL(fileURLToPath(new URL("js/app.js", ROOT))).href;

// matchMedia results, read live so module-level MediaQueryLists stay usable
// across tests (chrome.js creates them once, on first import).
const media = { "screen and (max-width: 767.98px)": false, "(prefers-color-scheme: dark)": false };
function matchMedia(query) {
  return {
    get matches() { return !!media[query]; },
    media: query,
    addEventListener() {}, removeEventListener() {},
  };
}

/** Fake Plotly that records calls and remembers layouts like the real one. */
function fakePlotly(doc) {
  const calls = [];
  // Only record calls for this test's page (earlier tests' timers may still fire).
  const record = (gd, entry) => { if (gd.ownerDocument === doc) calls.push(entry); };
  return {
    calls,
    react(gd, data, layout, config) {
      record(gd, { id: gd.id, data, layout, config });
      gd._fullLayout = { width: layout.width, height: layout.height };
      gd.data = data;
      gd.layout = layout;
      return Promise.resolve(gd);
    },
    relayout(gd, update) {
      record(gd, { id: gd.id, relayout: update });
      return Promise.resolve(gd);
    },
    purge() {},
    async toImage(gd, opts) {
      record(gd, { id: gd.id, toImage: opts });
      return "data:image/png;base64,iVBORw0KGgo=";
    },
    last(id) {
      return [...calls].reverse().find((c) => c.id === id && c.data);
    },
  };
}

let instance = 0;

export async function loadApp({ storage = {}, mobile = false, prefersDark = false, width = 800 } = {}) {
  media["screen and (max-width: 767.98px)"] = mobile;
  media["(prefers-color-scheme: dark)"] = prefersDark;

  const dom = new JSDOM(HTML, { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);

  w.matchMedia = matchMedia;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function (v) {
    this.removeAttribute("open");
    if (v !== undefined) this.returnValue = v;
    this.dispatchEvent(new w.Event("close"));
  };
  w.HTMLImageElement.prototype.decode = async function () {};
  Object.defineProperty(w.HTMLImageElement.prototype, "naturalWidth", { get: () => 200, configurable: true });
  Object.defineProperty(w.HTMLImageElement.prototype, "naturalHeight", { get: () => 100, configurable: true });
  const drawn = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    return { fillRect() {}, drawImage: (img, x, y) => drawn.push({ x, y }), set fillStyle(v) {} };
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["png"], { type: "image/png" })); };
  // No layout engine: give figures a width so they get drawn.
  Object.defineProperty(w.HTMLElement.prototype, "clientWidth", {
    get() { return this.classList.contains("figure") ? width : 0; }, configurable: true,
  });
  Object.defineProperty(w.HTMLElement.prototype, "clientHeight", {
    get() { return this.classList.contains("figure") ? 600 : 0; }, configurable: true,
  });

  const clipboard = { writes: [], texts: [], fail: false };
  Object.defineProperty(w.navigator, "clipboard", {
    configurable: true,
    value: {
      async write(items) {
        if (clipboard.fail) throw new Error("denied");
        const blob = await items[0].types["image/png"];
        clipboard.writes.push(blob);
      },
      async writeText(t) { clipboard.texts.push(t); },
    },
  });
  class ClipboardItem { constructor(types) { this.types = types; } }
  let printed = 0;
  w.print = () => { printed++; };

  const Plotly = fakePlotly(w.document);
  const globals = {
    window: w, document: w.document, HTMLElement: w.HTMLElement, Event: w.Event, KeyboardEvent: w.KeyboardEvent,
    Image: w.Image, localStorage: w.localStorage, getComputedStyle: w.getComputedStyle,
    requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    ResizeObserver: class { observe() {} disconnect() {} }, ClipboardItem, Plotly,
  };
  for (const [k, v] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true, writable: true });

  // The app logs caught errors (e.g. the ValueError box) with console.error;
  // collect them per app instead of cluttering the test output.
  const errors = [];
  console.error = (...a) => errors.push(a);
  await import(`${APP}?instance=${++instance}`);

  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  const app = {
    window: w, document: doc, $, Plotly, clipboard, errors, drawn,
    get printed() { return printed; },
    settle,
    /** Pick a file through the (hidden) file input, like the Open button does. */
    async open(name, text = makeNeaText(), { size, type = "text/plain" } = {}) {
      const file = new w.File([text], name, { type });
      if (size !== undefined) Object.defineProperty(file, "size", { value: size });
      const input = $("file-input");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new w.Event("change"));
      await settle();
    },
    async openPair() {
      await app.open("a.txt", makeNeaText({ fn: (c, i) => 1 + c * 0.1 + Math.sin(i) * 0.01 }));
      await app.open("b.txt", makeNeaText({ fn: (c, i) => 1 + c * 0.2 + Math.cos(i) * 0.01 }));
    },
    click(el) { (typeof el === "string" ? $(el) : el).click(); },
    key(key, opts = {}, target = doc) {
      const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
      target.dispatchEvent(e);
      return e;
    },
    fileList() { return [...$("file-list").querySelectorAll("p")].map((p) => p.textContent); },
    text(id) { return $(id).textContent.replace(/\s+/g, " ").trim(); },
    msgs(id) { return [...$(id).querySelectorAll(".msg")].map((m) => [m.className.replace("msg ", ""), m.textContent]); },
    orderButtons() { return [...$("order-options").querySelectorAll("button")]; },
    selectedOrder() { return app.orderButtons().find((b) => b.getAttribute("aria-pressed") === "true")?.textContent ?? null; },
    orderButton(o) { return app.orderButtons().find((b) => b.textContent === o); },
    snrInputs() { return [...$("snr-rows").querySelectorAll("input")]; },
    setRow(idx, start, end) {
      const [s, e] = app.snrInputs().slice(idx * 2, idx * 2 + 2);
      for (const [el, v] of [[s, start], [e, end]]) {
        el.value = v;
        el.dispatchEvent(new w.Event("input"));
        el.dispatchEvent(new w.Event("change"));
      }
    },
    /** Visible top-level blocks of the main area, in order. */
    mainBlocks() {
      return [...$("main").children].filter((c) => !c.hidden)
        .map((c) => c.id || (c.classList.contains("exception") ? "exception" : `msg:${c.className.replace("msg ", "")}`));
    },
  };
  return app;
}
