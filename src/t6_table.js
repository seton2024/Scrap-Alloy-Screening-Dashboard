/*
* t6_table.js — T6 Alloy Characteristics Table (Lookup view)
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §3.8, §4.7
*/

function initT6() {
    // When picks change, redraw the table
    pipeline.onChange("picks", renderT6Table);
    // TA: T5 axis-label hover -> highlight the matching property row here
    pipeline.onChange("hovered_axis", applyT6HoverHighlight);
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
        html += "<tr data-attr-key='" + attr.key + "'><td>" + attr.label + "</td>";
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

    // a fresh table has no highlight yet — re-apply whatever T5 was
    // already hovering (e.g. picks changed while the mouse hadn't moved)
    applyT6HoverHighlight();
}

// TA: T5 axis-label hover -> highlight the matching property row, scrolled
// into view. NOTE: T6 is still a single combined table (the picks_a/picks_b
// A-table/B-table split is a separate, not-yet-implemented task), so for now
// this highlights the one table's row regardless of which spider (A or B)
// is being hovered — session.hovered_axis.project is already carried through
// so wiring in the per-project table later needs no changes here beyond
// picking the right table element.
function applyT6HoverHighlight() {
    const rows = document.querySelectorAll("#tableT6 tr[data-attr-key]");
    rows.forEach(function (tr) { tr.classList.remove("t6-row-hover"); });

    const hov = session.hovered_axis;
    if (!hov) return;
    const row = document.querySelector("#tableT6 tr[data-attr-key='" + hov.key + "']");
    if (row) {
        row.classList.add("t6-row-hover");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
}

document.addEventListener("DOMContentLoaded", initT6);