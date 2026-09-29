// UI behaviour of the app (js/app.js), driven through the real page in jsdom.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./dom.js";
import { makeNeaText } from "./helpers.js";

const STATUS = "status-message";

describe("start-up", () => {
  test("shows the suggested parameters and asks for the first file", async () => {
    const app = await loadApp();
    assert.deepEqual(app.mainBlocks(), ["motd"]);
    assert.match(app.text("motd"), /In-contact tapping amplitude: 80 nm/);
    assert.deepEqual(app.msgs(STATUS), [["info", "Open your first spectrum file."]]);
    assert.equal(app.$("order-section").hidden, true);
    assert.equal(app.$("file-list-section").hidden, true);
    assert.equal(app.$("copy-figures-btn").disabled, true);
    assert.deepEqual(app.errors, []);
  });

  test("uses the Open wording", async () => {
    const app = await loadApp();
    assert.equal(app.text("upload-btn"), "Open");
    assert.match(app.document.querySelector(".sidebar-content p").textContent, /^Open two NeaSNOM files\.$/);
  });
});

describe("opening files", () => {
  test("first file is listed and the uploader is cleared", async () => {
    const app = await loadApp();
    await app.open("a.txt");
    assert.deepEqual(app.fileList(), ["1. a.txt"]);
    assert.deepEqual(app.msgs(STATUS), [["info", "Open one more file to proceed."]]);
    assert.equal(app.$("upl-chip-row").hidden, true, "no chip after a successful open");
    assert.deepEqual(app.msgs("upload-messages"), [], "no success message (Streamlit reruns straight away)");
  });

  test("shows a spinner while a file is read", async () => {
    const app = await loadApp();
    const file = new app.window.File([makeNeaText()], "slow.txt", { type: "text/plain" });
    Object.defineProperty(app.$("file-input"), "files", { value: [file], configurable: true });
    app.$("file-input").dispatchEvent(new app.window.Event("change"));
    assert.match(app.text("upload-messages"), /Loading slow\.txt\.\.\./);
    await app.settle();
    assert.equal(app.text("upload-messages"), "");
  });

  test("two files plot the O2A comparison", async () => {
    const app = await loadApp();
    await app.openPair();
    assert.deepEqual(app.fileList(), ["1. a.txt", "2. b.txt"]);
    assert.deepEqual(app.msgs(STATUS), [["success", "Both files uploaded."]]);
    assert.equal(app.$("order-section").hidden, false);
    assert.equal(app.selectedOrder(), "O2A");
    assert.deepEqual(app.mainBlocks(), ["main-figure", "metadata-section"]);
    const fig = app.Plotly.last("main-plot");
    assert.deepEqual(fig.data.map((t) => t.name), ["a.txt O2A", "b.txt O2A", fig.data[2].name, fig.data[3].name]);
    assert.match(fig.data[2].name, /^SNR: \d+\.\d$/);
    assert.match(fig.data[3].name, /^SNR: \d+\.\d$/);
    assert.equal(app.$("copy-figures-btn").disabled, false);
  });

  test("a duplicate name is ignored silently and stays in the uploader", async () => {
    const app = await loadApp();
    await app.open("a.txt");
    await app.open("a.txt");
    assert.deepEqual(app.fileList(), ["1. a.txt"]);
    assert.deepEqual(app.msgs("upload-messages"), []);
    assert.equal(app.$("upl-chip-row").hidden, false);
    assert.equal(app.text("upl-chip-name"), "a.txt");
    assert.match(app.text("upl-chip-size"), /^\d+(\.\d)?KB$/);
  });

  test("long names are shortened in the middle in the chip", async () => {
    const app = await loadApp();
    const long = "2026.09.28-17.31_2026-09-24 113848 NF S GoldRef.txt";
    await app.open(long);
    await app.open(long);
    assert.equal(app.text("upl-chip-name"), "2026.09...oldRef.txt"); // 7 + ... + last 10, as Streamlit
    assert.equal(app.$("upl-chip-name").title, long);
  });

  test("a third file shows the limit warning, which persists until the chip is removed", async () => {
    const app = await loadApp();
    await app.openPair();
    await app.open("c.txt");
    const warning = [["warning", "Maximum of 2 files allowed. Use reset button to clear."]];
    assert.deepEqual(app.msgs("upload-messages"), warning);
    app.click(app.orderButton("O3A")); // any rerun
    assert.deepEqual(app.msgs("upload-messages"), warning);
    app.click("upl-chip-remove");
    assert.deepEqual(app.msgs("upload-messages"), []);
    assert.equal(app.$("upl-chip-row").hidden, true);
    assert.deepEqual(app.fileList(), ["1. a.txt", "2. b.txt"]);
  });

  test("an unreadable file shows an error that persists across reruns", async () => {
    const app = await loadApp();
    await app.open("notes.txt", "hello\nworld\n");
    const [[kind, text]] = app.msgs("upload-messages");
    assert.equal(kind, "error");
    assert.match(text, /^Error loading file: /);
    assert.deepEqual(app.msgs(STATUS), [["info", "Open your first spectrum file."]]);
    app.click("display-graphs"); // rerun
    assert.equal(app.msgs("upload-messages").length, 1);
  });

  test("non-.txt files are rejected in the chip without being read", async () => {
    const app = await loadApp();
    await app.open("image.png", "x", { type: "image/png" });
    assert.equal(app.text("upl-chip-size"), "image/png files are not allowed.");
    assert.ok(app.$("upl-chip-size").classList.contains("error"));
    assert.equal(app.$("file-list-section").hidden, true);
  });

  test("files over 200 MB are rejected in the chip", async () => {
    const app = await loadApp();
    await app.open("huge.txt", "x", { size: 201 * 1024 * 1024 });
    assert.equal(app.text("upl-chip-size"), "File must be 200.0MB or smaller.");
    assert.equal(app.$("file-list-section").hidden, true);
  });

  test("files of an unknown type get a generic rejection", async () => {
    const app = await loadApp();
    await app.open("data.csv", "x", { type: "" });
    assert.equal(app.text("upl-chip-size"), "This file type files are not allowed.");
  });

  test("a file can be dropped on the uploader", async () => {
    const app = await loadApp();
    const zone = app.$("dropzone");
    const over = new app.window.Event("dragover", { bubbles: true, cancelable: true });
    zone.dispatchEvent(over);
    assert.ok(over.defaultPrevented, "the drop zone accepts drops");
    assert.ok(zone.classList.contains("dragover"));
    zone.dispatchEvent(new app.window.Event("dragleave"));
    assert.equal(zone.classList.contains("dragover"), false);
    zone.dispatchEvent(new app.window.Event("dragenter", { cancelable: true }));
    const drop = await app.drop("a.txt");
    assert.ok(drop.defaultPrevented);
    assert.equal(zone.classList.contains("dragover"), false);
    assert.deepEqual(app.fileList(), ["1. a.txt"]);
  });

  test("dropping a file elsewhere does not leave the app", async () => {
    const app = await loadApp();
    const e = await app.drop("a.txt", undefined, app.$("main"));
    assert.ok(e.defaultPrevented, "the browser would otherwise open the file");
    assert.deepEqual(app.fileList(), []);
    const over = new app.window.Event("dragover", { bubbles: true, cancelable: true });
    app.$("main").dispatchEvent(over);
    assert.ok(over.defaultPrevented);
  });

  test("removing the chip while a file is read discards it", async () => {
    for (const text of [makeNeaText(), "not a spectrum\n"]) {
      const app = await loadApp();
      const input = app.$("file-input");
      Object.defineProperty(input, "files", { value: [new app.window.File([text], "a.txt")], configurable: true });
      input.dispatchEvent(new app.window.Event("change"));
      app.click("upl-chip-remove"); // before the file text has been read
      await app.settle();
      assert.deepEqual(app.fileList(), []);
      assert.deepEqual(app.msgs("upload-messages"), [], "no late result or error");
      assert.equal(app.$("upl-chip-row").hidden, true);
    }
  });

  test("cancelling the file picker changes nothing", async () => {
    const app = await loadApp();
    await app.open("a.txt");
    const input = app.$("file-input");
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new app.window.Event("change"));
    await app.settle();
    assert.deepEqual(app.fileList(), ["1. a.txt"]);
    assert.equal(app.$("upl-chip-row").hidden, true);
  });

  test("the Open and + buttons open the file picker", async () => {
    const app = await loadApp();
    let picks = 0;
    app.$("file-input").addEventListener("click", (e) => { picks++; e.preventDefault(); });
    app.click("upload-btn");
    app.click("upl-add");
    assert.equal(picks, 2);
  });
});

