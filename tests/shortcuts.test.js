// Keyboard shortcuts (js/shortcuts.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./dom.js";
import { IS_MAC, SHORTCUTS } from "../js/shortcuts.js";

const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true };
const isCollapsed = (app) => app.$("app").classList.contains("sidebar-collapsed");

describe("single-key shortcuts", () => {
  test("F opens the file picker", async () => {
    const app = await loadApp();
    let picks = 0;
    app.$("file-input").addEventListener("click", (e) => { picks++; e.preventDefault(); });
    app.key("f");
    app.key("F", { shiftKey: true });
    assert.equal(picks, 2);
  });

  test("O cycles the demodulation order and wraps around", async () => {
    const app = await loadApp();
    await app.openPair();
    const seen = [];
    for (let i = 0; i < 5; i++) {
      app.key("o");
      seen.push(app.selectedOrder());
    }
    assert.deepEqual(seen, ["O3A", "O4A", "O5A", "O2A", "O3A"]);
    assert.match(app.Plotly.last("main-plot").data[0].name, /O3A$/);
  });

  test("O does nothing before two files are open", async () => {
    const app = await loadApp();
    await app.open("a.txt");
    app.key("o");
    assert.equal(app.$("order-section").hidden, true);
    await app.open("b.txt");
    assert.equal(app.selectedOrder(), "O2A");
  });

  test("D switches between light and dark", async () => {
    const app = await loadApp({ prefersDark: false });
    app.key("d");
    assert.equal(app.document.documentElement.dataset.theme, "dark");
    app.key("d");
    assert.equal(app.document.documentElement.dataset.theme, "light");
  });

  test("S collapses and expands the sidebar", async () => {
    const app = await loadApp();
    app.key("s");
    assert.equal(isCollapsed(app), true);
    app.key("s");
    assert.equal(isCollapsed(app), false);
  });

  test("? opens the shortcut list with every shortcut", async () => {
    const app = await loadApp();
    const dialog = app.$("shortcuts-dialog");
    app.key("?", { shiftKey: true });
    assert.equal(dialog.open, true);
    const rows = [...dialog.querySelectorAll("tbody tr")].map((r) => r.cells[1].textContent);
    assert.deepEqual(rows, SHORTCUTS.map((s) => s.action));
    assert.equal(rows.length, 7);
  });

  test("keys typed through an input method (IME) are ignored", async () => {
    const app = await loadApp();
    app.key("s", { isComposing: true });
    assert.equal(isCollapsed(app), false);
  });

  test("other shortcuts are paused while the list is open", async () => {
    const app = await loadApp();
    app.key("?");
    app.key("s");
    assert.equal(isCollapsed(app), false);
  });

  test("clicking the backdrop closes the list", async () => {
    const app = await loadApp();
    const dialog = app.$("shortcuts-dialog");
    app.key("?");
    dialog.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    assert.equal(dialog.open, false);
  });
});

describe("modifier shortcuts", () => {
  test("Cmd/Ctrl+P prints through the app (fresh snapshot)", async () => {
    const app = await loadApp();
    await app.openPair();
    const e = app.key("p", MOD);
    assert.equal(e.defaultPrevented, true, "browser print replaced");
    await app.settle(100);
    assert.equal(app.printed, 1);
  });

  test("Cmd/Ctrl+C copies the figures when no text is selected", async () => {
    const app = await loadApp();
    await app.openPair();
    const e = app.key("c", MOD);
    await app.settle(50);
    assert.equal(e.defaultPrevented, true);
    assert.equal(app.clipboard.writes.length, 1);
  });

  test("Cmd/Ctrl+C keeps normal text copying when text is selected", async () => {
    const app = await loadApp();
    await app.openPair();
    const range = app.document.createRange();
    range.selectNodeContents(app.$("metadata"));
    app.window.getSelection().addRange(range);
    const e = app.key("c", MOD);
    await app.settle(50);
    assert.equal(e.defaultPrevented, false);
    assert.equal(app.clipboard.writes.length, 0);
  });

  test("Cmd/Ctrl+C does nothing special before there is a figure", async () => {
    const app = await loadApp();
    const e = app.key("c", MOD);
    assert.equal(e.defaultPrevented, false);
  });

  test("letters with Ctrl/Cmd/Alt are left to the browser", async () => {
    const app = await loadApp();
    for (const opts of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const e = app.key("s", opts);
      assert.equal(e.defaultPrevented, false);
    }
    assert.equal(isCollapsed(app), false);
  });
});

describe("typing", () => {
  test("shortcuts are ignored inside text fields", async () => {
    const app = await loadApp();
    await app.openPair();
    const input = app.snrInputs()[0];
    for (const k of ["o", "d", "s", "f", "?"]) app.key(k, {}, input);
    assert.equal(app.selectedOrder(), "O2A");
    assert.equal(isCollapsed(app), false);
    assert.equal(app.$("shortcuts-dialog").open, false);
    const e = app.key("c", MOD, input);
    await app.settle(50);
    assert.equal(e.defaultPrevented, false);
    assert.equal(app.clipboard.writes.length, 0);
  });
});
