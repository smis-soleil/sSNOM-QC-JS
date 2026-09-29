import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSnrStats, computePlotData, parseCustomSnrRanges, assessFileCompatibility, formatG,
} from "../js/analysis.js";
import { fileData, linspace } from "./helpers.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("calculateSnrStats uses population std over the inclusive range", () => {
  const wn = [700, 800, 900, 1000, 1100];
  const ratio = [2.0, 2.2, 2.4, 2.6, 2.8];
  const s = calculateSnrStats(wn, ratio, 800, 1100);
  const sl = ratio.slice(1);
  const mean = sl.reduce((a, b) => a + b) / sl.length;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / sl.length);
  close(s.snr, mean / std);
  close(s.yMin, 2.2 - std);
  close(s.yMax, 2.8 + std);
});

test("calculateSnrStats throws a ValueError for an empty range", () => {
  assert.throws(() => calculateSnrStats([700, 800, 900], [1, 1.1, 1.2], 1500, 1600),
    (e) => e.name === "ValueError" && /No data points/.test(e.message));
});

test("computePlotData returns ratio and both preset stats", () => {
  const wn = linspace(650, 1800, 1024);
  const sp1 = wn.map((_, i) => 2 + 0.01 * Math.sin(i));
  const sp2 = wn.map((_, i) => 1 + 0.01 * Math.cos(i));
  const { ratio, stats1, stats2 } = computePlotData(wn, sp1, wn, sp2);
  assert.equal(ratio.length, wn.length);
  close(ratio[3], sp1[3] / sp2[3]);
  assert.ok(Number.isFinite(stats1.snr) && Number.isFinite(stats2.snr));
});

test("computePlotData rejects mismatched lengths", () => {
  const wn = linspace(650, 1800, 10);
  assert.throws(() => computePlotData(wn, new Float64Array(10).fill(1), wn.slice(0, 9), new Float64Array(9).fill(1)));
});

test("parseCustomSnrRanges keeps valid rows and reports bad ones", () => {
  const wn = linspace(700, 1500, 100);
  const { ranges, errors } = parseCustomSnrRanges(
    [{ start: "800", end: "1300" }, { start: "abc", end: "1600" }, { start: "", end: "" }], wn);
  assert.deepEqual(ranges, [[800, 1300]]);
  assert.deepEqual(errors, ["Row 2: start and end must be numeric."]);
});

test("parseCustomSnrRanges reports missing, inverted and out-of-data rows", () => {
  const wn = linspace(700, 1500, 100);
  const { ranges, errors } = parseCustomSnrRanges([
    { start: "900", end: "" },
    { start: "1200", end: "1000" },
    { start: "3000", end: "3100" },
  ], wn);
  assert.deepEqual(ranges, []);
  assert.deepEqual(errors, [
    "Row 1: both start and end are required.",
    "Row 2: start must be lower than end.",
    "Row 3: no data points found in selected range [3000.0, 3100.0].",
  ]);
});

test("assessFileCompatibility flags point count and range mismatch", () => {
  const f2 = fileData("b", linspace(500, 1700, 400));
  const { warnings, presetValid } = assessFileCompatibility(fileData("a"), f2);
  assert.equal(presetValid, true);
  assert.ok(warnings.some((w) => w.includes("different numbers of points")));
  assert.ok(warnings.some((w) => w.includes("different wavenumber ranges")));
});

test("assessFileCompatibility disables presets not covered by data", () => {
  const wn = linspace(3000, 3100, 50);
  const { warnings, presetValid } = assessFileCompatibility(fileData("a", wn), fileData("b", wn));
  assert.equal(presetValid, false);
  assert.ok(warnings.some((w) => w.includes("Preset SNR ranges are not fully covered")));
});

test("assessFileCompatibility is quiet for matching files", () => {
  assert.deepEqual(assessFileCompatibility(fileData("a"), fileData("b")), { warnings: [], presetValid: true });
});

test("formatG matches Python {:g}", () => {
  assert.equal(formatG(800), "800");
  assert.equal(formatG(812.5), "812.5");
});