describe("demodulation order", () => {
  test("switching order redraws with that channel and keeps the metadata", async () => {
    const app = await loadApp();
    await app.openPair();
    for (const order of ["O3A", "O4A", "O5A", "O2A"]) {
      app.click(app.orderButton(order));
      assert.equal(app.selectedOrder(), order);
      assert.match(app.Plotly.last("main-plot").data[0].name, new RegExp(`${order}$`));
      assert.deepEqual(app.mainBlocks(), ["main-figure", "metadata-section"], `after ${order}`);
    }
  });

  test("clicking the selected order keeps the plot", async () => {
    const app = await loadApp();
    await app.openPair();
    const draws = () => app.Plotly.calls.filter((c) => c.data).length;
    const before = draws();
    app.click(app.orderButton("O2A"));
    app.click(app.orderButton("O2A"));
    assert.equal(app.selectedOrder(), "O2A");
    assert.deepEqual(app.mainBlocks(), ["main-figure", "metadata-section"]);
    assert.equal(draws(), before, "no rerun for the already-selected order");
  });

  test("goes back to O2A after reset", async () => {
    const app = await loadApp();
    await app.openPair();
    app.click(app.orderButton("O5A"));
    app.click("reset");
    await app.openPair();
    assert.equal(app.selectedOrder(), "O2A");
  });
});

