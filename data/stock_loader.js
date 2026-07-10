/*
* stock_loader.js — parses the facility stock CSV into a lookup table
* Format: scrap_family, qty_kg (one row per scrap family). Not part of the
* SciVis dataset — a facility-specific input loaded at session start.
*/

function loadStockCSV(url, callback) {
    d3.csv(url, function (row) {
        return { scrap_family: row.scrap_family, qty_kg: +row.qty_kg };
    }).then(function (rows) {
        const stock = {};
        rows.forEach(function (r) { stock[r.scrap_family] = r.qty_kg; });
        pipeline.set("stock", stock);
        if (callback) callback(stock);
    }).catch(function (err) {
        console.warn("stock_loader.js: could not load " + url + " (expected when opened via file://).", err);
        if (callback) callback({});
    });
}
