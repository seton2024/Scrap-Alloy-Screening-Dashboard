/*
* loading_tab.js — Loading tab: dataset parse, loading animation, data preview
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §4.0.1, §4.0.2
*
* The real pipeline runs steps 1-9 in a Web Worker (future work, once
* data/precompute.py output files exist). Parsing (step 1) already runs in
* parse_worker.js so the main thread — and the progress animation — never
* freezes while the file is read. The remaining steps are simulated here
* until their data/*.npy / *.json outputs exist.
*/

// non-ASCII written as \u escapes so the labels render correctly regardless
// of how the browser guesses this file's text encoding (… = …, × = ×)
const LOADING_STEPS = [
    "Parsing dataset (tab-separated, Latin-1)…",
    "Loading precomputed UMAP coordinates…",
    "Computing scrap-family labels…",
    "Loading precomputed blob contours…",
    "Computing normalization table (min/max per column)…",
    "Computing violin KDE curves (14 × 6)…",
    "Building quadtree spatial index…",
    "Loading stock data…",
    "Finalizing…"
];

// rows shown per data-preview page; bumped up from the report's original
// 100/page so a single page surfaces more of the dataset at once
const PAGE_SIZE = 500;
let currentPage = 0;

function init() {
    document.getElementById("defaultOpen").click();

    const fileInput = document.getElementById("upload");
    fileInput.addEventListener("change", handleFileSelected);

    document.getElementById("prevPageBtn").addEventListener("click", function () {
        if (currentPage > 0) { currentPage -= 1; renderPreviewPage(); }
    });
    document.getElementById("nextPageBtn").addEventListener("click", function () {
        const totalPages = Math.max(1, Math.ceil(session.rowCount / PAGE_SIZE));
        if (currentPage < totalPages - 1) { currentPage += 1; renderPreviewPage(); }
    });
}

function handleFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetLoadingUi();
    beginStep(0); // immediate feedback, before the (potentially slow) parse starts

    const worker = new Worker("parse_worker.js");
    worker.onmessage = function (e) {
        finishParseStep(e.data);
        worker.terminate();
        runLoadingSequence();
    };
    worker.onerror = function (err) {
        console.error("parse_worker.js failed:", err.message);
        document.getElementById("progressStepLabel").textContent = "Failed to parse file: " + err.message;
    };
    worker.postMessage({ file: file });
}

function resetLoadingUi() {
    document.getElementById("dataPreviewPanel").hidden = true;
    const fill = document.getElementById("progressFill");
    fill.style.width = "0%";
    fill.classList.remove("is-complete");
}

function beginStep(index) {
    const total = LOADING_STEPS.length;
    document.getElementById("progressStepLabel").textContent = LOADING_STEPS[index];
    document.getElementById("progressStepsCount").textContent = "Step " + (index + 1) + " of " + total;
    const fill = document.getElementById("progressFill");
    fill.classList.add("is-active");
    fill.style.width = Math.round(((index + 1) / total) * 100) + "%";
}

// first column: a stable per-row identifier (report §pre-coding checklist,
// "alloy naming convention decided") — the dataset itself has no names
function generateMixtureIds(rowCount) {
    const ids = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) ids[i] = "Mixture " + (i + 1);
    return ids;
}

function finishParseStep(workerResult) {
    // "Mixture ID" is inserted first so it renders as the 1st column
    // (object key insertion order is preserved for non-numeric string keys)
    const columns = { "Mixture ID": generateMixtureIds(workerResult.rowCount) };
    workerResult.columnNames.forEach(function (col) {
        columns[col] = workerResult.columns[col];
    });
    pipeline.set("columns", columns);
    session.rowCount = workerResult.rowCount;
}

function computeNormTable(columns) {
    const table = {};
    for (const col in columns) {
        const values = columns[col].filter(function (v) { return typeof v === "number"; });
        if (values.length === 0) continue;
        table[col] = { min: d3.min(values), max: d3.max(values) };
    }
    return table;
}

