# sSNOM-QC (browser version)

Quality control for NeaSNOM nano-FTIR spectra. This is a JavaScript port of the
[sSNOM-QC Streamlit app](https://github.com/smis-soleil/sSNOM-QC). It is a static
web page: the browser downloads it once and all file parsing, SNR calculation and
plotting run on the user's computer. Spectra are never uploaded anywhere.

## Usage

1. Open the page and upload two NeaSNOM spectrum exports (`.txt`), one at a time.
2. Pick the demodulation order (O2A–O5A).
3. The ratio of the two spectra is shown with its SNR (mean / std) in the
   800–1300 and 650–1800 cm⁻¹ ranges. Extra ranges can be added under
   *Custom SNR graphs*.
4. Use the camera icon in the plot toolbar to save a PNG.

The page behaves like the Streamlit app, including its sidebar (collapse with «,
drag the edge to resize) and fullscreen figures. The icons at the top right switch
between light and dark theme (the system theme is used until one is picked), copy
all figures to the clipboard as one PNG, and print the page. Theme and sidebar size are remembered per browser.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F` | Open a spectrum file |
| `O` | Next demodulation order |
| `D` | Switch between light and dark theme |
| `S` | Collapse or expand the sidebar |
| `⌘/Ctrl` + `C` | Copy all figures to the clipboard (when no text is selected) |
| `⌘/Ctrl` + `P` | Print |
| `?` | Show keyboard shortcuts |

Single-key shortcuts are ignored while typing in a text field.

Intentional differences from the Streamlit version:

- The figure caption shows the tapping amplitude in nm (Streamlit shows the tip
  amplitude, which is in mV, labelled as nm) and has a " - " after the date.
- Plots are interactive (zoom, hover) instead of static images.
- A file that cannot be read gives this reader's own error message, not pandas'.

## Hosting on GitHub Pages

No build step is needed. Push this folder to a repository, then in
**Settings → Pages** choose *Deploy from a branch*, branch `main`, folder `/ (root)`.

## Local development

ES modules need to be served over HTTP (opening `index.html` as a file will not work):

```bash
npm install          # once: installs jsdom, used by the UI tests
npm run serve        # no-cache dev server → http://localhost:8000
npm test             # all tests (Node 22+ built-in test runner)
```

## Tests

- `tests/nea-reader.test.js`, `tests/analysis.test.js`, `tests/plots.test.js`: file parsing,
  SNR maths and figure building.
- `tests/app.test.js`, `tests/chrome.test.js`, `tests/shortcuts.test.js`: the whole UI,
  driven through the real `index.html` in [jsdom](https://github.com/jsdom/jsdom) with a
  stand-in for Plotly (`tests/dom.js`) — opening files, messages, order, custom ranges,
  reset, error states, theme, sidebar, print, copy, fullscreen and keyboard shortcuts.

## Layout

| Path | Contents |
| --- | --- |
| `js/nea-reader.js` | Port of pySNOM's `NeaSpectralReader` (header + data parsing) |
| `js/analysis.js` | SNR statistics, file compatibility checks, custom range validation |
| `js/plots.js` | Plotly figure definitions |
| `js/app.js` | App state and rendering, following Streamlit's rerun model |
| `js/chrome.js` | Streamlit-style shell: sidebar, theme and print buttons, fullscreen |
| `js/icons.js` | Material Symbols icons used by the shell |
| `js/shortcuts.js` | Keyboard shortcuts and the `?` help dialog |
| `vendor/plotly-basic.min.js` | Plotly.js 4.1.1 basic bundle (MIT), vendored so the app has no CDN dependency |

| `vendor/fonts/` | Source Sans 3 and Source Code Pro variable fonts (SIL OFL 1.1), self-hosted |

## Privacy

Spectra are read and processed in the browser and never sent anywhere. The page makes
no requests to third parties (fonts and Plotly are bundled, Plotly's cloud-sharing button
is disabled) and sets no cookies. The only thing stored is the theme and sidebar layout,
in the browser's local storage. As for any GitHub Pages site, GitHub logs visitor IP
addresses for security; those logs are not visible to the site owner.

## License

GNU General Public License v3.0, same as the original sSNOM-QC.
