// Plotly figures that reproduce the matplotlib figures of sSNOM-QC
// (source/app.py + plot-style.mplstyle). Streamlit shows them as PNGs scaled to
// the column width, so text sizes here scale with the plot width too.
import {
  START_WN1, END_WN1, START_WN2, END_WN2,
  calculateSnrStats, computePlotData, formatG,
} from "./analysis.js";
import { formatParamValue } from "./nea-reader.js";

const TEXT = "#333333";   // text.color (0.2, 0.2, 0.2)
const LABEL = "#1a1a1a";  // axes.labelcolor / edgecolor (0.1, 0.1, 0.1)
const GRID = "rgba(176,176,176,0.75)"; // default grid colour, grid.alpha 0.75
const SPECTRUM_COLORS = ["#4287f5", "#f5a142"]; // axes.prop_cycle
const CUSTOM_COLORS = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#56b4e9", "#e69f00"];
// Streamlit Cloud has no Helvetica, so matplotlib falls back to DejaVu Sans.
// Arial/Helvetica are the closest widely installed metrics.
const FAMILY = '"DejaVu Sans", "Bitstream Vera Sans", Arial, Helvetica, sans-serif';

// px per matplotlib point when the figure is REF_WIDTH px wide on screen.
const REF_WIDTH = 856;
const MAIN_PX_PER_PT = 1.2;   // 12 x 6 in figure
const CUSTOM_PX_PER_PT = 1.5; // 8 x 3n in figure

// Aspect ratio of the custom-range PNGs Streamlit serves (bbox_inches="tight").
export const customAspect = (n) => 1460 / (536 * n);

export const PLOT_CONFIG = {
  displaylogo: false,
  // Plotly 4's "Share chart..." button uploads the plotted data to
  // cloud.plotly.com; spectra must never leave the user's computer.
  showSendToCloud: false,
  plotlyServerURL: "",
  responsive: true,
  modeBarButtonsToRemove: ["select2d", "lasso2d"],
  toImageButtonOptions: { format: "png", filename: "ssnom-qc", scale: 2 },
  // Double-click restores the initial ranges instead of autoscaling every panel.
  doubleClick: "reset",
};

/**
 * Main figure: autoscale only the spectra panel. Plotly's own button would
 * also autoscale the SNR panels and lose their preset ranges.
 */
export function mainPlotConfig() {
  return {
    ...PLOT_CONFIG,
    modeBarButtonsToRemove: [...PLOT_CONFIG.modeBarButtonsToRemove, "autoScale2d"],
    modeBarButtonsToAdd: [{
      name: "autoscaleSpectra",
      title: "Autoscale spectra",
      icon: globalThis.Plotly?.Icons?.autoscale,
      click: (gd) => Plotly.relayout(gd, { "xaxis.autorange": true, "yaxis.autorange": true }),
    }],
  };
}

/** Custom figure: every panel is an SNR panel with a preset range, so no autoscale. */
export function customPlotConfig() {
  return {
    ...PLOT_CONFIG,
    modeBarButtonsToRemove: [...PLOT_CONFIG.modeBarButtonsToRemove, "autoScale2d"],
    toImageButtonOptions: { ...PLOT_CONFIG.toImageButtonOptions, filename: "ssnom-qc-custom-snr" },
  };
}

// File names and header values end up in Plotly's HTML-like text labels.
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function formatTimestamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Text shrinks with narrow figures like the scaled PNG, but never grows past
// the size it has at REF_WIDTH (large text on wide screens looks clumsy).
function scaler(width, pxPerPt) {
  const k = pxPerPt * Math.min(1, Math.max(width, 280) / REF_WIDTH);
  return (pt) => Math.round(pt * k * 10) / 10;
}

// Rough average glyph width of the plot font, as a fraction of the font size.
const CHAR_EM = 0.56;
const charsFitting = (px, fontPx) => Math.max(8, Math.floor(px / (fontPx * CHAR_EM)));

// "a-very-long-file-name.txt" -> "a-very-lo…-name.txt"
export function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) return text;
  const keep = maxChars - 1;
  const head = Math.ceil(keep * 0.55);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

