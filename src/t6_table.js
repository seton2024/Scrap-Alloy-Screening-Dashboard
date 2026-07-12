// t6_table.js - T6 Alloy Characteristics Table (Lookup view)

// Two side-by-side tables: 
//      Table A ,
//      Table B (hidden in single-project)
//      mode. picksForProject() / violatesConstraint() defined here used in T6


// per-property formatting; attrs not listed here (the secondary tier) 
// fall back to formatRangeValue's magnitude-aware default
const T6_FIXED_DP     = { YS: 0, CSC: 3, TC: 1, Hardness: 1, Density: 3 };
const T6_SCI_SIGFIGS  = { ER: 2, LinearTE: 2 };

const SUPERSCRIPT_DIGITS = {
    "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"
};

function toSuperscript(n) {
    return String(n).split("").map(function (ch) { return SUPERSCRIPT_DIGITS[ch] || ch; }).join("");
}

// scientific notation "2.8×10⁻⁸"
function formatSci(value, sig) {
    if (value === 0) return "0";
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    let exp = Math.floor(Math.log10(abs));
    let mantissa = (abs / Math.pow(10, exp)).toFixed(sig - 1);
    if (parseFloat(mantissa) >= 10) { // rounding pushed e.g. 9.96 -> "10.0"
        exp += 1;
        mantissa = (abs / Math.pow(10, exp)).toFixed(sig - 1);
    }
    return sign + mantissa + "×10" + toSuperscript(exp);
}

function formatAttrCell(attr, value) {
    if (value == null || isNaN(value)) return "—";
    if (T6_SCI_SIGFIGS[attr.key] != null) return formatSci(value, T6_SCI_SIGFIGS[attr.key]);
    if (T6_FIXED_DP[attr.key] != null) return value.toFixed(T6_FIXED_DP[attr.key]);
    return formatRangeValue(value);
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
    const picksB = picksForProject(1).slice(0, 4);

    document.getElementById("t6WrapB").hidden = !dual;

    const placeholder = document.getElementById("placeholderT6");
    placeholder.hidden = picksA.length > 0 || (dual && picksB.length > 0);

    renderOneTable("tableT6-A", picksA, 0, "A");
    if (dual) renderOneTable("tableT6-B", picksB, 1, "B");
    else document.getElementById("tableT6-B").innerHTML = "";

    applyT6HoverHighlight();
}

function renderOneTable(slotId, picks, projIdx, side) {
    const slot = document.getElementById(slotId);
    if (picks.length === 0) { slot.innerHTML = ""; return; }

    const project = session.projects[projIdx];
    const nCols = picks.length + 1;

    let html = "<table class='t6-table t6-table-" + side.toLowerCase() + "'>";

    // HEADER ROW: "Attribute" + one column per picked alloy (A1-A4 / B1-B4)
    html += "<tr><th>Attribute</th>";
    picks.forEach(function (pick) { html += "<th>" + side + pick.number + "</th>"; });
    html += "</tr>";

    // RECIPIE SELECTION: 6 scrap families
    html += sectionHeaderRow("Recipe", nCols);
    SCRAP_FAMILIES.forEach(function (fam) {
        html += "<tr><td>" + fam.key + "</td>";
        picks.forEach(function (pick) {
            const value = session.columns[fam.col][pick.rowId];
            const amber = cellHasStockAlert(pick, fam.key, side);
            html += "<td" + (amber ? " class='t6-cell-amber'" : "") + ">" + value.toFixed(1) + "</td>";
        });
        html += "</tr>";
    });

    //OUTPUT PROPERTIES SECTION: 14 attributes, abbreviation row titles
    html += sectionHeaderRow("Output properties", nCols);
    ATTRIBUTES.forEach(function (attr) {
        const values = picks.map(function (pick) { return session.columns[attr.col][pick.rowId]; });
        const best = picks.length > 1 ? bestOf(values, attr.higherIsBetter) : null;

        html += "<tr data-attr-key='" + attr.key + "'><td title='" + escapeHtml(attr.label) + "'>" + attr.key + "</td>";
        picks.forEach(function (pick, i) {
            const value = values[i];
            const classes = [];
            if (project && violatesConstraint(project, attr.key, value)) classes.push("t6-cell-red");
            if (best != null && value === best) classes.push("t6-cell-best");
            html += "<td" + (classes.length ? " class='" + classes.join(" ") + "'" : "") + ">" + formatAttrCell(attr, value) + "</td>";
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

//highlight the matching property row in table A or B
function applyT6HoverHighlight() {
    document.querySelectorAll("#tableT6-A tr[data-attr-key], #tableT6-B tr[data-attr-key]").forEach(function (tr) {
        tr.classList.remove("t6-row-hover");
    });

    const hov = session.hovered_axis;
    if (!hov) return;
    const tableId = hov.project === "B" ? "tableT6-B" : "tableT6-A";
    const row = document.querySelector("#" + tableId + " tr[data-attr-key='" + hov.key + "']");
    if (row) {
        row.classList.add("t6-row-hover");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
}

document.addEventListener("DOMContentLoaded", initT6);
