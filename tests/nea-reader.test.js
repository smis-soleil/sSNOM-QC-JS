import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNeaSpectrum, parseHeaderLine, pyFloat, pyFloatStr, formatParamValue } from "../js/nea-reader.js";
import { CHANNELS, makeNeaText } from "./helpers.js";

test("pyFloat follows Python float() rules", () => {
  assert.equal(pyFloat(" 12.5 "), 12.5);
  assert.equal(pyFloat("1e3"), 1000);
  assert.equal(pyFloat(".5"), 0.5);
  assert.ok(Number.isNaN(pyFloat("nan")));
  assert.equal(pyFloat("-inf"), -Infinity);
  assert.equal(pyFloat(""), null);
  assert.equal(pyFloat("2.1.11508.0"), null);
  assert.equal(pyFloat("05/19/2024 16:59:10"), null);
});

test("header fields are typed like pySNOM", () => {
  const { params } = parseNeaSpectrum(makeNeaText());
  assert.equal(params.Scan, "Fourier Scan");
  assert.equal(params.Project, "QC-Project");
  assert.equal(params.Date, "05/19/2024 16:59:10");
  assert.deepEqual(params.ScannerCenterPosition, [46.77, 49.79]);
  assert.deepEqual(params.ScanArea, [0, 0, 0]);
  assert.deepEqual(params.PixelArea, [1, 1, 1024]);
  assert.deepEqual(params.InterferometerCenterDistance, [470, 490]);
  assert.equal(params.Averaging, 45);
  assert.equal(params.Integrationtime, 20);
  assert.equal(params.LaserSource, "");
  assert.equal(params.TipFrequency, 68263.5);
  assert.equal(params.TappingAmplitude, 76.233);
  assert.deepEqual(params.Regulator, [3.767854, 6.228756, 1]);
  assert.equal(params.QFactor, 221.1);
  assert.equal(params.Version, "2.1.11508.0");
});

test("Regulator (P, I) is stored as RegulatorPercentage", () => {
  const p = parseHeaderLine("# Regulator (P, I):\t[%]\t10\t20", {});
  assert.deepEqual(p, { RegulatorPercentage: [10, 20] });
});

test("data channels are parsed into Float64Arrays", () => {
  const { data } = parseNeaSpectrum(makeNeaText({ n: 10 }));
  assert.deepEqual(Object.keys(data), CHANNELS);
  assert.ok(data.Wavenumber instanceof Float64Array);
  assert.equal(data.Wavenumber.length, 10);
  assert.equal(data.Wavenumber[9], 2500);
  assert.equal(data.O2A[0], 1 + 4 * 0.1);
});

test("CRLF line endings are handled", () => {
  const { data, params } = parseNeaSpectrum(makeNeaText({ n: 5, eol: "\r\n" }));
  assert.equal(data.O5P.length, 5);
  assert.equal(params.Version, "2.1.11508.0");
});

test("rows with invalid Row/Column coordinates are dropped", () => {
  const bad = ["x", "0", "99", "1000", ...Array(12).fill("1")].join("\t");
  const { data } = parseNeaSpectrum(makeNeaText({ n: 5, extraRows: [bad] }));
  assert.equal(data.Row.length, 5);
});

test("non-NeaSNOM text is rejected", () => {
  assert.throws(() => parseNeaSpectrum("hello\nworld\n"), /Row/);
  assert.throws(() => parseNeaSpectrum("# www.neaspec.com\n# Scan:\t \tFourier\n"), /No data/);
});

test("pyFloatStr matches Python repr(float)", () => {
  assert.equal(pyFloatStr(20), "20.0");
  assert.equal(pyFloatStr(0), "0.0");
  assert.equal(pyFloatStr(1.003656), "1.003656");
  assert.equal(pyFloatStr(1e-5), "1e-05");
  assert.equal(pyFloatStr(0.0001), "0.0001");
  assert.equal(pyFloatStr(1e16), "1e+16");
  assert.equal(pyFloatStr(NaN), "nan");
});

test("formatParamValue prints metadata like str() in Python", () => {
  const { params } = parseNeaSpectrum(makeNeaText());
  assert.equal(formatParamValue("Averaging", params.Averaging), "45");
  assert.equal(formatParamValue("PixelArea", params.PixelArea), "[1, 1, 1024]");
  assert.equal(formatParamValue("ScanArea", params.ScanArea), "[0.0, 0.0, 0.0]");
  assert.equal(formatParamValue("Integrationtime", params.Integrationtime), "20.0");
  assert.equal(formatParamValue("InterferometerCenterDistance", params.InterferometerCenterDistance), "[470.0, 490.0]");
  assert.equal(formatParamValue("Detector", "R"), "R");
  assert.equal(formatParamValue("LaserSource", ""), "");
});

test("bad header values name the field", () => {
  const parse = (line) => () => parseHeaderLine(line, {});
  assert.throws(parse("# Q-Factor:\t \tabc"), /Invalid number 'abc' in header field 'QFactor'/);
  assert.throws(parse("# Averaging:\t \t4.5"), /Invalid integer '4.5' in header field 'Averaging'/);
  assert.throws(parse("# Pixel Area (X, Y, Z):\t[px]\t1\tx\t1024"), /Invalid integer 'x' in header field 'PixelArea'/);
  assert.throws(parse("# Scanner Center Position (X, Y):\t[µm]\t46.77"),
    /Missing value in header field 'ScannerCenterPosition'/);
  assert.throws(parse("# Interferometer Center/Distance:\t[µm]\t470"),
    /Missing value in header field 'InterferometerCenterDistance'/);
  assert.throws(parse("# Averaging:\t \t"), /Invalid integer ''/);
  assert.throws(parse("# Averaging:\t"), /Malformed header line: '# Averaging:'/);
});

test("a bad header line rejects the whole file", () => {
  const text = makeNeaText().replace("# Averaging:\t \t45", "# Averaging:\t \tmany");
  assert.throws(() => parseNeaSpectrum(text), /Invalid integer 'many'/);
});

test("short rows are padded with NaN; empty and all-NaN columns are dropped", () => {
  const header = makeNeaText().split("\n").slice(0, 17).join("\n");
  const text = `${header}\nRow\tColumn\t\tWavenumber\tO2A\tNote\n` +
    "0\t0\t\t800\t1.5\tx\n" +
    "0\t0\t\t900\n";
  const { data } = parseNeaSpectrum(text);
  assert.deepEqual(Object.keys(data), ["Row", "Column", "Wavenumber", "O2A"]);
  assert.deepEqual([...data.Wavenumber], [800, 900]);
  assert.equal(data.O2A[0], 1.5);
  assert.ok(Number.isNaN(data.O2A[1]));
});

test("pyFloatStr handles infinities and negative zero", () => {
  assert.equal(pyFloatStr(Infinity), "inf");
  assert.equal(pyFloatStr(-Infinity), "-inf");
  assert.equal(pyFloatStr(-0), "-0.0");
});
