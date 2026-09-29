// App logic, following the Streamlit script in sSNOM-QC source/app.py.
//
// Streamlit reruns the whole script after every widget interaction. rerun()
// mirrors that: it recomputes everything shown from `state`, and output that
// only lives for one script run (the custom-range messages) is dropped.
import { parseNeaSpectrum, formatParamValue } from "./nea-reader.js";
import {
  DEMOD_OPTIONS, MAX_FILES, MAX_UPLOAD_MB, assessFileCompatibility, parseCustomSnrRanges,
} from "./analysis.js";
import {
  comparisonFigure, customAspect, customPlotConfig, customSnrFigure, mainPlotConfig,
} from "./plots.js";
import { hydrateIcons } from "./icons.js";
import { setupChrome, setupFullscreen } from "./chrome.js";
import { setupShortcuts } from "./shortcuts.js";

const doc = document; // bound once, so late timers always target this page
const $ = (id) => doc.getElementById(id);

const state = {
  files: [],             // st.session_state.uploaded_files: { name, data, params }
  pending: null,         // file sitting in st.file_uploader: { file, message, loading, clientError }
  order: DEMOD_OPTIONS[0],
  rows: [{ start: "", end: "" }], // custom_snr_start_i / custom_snr_end_i
  customRanges: [],
  showMotd: true,
  customMessages: [],    // shown for one run only (after "Display graphs")
};

// ---- Helpers --------------------------------------------------------------

function alertEl(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
  div.textContent = text;
  return div;
}

function exceptionEl(err) {
  const box = document.createElement("div");
  box.className = "msg error exception";
  const head = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = err.name || "Error";
  head.append(b, `: ${err.message}`);
  const tbLabel = document.createElement("div");
  tbLabel.textContent = "Traceback:";
  const pre = document.createElement("pre");
  pre.textContent = (err.stack || "").split("\n").filter((l) => /^\s*at\s|@/.test(l)).join("\n") || String(err);
  box.append(head, tbLabel, pre);
  return box;
}

