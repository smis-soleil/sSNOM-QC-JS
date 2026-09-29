// Port of pySNOM's NeaHeaderReader / NeaSpectralReader (pySNOM/readers.py)
// for NeaSNOM spectral .txt exports. Pure functions, no DOM access.

// Mirrors Python's float(): optional sign, decimal or exponent notation,
// surrounding whitespace, nan/inf. Returns null when Python would raise.
export function pyFloat(raw) {
  const s = String(raw).trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  const lower = s.toLowerCase().replace(/^[+-]/, "");
  const sign = s.startsWith("-") ? -1 : 1;
  if (lower === "nan") return NaN;
  if (lower === "inf" || lower === "infinity") return sign * Infinity;
  return null;
}

function requireFloat(raw, field) {
  const v = pyFloat(raw ?? "");
  if (v === null) throw new Error(`Invalid number '${raw}' in header field '${field}'.`);
  return v;
}

function requireInt(raw, field) {
  const s = String(raw ?? "").trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`Invalid integer '${raw}' in header field '${field}'.`);
  return parseInt(s, 10);
}

/** Parse one "# Field:\t[unit]\tvalue..." header line into params (mutated). */
export function parseHeaderLine(line, params = {}) {
  const ct = line.split("\t");
  let field = ct[0].slice(2, -1).replaceAll(" ", "");
  if (ct.length < 3) throw new Error(`Malformed header line: '${line.trim()}'.`);

  if (line.includes("Scanner Center Position")) {
    field = field.slice(0, -5);
    params[field] = [requireFloat(ct[2], field), requireFloat(ct[3], field)];
  } else if (line.includes("Scan Area")) {
    field = field.slice(0, -7);
    params[field] = [ct[2], ct[3], ct[4]].map((v) => requireFloat(v, field));
  } else if (line.includes("Pixel Area")) {
    field = field.slice(0, -7);
    params[field] = [ct[2], ct[3], ct[4]].map((v) => requireInt(v, field));
  } else if (line.includes("Averaging")) {
    params[field] = requireInt(ct[2], field);
  } else if (line.includes("Interferometer Center/Distance")) {
    field = field.replace("/", "");
    params[field] = [ct[2], ct[3]].map((v) => requireFloat((v ?? "").replaceAll(",", ""), field));
  } else if (line.includes("Regulator (P, I, D)")) {
    field = "Regulator";
    params[field] = [ct[2], ct[3], ct[4]].map((v) => requireFloat(v, field));
  } else if (line.includes("Regulator (P, I)")) {
    field = "RegulatorPercentage";
    params[field] = [ct[2], ct[3]].map((v) => requireFloat(v, field));
  } else if (line.includes("Q-Factor")) {
    field = field.replace("-", "");
    params[field] = requireFloat(ct[2], field);
  } else {
    const val = ct[2].replaceAll(",", "");
    const num = pyFloat(val);
    params[field] = num === null ? val.trim() : num;
  }
  return params;
}

/**
 * Parse the text of a NeaSNOM spectrum export.
 * Returns { data: {channel: Float64Array}, params: {...} } like
 * NeaSpectralReader(...).read() with output="dict".
 */
export function parseNeaSpectrum(text) {
  const lines = text.split(/\r?\n/);
  const params = {};

  // Line 0 is "# www.neaspec.com"; header lines follow, blank lines are skipped.
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    if (line[0] !== "#") break;
    parseHeaderLine(line, params);
  }
  if (i >= lines.length) throw new Error("No data found after the file header.");

  const channels = lines[i].trim().split("\t").map((c) => c.trim());
  const rows = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    const cells = lines[j].split("\t");
    const row = new Array(channels.length);
    for (let k = 0; k < channels.length; k++) {
      const v = cells[k] === undefined ? null : pyFloat(cells[k]);
      row[k] = v === null ? NaN : v;
    }
    rows.push(row);
  }

  // Remove rows with invalid coordinates caused by neaspec reader bugs.
  const rowIdx = channels.indexOf("Row");
  const colIdx = channels.indexOf("Column");
  if (rowIdx < 0 || colIdx < 0) {
    throw new Error("File has no 'Row'/'Column' channels; is this a NeaSNOM spectrum export?");
  }
  const valid = rows.filter((r) => Number.isFinite(r[rowIdx]) && Number.isFinite(r[colIdx]));

  const data = {};
  channels.forEach((name, k) => {
    if (name === "") return;
    const col = Float64Array.from(valid, (r) => r[k]);
    if (col.length > 0 && col.every(Number.isNaN)) return; // dropna(axis=1, how="all")
    data[name] = col;
  });
  return { data, params };
}

// Header fields pySNOM stores as Python ints; every other number is a float.
const INT_FIELDS = new Set(["Averaging", "PixelArea"]);

// Python's repr() of a float: "20.0", "1e-05", "1e+16", "nan", "inf".
export function pyFloatStr(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 16) {
    // Shortest round-trip digits, Python-style exponent (at least two digits).
    const [mant, e] = x.toExponential().split("e");
    const n = Number(e);
    return `${mant}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** str() of a parsed header value as Python would print it (metadata, caption). */
export function formatParamValue(key, value) {
  const one = (v) => (typeof v === "number" ? (INT_FIELDS.has(key) ? String(v) : pyFloatStr(v)) : String(v));
  return Array.isArray(value) ? `[${value.map(one).join(", ")}]` : one(value);
}
