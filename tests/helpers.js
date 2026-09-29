// Builds synthetic NeaSNOM spectrum exports for tests.
export const CHANNELS = ["Row", "Column", "Omega", "Wavenumber",
  "O0A", "O0P", "O1A", "O1P", "O2A", "O2P", "O3A", "O3P", "O4A", "O4P", "O5A", "O5P"];

export const HEADER = [
  "# www.neaspec.com",
  "# Scan:\t \tFourier Scan",
  "# Project:\t \tQC-Project",
  "# Date:\t \t05/19/2024 16:59:10",
  "# Scanner Center Position (X, Y):\t[µm]\t46.77\t49.79\t ",
  "# Scan Area (X, Y, Z):\t[µm]\t0.000\t0.000\t0.000",
  "# Pixel Area (X, Y, Z):\t[px]\t1\t1\t1024",
  "# Interferometer Center/Distance:\t[µm]\t470.000\t490.000\t ",
  "# Averaging:\t \t45\t \t ",
  "# Integration time:\t[ms]\t20\t \t ",
  "# Laser Source:\t \t",
  "# Tip Frequency:\t[Hz]\t68,263.500\t \t ",
  "# Tip Amplitude:\t[mV]\t339.702\t \t ",
  "# Tapping Amplitude:\t[nm]\t76.233\t \t ",
  "# Regulator (P, I, D):\t \t3.767854\t6.228756\t1.000000",
  "# Q-Factor:\t \t221.1\t \t ",
  "# Version:\t \t2.1.11508.0",
];

/** n points from 0 to wnMax; channel values from fn(channelIndex, i). */
export function makeNeaText({ n = 64, wnMax = 2500, fn = (c, i) => 1 + c * 0.1 + i * 1e-3, eol = "\n", extraRows = [] } = {}) {
  const lines = [...HEADER, CHANNELS.join("\t") + "\t"];
  for (let i = 0; i < n; i++) {
    const wn = (wnMax * i) / (n - 1);
    const vals = CHANNELS.slice(4).map((_, c) => fn(c, i));
    lines.push([0, 0, i, wn, ...vals].join("\t") + "\t");
  }
  lines.push(...extraRows);
  return lines.join(eol) + eol;
}

export function linspace(a, b, n) {
  return Float64Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

export function fileData(name, wn = linspace(650, 1800, 500), phase = name.length) {
  const data = { Wavenumber: wn };
  for (const o of ["O2A", "O3A", "O4A", "O5A"]) {
    data[o] = Float64Array.from(wn, (_, i) => 1 + 0.01 * Math.sin(i * phase));
  }
  return { name, data, params: { Project: name } };
}
