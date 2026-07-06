/*
* parse_worker.js — off-main-thread dataset parsing
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §4.0 ("All loading steps run
* in a Web Worker to avoid blocking the main thread").
*
* Parsing 324,632 rows synchronously on the main thread is what made the
* progress bar appear frozen for a few seconds after choosing a file: the
* browser can't paint until the parse finishes. Running it here keeps the
* UI thread free so the progress animation keeps playing.
*/

importScripts("https://d3js.org/d3.v7.min.js");

self.onmessage = async function (event) {
    const file = event.data.file;

    // The dataset is Latin-1 (ISO-8859-1), not UTF-8. file.text() would
    // assume UTF-8 and turn the degree sign (byte 0xB0) in three column
    // names into a replacement character, breaking exact column-name
    // matching. So we read the raw bytes and decode them as Latin-1
    // ourselves, which round-trips the ° sign correctly.
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("iso-8859-1").decode(buffer);

    const firstLine = text.split(/\r?\n/, 1)[0];
    const delimiter = firstLine.indexOf("\t") !== -1 ? "\t" : ",";
    const parser = d3.dsvFormat(delimiter);

    const rows = parser.parse(text, function (row) {
        for (const key in row) {
            if (row[key] !== "" && !isNaN(+row[key])) row[key] = +row[key];
        }
        return row;
    });

    const columnNames = rows.columns.slice();
    const columns = {};
    columnNames.forEach(function (col) {
        columns[col] = rows.map(function (r) { return r[col]; });
    });

    self.postMessage({ columns: columns, columnNames: columnNames, rowCount: rows.length });
};
