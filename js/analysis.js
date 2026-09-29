// SNR computation and input validation, ported from sSNOM-QC source/app.py.
import { pyFloat } from "./nea-reader.js";

export const START_WN1 = 800, END_WN1 = 1300;
export const START_WN2 = 650, END_WN2 = 1800;
export const DEFAULT_RANGES = [[START_WN1, END_WN1], [START_WN2, END_WN2]];
export const DEMOD_OPTIONS = ["O2A", "O3A", "O4A", "O5A"];
export const MAX_FILES = 2;
export const MAX_UPLOAD_MB = 200;

// Named like Python's exception so the error box reads "ValueError: ...".
export class ValueError extends Error {
  get name() { return "ValueError"; }
}

// Python's repr() of a float, e.g. 800 -> "800.0", used in error messages.
export function pyFloatRepr(x) {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

// Python's "{:g}" format.
export function formatG(x) {
  return String(Number(x.toPrecision(6)));
}

function isClose(a, b) {
  return Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);
}

// Loop instead of Math.min(...a): spread overflows the stack on large arrays.
function minMax(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function hasDataInRange(wn, start, end) {
  for (const v of wn) if (v >= start && v <= end) return true;
  return false;
}

/** Mean/std SNR of `ratio` over [start, end] plus y-limits for plotting. */
export function calculateSnrStats(wn, ratio, start, end) {
  const slice = [];
  for (let i = 0; i < wn.length; i++) {
    if (wn[i] >= start && wn[i] <= end) slice.push(ratio[i]);
  }
  if (slice.length === 0) {
    throw new ValueError(`No data points in selected range [${start}, ${end}].`);
  }
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
  const [min, max] = minMax(slice);
  return { snr: mean / std, yMin: min - std, yMax: max + std };
}

/** Ratio sp1/sp2 and SNR stats for the two preset ranges. */
export function computePlotData(wn1, sp1, wn2, sp2) {
  if (sp1.length !== sp2.length) throw new ValueError("Spectra must have the same length.");
  if (wn1.length !== wn2.length) throw new ValueError("Wavenumber arrays must have the same length.");
  const ratio = Float64Array.from(sp1, (v, i) => v / sp2[i]);
  return {
    ratio,
    stats1: calculateSnrStats(wn1, ratio, START_WN1, END_WN1),
    stats2: calculateSnrStats(wn1, ratio, START_WN2, END_WN2),
  };
}

/** Warnings about the two files and whether the preset SNR ranges are usable. */
export function assessFileCompatibility(file1, file2) {
  const warnings = [];
  let presetValid = true;
  const wn1 = file1?.data?.Wavenumber;
  const wn2 = file2?.data?.Wavenumber;
  if (!wn1 || !wn2) return { warnings, presetValid };

  if (wn1.length !== wn2.length) {
    warnings.push("Files have different numbers of points and might not be compatible.");
  }
  const [lo1, hi1] = minMax(wn1), [lo2, hi2] = minMax(wn2);
  if (!(isClose(lo1, lo2) && isClose(hi1, hi2))) {
    warnings.push("Files have different wavenumber ranges and might not be compatible.");
  }
  for (const [s, e] of DEFAULT_RANGES) {
    if (!hasDataInRange(wn1, s, e) || !hasDataInRange(wn2, s, e)) presetValid = false;
  }
  if (!presetValid) {
    warnings.push(
      "Preset SNR ranges are not fully covered by uploaded data. Main SNR graphs are disabled."
    );
  }
  return { warnings, presetValid };
}

/** Validate user rows [{start, end}] (strings) into numeric [start, end] ranges. */
export function parseCustomSnrRanges(rows, wnReference = null) {
  const ranges = [];
  const errors = [];
  rows.forEach(({ start = "", end = "" }, idx) => {
    const s = String(start).trim(), e = String(end).trim();
    const n = idx + 1;
    if (!s && !e) return;
    if (!s || !e) return errors.push(`Row ${n}: both start and end are required.`);
    const startWn = pyFloat(s), endWn = pyFloat(e);
    if (startWn === null || endWn === null) {
      return errors.push(`Row ${n}: start and end must be numeric.`);
    }
    if (startWn >= endWn) return errors.push(`Row ${n}: start must be lower than end.`);
    if (wnReference && !hasDataInRange(wnReference, startWn, endWn)) {
      return errors.push(
        `Row ${n}: no data points found in selected range ` +
          `[${pyFloatRepr(startWn)}, ${pyFloatRepr(endWn)}].`
      );
    }
    ranges.push([startWn, endWn]);
  });
  return { ranges, errors };
}