function formatSize(bytes) {
  // Streamlit uses decimal units, e.g. 311613 bytes -> "311.6KB"
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`;
}

// Streamlit shortens long names in the middle: "testspe...epoint.txt"
function middleTruncate(name, max = 20) {
  return name.length <= max ? name : `${name.slice(0, 7)}...${name.slice(-(max - 10))}`;
}

// ---- Upload (st.file_uploader + handle_file_upload) ------------------------

function selectFile(file) {
  if (!file) return;
  const pending = { file, message: null, loading: false, clientError: null };
  // The browser-side checks Streamlit's uploader does before the script sees the file.
  if (!file.name.toLowerCase().endsWith(".txt")) {
    pending.clientError = `${file.type || "This file type"} files are not allowed.`;
  } else if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    pending.clientError = `File must be ${MAX_UPLOAD_MB.toFixed(1)}MB or smaller.`;
  }
  state.pending = pending;
  if (pending.clientError) return renderUploader();
  processPending();
}

async function processPending() {
  const p = state.pending;
  if (state.files.length >= MAX_FILES) {
    p.message = ["warning", `Maximum of ${MAX_FILES} files allowed. Use reset button to clear.`];
    return rerun();
  }
  if (state.files.some((f) => f.name === p.file.name)) {
    p.message = null; // silently ignored, the file stays in the uploader
    return rerun();
  }
  p.loading = true;
  rerun();
  try {
    const { data, params } = parseNeaSpectrum(await p.file.text());
    if (state.pending !== p) return; // replaced or reset meanwhile
    state.files.push({ name: p.file.name, data, params });
    state.pending = null; // upload_widget_key += 1 clears the uploader
  } catch (e) {
    if (state.pending !== p) return;
    p.loading = false;
    p.message = ["error", `Error loading file: ${e.message}`];
  }
  rerun();
}

function renderUploader() {
  const p = state.pending;
  $("upl-empty").hidden = !!p;
  $("upl-chip-row").hidden = !p;
  if (p) {
    $("upl-chip-name").textContent = middleTruncate(p.file.name);
    $("upl-chip-name").title = p.file.name;
    const size = $("upl-chip-size");
    size.textContent = p.clientError || formatSize(p.file.size);
    size.classList.toggle("error", !!p.clientError);
    $("upl-chip-remove").setAttribute("aria-label", `Remove ${p.file.name}`);
  }
  const msgs = [];
  if (p?.loading) {
    const s = document.createElement("div");
    s.className = "spinner-msg";
    s.innerHTML = `<span class="spinner"></span>`;
    s.append(`Loading ${p.file.name}...`);
    msgs.push(s);
  } else if (p?.message) {
    msgs.push(alertEl(...p.message));
  }
  $("upload-messages").replaceChildren(...msgs);
}

function setupUpload() {
  const input = $("file-input");
  const zone = $("dropzone");
  const pick = () => input.click();
  $("upload-btn").addEventListener("click", pick);
  $("upl-add").addEventListener("click", pick);
  input.addEventListener("change", () => {
    selectFile(input.files[0]);
    input.value = "";
  });
  $("upl-chip-remove").addEventListener("click", () => {
    state.pending = null;
    rerun();
  });
  for (const ev of ["dragenter", "dragover"]) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    zone.addEventListener(ev, () => zone.classList.remove("dragover"));
  }
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    selectFile(e.dataTransfer.files[0]); // single-file uploader
  });
  // Dropping a file elsewhere must not navigate away from the app.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

// ---- Demodulation order (st.segmented_control) ----------------------------

function setupOrder() {
  const box = $("order-options");
  for (const opt of DEMOD_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt;
    b.dataset.value = opt;
    // Always exactly one order selected: clicking the active one keeps it.
    b.addEventListener("click", () => selectOrder(opt));
    box.append(b);
  }
}

function selectOrder(opt) {
  if (state.order === opt) return;
  state.order = opt;
  rerun();
}

// "o" shortcut: next demodulation order, wrapping around.
function cycleOrder() {
  if (state.files.length !== MAX_FILES) return;
  const i = DEMOD_OPTIONS.indexOf(state.order);
  selectOrder(DEMOD_OPTIONS[(i + 1) % DEMOD_OPTIONS.length]);
}

// ---- Custom SNR rows ---------------------------------------------------------

function renderSnrRows() {
  const grid = $("snr-rows");
  grid.querySelectorAll(".snr-row").forEach((el) => el.remove());
  const last = state.rows.length - 1;

  state.rows.forEach((row, idx) => {
    for (const key of ["start", "end"]) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "snr-row";
      input.setAttribute("aria-label", `${key}_${idx}`);
      input.value = row[key];
      input.addEventListener("input", () => { row[key] = input.value; });
      // st.text_input commits on Enter / blur, which triggers a rerun.
      input.addEventListener("change", () => rerun());
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      grid.append(input);
    }
    const addCell = document.createElement("span");
    const removeCell = document.createElement("span");
    addCell.className = removeCell.className = "snr-row";
    if (idx === last) {
      addCell.append(squareButton("➕", "btn-green", "Add range", () => {
        state.rows.push({ start: "", end: "" });
        renderSnrRows();
        rerun();
      }));
      if (state.rows.length > 1) {
        removeCell.append(squareButton("➖", "btn-red", "Remove last range", () => {
          state.rows.pop();
          renderSnrRows();
          rerun();
        }));
      }
    }
    grid.append(addCell, removeCell);
  });
}

function squareButton(text, cls, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function displayCustomGraphs() {
  let ranges, errors;
  if (state.files.length < MAX_FILES) {
    ranges = [];
    errors = ["Open two valid spectra before calculating custom SNR ranges."];
  } else {
    ({ ranges, errors } = parseCustomSnrRanges(state.rows, state.files[0].data.Wavenumber));
  }
  state.customRanges = ranges;
  const msgs = errors.map((e) => ["error", e]);
  if (!errors.length && !ranges.length) msgs.push(["warning", "No valid custom SNR ranges entered."]);
  rerun();
  state.customMessages = msgs; // set after rerun() so they survive this one run
  renderCustomMessages();
}

function renderCustomMessages() {
  $("custom-messages").replaceChildren(...state.customMessages.map((m) => alertEl(...m)));
}

// ---- Reset --------------------------------------------------------------------

function reset() {
  state.files = [];
  state.pending = null;
  state.showMotd = true;
  state.rows = [{ start: "", end: "" }];
  state.customRanges = [];
  renderSnrRows();
  rerun();
}

// ---- Figures --------------------------------------------------------------------

let figures = { main: null, custom: null }; // what to draw, redrawn on resize

function plotSize(figEl, aspect) {
  if (figEl.classList.contains("fullscreen")) {
    const w = Math.min(figEl.clientWidth - 64, (figEl.clientHeight - 80) * aspect);
    return { width: w, height: w / aspect };
  }
  const w = figEl.clientWidth;
  return { width: w, height: w / aspect };
}

function drawFigures() {
  scheduleSnapshots();
  const { main, custom } = figures;
  if (main && !$("main-figure").hidden) {
    const el = $("main-figure");
    // The figure's height follows from its width (the caption may wrap).
    const build = (w) => comparisonFigure(main.f1, main.f2, main.order, w, main.now);
    let fig = build(el.classList.contains("fullscreen") ? el.clientWidth - 64 : el.clientWidth);
    if (el.classList.contains("fullscreen")) {
      const availH = el.clientHeight - 80;
      if (fig.layout.height > availH) fig = build(fig.layout.width * (availH / fig.layout.height));
    }
    if (fig.layout.width > 0) {
      Plotly.react($("main-plot"), fig.data, { ...fig.layout, autosize: false },
        { ...mainPlotConfig(), responsive: false });
    }
  }
  if (custom && !$("custom-figure").hidden) {
    const aspect = customAspect(custom.ranges.length);
    const { width, height } = plotSize($("custom-figure"), aspect);
    if (width > 0) {
      const fig = customSnrFigure(custom.f1, custom.f2, custom.order, custom.ranges, width);
      Plotly.react($("custom-plot"), fig.data, { ...fig.layout, width, height, autosize: false },
        { ...customPlotConfig(), responsive: false });
    }
  }
}

// Plotly draws at a fixed pixel size, which prints badly. A high-resolution
// snapshot of each figure is kept in an <img> that print CSS shows instead.
let snapshotTimer = 0;
let snapshotsReady = Promise.resolve();

async function takeSnapshots() {
  for (const [plotId, imgId] of [["main-plot", "main-print"], ["custom-plot", "custom-print"]]) {
    const gd = $(plotId);
    if (gd.closest(".figure").hidden || !gd._fullLayout) continue;
    const { width, height } = gd._fullLayout;
    $(imgId).src = await Plotly.toImage(gd, { format: "png", width, height, scale: 2 });
  }
}

function scheduleSnapshots() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => { snapshotsReady = takeSnapshots(); }, 400);
}

async function prepareForPrint() {
  clearTimeout(snapshotTimer);
  await snapshotsReady;
  await takeSnapshots();
}

// All visible figures stacked into one PNG (white background, like the plots).
async function figuresPng() {
  const shots = [];
  for (const plotId of ["main-plot", "custom-plot"]) {
    const gd = $(plotId);
    if (gd.closest(".figure").hidden || !gd._fullLayout) continue;
    const { width, height } = gd._fullLayout;
    const img = new Image();
    img.src = await Plotly.toImage(gd, { format: "png", width, height, scale: 2 });
    await img.decode();
    shots.push(img);
  }
  if (!shots.length) throw new Error("No figures to copy.");
  const gap = 32;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...shots.map((i) => i.naturalWidth));
  canvas.height = shots.reduce((h, i) => h + i.naturalHeight, 0) + gap * (shots.length - 1);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const img of shots) {
    ctx.drawImage(img, Math.round((canvas.width - img.naturalWidth) / 2), y);
    y += img.naturalHeight + gap;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), "image/png");
  });
}

async function copyFigures() {
  // Safari needs the ClipboardItem created synchronously with a promised blob.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": figuresPng() })]);
}

let redrawFrame = 0;
function scheduleRedraw() {
  cancelAnimationFrame(redrawFrame);
  redrawFrame = requestAnimationFrame(drawFigures);
}

// ---- Rendering ---------------------------------------------------------------------

function renderMetadata() {
  $("metadata").replaceChildren(
    ...state.files.map((f) => {
      const col = document.createElement("div");
      const title = document.createElement("p");
      const tb = document.createElement("b");
      tb.textContent = f.name;
      title.append(tb);
      col.append(title);
      for (const [k, v] of Object.entries(f.params)) {
        const p = document.createElement("p");
        const b = document.createElement("b");
        b.textContent = `${k}:`;
        p.append(b, ` ${formatParamValue(k, v)}`);
        col.append(p);
      }
      return col;
    })
  );
}

function renderSidebar() {
  const n = state.files.length;
  renderUploader();

  $("file-list-section").hidden = n === 0;
  $("file-list").replaceChildren(
    ...state.files.map((f, i) => {
      const p = document.createElement("p");
      const b = document.createElement("b");
      b.textContent = `${i + 1}.`;
      p.append(b, ` ${f.name}`);
      return p;
    })
  );

  let presetValid = true;
  const compat = [];
  if (n === MAX_FILES) {
    $("status-message").replaceChildren(alertEl("success", "Both files uploaded."));
    const res = assessFileCompatibility(state.files[0], state.files[1]);
    presetValid = res.presetValid;
    compat.push(...res.warnings.map((w) => alertEl("warning", w)));
  } else {
    // Widget state is dropped while the segmented control is not rendered.
    state.order = DEMOD_OPTIONS[0];
    $("status-message").replaceChildren(
      alertEl("info", n === 1 ? "Open one more file to proceed." : "Open your first spectrum file.")
    );
  }
  $("order-section").hidden = n !== MAX_FILES;
  $("order-options").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.value === state.order));
  });
  $("compat-messages").replaceChildren(...compat);
  renderCustomMessages();

  // Streamlit identifies the (keyless) expander by its position in the sidebar,
  // so it comes back collapsed whenever the number of elements above it changes.
  const expanderIndex = 3 + (state.pending?.loading || state.pending?.message ? 1 : 0)
    + (n > 0 ? 1 + n : 0) + 1 + (n === MAX_FILES ? 1 : 0) + compat.length;
  if (lastExpanderIndex !== null && expanderIndex !== lastExpanderIndex) $("custom-snr").open = false;
  lastExpanderIndex = expanderIndex;
  return presetValid;
}

let lastExpanderIndex = null;

const PERSISTENT = ["motd", "main-figure", "additional-snr-graphs", "custom-figure", "metadata-section"];

function renderMain(presetValid) {
  const n = state.files.length;
  const blocks = []; // main area, in Streamlit's output order
  const motdShown = state.showMotd;
  let motdCleared = false;
  if (motdShown) blocks.push($("motd"));
  figures = { main: null, custom: null };

  if (n === MAX_FILES && state.order && presetValid) {
    const [f1, f2] = state.files;
    const order = state.order;
    try {
      // compute_plot_data(), then create_comparison_plot() sets show_motd = False.
      comparisonFigure(f1, f2, order);
      state.showMotd = false;
      figures.main = { f1, f2, order, now: new Date() };
      blocks.push($("main-figure"));

      if (state.customRanges.length) {
        blocks.push($("additional-snr-graphs"));
        customSnrFigure(f1, f2, order, state.customRanges);
        figures.custom = { f1, f2, order, ranges: state.customRanges };
        blocks.push($("custom-figure"));
      }
      motdCleared = true; // motd_box.empty()
      renderMetadata();
      blocks.push($("metadata-section"));
    } catch (e) {
      console.error(e);
      blocks.push(alertEl("error", `An error occurred: ${e.message}`), exceptionEl(e));
    }
  } else if (n === MAX_FILES && state.order && !presetValid) {
    blocks.push(alertEl("warning", "Cannot render main SNR graphs because preset SNR ranges are not valid for these files."));
  }
  // Only when it was shown this run: indexOf -1 would make splice drop the last block.
  if (motdCleared && motdShown) blocks.splice(blocks.indexOf($("motd")), 1);

  // Persistent blocks stay in the DOM (hidden) so Plotly state survives.
  const persistent = PERSISTENT.map($);
  for (const el of persistent) el.hidden = !blocks.includes(el);
  $("copy-figures-btn").disabled = $("main-figure").hidden;
  $("main").replaceChildren(...blocks, ...persistent.filter((el) => !blocks.includes(el)));
  drawFigures();
}

function rerun() {
  state.customMessages = [];
  const presetValid = renderSidebar();
  renderMain(presetValid);
}

// ---- Init -----------------------------------------------------------------------------

// The app itself is wired first; a failure in the cosmetic shell (icons,
// sidebar, theme buttons) must never leave uploading or plotting broken.
setupUpload();
setupOrder();
renderSnrRows();
$("display-graphs").addEventListener("click", displayCustomGraphs);
$("reset").addEventListener("click", reset);
new ResizeObserver(scheduleRedraw).observe($("main"));
window.addEventListener("app:layout", () => setTimeout(scheduleRedraw, 320)); // after the sidebar transition
rerun();
for (const init of [
  hydrateIcons,
  () => setupChrome({ prepareForPrint, copyFigures }),
  () => setupFullscreen(scheduleRedraw),
  () => setupShortcuts({ cycleOrder }),
]) {
  try { init(); } catch (e) { console.error(e); }
}
