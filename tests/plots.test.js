import { test } from "node:test";
import assert from "node:assert/strict";
import { PLOT_CONFIG, comparisonFigure, customSnrFigure, figureCaption } from "../js/plots.js";
import { fileData } from "./helpers.js";

test("comparisonFigure builds spectra plus two ratio panels", () => {
  const fig = comparisonFigure(fileData("a"), fileData("bb"), "O3A", 856, new Date(2024, 4, 19, 9, 5));
  assert.equal(fig.data.length, 4);
  assert.equal(fig.layout.xaxis.range, undefined, "spectra start autoscaled to the data");
  assert.equal(fig.layout.xaxis.autorange, true);
  assert.deepEqual(fig.layout.xaxis2.range, [800, 1300]);
  assert.deepEqual(fig.layout.xaxis3.range, [650, 1800]);
  assert.match(fig.layout.annotations[0].text, /Project: a<br>Plot date: 2024\/05\/19 09:05/);
  // matplotlib legends: one per panel, ratio legends show the SNR
  assert.deepEqual(fig.data.map((t) => t.legend), ["legend", "legend", "legend2", "legend3"]);
  assert.match(fig.data[2].name, /^SNR: \d+\.\d$/);
  assert.match(fig.data[3].name, /^SNR: \d+\.\d$/);
});

test("comparisonFigure reports a missing channel", () => {
  const b = fileData("b");
  delete b.data.O5A;
  assert.throws(() => comparisonFigure(fileData("a"), b, "O5A"), /O5A/);
});

test("customSnrFigure has one panel and legend per range", () => {
  const fig = customSnrFigure(fileData("a"), fileData("bb"), "O2A", [[800, 900], [1000, 1200], [700, 1700]]);
  assert.equal(fig.data.length, 3);
  assert.deepEqual(fig.layout.xaxis3.range, [700, 1700]);
  assert.deepEqual(fig.data.map((t) => t.legend), ["legend", "legend2", "legend3"]);
  assert.ok(fig.layout.annotations.some((a) => a.text === "Custom SNR range: 1000 - 1200 cm⁻¹"));
  assert.equal(fig.layout.xaxis.title, undefined); // x label only on the last panel
  assert.equal(fig.layout.xaxis3.title.text, "Frequency / cm⁻¹");
});

test("text scales with the plot width like the Streamlit PNG", () => {
  const small = comparisonFigure(fileData("a"), fileData("bb"), "O2A", 428);
  const big = comparisonFigure(fileData("a"), fileData("bb"), "O2A", 856);
  assert.equal(small.layout.xaxis.tickfont.size * 2, big.layout.xaxis.tickfont.size);
});

test("caption escapes file names and prefers tapping amplitude", () => {
  const a = fileData("<b>x</b>.txt");
  a.params = { Date: "d", TappingAmplitude: 76.2, TipAmplitude: 339.7, Averaging: 16,
    Integrationtime: 20, InterferometerCenterDistance: [470, 490] };
  const b = fileData("b.txt");
  const cap = figureCaption(a, b);
  assert.match(cap, /&lt;b&gt;x&lt;\/b&gt;\.txt/);
  // Python float formatting as in the Streamlit caption, plus the ' - ' after the date
  assert.match(cap, /Exp\. Date: d - TA: 76\.2 nm - Avg: 16 - Int time: 20\.0 ms - Interferometer: 470\.0, 490\.0/);
  assert.match(cap, /Avg: n\/a/); // missing params do not throw
});

test("long file names do not overflow the legend or the caption", () => {
  const long = "2026.09.28-17.31_2026-09-24 113848 NF S GoldRef-LHe-MCT-24-KRS5-polarizer-as-BS-s1 Spectra.txt";
  const a = fileData(long);
  const b = fileData(long.replace("s1", "s2") + "x");
  a.params = { Date: "09/24/2026 11:38:48", TappingAmplitude: 133.803, Averaging: 32,
    Integrationtime: 20, InterferometerCenterDistance: [400, 420] };
  const width = 640;
  const fig = comparisonFigure(a, b, "O3A", width);
  const legendChars = fig.data[0].name.length;
  assert.ok(fig.data[0].name.includes("…"), "legend name is shortened");
  assert.ok(legendChars < 60, `legend label too long: ${legendChars}`);
  assert.equal(fig.data[0].meta, long); // full name on hover
  const caption = fig.layout.annotations[1].text.split("<br>");
  assert.ok(caption.length > 5, "caption wraps");
  const maxLine = Math.max(...caption.map((l) => l.length));
  const fontPx = fig.layout.annotations[1].font.size;
  assert.ok(maxLine * fontPx * 0.56 <= width, "caption fits the figure width");
  assert.ok(caption.join("").replace(/&amp;/g, "&").includes("GoldRef")); // nothing dropped
  assert.ok(fig.layout.height > 0 && fig.layout.width === width);
});

test("ratio panels keep matplotlib's tick spacing at the reference size", () => {
  const fig = comparisonFigure(fileData("a"), fileData("bb"), "O2A", 856);
  assert.equal(fig.layout.xaxis2.dtick, 100);
  assert.equal(fig.layout.xaxis3.dtick, 250);
});

test("plot config never offers to upload data to Plotly's cloud", () => {
  assert.equal(PLOT_CONFIG.showSendToCloud, false);
  assert.equal(PLOT_CONFIG.plotlyServerURL, "");
});
