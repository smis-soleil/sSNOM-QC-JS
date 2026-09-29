// The Streamlit-style shell (js/chrome.js): theme, sidebar, print, copy, fullscreen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadApp } from "./dom.js";

const pressed = (app, choice) =>
  app.document.querySelector(`[data-theme-choice="${choice}"]`).getAttribute("aria-pressed");

describe("page", () => {
  test("has a title, favicon and all icons rendered", async () => {
    const app = await loadApp();
    assert.equal(app.document.title, "sSNOM-QC");
    assert.equal(app.document.querySelector('link[rel="icon"]').getAttribute("href"), "favicon.svg");
    const icons = [...app.document.querySelectorAll("[data-icon]")];
    assert.ok(icons.length > 10);
    for (const el of icons) assert.ok(el.querySelector("svg path"), `icon ${el.dataset.icon} rendered`);
  });

  test("loads nothing from other servers (fonts and Plotly are bundled)", () => {
    const root = new URL("..", import.meta.url);
    const files = ["index.html", ...readdirSync(new URL("css/", root)).map((f) => `css/${f}`),
      ...readdirSync(new URL("js/", root)).map((f) => `js/${f}`)];
    for (const f of files) {
      const text = readFileSync(new URL(f, root), "utf8");
      const external = text.match(/(?:src|href|url)\s*[=(]\s*["']?https?:\/\/[^"')\s]+/gi) || [];
      assert.deepEqual(external, [], `${f} references another server`);
    }
    const fonts = readFileSync(new URL("css/fonts.css", root), "utf8");
    for (const [, path] of fonts.matchAll(/url\(([^)]+)\)/g)) {
      assert.doesNotThrow(() => readFileSync(new URL(path, new URL("css/", root))), `${path} exists`);
    }
  });

  test("header has exactly the light, dark, copy and print buttons", async () => {
    const app = await loadApp();
    const labels = [...app.document.querySelectorAll(".header-actions button")].map((b) => b.getAttribute("aria-label"));
    assert.deepEqual(labels, ["Light theme", "Dark theme", "Copy figures to clipboard", "Print"]);
    assert.equal(app.$("menu-btn"), null);
  });
});

describe("theme", () => {
  test("follows the system theme until one is picked", async () => {
    const light = await loadApp({ prefersDark: false });
    assert.equal(light.document.documentElement.dataset.theme, undefined);
    assert.equal(pressed(light, "light"), "true");
    const dark = await loadApp({ prefersDark: true });
    assert.equal(pressed(dark, "dark"), "true");
    assert.equal(pressed(dark, "light"), "false");
  });

  test("buttons switch and remember the theme", async () => {
    const app = await loadApp();
    app.click(app.document.querySelector('[data-theme-choice="dark"]'));
    assert.equal(app.document.documentElement.dataset.theme, "dark");
    assert.equal(pressed(app, "dark"), "true");
    assert.equal(app.window.localStorage.getItem("ssnomqc-theme"), "dark");
    app.click(app.document.querySelector('[data-theme-choice="light"]'));
    assert.equal(app.document.documentElement.dataset.theme, "light");
    assert.equal(app.window.localStorage.getItem("ssnomqc-theme"), "light");
  });

  test("a saved theme is applied on load", async () => {
    const app = await loadApp({ storage: { "ssnomqc-theme": "dark" }, prefersDark: false });
    assert.equal(app.document.documentElement.dataset.theme, "dark");
    assert.equal(pressed(app, "dark"), "true");
  });
});

describe("sidebar", () => {
  test("collapses and expands, and remembers it", async () => {
    const app = await loadApp();
    const root = app.$("app");
    assert.equal(root.classList.contains("sidebar-collapsed"), false);
    assert.equal(app.$("expand-btn").hidden, true);
    app.click("collapse-btn");
    assert.equal(root.classList.contains("sidebar-collapsed"), true);
    assert.equal(app.$("expand-btn").hidden, false);
    assert.equal(app.$("sidebar").inert, true, "collapsed content is not focusable");
    assert.equal(app.window.localStorage.getItem("ssnomqc-sidebar-collapsed"), "1");
    app.click("expand-btn");
    assert.equal(root.classList.contains("sidebar-collapsed"), false);
    assert.equal(app.window.localStorage.getItem("ssnomqc-sidebar-collapsed"), "0");
  });

  test("starts collapsed if it was collapsed before", async () => {
    const app = await loadApp({ storage: { "ssnomqc-sidebar-collapsed": "1" } });
    assert.equal(app.$("app").classList.contains("sidebar-collapsed"), true);
  });

  test("starts collapsed on phones without saving that", async () => {
    const app = await loadApp({ mobile: true });
    assert.equal(app.$("app").classList.contains("sidebar-collapsed"), true);
    assert.equal(app.window.localStorage.getItem("ssnomqc-sidebar-collapsed"), null);
  });

  test("can be resized with the keyboard, within 200-600 px, and remembers it", async () => {
    const app = await loadApp();
    const sidebar = app.$("sidebar");
    const resizer = app.$("sidebar-resizer");
    const widthVar = () => app.document.documentElement.style.getPropertyValue("--sidebar-width");
    const arrow = (key, current) => {
      sidebar.getBoundingClientRect = () => ({ width: current });
      app.key(key, {}, resizer);
    };
    arrow("ArrowRight", 300);
    assert.equal(widthVar(), "316px");
    assert.equal(app.window.localStorage.getItem("ssnomqc-sidebar-width"), "316");
    arrow("ArrowRight", 595);
    assert.equal(widthVar(), "600px");
    arrow("ArrowLeft", 205);
    assert.equal(widthVar(), "200px");
  });
});

describe("print", () => {
  test("refreshes the figure snapshot, then prints", async () => {
    const app = await loadApp();
    await app.openPair();
    app.click("print-btn");
    await app.settle(100);
    assert.equal(app.printed, 1);
    assert.ok(app.Plotly.calls.some((c) => c.toImage && c.id === "main-plot"));
    assert.match(app.$("main-print").src, /^data:image\/png/);
  });

  test("prints even with nothing plotted", async () => {
    const app = await loadApp();
    app.click("print-btn");
    await app.settle();
    assert.equal(app.printed, 1);
  });
});

describe("copy figures", () => {
  test("is disabled until a figure is shown", async () => {
    const app = await loadApp();
    assert.equal(app.$("copy-figures-btn").disabled, true);
    await app.open("a.txt");
    assert.equal(app.$("copy-figures-btn").disabled, true);
    await app.open("b.txt");
    assert.equal(app.$("copy-figures-btn").disabled, false);
  });

  test("copies one PNG with all visible figures stacked", async () => {
    const app = await loadApp();
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click("display-graphs");
    app.click("copy-figures-btn");
    await app.settle(50);
    assert.equal(app.clipboard.writes.length, 1);
    assert.equal(app.clipboard.writes[0].type, "image/png");
    assert.equal(app.drawn.length, 2, "main and custom figure");
    assert.ok(app.drawn[1].y > app.drawn[0].y, "stacked vertically");
    assert.equal(app.$("copy-figures-btn").title, "Figures copied");
  });

  test("shows a failure when the clipboard refuses", async () => {
    const app = await loadApp();
    await app.openPair();
    app.clipboard.fail = true;
    app.click("copy-figures-btn");
    await app.settle(50);
    assert.equal(app.$("copy-figures-btn").title, "Copy failed");
  });
});

describe("fullscreen and code block", () => {
  test("a figure goes fullscreen and back with the button or Esc", async () => {
    const app = await loadApp();
    await app.openPair();
    const fig = app.$("main-figure");
    const btn = fig.querySelector(".fs-btn");
    app.click(btn);
    assert.ok(fig.classList.contains("fullscreen"));
    assert.ok(app.document.body.classList.contains("has-fullscreen"));
    assert.equal(btn.getAttribute("aria-label"), "Close fullscreen");
    app.key("Escape");
    assert.equal(fig.classList.contains("fullscreen"), false);
    assert.equal(btn.getAttribute("aria-label"), "Fullscreen");
  });

  test("the suggested-parameters block can be copied", async () => {
    const app = await loadApp();
    app.click(app.document.querySelector("#motd .copy-btn"));
    await app.settle();
    assert.equal(app.clipboard.texts.length, 1);
    assert.match(app.clipboard.texts[0], /In-contact tapping amplitude: 80 nm\nNumber of acquisitions: 16/);
  });
});
