/*
* loading_tab.js - Loading tab: dataset parse, loading animation, data preview
*
* Fetch-only loading: the heavy computation (UMAP, family labels, norm
* table, KDE curves, spatial grid) already ran once, offline, in
* data/precompute.py. All of it — plus parsing the raw dataset file — runs
* in parse_worker.js so the main thread and its progress animation never
* freeze. This file just drives the worker and renders its result.
*/


const LOADING_STEPS = [
    "Parsing dataset (tab-separated, Latin-1)…",
    "Loading precomputed UMAP coordinates…",
    "Loading scrap-family labels…",
    "Loading normalization table…",
    "Loading violin KDE curves…",
    "Loading spatial grid…",
    "Loading stock data…",
    "Finalizing…"
];

const PAGE_SIZE = 100;
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
    beginStep(0); // immediate feedback, before the worker's first message arrives

    const worker = new Worker("parse_worker.js");
    worker.onmessage = function (e) {
        const msg = e.data;
        if (msg.type === "step") { beginStep(msg.index); return; }
        if (msg.type === "error") {
            console.error("parse_worker.js failed:", msg.message);
            document.getElementById("progressStepLabel").textContent = "Failed to load: " + msg.message;
            worker.terminate();
            return;
        }
        finishLoading(msg); // msg.type === "done"
        worker.terminate();
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

// first column: a stable per-row identifier — the dataset itself has no names
function generateMixtureIds(rowCount) {
    const ids = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) ids[i] = "Mixture " + (i + 1);
    return ids;
}

// everything the worker fetched/parsed lands here in one shot; write session
// fields in dependency order and "loaded" last (subscribers read the rest of
// session when it fires)
function finishLoading(result) {
    session.rowCount = result.rowCount; // set before "columns" — subscribers may read it

    // "Mixture ID" inserted first so it renders as the 1st preview column
    const columns = { "Mixture ID": generateMixtureIds(result.rowCount) };
    result.columnNames.forEach(function (col) { columns[col] = result.columns[col]; });
    pipeline.set("columns", columns);

    pipeline.set("umap", result.umap);
    pipeline.set("family_labels", result.familyLabels);
    pipeline.set("norm_table", result.normTable);
    pipeline.set("kde_cache", result.kdeCache);
    pipeline.set("quadtree", result.spatialGrid); // uniform grid doubles as the T2 spatial index
    pipeline.set("stock", result.stock);

    const fill = document.getElementById("progressFill");
    fill.classList.remove("is-active");
    fill.classList.add("is-complete");
    document.getElementById("progressStepLabel").textContent = "Dataset ready.";

    pipeline.set("loaded", true);
    // "+ Add Project" reads session.norm_table (T1's out-of-range validation)
    // and session.projects (T2's pre-filter dimming) — both are meaningless
    // before load finishes. openPage() only re-evaluates the button's hidden
    // state when a tab is clicked, so if the user is already sitting on the
    // Dashboard tab when loading completes, nothing would otherwise unhide
    // the button — re-check it here too.
    updateAddProjectBtnVisibility();

    currentPage = 0;
    document.getElementById("dataPreviewPanel").hidden = false;
    renderPreviewPage();
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

// "+ Add Project" only makes sense once BOTH the Dashboard tab is showing
// AND the dataset has actually finished loading (T1's out-of-range check and
// T2's pre-filter dimming both read data - session.norm_table, session.
// columns - that doesn't exist until session.loaded is true). Previously this
// only checked the tab, so the modal was reachable (and silently broken -
// e.g. the out-of-range check always no-op'd) before any file was uploaded.
function updateAddProjectBtnVisibility() {
    const dashboardActive = document.getElementById("Dashboard").classList.contains("active");
    document.getElementById("addProjectBtn").hidden = !dashboardActive || !session.loaded;
}

// switches and displays the tabs
function openPage(pageName, elmnt) {
    document.querySelectorAll(".tabcontent").forEach(function (el) { el.classList.remove("active"); });
    document.querySelectorAll(".tablink").forEach(function (el) { el.classList.remove("active"); });
    document.getElementById(pageName).classList.add("active");
    elmnt.classList.add("active");

    updateAddProjectBtnVisibility();

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
    if (typeof renderT2 === "function") renderT2();
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
