// t6_table.js - T6 Alloy Characteristics Table (Lookup view)

// One shared table: a single "Attribute" column, then A1-A4 (left side),
// then B1-B4 (right side, only in dual-project mode) — not two separate
// tables that would each need their own Attribute column.
// picksForProject() lives in pipeline.js; violatesConstraint() in t5_spider.js


// every T6 data cell (recipe % and output-property alike) goes through the
// shared fmtVal() (pipeline.js) so scientific-notation values are consistent
// with T1's inputs instead of each cell inventing its own precision rule
function formatAttrCell(attr, value) {
    return fmtVal(value);
}

// direction-aware winner of a set of raw values (null if there's nothing to compare)
function bestOf(values, higherIsBetter) {
    return values.reduce(function (best, v) {
        if (best == null) return v;
        return higherIsBetter ? Math.max(best, v) : Math.min(best, v);
    }, null);
}

function initT6() {
    pipeline.onChange("picks", renderT6Tables);
    pipeline.onChange("projects", renderT6Tables);
    pipeline.onChange("stock_alerts", renderT6Tables);
    // T5 axis-label hover  used in T6
    pipeline.onChange("hovered_axis", applyT6HoverHighlight);
}

function renderT6Tables() {
    const dual   = session.projects.length > 1;
    const picksA = picksForProject(0).slice(0, 4);
    const picksB = dual ? picksForProject(1).slice(0, 4) : [];

    const placeholder = document.getElementById("placeholderT6");
    placeholder.hidden = picksA.length > 0 || picksB.length > 0;

    renderCombinedTable(picksA, picksB);
    applyT6HoverHighlight();
}

// one table: Attribute | A1..A4 | B1..B4. "Best" is compared separately
// within each side's own picks (A vs A, B vs B) — the two projects can have
// completely different requirements, so cross-side comparison isn't meaningful.
function renderCombinedTable(picksA, picksB) {
    const slot = document.getElementById("tableT6");
    if (picksA.length === 0 && picksB.length === 0) { slot.innerHTML = ""; return; }

    const projectA = session.projects[0];
    const projectB = session.projects[1];
    const nCols = 1 + picksA.length + picksB.length;

    // renders one side's <td> cells for a row; adds a divider marker to the
    // first B column so "A on the left, B on the right" reads as two groups
    function pickCells(picks, side, cellFn) {
        let html = "";
        picks.forEach(function (pick, i) {
            const classes = (cellFn.classes(pick, i) || "").split(" ").filter(Boolean);
            if (side === "B" && i === 0) classes.push("t6-b-divider");
            const cls = classes.length ? " class='" + classes.join(" ") + "'" : "";
            html += "<td" + cls + ">" + cellFn.value(pick, i) + "</td>";
        });
        return html;
    }

    let html = "<table class='t6-table'>";

    // HEADER ROW: "Attribute" + A1-A4 (left) + B1-B4 (right)
    html += "<tr><th>Attribute</th>";
    picksA.forEach(function (pick) { html += "<th>A" + pick.number + "</th>"; });
    picksB.forEach(function (pick, i) { html += "<th class='" + (i === 0 ? "t6-b-divider" : "") + "'>B" + pick.number + "</th>"; });
    html += "</tr>";

    // RECIPE SELECTION: 6 scrap families
    html += sectionHeaderRow("Recipe", nCols);
    SCRAP_FAMILIES.forEach(function (fam) {
        html += "<tr><td>" + fam.key + "</td>";
        html += pickCells(picksA, "A", {
            classes: function (pick) { return cellHasStockAlert(pick, fam.key, "A") ? "t6-cell-amber" : ""; },
            value: function (pick) { return fmtVal(session.columns[fam.col][pick.rowId]); }
        });
        html += pickCells(picksB, "B", {
            classes: function (pick) { return cellHasStockAlert(pick, fam.key, "B") ? "t6-cell-amber" : ""; },
            value: function (pick) { return fmtVal(session.columns[fam.col][pick.rowId]); }
        });
        html += "</tr>";
    });

    // OUTPUT PROPERTIES SECTION: 14 attributes, abbreviation row titles
    html += sectionHeaderRow("Output properties", nCols);
    ATTRIBUTES.forEach(function (attr) {
        const valuesA = picksA.map(function (pick) { return session.columns[attr.col][pick.rowId]; });
        const valuesB = picksB.map(function (pick) { return session.columns[attr.col][pick.rowId]; });
        const bestA = picksA.length > 1 ? bestOf(valuesA, attr.higherIsBetter) : null;
        const bestB = picksB.length > 1 ? bestOf(valuesB, attr.higherIsBetter) : null;

        html += "<tr data-attr-key='" + attr.key + "'><td title='" + escapeHtml(attr.label) + "'>" + attr.key + "</td>";
        html += pickCells(picksA, "A", {
            classes: function (pick, i) {
                const c = [];
                if (projectA && violatesConstraint(projectA, attr.key, valuesA[i])) c.push("t6-cell-red");
                if (bestA != null && valuesA[i] === bestA) c.push("t6-cell-best");
                return c.join(" ");
            },
            value: function (pick, i) { return formatAttrCell(attr, valuesA[i]); }
        });
        html += pickCells(picksB, "B", {
            classes: function (pick, i) {
                const c = [];
                if (projectB && violatesConstraint(projectB, attr.key, valuesB[i])) c.push("t6-cell-red");
                if (bestB != null && valuesB[i] === bestB) c.push("t6-cell-best");
                return c.join(" ");
            },
            value: function (pick, i) { return formatAttrCell(attr, valuesB[i]); }
        });
        html += "</tr>";
    });

    //DISCLAIMER
    html += "<tr><td colspan='" + nCols + "'><i>Values are CALPHAD predictions. Verify by laboratory measurement before production use.</i></td></tr>";

    html += "</table>";
    slot.innerHTML = html;
}

function sectionHeaderRow(label, colspan) {
    return "<tr class='t6-section'><td colspan='" + colspan + "'>" + label + "</td></tr>";
}

// does a stock alert happen on pick's scrap-family cell on this table side?
function cellHasStockAlert(pick, scrapKey, side) {
    return session.stock_alerts.some(function (al) {
        if (al.scrap !== scrapKey) return false;
        if (al.type === "single") return al.rowId === pick.rowId && al.project === side;
        return side === "A" ? al.rowIdA === pick.rowId : al.rowIdB === pick.rowId;
    });
}

//highlight the matching property row (shared by both A and B columns now)
function applyT6HoverHighlight() {
    document.querySelectorAll("#tableT6 tr[data-attr-key]").forEach(function (tr) {
        tr.classList.remove("t6-row-hover");
    });

    const hov = session.hovered_axis;
    if (!hov) return;
    const row = document.querySelector("#tableT6 tr[data-attr-key='" + hov.key + "']");
    if (row) {
        row.classList.add("t6-row-hover");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
}

document.addEventListener("DOMContentLoaded", initT6);
