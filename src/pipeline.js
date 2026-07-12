// pipeline.js - shared cross-view session state + shared config

// T1 (t1_modal.js) is the sole writer of session.projects.

// The loading tab (loading_tab.js) is the sole writer of the dataset fields

// Every other view is a read-only consumer: subscribe with
// pipeline.onChange(key, callback) and re-render when notified.


const session = {
    loaded: false,

    // dataset (written once by the loading pipeline)
    columns: {},            // { colName: Array } column-store, full dataset
    umap: null,              // Float32Array, 324632 rows * 2 (x,y) — not yet used
    family_labels: null,      // Uint8Array, 324632 family indices (0-6)    norm_table: {},          // { colName: { min, max } }
    kde_cache: {},           // { attrKey: { familyIdx: Float32Array(200) } }
    quadtree: null,
    stock: {},               // { scrap_family_name: qty_kg }
    rowCount: 0,

    // T1 (session.projects T1 is allowed to write)
    projects: [],            // 1 or 2 entries, 

    // cross-view selection state
    brush_t2: null,           // { rowIds: Set } | null
    brush_t3: {},             // { attrKey: [normMin, normMax] }
    active_set: null,         // Set of row ids (brush_t2 ∩ brush_t3), or null = "all"
    picks: [],                // up to 4 entries: { rowId, number: 1-4, project: 'A'|'B' }
    stock_alerts: [],         // { type: 'single'|'combined', ... } — derived, recomputed by pipeline whenever picks/projects change
    feasible_mask: null,      // Uint8Array, 1 = row passes >=1 active project's full thresholds — derived, recomputed whenever projects changes
    hovered_axis: null,       // { key, project: 'A'|'B' } | null — T5 axis-label hover, read by T6 to highlight its matching row
    axisQueue: []             // [{ axis, source: 'T1'|'T3', brushRange: [lo,hi]|null }] — T1 writes on Apply, T3 writes on brush commit/clear; T4 reads to pick default axes for new panels
};

// SHARED CONFIG — single source of truth for every view

const DEG_C = String.fromCharCode(0xB0) + "C";

const ATTRIBUTES = [
    // --- primary tier (7) ---
    { key: "YS",       col: "YS(MPa)",                    label: "Yield Strength (MPa)",              higherIsBetter: true,  defaultMargin: 10, tier: "primary",   mostUsed: true  },
    { key: "CSC",      col: "CSC",                        label: "Hot Crack Susceptibility (CSC)",     higherIsBetter: false, defaultMargin: 15, tier: "primary",   mostUsed: true  },
    { key: "TC",       col: "Therm.conductivity(W/(mK))", label: "Thermal Conductivity (W/(m·K))", higherIsBetter: true,  defaultMargin: 10, tier: "primary",   mostUsed: true  },
    { key: "ER",       col: "El. resistivity(ohm m)",     label: "Electrical Resistivity (ohm·m)", higherIsBetter: false, defaultMargin: 10, tier: "primary",   mostUsed: true  },
    { key: "Hardness", col: "hardness(Vickers)",          label: "Hardness (Vickers)",                 higherIsBetter: true,  defaultMargin: 10, tier: "primary",   mostUsed: false },
    { key: "Density",  col: "Density(g/cm3)",             label: "Density (g/cm³)",               higherIsBetter: false, defaultMargin: 5,  tier: "primary",   mostUsed: false },
    { key: "LinearTE", col: "Linear thermal expansion (1/K)(20.0-300.0" + DEG_C + ")", label: "Linear Thermal Expansion (1/K)", higherIsBetter: false, defaultMargin: 10, tier: "primary", mostUsed: false },
    // --- secondary tier (7) ---
    { key: "ThermDiff", col: "Therm. diffusivity(m2/s)",  label: "Thermal Diffusivity (m²/s)",    higherIsBetter: true,  defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "HeatCap",   col: "heat capacity(J/(mol K))",  label: "Heat Capacity (J/(mol·K))",     higherIsBetter: true,  defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "ThermRes",  col: "Therm.resistivity(mK/W)",   label: "Thermal Resistivity (mK/W)",         higherIsBetter: false, defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "ElCond",    col: "El.conductivity(S/m)",      label: "Electrical Conductivity (S/m)",      higherIsBetter: true,  defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "CTEvol",    col: "CTEvol(1/K)(20.0-300.0" + DEG_C + ")", label: "CTE Volumetric (1/K)",          higherIsBetter: false, defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "TechTE",    col: "Technical thermal expansion (1/K)(20.0-300.0" + DEG_C + ")", label: "Technical Thermal Exp. (1/K)", higherIsBetter: false, defaultMargin: 10, tier: "secondary", mostUsed: false },
    { key: "Volume",    col: "Volume(m3/mol)",            label: "Volume (m³/mol)",               higherIsBetter: true,  defaultMargin: 10, tier: "secondary", mostUsed: false }
];