describe("custom SNR ranges", () => {
  test("+ adds rows and - removes the last one", async () => {
    const app = await loadApp();
    const addBtn = () => app.$("snr-rows").querySelector('[aria-label="Add range"]');
    const removeBtn = () => app.$("snr-rows").querySelector('[aria-label="Remove last range"]');
    assert.equal(app.snrInputs().length, 2);
    assert.equal(removeBtn(), null, "no - with a single row");
    app.click(addBtn());
    app.click(addBtn());
    assert.equal(app.snrInputs().length, 6);
    app.click(removeBtn());
    assert.equal(app.snrInputs().length, 4);
  });

  test("needs two files", async () => {
    const app = await loadApp();
    await app.open("a.txt");
    app.click("display-graphs");
    assert.deepEqual(app.msgs("custom-messages"), [["error", "Open two valid spectra before calculating custom SNR ranges."]]);
  });

  test("warns when nothing is entered", async () => {
    const app = await loadApp();
    await app.openPair();
    app.click("display-graphs");
    assert.deepEqual(app.msgs("custom-messages"), [["warning", "No valid custom SNR ranges entered."]]);
    assert.equal(app.$("custom-figure").hidden, true);
  });

  test("plots valid rows and lists errors for the others", async () => {
    const app = await loadApp();
    await app.openPair();
    app.click(app.$("snr-rows").querySelector('[aria-label="Add range"]'));
    app.click(app.$("snr-rows").querySelector('[aria-label="Add range"]'));
    app.setRow(0, "1000", "1200");
    app.setRow(1, "1500", "abc");
    app.setRow(2, "1200", "1000");
    app.click("display-graphs");
    assert.deepEqual(app.msgs("custom-messages"), [
      ["error", "Row 2: start and end must be numeric."],
      ["error", "Row 3: start must be lower than end."],
    ]);
    assert.deepEqual(app.mainBlocks(), ["main-figure", "additional-snr-graphs", "custom-figure", "metadata-section"]);
    const custom = app.Plotly.last("custom-plot");
    assert.equal(custom.data.length, 1);
    assert.deepEqual(custom.layout.xaxis.range, [1000, 1200]);
  });

  test("messages last one rerun; graphs follow the order", async () => {
    const app = await loadApp();
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click(app.$("snr-rows").querySelector('[aria-label="Add range"]'));
    app.setRow(1, "x", "y");
    app.click("display-graphs");
    assert.equal(app.msgs("custom-messages").length, 1);
    app.click(app.orderButton("O3A"));
    assert.deepEqual(app.msgs("custom-messages"), []);
    assert.equal(app.$("custom-figure").hidden, false);
    assert.match(app.Plotly.last("custom-plot").layout.yaxis.title.text, /^O3A Ratio/);
  });

  test("editing a field reruns (clearing messages) but does not replot until Display", async () => {
    const app = await loadApp();
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click("display-graphs");
    app.setRow(0, "900", "1100");
    assert.deepEqual(app.Plotly.last("custom-plot").layout.xaxis.range, [1000, 1200]);
    app.click("display-graphs");
    assert.deepEqual(app.Plotly.last("custom-plot").layout.xaxis.range, [900, 1100]);
  });

  test("Enter in a range field commits it", async () => {
    const app = await loadApp();
    app.click(app.document.querySelector("#custom-snr summary"));
    const [start] = app.snrInputs();
    start.focus();
    assert.equal(app.document.activeElement, start);
    app.key("Enter", {}, start);
    assert.notEqual(app.document.activeElement, start, "blurred, which commits like st.text_input");
  });

  test("the expander collapses when elements above it change, like Streamlit", async () => {
    const app = await loadApp();
    const ex = app.$("custom-snr");
    ex.open = true;
    await app.open("a.txt"); // file list appears above
    assert.equal(ex.open, false);
    ex.open = true;
    app.click("display-graphs"); // nothing above changes
    assert.equal(ex.open, true);
  });
});