// Greedy wrap of `parts` joined by `sep`; parts longer than a line are hard-split.
function wrapParts(parts, sep, maxChars, indent = "") {
  const lines = [];
  let line = "";
  for (let part of parts) {
    while (indent.length + part.length > maxChars) {
      if (line) { lines.push(line); line = ""; }
      const room = maxChars - indent.length;
      lines.push(indent + part.slice(0, room));
      part = part.slice(room);
    }
    const candidate = line ? `${line}${sep}${part}` : indent + part;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = indent + part;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Smallest "nice" tick step whose labels fit side by side in panelPx.
function tickStep(range, panelPx, labelPx, candidates) {
  const maxTicks = Math.max(2, Math.floor(panelPx / labelPx));
  for (const d of candidates) {
    const count = Math.floor(range[1] / d) - Math.ceil(range[0] / d) + 1;
    if (count <= maxTicks) return d;
  }
  return candidates[candidates.length - 1];
}

function axis(pt, extra = {}) {
  return {
    showgrid: true, gridcolor: GRID, gridwidth: 0.5,
    showline: true, mirror: true, linecolor: LABEL, linewidth: 1,
    ticks: "inside", ticklen: pt(3.5), tickcolor: LABEL, zeroline: false, tickangle: 0,
    tickfont: { family: FAMILY, size: pt(12), color: TEXT },
    title: { font: { family: FAMILY, size: pt(13), color: LABEL }, standoff: pt(4) },
    automargin: true,
    ...extra,
  };
}

function axisTitle(pt, text) {
  return { text, font: { family: FAMILY, size: pt(13), color: LABEL }, standoff: pt(4) };
}

// matplotlib legend(loc="upper right"): white box, light grey frame, inside the axes.
function legendAt(pt, xDomain, yDomain) {
  return {
    x: xDomain[1] - 0.006, xanchor: "right", y: yDomain[1] - 0.012, yanchor: "top",
    xref: "paper", yref: "paper",
    bgcolor: "rgba(255,255,255,0.8)", bordercolor: "#cccccc", borderwidth: 1,
    font: { family: FAMILY, size: pt(10), color: TEXT },
    itemwidth: 30, tracegroupgap: 0,
  };
}

// matplotlib ax.set_title(..., loc="left")
function axesTitle(pt, xref, yref, text) {
  return {
    xref: `${xref} domain`, yref: `${yref} domain`, x: 0, y: 1, xanchor: "left", yanchor: "bottom",
    yshift: pt(4), align: "left", showarrow: false, text,
    font: { family: FAMILY, size: pt(15), color: TEXT },
  };
}

function paramsSummary(params) {
  const v = (key) => {
    const x = params[key];
    return x === undefined || x === null || x === "" ? "n/a" : formatParamValue(key, x);
  };
  // The Streamlit app prints TipAmplitude (mV) labelled as nm; show the
  // tapping amplitude (nm) instead, falling back to TipAmplitude.
  const taKey = params.TappingAmplitude !== undefined ? "TappingAmplitude" : "TipAmplitude";
  const icd = params.InterferometerCenterDistance;
  const interf = Array.isArray(icd)
    ? `${formatParamValue("", icd[0])}, ${formatParamValue("", icd[1])}`
    : "n/a, n/a";
  return (
    `Exp. Date: ${v("Date")} - TA: ${v(taKey)} nm - Avg: ${v("Averaging")} - ` +
    `Int time: ${v("Integrationtime")} ms - Interferometer: ${interf}`
  );
}

/** Caption lines for both files, wrapped to maxChars (Infinity: no wrapping). */
export function captionLines(file1, file2, maxChars = Infinity) {
  const indent = "\u00a0\u00a0";
  const lines = [];
  [file1, file2].forEach((f, i) => {
    if (i) lines.push("");
    lines.push(...wrapParts([f.name], "", maxChars));
    lines.push(...wrapParts(paramsSummary(f.params).split(" - "), " - ", maxChars, indent));
  });
  return lines;
}

export function figureCaption(file1, file2, maxChars = Infinity) {
  return captionLines(file1, file2, maxChars).map(esc).join("<br>");
}

/** Main figure: both spectra on the left, ratio in the two preset ranges on the right. */
export function comparisonFigure(file1, file2, order, width = REF_WIDTH, now = new Date()) {
  const wn1 = file1.data.Wavenumber, sp1 = file1.data[order];
  const wn2 = file2.data.Wavenumber, sp2 = file2.data[order];
  if (!sp1 || !sp2) throw new Error(`Channel '${order}' is missing from one of the files.`);
  const { ratio, stats1, stats2 } = computePlotData(wn1, sp1, wn2, sp2);
  const pt = scaler(width, MAIN_PX_PER_PT);
  const lw = pt(1.5);
  const tickPx = pt(12);

  const margin = { l: pt(58), r: pt(24), t: pt(15) * 2.6 + pt(8), b: 0 };
  const plotWidth = Math.max(1, width - margin.l - margin.r);

  // GridSpec(2, 2, width_ratios=[0.7, 0.3]); the gap leaves room for the
  // right panels' y tick labels and titles, so it is sized in pixels.
  const gap = Math.min(0.2, (4 * tickPx * CHAR_EM + pt(13) * 1.4 + pt(18)) / plotWidth);
  const xLeft = [0, 0.7 * (1 - gap)], xRight = [1 - 0.3 * (1 - gap), 1];
  const yTop = [0.555, 1], yBottom = [0, 0.445];

  // Legend inside the left axes: shorten long file names so it never spills out
  // (a legend wider than the axes pushes the whole plot to the right).
  const legendBudget = xLeft[1] * plotWidth * 0.62 - pt(10) * 5;
  const nameChars = Math.max(12, charsFitting(legendBudget, pt(10)) - order.length - 1);
  const legendName = (f) => `${esc(truncateMiddle(f.name, nameChars))} ${order}`;

  const data = [
    { x: wn1, y: sp1, name: legendName(file1), legend: "legend", meta: esc(file1.name),
      hovertemplate: "%{meta}<br>%{x:.1f}, %{y:.4g}<extra></extra>",
      line: { color: SPECTRUM_COLORS[0], width: lw } },
    { x: wn2, y: sp2, name: legendName(file2), legend: "legend", meta: esc(file2.name),
      hovertemplate: "%{meta}<br>%{x:.1f}, %{y:.4g}<extra></extra>",
      line: { color: SPECTRUM_COLORS[1], width: lw } },
    { x: wn1, y: ratio, xaxis: "x2", yaxis: "y2", legend: "legend2",
      name: `SNR: ${stats1.snr.toFixed(1)}`, line: { color: "#28ad2c", width: lw } },
    { x: wn1, y: ratio, xaxis: "x3", yaxis: "y3", legend: "legend3",
      name: `SNR: ${stats2.snr.toFixed(1)}`, line: { color: "#e0147a", width: lw } },
  ].map((t) => ({ type: "scatter", mode: "lines", hovertemplate: "%{x:.1f}, %{y:.4g}<extra></extra>", ...t }));

  // Caption (fig.text below the axes), wrapped to the figure width.
  const captionFont = pt(12);
  const captionX = pt(14);
  const lines = captionLines(file1, file2, charsFitting(width - captionX - pt(8), captionFont));
  const captionHeight = lines.length * captionFont * 1.3;
  margin.b = pt(40) + captionHeight + pt(8);

  const plotHeight = plotWidth * 0.5;
  const rightPx = (xRight[1] - xRight[0]) * plotWidth;
  const xLabelPx = 4 * tickPx * 0.52 + pt(2); // "1300": digits are ~0.52 em wide

  const layout = {
    font: { family: FAMILY, color: TEXT },
    paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
    width, height: Math.round(margin.t + plotHeight + margin.b),
    margin,
    showlegend: true,
    legend: legendAt(pt, xLeft, [0, 1]),
    legend2: legendAt(pt, xRight, yTop),
    legend3: legendAt(pt, xRight, yBottom),
    xaxis: axis(pt, { domain: xLeft, autorange: true, title: axisTitle(pt, "Frequency / cm⁻¹") }),
    yaxis: axis(pt, { title: axisTitle(pt, `${order} / a.u.`) }),
    xaxis2: axis(pt, { domain: xRight, anchor: "y2", range: [START_WN1, END_WN1],
      dtick: tickStep([START_WN1, END_WN1], rightPx, xLabelPx, [100, 200, 250, 500]) }),
    yaxis2: axis(pt, { domain: yTop, anchor: "x2", range: [stats1.yMin, stats1.yMax],
      tickformat: ".2f", nticks: 7, title: axisTitle(pt, `${order} Ratio / a.u.`) }),
    xaxis3: axis(pt, { domain: xRight, anchor: "y3", range: [START_WN2, END_WN2], tick0: 0,
      dtick: tickStep([START_WN2, END_WN2], rightPx, xLabelPx, [250, 500, 1000]),
      title: axisTitle(pt, "Frequency / cm⁻¹") }),
    yaxis3: axis(pt, { domain: yBottom, anchor: "x3", range: [stats2.yMin, stats2.yMax],
      tickformat: ".2f", nticks: 7, title: axisTitle(pt, `${order} Ratio / a.u.`) }),
    annotations: [
      axesTitle(pt, "x", "y",
        `Project: ${esc(file1.params.Project ?? "n/a")}<br>Plot date: ${formatTimestamp(now)}`),
      {
        // fig.text(0.1, -0.15, caption, fontsize=12), anchored to the figure's left edge
        xref: "paper", yref: "paper", x: (captionX - margin.l) / plotWidth, y: 0, yshift: -pt(40),
        xanchor: "left", yanchor: "top",
        align: "left", showarrow: false, text: lines.map(esc).join("<br>"),
        font: { family: FAMILY, size: captionFont, color: TEXT },
      },
    ],
  };
  return { data, layout, stats: { stats1, stats2 } };
}

/** One stacked panel per user-defined range (plt.subplots(n, 1, figsize=(8, 3n))). */
export function customSnrFigure(file1, file2, order, ranges, width = REF_WIDTH) {
  const wn1 = file1.data.Wavenumber;
  const { ratio } = computePlotData(wn1, file1.data[order], file2.data.Wavenumber, file2.data[order]);
  const pt = scaler(width, CUSTOM_PX_PER_PT);
  const n = ranges.length;
  const heightPx = width / customAspect(n);
  const gap = n > 1 ? (pt(15) * 2.4 + pt(12) * 1.2) / heightPx : 0;
  const h = (1 - gap * (n - 1)) / n;

  const data = [];
  const layout = {
    font: { family: FAMILY, color: TEXT },
    paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", autosize: true,
    margin: { l: pt(10), r: pt(24), t: pt(15) * 1.6 + pt(6), b: pt(8) }, // r: room for the last tick label
    showlegend: true, annotations: [],
  };

  ranges.forEach(([start, end], i) => {
    const stats = calculateSnrStats(wn1, ratio, start, end);
    const k = i === 0 ? "" : String(i + 1);
    const top = 1 - i * (h + gap);
    const yDomain = [top - h, top];
    data.push({
      type: "scatter", mode: "lines", x: wn1, y: ratio, xaxis: `x${k}`, yaxis: `y${k}`,
      legend: `legend${k}`, name: `SNR: ${stats.snr.toFixed(1)}`,
      hovertemplate: "%{x:.1f}, %{y:.4g}<extra></extra>",
      line: { color: CUSTOM_COLORS[i % CUSTOM_COLORS.length], width: pt(1.5) },
    });
    layout[`xaxis${k}`] = axis(pt, {
      anchor: `y${k}`, range: [start, end],
      title: i === n - 1 ? axisTitle(pt, "Frequency / cm⁻¹") : undefined,
    });
    layout[`yaxis${k}`] = axis(pt, {
      anchor: `x${k}`, domain: yDomain, range: [stats.yMin, stats.yMax],
      tickformat: ".2f", nticks: 7, title: axisTitle(pt, `${order} Ratio / a.u.`),
    });
    layout[`legend${k}`] = legendAt(pt, [0, 1], yDomain);
    layout.annotations.push(
      axesTitle(pt, `x${k}`, `y${k}`, `Custom SNR range: ${formatG(start)} - ${formatG(end)} cm⁻¹`)
    );
  });
  return { data, layout };
}
