/*
* pipeline.js — shared cross-view session state + shared config
* Implements the state shape agreed in docs/pipeline_contract.md.
*
* T1 (t1_modal.js) is the sole writer of session.projects.
* The loading tab (loading_tab.js) is the sole writer of the dataset fields
* (columns, family_labels, norm_table, kde_cache, stock) and of session.loaded.
* Every other view is a read-only consumer: subscribe with
* pipeline.onChange(key, callback) and re-render when notified.
*/

const session = {
    loaded: false,

    // dataset (written once by the loading pipeline)
    columns: {},            // { colName: Array } column-store, full dataset
    umap: null,              // Float32Array, 324632 rows * 2 (x,y) — not yet used
    family_labels: null,      // Uint8Array, 324632 family indices (0-6)
    blob_contours: [],       // array of 6 polygon arrays [[x, y], ...] — not yet used
    norm_table: {},          // { colName: { min, max } }
    kde_cache: {},           // { attrKey: { familyIdx: Float32Array(200) } }
    quadtree: null,
    stock: {},               // { scrap_family_name: qty_kg }
    rowCount: 0,

    // T1 (session.projects is the only field T1 is allowed to write)
    projects: [],            // 1 or 2 entries, see docs/pipeline_contract.md

    // cross-view selection state
    brush_t2: null,           // { rowIds: Set } | null
    brush_t3: {},             // { attrKey: [normMin, normMax] }
    active_set: null,         // Set of row ids (brush_t2 ∩ brush_t3), or null = "all"
    picks: [],                // up to 4 entries: { rowId, number: 1-4, project: 'A'|'B' }
    stock_alerts: []          // { type: 'single'|'combined', ... }
};

/* ==================================================================
 * SHARED CONFIG — single source of truth for every view
 * ================================================================== */

// The 14 interactive attributes. `col` is the EXACT column name in
// Dataset_VisContest_Rapid_Alloy_development_v3.txt. Three of them contain a
// degree sign; we write it as the ASCII escape ° (not a literal °) so
// the match works no matter what text encoding the browser guesses for this
// .js file — a literal ° saved as UTF-8 becomes "A°" if the file is read as
// Latin-1, which silently breaks column matching. Same reasoning for the ·,
// ², ³ in the display labels. `tier` splits the primary 7 (always shown)
// from the secondary 7 (behind "See more"). Directions/margins are
// domain-grounded (report §2.4, §2.6, §4.1.1).
// "°C" built from a char code so the source stays pure ASCII. This makes the
// three degree-sign column names match the dataset regardless of how the
// browser decodes this .js file — the one thing that MUST work for the data
// to bind. (Cosmetic labels below still use literal ·/²/³ and rely on the
// page being served/opened as UTF-8, which is the normal case.)
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

// The 6 scrap families (index 0-5). Mixed (index 6) is a derived tie-break
// category and has no input column of its own.
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
// Wong / Okabe-Ito colorblind-safe palette (report §3.2.1)
const FAMILY_COLORS   = ["#E69F00", "#56B4E9", "#009E73", "#0072B2", "#D55E00", "#CC79A7", "#888888"];
// redundant texture channel, so families stay distinct in grayscale (§3.2.1)
const FAMILY_TEXTURES = ["solid", "horizontal", "dots", "diagonal", "crosshatch", "vertical", "stipple"];

/* ==================================================================
 * PIPELINE — the publish/subscribe hub
 * ================================================================== */

const pipeline = (function () {
    const listeners = {};

    function onChange(key, callback) {
        (listeners[key] = listeners[key] || []).push(callback);
    }

    function emit(key) {
        (listeners[key] || []).forEach(function (fn) { fn(session[key]); });
    }

    // assign + notify subscribers in one call. Brush changes additionally
    // trigger an active_set recompute (T2 ∩ T3), per docs/pipeline_contract.md.
    function set(key, value) {
        session[key] = value;
        emit(key);
        if (key === "brush_t2" || key === "brush_t3") recomputeActiveSet();
    }

    // reconstruct one row on demand from the column-store (§4.0.1)
    function getRow(rowIndex) {
        const row = {};
        for (const col in session.columns) {
            row[col] = session.columns[col][rowIndex];
        }
        return row;
    }

    // normalize a raw attribute value to [0,1] where 1 = "best". For
    // lower-is-better attributes the scale is inverted, so on every view
    // "further right / further out = better" holds consistently.
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
    // null means "no active filter" (i.e. all rows are in play).
    function recomputeActiveSet() {
        const brushKeys = Object.keys(session.brush_t3);
        if (brushKeys.length === 0 && !session.brush_t2) {
            session.active_set = null;
            emit("active_set");
            return;
        }
        const n = session.rowCount;
        const result = new Set();
        for (let i = 0; i < n; i++) {
            if (session.brush_t2 && !session.brush_t2.rowIds.has(i)) continue;
            let ok = true;
            for (let b = 0; b < brushKeys.length; b++) {
                const key = brushKeys[b];
                const a = ATTR_BY_KEY[key];
                const nv = normAttr(key, session.columns[a.col][i]);
                const range = session.brush_t3[key];
                if (nv < range[0] || nv > range[1]) { ok = false; break; }
            }
            if (ok) result.add(i);
        }
        session.active_set = result;
        emit("active_set");
    }

    return {
        session: session,
        onChange: onChange,
        emit: emit,
        set: set,
        getRow: getRow,
        normAttr: normAttr,
        recomputeActiveSet: recomputeActiveSet
    };
})();

/* ==================================================================
 * Canvas helper — crisp rendering on high-DPI screens
 * ==================================================================
 * A <canvas> has two sizes: its backing store (the real pixel grid, set by
 * the width/height attributes) and its displayed size (set by CSS). If they
 * differ — because CSS stretches it, or because a Retina screen packs 2+
 * physical pixels per CSS pixel — the browser upscales the bitmap and it
 * looks blurry. This sizes the backing store to (displayed size ×
 * devicePixelRatio) and scales the drawing context to match, so 1 drawing
 * unit = 1 CSS pixel but everything is rendered at full physical resolution.
 *
 * Returns { ctx, W, H } with W/H in CSS pixels — do ALL drawing and mouse
 * hit-testing in those units. Returns null if the canvas isn't visible yet
 * (zero-sized), so callers should skip drawing and re-render once it shows.
 */
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