// Dominant-scrap classification (report §2.3): each alloy's family is the
// argmax of its 6 input mixing ratios — UNLESS the top two are within 2
// percentage points of each other, in which case it's "Mixed" (index 6).
// Result is a compact Uint8Array (one byte per row, values 0-6).
function computeFamilyLabels(columns, rowCount) {
    const inputCols = SCRAP_FAMILIES.map(function (f) { return columns[f.col]; });
    const labels = new Uint8Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        let bestIdx = 0, best = -Infinity, second = -Infinity;
        for (let f = 0; f < inputCols.length; f++) {
            const v = inputCols[f][i];
            if (v > best) { second = best; best = v; bestIdx = f; }
            else if (v > second) { second = v; }
        }
        labels[i] = (best - second) <= 2.0 ? 6 : bestIdx; // 6 = Mixed
    }
    return labels;
}

// A Gaussian kernel evaluated at u (report §4.4): (1/√(2π)) e^(−u²/2).
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
function gaussianKernel(u) { return INV_SQRT_2PI * Math.exp(-0.5 * u * u); }

// 1D KDE per attribute per family, on a fixed 200-point grid over the
// normalized [0,1] axis (report §4.4). We subsample each family to at most
// KDE_SAMPLE points — a naive KDE over all 324,632 rows × 200 grid points ×
// 84 curves would be billions of operations, and for a *visual* density a
// few thousand representative points are indistinguishable from all of them.
const KDE_GRID = 200;
const KDE_SAMPLE = 1500;

function computeKdeCache(columns, labels, rowCount) {
    const cache = {};
    // bucket row indices by family once, so we don't rescan the labels
    // array 14 separate times
    const familyRows = [[], [], [], [], [], []]; // Mixed (6) excluded from violins
    for (let i = 0; i < rowCount; i++) {
        const fam = labels[i];
        if (fam < 6) familyRows[fam].push(i);
    }

    ATTRIBUTES.forEach(function (attr) {
        cache[attr.key] = {};
        for (let fam = 0; fam < 6; fam++) {
            cache[attr.key][fam] = computeOneViolin(columns[attr.col], attr.key, familyRows[fam]);
        }
    });
    return cache;
}

function computeOneViolin(colArray, attrKey, rowIdxs) {
    // gather + normalize (with lower-is-better inversion baked in) + subsample
    const step = Math.max(1, Math.floor(rowIdxs.length / KDE_SAMPLE));
    const sample = [];
    for (let k = 0; k < rowIdxs.length; k += step) {
        const nv = pipeline.normAttr(attrKey, colArray[rowIdxs[k]]);
        if (nv !== null && !isNaN(nv)) sample.push(nv);
    }
    const density = new Float32Array(KDE_GRID);
    const n = sample.length;
    if (n === 0) return density;

    // Scott's rule bandwidth for 1D data: h = n^(−1/5) × σ
    const mean = sample.reduce(function (s, v) { return s + v; }, 0) / n;
    let variance = 0;
    for (let k = 0; k < n; k++) { const d = sample[k] - mean; variance += d * d; }
    const std = Math.sqrt(variance / n) || 0.05; // guard against a zero-width family
    const h = Math.pow(n, -1 / 5) * std || 0.02;

    for (let g = 0; g < KDE_GRID; g++) {
        const x = g / (KDE_GRID - 1); // grid point in [0,1]
        let sum = 0;
        for (let k = 0; k < n; k++) sum += gaussianKernel((x - sample[k]) / h);
        density[g] = sum / (n * h);
    }
    return density;
}

async function runLoadingSequence() {
    const fill = document.getElementById("progressFill");
    const total = LOADING_STEPS.length;

    // step 0 (parse) already ran in parse_worker.js before this was called
    for (let i = 1; i < total; i++) {
        beginStep(i);
        await runLoadingStep(i);
    }

    fill.classList.remove("is-active");
    fill.classList.add("is-complete");
    document.getElementById("progressStepLabel").textContent = "Dataset ready.";

    pipeline.set("loaded", true);

    currentPage = 0;
    document.getElementById("dataPreviewPanel").hidden = false;
    renderPreviewPage();
}