describe("reset", () => {
  test("clears files, chip, rows and graphs and shows the suggested parameters again", async () => {
    const app = await loadApp();
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click(app.$("snr-rows").querySelector('[aria-label="Add range"]'));
    app.click("display-graphs");
    await app.open("a.txt"); // duplicate: chip stays
    app.click("reset");
    assert.deepEqual(app.mainBlocks(), ["motd"]);
    assert.equal(app.$("file-list-section").hidden, true);
    assert.equal(app.$("upl-chip-row").hidden, true);
    assert.deepEqual(app.snrInputs().map((i) => i.value), ["", ""]);
    assert.equal(app.$("copy-figures-btn").disabled, true);
    assert.deepEqual(app.msgs(STATUS), [["info", "Open your first spectrum file."]]);
  });
});

describe("problem files", () => {
  test("different lengths: warnings, error and ValueError traceback; parameters stay", async () => {
    const app = await loadApp();
    await app.open("a.txt", makeNeaText({ n: 64 }));
    await app.open("b.txt", makeNeaText({ n: 40 }));
    const compat = app.msgs("compat-messages").map(([, t]) => t);
    assert.ok(compat.some((t) => t.includes("different numbers of points")));
    assert.deepEqual(app.mainBlocks(), ["motd", "msg:error", "exception"]);
    assert.match(app.text("main"), /An error occurred: Spectra must have the same length\./);
    assert.match(app.document.querySelector(".exception").textContent, /^ValueError: Spectra must have the same length\.Traceback:/);
  });

  test("preset ranges not covered: warnings in sidebar and main, no plot", async () => {
    const app = await loadApp();
    await app.open("a.txt", makeNeaText({ wnMax: 500 }));
    await app.open("b.txt", makeNeaText({ wnMax: 500, fn: (c, i) => 2 + i * 1e-3 }));
    assert.match(app.text("compat-messages"), /Preset SNR ranges are not fully covered/);
    assert.deepEqual(app.mainBlocks(), ["motd", "msg:warning"]);
    assert.match(app.text("main"), /Cannot render main SNR graphs because preset SNR ranges are not valid/);
  });
});

