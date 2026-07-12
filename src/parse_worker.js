/*
* parse_worker.js — the entire loading pipeline, off the main thread.
* Owner: P2 · Branch: p2-ui
*
* Runs in a Web Worker so the progress UI never freezes. Does two kinds of
* work: (1) parses the user-selected raw dataset file, (2) fetches every
* precomputed file that data/precompute.py already generated. Nothing here
* recomputes anything precompute.py already did — loading is fetch-only.
*
* Sends one { type:"step", index } message before each stage so the main
* thread can update the progress label, then a single { type:"done", ... }
* message with everything the pipeline needs.
*/

const DATA_DIR = "../data/";

self.onmessage = async function (event) {
    const file = event.data.file;
    try {
        postMessage({ type: "step", index: 0 });
        const parsed = await parseDataset(file);

        postMessage({ type: "step", index: 1 });
        const umap = await fetchNpy(DATA_DIR + "umap_coords.npy");

        postMessage({ type: "step", index: 2 });
        const familyLabels = await fetchNpy(DATA_DIR + "family_labels.npy");

        postMessage({ type: "step", index: 3 });
        const normTable = await fetchJson(DATA_DIR + "norm_table.json");

        postMessage({ type: "step", index: 4 });
        const kdeCache = await fetchJson(DATA_DIR + "kde_curves.json");

        postMessage({ type: "step", index: 5 });
        const spatialGrid = await fetchJson(DATA_DIR + "spatial_grid.json");

        postMessage({ type: "step", index: 6 });
        const stock = parseStockCsv(await fetchText(DATA_DIR + "stock.csv"));

        postMessage({ type: "step", index: 7 }); // finalizing

        // transfer the big typed-array buffers instead of copying them. A
        // buffer can only be transferred once — dedupe defensively in case
        // the header has a repeated column name (parsed.columns[name] would
        // then be the same array under two entries of parsed.columnNames).
        const transferList = [];
        const transferred = new Set();
        function addTransfer(buf) { if (!transferred.has(buf)) { transferred.add(buf); transferList.push(buf); } }
        addTransfer(umap.buffer);
        addTransfer(familyLabels.buffer);
        parsed.columnNames.forEach(function (name) { addTransfer(parsed.columns[name].buffer); });

        postMessage({
            type: "done",
            columns: parsed.columns,
            columnNames: parsed.columnNames,
            rowCount: parsed.rowCount,
            umap: umap,
            familyLabels: familyLabels,
            normTable: normTable,
            kdeCache: kdeCache,
            spatialGrid: spatialGrid,
            stock: stock
        }, transferList);
    } catch (err) {
        postMessage({ type: "error", message: err.message });
    }
};

// The dataset is Latin-1 (ISO-8859-1), not UTF-8. Reading it as UTF-8 would
// turn the degree sign (byte 0xB0) in three column names into a replacement
// character, breaking exact column-name matching against pipeline.js.
// Columns are written straight into preallocated Float64Arrays — no
// intermediate per-row objects — since every real dataset column is numeric.
// Float64 (not Float32) so displayed values match the source file exactly;
// JS numbers are doubles anyway, so this costs memory, not precision.
async function parseDataset(file) {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("iso-8859-1").decode(buffer);

    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop(); // trailing newline

    const columnNames = lines[0].split("\t");
    const rowCount = lines.length - 1;

    // a repeated header name would collide in the `columns` dictionary (last
    // occurrence wins, same as the old d3-based parser) — warn so it's
    // visible instead of silently losing a column's data
    const columns = {};
    const seenNames = new Set();
    columnNames.forEach(function (name) {
        if (seenNames.has(name)) console.warn('parse_worker.js: duplicate column name "' + name + '" in header');
        seenNames.add(name);
        columns[name] = new Float64Array(rowCount);
    });

    for (let i = 0; i < rowCount; i++) {
        const cells = lines[i + 1].split("\t");
        for (let c = 0; c < columnNames.length; c++) {
            columns[columnNames[c]][i] = parseFloat(cells[c]);
        }
    }
    return { columns: columns, columnNames: columnNames, rowCount: rowCount };
}

// Minimal .npy reader — just enough to unwrap the two arrays precompute.py
// writes (float32 and uint8, C-order, version 1.0/2.0). Not a general-purpose
// parser: no library exists for "read one small numpy file in a worker", and
// writing 20 lines beats pulling in a dependency for that.
function parseNpy(buffer) {
    const view = new DataView(buffer);
    const majorVersion = view.getUint8(6);
    const headerLenBytes = majorVersion === 1 ? 2 : 4;
    const headerLenOffset = 8;
    const headerLen = majorVersion === 1
        ? view.getUint16(headerLenOffset, true)
        : view.getUint32(headerLenOffset, true);
    const headerStart = headerLenOffset + headerLenBytes;
    const header = String.fromCharCode.apply(null, new Uint8Array(buffer, headerStart, headerLen));

    const descr = header.match(/'descr':\s*'([^']+)'/)[1];
    const dataStart = headerStart + headerLen;

    if (descr === "<f4") return new Float32Array(buffer, dataStart);
    if (descr === "|u1" || descr === "<u1") return new Uint8Array(buffer, dataStart);
    throw new Error("parseNpy: unsupported dtype " + descr);
}

async function fetchNpy(path) {
    const res = await fetch(path);
    return parseNpy(await res.arrayBuffer());
}

async function fetchJson(path) {
    const res = await fetch(path);
    return res.json();
}

async function fetchText(path) {
    const res = await fetch(path);
    return res.text();
}

// stock.csv: "scrap_family,qty_kg" header + one row per family
function parseStockCsv(text) {
    const lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
    const stock = {};
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        stock[parts[0]] = Number(parts[1]);
    }
    return stock;
}