function runLoadingStep(index) {
    return new Promise(function (resolve) {
        switch (index) {
            case 2: // scrap-family labels (real, computed from the 6 input columns)
                pipeline.set("family_labels", computeFamilyLabels(session.columns, session.rowCount));
                return resolve();
            case 4: // normalization table (real, self-contained)
                pipeline.set("norm_table", computeNormTable(session.columns));
                return resolve();
            case 5: // violin KDE curves (real; needs norm_table from step 4 + labels from step 2)
                pipeline.set("kde_cache", computeKdeCache(session.columns, session.family_labels, session.rowCount));
                return resolve();
            case 7: // stock data (real, self-contained; falls back to {} offline)
                if (typeof loadStockCSV === "function") {
                    loadStockCSV("../data/stock.csv", function () { resolve(); });
                    return;
                }
                return resolve();
            default:
                // steps 1, 3, 6, 8: depend on data/precompute.py outputs
                // (umap_coords.npy, blob_contours.json) and the quadtree
                // build — simulated here until those files exist.
                return setTimeout(resolve, 200);
        }
    });
}

function renderPreviewPage() {
    const totalPages = Math.max(1, Math.ceil(session.rowCount / PAGE_SIZE));
    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, session.rowCount);

    const columnNames = Object.keys(session.columns);
    const container = d3.select("#dataTable");
    container.selectAll("*").remove();

    const table = container.append("table").attr("class", "dataTableClass");
    const header = table.append("thead").append("tr");
    columnNames.forEach(function (col) {
        header.append("th").attr("class", "tableHeaderClass").text(col);
    });
    header.append("th").attr("class", "tableHeaderClass").text("Scrap Family");

    const body = table.append("tbody");
    for (let i = start; i < end; i++) {
        const row = pipeline.getRow(i);
        const tr = body.append("tr");
        columnNames.forEach(function (col) {
            const value = row[col];
            tr.append("td")
                .attr("class", "tableBodyClass")
                .attr("title", value)
                .text(value);
        });
        tr.append("td").attr("class", "tableBodyClass").text(familyLabelName(i));
    }

    document.getElementById("pageCounter").textContent =
        "Page " + (currentPage + 1) + " of " + totalPages;
    document.getElementById("prevPageBtn").disabled = currentPage === 0;
    document.getElementById("nextPageBtn").disabled = currentPage >= totalPages - 1;
}

// FAMILY_NAMES lives in pipeline.js (shared with T3/T5)
function familyLabelName(rowIndex) {
    if (!session.family_labels) return "N/A";
    return FAMILY_NAMES[session.family_labels[rowIndex]] || "N/A";
}

// switches and displays the tabs; "+ Add Project" only makes sense once
// the Dashboard workflow (T1-T6) is visible
function openPage(pageName, elmnt) {
    document.querySelectorAll(".tabcontent").forEach(function (el) { el.classList.remove("active"); });
    document.querySelectorAll(".tablink").forEach(function (el) { el.classList.remove("active"); });
    document.getElementById(pageName).classList.add("active");
    elmnt.classList.add("active");

    document.getElementById("addProjectBtn").hidden = pageName !== "Dashboard";

    // The dashboard canvases size themselves to their displayed dimensions,
    // but that only works once they're actually visible. The first render
    // fires while this tab is still hidden (zero-sized), so re-render the
    // dashboard views the moment we switch to it.
    if (pageName === "Dashboard") rerenderDashboard();
}

// re-draw the canvas-based dashboard views (used on tab switch and resize, so
// they always match their current on-screen size for crisp output)
function rerenderDashboard() {
    if (!session.loaded) return;
    if (typeof renderT3 === "function") renderT3();
    if (typeof renderT5Spiders === "function") renderT5Spiders();
}

// a window resize changes each canvas's displayed width, which would blur the
// last-drawn bitmap — redraw at the new size (debounced so we don't thrash)
let t_resizeTimer = null;
window.addEventListener("resize", function () {
    clearTimeout(t_resizeTimer);
    t_resizeTimer = setTimeout(function () {
        if (document.getElementById("Dashboard").classList.contains("active")) rerenderDashboard();
    }, 150);
});