const PRIMARY_ATTRS   = ATTRIBUTES.filter(function (a) { return a.tier === "primary"; });
const SECONDARY_ATTRS = ATTRIBUTES.filter(function (a) { return a.tier === "secondary"; });

// fast lookup: attribute key -> attribute object
const ATTR_BY_KEY = {};
ATTRIBUTES.forEach(function (a) { ATTR_BY_KEY[a.key] = a; });

// 6 scrap families (index 0-5). Mixed (index 6) is a derived => no input column of its own.
const SCRAP_FAMILIES = [
    { key: "KS1295",  col: "KS1295[%]"  },
    { key: "6082",    col: "6082[%]"    },
    { key: "2024",    col: "2024[%]"    },
    { key: "bat-box", col: "bat-box[%]" },
    { key: "3003",    col: "3003[%]"    },
    { key: "4032",    col: "4032[%]"    }
];

// index 0-6; matches the Uint8Array codes written into session.family_labels
const FAMILY_NAMES    = ["KS1295", "6082", "2024", "bat-box", "3003", "4032", "Mixed"];
// Wong / Okabe-Ito colorblind-safe palette
const FAMILY_COLORS   = ["#E69F00", "#56B4E9", "#009E73", "#0072B2", "#D55E00", "#CC79A7", "#888888"];
// redundant texture channel, so families stay distinct in grayscale
const FAMILY_TEXTURES = ["solid", "horizontal", "dots", "diagonal", "crosshatch", "vertical", "wave"];
//redundant markers for families, so they stay distinct in b/w print
const FAMILY_MARKERS  = ["circle", "square", "triangle", "diamond", "cross", "plus", "star"];

// darken a #rrggbb hex color by a fraction (0-1) — e.g. T4's point borders
// read as "this family, but a shade darker" instead of a flat black outline
function darkenHex(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * (1 - amount));
    const g = Math.round(((n >> 8) & 255) * (1 - amount));
    const b = Math.round((n & 255) * (1 - amount));
    return "#" + [r, g, b].map(function (c) { return c.toString(16).padStart(2, "0"); }).join("");
}
const FAMILY_COLORS_DARK = FAMILY_COLORS.map(function (c) { return darkenHex(c, 0.35); });

// Shared shape-drawing for FAMILY_MARKERS, built once here so a family reads
// as the same shape everywhere (T2 fringe markers, T4 scatter points), not
// just the same hue. "cross"/"plus" are open paths (no enclosed area), so
// they only ever stroke — fillColor is ignored for those two shapes.
function drawFamilyMarker(ctx, shape, px, py, r, fillColor, strokeColor, lineWidth) {
    ctx.beginPath();
    let fillable = true;
    switch (shape) {
        case "square":
            ctx.rect(px - r, py - r, 2 * r, 2 * r);
            break;
        case "triangle":
            ctx.moveTo(px, py - r);
            ctx.lineTo(px + r * 0.87, py + r * 0.5);
            ctx.lineTo(px - r * 0.87, py + r * 0.5);
            ctx.closePath();
            break;
        case "diamond":
            ctx.moveTo(px, py - r); ctx.lineTo(px + r, py);
            ctx.lineTo(px, py + r); ctx.lineTo(px - r, py);
            ctx.closePath();
            break;
        case "cross":
            fillable = false;
            ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
            ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
            break;
        case "plus":
            fillable = false;
            ctx.moveTo(px - r, py); ctx.lineTo(px + r, py);
            ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
            break;
        case "star": {
            const spikes = 5, outerR = r, innerR = r * 0.45;
            for (let i = 0; i < spikes * 2; i++) {
                const rad = i % 2 === 0 ? outerR : innerR;
                const angle = (Math.PI / spikes) * i - Math.PI / 2;
                const x = px + Math.cos(angle) * rad, y = py + Math.sin(angle) * rad;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            break;
        }
        default: // "circle"
            ctx.arc(px, py, r, 0, 2 * Math.PI);
    }
    if (fillColor && fillable) { ctx.fillStyle = fillColor; ctx.fill(); }
    if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth || 1; ctx.stroke(); }
}

// so the html can display these symbols
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// format a numeric value for display in tooltip and messeges
function formatRangeValue(v) {
    if (v === 0) return "0";
    const abs = Math.abs(v);
    if (abs < 0.001 || abs >= 100000) return v.toExponential(2);
    return String(parseFloat(v.toPrecision(4)));
}

// scientific-notation-aware value formatter — used everywhere a data cell or
// threshold input needs a consistent, compact numeric display (T1, T6)
function fmtVal(v) {
    if (v == null || isNaN(v)) return "—"; // em dash
    return (Math.abs(v) < 0.001 || Math.abs(v) >= 1e6)
        ? v.toExponential(2)
        : String(+v.toPrecision(3));
}

