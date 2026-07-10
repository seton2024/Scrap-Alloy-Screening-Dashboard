/*
* t6_table.js — T6 Alloy Characteristics Table (Lookup view)
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §3.8, §4.7
*/

function initT6() {
    // When picks change, redraw the table
    pipeline.onChange("picks", renderT6Table);
}

function renderT6Table() {
    // Grab the two DOM slots we need
    const tableSlot   = document.getElementById("tableT6");
    const placeholder = document.getElementById("placeholderT6");

    // No picks yet? Show the placeholder, empty the table.
    if (session.picks.length === 0) {
        placeholder.hidden = false;
        tableSlot.innerHTML = "";
        return;
    }

    // Picks exist -> hide the placeholder, we'll build a table below.
    placeholder.hidden = true;

    // We build the table as one big HTML string, then dump it into tableSlot.
    let html = "<table class='t6-table'>";

    // --- Header row: "Attribute" + one column per picked alloy ---
    html += "<tr><th>Attribute</th>";
    session.picks.forEach(function (pick) {
        html += "<th>Alloy #" + pick.number + "</th>";
    });
    html += "</tr>";

    // --- Recipe rows: 6 scrap families ---
    SCRAP_FAMILIES.forEach(function (scrap) {
        html += "<tr><td>" + scrap.key + " (%)</td>";
        session.picks.forEach(function (pick) {
            const row = pipeline.getRow(pick.rowId);
            const value = row[scrap.col];
            html += "<td>" + value.toFixed(1) + "</td>";
        });
        html += "</tr>";
    });

    // --- Property rows: 14 output attributes ---
    ATTRIBUTES.forEach(function (attr) {
        html += "<tr><td>" + attr.label + "</td>";
        session.picks.forEach(function (pick) {
            const row = pipeline.getRow(pick.rowId);
            const value = row[attr.col];
            html += "<td>" + value.toFixed(3) + "</td>";
        });
        html += "</tr>";
    });

    // --- Disclaimer row at the bottom ---
    const nCols = session.picks.length + 1;
    html += "<tr><td colspan='" + nCols + "'><i>Values are CALPHAD predictions.</i></td></tr>";

    html += "</table>";

    // Push the finished HTML into the DOM
    tableSlot.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", initT6);