describe("metadata", () => {
  test("two columns with Python-style values", async () => {
    const app = await loadApp();
    await app.openPair();
    const cols = [...app.$("metadata").children];
    assert.equal(cols.length, 2);
    const lines = [...cols[0].querySelectorAll("p")].map((p) => p.textContent);
    assert.equal(lines[0], "a.txt");
    assert.ok(lines.includes("Averaging: 45"));
    assert.ok(lines.includes("PixelArea: [1, 1, 1024]"));
    assert.ok(lines.includes("ScanArea: [0.0, 0.0, 0.0]"));
    assert.ok(lines.includes("Integrationtime: 20.0"));
    assert.ok(lines.includes("InterferometerCenterDistance: [470.0, 490.0]"));
  });
});

describe("figures", () => {
  test("keep a print snapshot up to date", async () => {
    const app = await loadApp();
    await app.openPair();
    // Snapshots are taken 400 ms after the last draw (the start-up layout
    // redraw at ~320 ms restarts that timer).
    await app.settle(900);
    assert.match(app.$("main-print").src, /^data:image\/png/);
    const shot = app.Plotly.calls.find((c) => c.toImage);
    assert.equal(shot.toImage.scale, 2);
  });

  test("are drawn without Plotly's cloud-upload button", async () => {
    const app = await loadApp();
    await app.openPair();
    const { config } = app.Plotly.last("main-plot");
    assert.equal(config.showSendToCloud, false);
    assert.equal(config.plotlyServerURL, "");
  });

  test("autoscale only touches the spectra panel, not the SNR panels", async () => {
    const app = await loadApp();
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click("display-graphs");
    const main = app.Plotly.last("main-plot").config;
    assert.ok(main.modeBarButtonsToRemove.includes("autoScale2d"));
    assert.equal(main.doubleClick, "reset");
    const [button] = main.modeBarButtonsToAdd;
    button.click(app.$("main-plot"));
    const { relayout } = app.Plotly.calls.find((c) => c.relayout);
    assert.deepEqual(relayout, { "xaxis.autorange": true, "yaxis.autorange": true });
    const custom = app.Plotly.last("custom-plot").config;
    assert.ok(custom.modeBarButtonsToRemove.includes("autoScale2d"));
    assert.equal(custom.modeBarButtonsToAdd, undefined);
    assert.equal(custom.toImageButtonOptions.filename, "ssnom-qc-custom-snr");
    assert.equal(custom.showSendToCloud, false);
  });

  test("are drawn at the figure's width", async () => {
    const app = await loadApp({ width: 640 });
    await app.openPair();
    assert.equal(app.Plotly.last("main-plot").layout.width, 640);
  });

  test("fullscreen figures are resized to fit the window", async () => {
    const app = await loadApp({ width: 800 }); // the harness reports 800 x 600 px figures
    await app.openPair();
    app.setRow(0, "1000", "1200");
    app.click("display-graphs");
    for (const id of ["main", "custom"]) {
      app.click(app.$(`${id}-figure`).querySelector(".fs-btn"));
      await app.settle(50);
      const { layout } = app.Plotly.last(`${id}-plot`);
      assert.ok(layout.width <= 800 - 64, `${id}: width ${layout.width}`);
      assert.ok(layout.height <= 600 - 80 + 1, `${id}: height ${layout.height}`);
      app.key("Escape");
      await app.settle(50);
      assert.equal(app.Plotly.last(`${id}-plot`).layout.width, 800, `${id}: back to normal size`);
    }
  });

  test("a failing page shell does not break opening and plotting", async () => {
    const app = await loadApp({ beforeStart: (doc) => doc.getElementById("print-btn").remove() });
    assert.ok(app.errors.length > 0, "the error is logged");
    await app.openPair();
    assert.ok(app.Plotly.last("main-plot"));
  });

  test("redraw when the sidebar changes the layout", async () => {
    const app = await loadApp();
    await app.openPair();
    const before = app.Plotly.calls.filter((c) => c.data).length;
    app.window.dispatchEvent(new app.window.Event("app:layout"));
    await app.settle(400);
    assert.ok(app.Plotly.calls.filter((c) => c.data).length > before);
  });
});