// DERIVED STATE — feasibility + stock alerts, recomputed reactively by
// pipeline.set() (below) whenever their inputs change, so every view reads
// the same already-fresh values instead of each computing its own.

// does this row meet EVERY effective threshold of one project (not just
// whichever two axes a view happens to be plotting)?
function rowMeetsProject(project, rowId) {
    const thresholds = project.thresholds;
    for (const key in thresholds) {
        const t = thresholds[key];
        if (!t || t.effective == null) continue;
        const a = ATTR_BY_KEY[key];
        const v = session.columns[a.col][rowId];
        const pass = a.higherIsBetter ? v >= t.effective : v <= t.effective;
        if (!pass) return false;
    }
    return true;
}

// feasible = matches at least one active project (project A ∪ project B),
// or trivially true if no project exists yet
function rowIsFeasible(rowId) {
    if (session.projects.length === 0) return true;
    for (let p = 0; p < session.projects.length; p++) {
        if (rowMeetsProject(session.projects[p], rowId)) return true;
    }
    return false;
}

function recomputeFeasibleMask() {
    if (!session.rowCount) { session.feasible_mask = null; return; }
    const mask = new Uint8Array(session.rowCount);
    for (let i = 0; i < session.rowCount; i++) mask[i] = rowIsFeasible(i) ? 1 : 0;
    session.feasible_mask = mask;
}

// picks belonging to a given project slot (A = 0, B = 1). In single-project
// mode every pick belongs to A. Used by T5 (spider) and T6 (table).
function picksForProject(projIdx) {
    const wantB = projIdx === 1;
    return session.picks.filter(function (p) {
        const isB = p.project === "B";
        return wantB ? isB : !isB;
    });
}

// recipe fraction (0-1) of a scrap family within an alloy: input column is a
// percentage, so divide by 100
function recipeFraction(rowId, scrapCol) {
    const v = session.columns[scrapCol] ? session.columns[scrapCol][rowId] : 0;
    return (v || 0) / 100;
}

function recomputeStockAlerts() {
    const alerts = [];
    if (!session.loaded || session.picks.length === 0) { session.stock_alerts = alerts; return; }

    const aPicks = picksForProject(0);
    const bPicks = picksForProject(1);
    const dual = session.projects.length > 1;
    const batchA = session.projects[0] ? session.projects[0].batch_kg : 1000;
    const batchB = session.projects[1] ? session.projects[1].batch_kg : 1000;

    SCRAP_FAMILIES.forEach(function (fam) {
        const available = session.stock[fam.key];
        if (available == null) return;

        // single-project check: each pick on its own vs available stock
        session.picks.forEach(function (pick) {
            const isB = pick.project === "B";
            const batch = isB ? batchB : batchA;
            if (recipeFraction(pick.rowId, fam.col) * batch > available) {
                alerts.push({ type: "single", scrap: fam.key, rowId: pick.rowId, project: isB ? "B" : "A" });
            }
        });

        if (dual) {
            aPicks.forEach(function (a) {
                bPicks.forEach(function (b) {
                    const demand = recipeFraction(a.rowId, fam.col) * batchA
                                 + recipeFraction(b.rowId, fam.col) * batchB;
                    if (demand > available) {
                        alerts.push({ type: "combined", scrap: fam.key, rowIdA: a.rowId, rowIdB: b.rowId });
                    }
                });
            });
        }
    });
    session.stock_alerts = alerts;
}

// PIPELINE — the publish/subscribe hub

