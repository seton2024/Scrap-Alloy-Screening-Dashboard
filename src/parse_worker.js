// parse_worker.js - the loading pipeline, off the main thread.

// Web Worker so the UI never freezes. Parses the raw file, fetches the
// files data/precompute.py already made. Sends { type:"step", index } per stage.


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
        const stock = await fetchJson(DATA_DIR + "stock.json");

        postMessage({ type: "step", index: 7 }); // finalizing

        // transfer the big typed-array buffers instead of copying them.
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

// The dataset is Latin-1 (ISO-8859-1), 
// Float64 (not Float32) so displayed values match the source file exactly;
async function parseDataset(file) {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("iso-8859-1").decode(buffer);

    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop(); // trailing newline

    const columnNames = lines[0].split("\t");
    const rowCount = lines.length - 1;

    // warn on a repeated header name (last one wins, data would be lost silently)
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
// writes (float32 and uint8, C-order, version 1.0/2.0).
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

