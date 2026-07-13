// loading_tab.js - Loading tab: dataset parse, loading animation, data preview

// Heavy compute ran once offline (data/precompute.py). parse_worker.js
// fetches it and parses the raw file off the main thread; this file drives it.


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

// worker result lands here. Write fields in order, "loaded" last.
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
    // re-check the button here too, in case the user is already on the
    // Dashboard tab when loading finishes (openPage won't fire again)
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

// FAMILY_NAMES lives in datavis.js (shared with T3/T5)
function familyLabelName(rowIndex) {
    if (!session.family_labels) return "N/A";
    return FAMILY_NAMES[session.family_labels[rowIndex]] || "N/A";
}

// "+ Add Project" needs both the Dashboard tab open AND data loaded -
// T1/T2 read session data that doesn't exist before session.loaded.
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

    // canvases size to their on-screen box, which is 0 while hidden - redraw on switch
    if (pageName === "Dashboard") rerenderDashboard();
}

// re-draw the canvas-based dashboard views (used on tab switch and resize, so
// they always match their current on-screen size for crisp output)
function rerenderDashboard() {
    if (!session.loaded) return;
    if (typeof renderT2 === "function") renderT2();
    if (typeof renderT3 === "function") renderT3();
    if (typeof renderT4Panels === "function") renderT4Panels();
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