const pipeline = (function () {
    const listeners = {};

    function onChange(key, callback) {
        (listeners[key] = listeners[key] || []).push(callback);
    }

    function emit(key) {
        (listeners[key] || []).forEach(function (fn) { fn(session[key]); });
    }

    // assign + notify subscribers in one call. Derived state (feasible_mask,
    // stock_alerts) is recomputed BEFORE emitting the triggering key, so
    // every subscriber — including whatever fires off "projects"/"picks"
    // itself — reads already-fresh derived state instead of each view racing
    // to compute its own copy in listener-registration order (this is what
    // caused a transient stale Spider B render when Project B was removed:
    // T1 used to set "picks" before "projects", and T5 computed stock_alerts
    // itself inside its own "picks" handler, off the not-yet-updated projects).
    function set(key, value) {
        session[key] = value;
        // "loaded" also (re)builds the mask so it's never null once data
        // exists, even before any project is applied (all rows trivially
        // feasible with zero active projects — see rowIsFeasible)
        if (key === "projects" || (key === "loaded" && value)) recomputeFeasibleMask();
        if (key === "picks" || key === "projects") recomputeStockAlerts();

        emit(key);
        if (key === "projects" || (key === "loaded" && value)) emit("feasible_mask");
        if (key === "picks" || key === "projects") emit("stock_alerts");
        if (key === "brush_t2" || key === "brush_t3") recomputeActiveSet(); // computes + emits "active_set"
    }

    // reconstruct one row on demand from the column-store
    function getRow(rowIndex) {
        const row = {};
        for (const col in session.columns) {
            row[col] = session.columns[col][rowIndex];
        }
        return row;
    }

    // normalize a raw attribute value to [0,1] where 1 = "best". For
    // lower-is-better attributes the scale is inverted
    function normAttr(key, rawValue) {
        const a = ATTR_BY_KEY[key];
        if (!a) return null;
        const nt = session.norm_table[a.col];
        if (!nt) return null;
        const span = nt.max - nt.min;
        if (span === 0) return 0.5;
        let n = (rawValue - nt.min) / span;
        if (!a.higherIsBetter) n = 1 - n;
        return n;
    }

    // active_set = rows that pass the T2 brush AND every T3 range brush.
    // null means "no active filter".
    //
    // Perf: brush ranges are stored normalized ([0,1], normAttr's space), so
    // the naive version calls normAttr() — an ATTR_BY_KEY/norm_table lookup
    // plus a divide and a higherIsBetter branch — for every (row, brush)
    // pair, i.e. O(rows x brushes). Instead, invert normAttr ONCE per brush
    // to get that brush's bounds in raw data units, then every row is just
    // two plain number comparisons against an already-resolved column
    // reference — no per-row lookups or branching.
    function recomputeActiveSet() {
        const brushKeys = Object.keys(session.brush_t3);
        if (brushKeys.length === 0 && !session.brush_t2) {
            session.active_set = null;
            emit("active_set");
            return;
        }

        const brushBounds = brushKeys.map(function (key) {
            const a = ATTR_BY_KEY[key];
            const nt = session.norm_table[a.col];
            const range = session.brush_t3[key];
            const span = nt.max - nt.min;
            // inverse of normAttr: raw = min + n*span (higher-is-better),
            // or min + (1-n)*span (lower-is-better, since normAttr flips it)
            const toRaw = function (nv) { return a.higherIsBetter ? nt.min + nv * span : nt.min + (1 - nv) * span; };
            const r0 = toRaw(range[0]), r1 = toRaw(range[1]);
            return { col: session.columns[a.col], lo: Math.min(r0, r1), hi: Math.max(r0, r1) };
        });

        const n = session.rowCount;
        const result = new Set();
        for (let i = 0; i < n; i++) {
            if (session.brush_t2 && !session.brush_t2.rowIds.has(i)) continue;
            let ok = true;
            for (let b = 0; b < brushBounds.length; b++) {
                const bb = brushBounds[b];
                const v = bb.col[i];
                if (v < bb.lo || v > bb.hi) { ok = false; break; }
            }
            if (ok) result.add(i);
        }
        session.active_set = result;
        emit("active_set");
    }

    // push-or-update one axis's entry in session.axisQueue, keyed by axis
    // (one entry per axis regardless of who wrote it last). New axes are
    // appended, so T1's Apply-time entries naturally stay ahead of any axis
    // a later T3 brush introduces.
    function axisQueueUpsert(axis, source, brushRange) {
        const queue = session.axisQueue.slice();
        const idx = queue.findIndex(function (e) { return e.axis === axis; });
        const entry = { axis: axis, source: source, brushRange: brushRange };
        if (idx >= 0) queue[idx] = entry; else queue.push(entry);
        set("axisQueue", queue);
    }

    // T3 brush-clear (middle-click): if this axis still has an active T1
    // constraint, fall back to the T1 entry instead of dropping the axis
    // from the queue entirely; otherwise remove it.
    function axisQueueClear(axis) {
        const queue = session.axisQueue.slice();
        const idx = queue.findIndex(function (e) { return e.axis === axis; });
        if (idx < 0) return;
        const hasT1Constraint = session.projects.some(function (p) {
            const t = p.thresholds[axis];
            return t && t.effective != null;
        });
        if (hasT1Constraint) queue[idx] = { axis: axis, source: "T1", brushRange: null };
        else queue.splice(idx, 1);
        set("axisQueue", queue);
    }

    return {
        session: session,
        onChange: onChange,
        emit: emit,
        set: set,
        getRow: getRow,
        normAttr: normAttr,
        recomputeActiveSet: recomputeActiveSet,
        axisQueueUpsert: axisQueueUpsert,
        axisQueueClear: axisQueueClear,
        rowMeetsProject: rowMeetsProject,
        rowIsFeasible: rowIsFeasible
    };
})();

// Canvas helper — crisp rendering on high-DPI screens

function setupHiDPICanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px, at full density
    return { ctx: ctx, W: rect.width, H: rect.height };
}
