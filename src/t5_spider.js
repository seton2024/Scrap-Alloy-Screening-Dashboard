/*
* t5_spider.js — T5 Spider Chart (Comparison view) + stock alerts
* See docs/nested_model_L1_L2_L3_L4_report.md §3.7, §4.6
*
* One spider per active project (A left, B right). Each shows up to 4 alloys
* picked while that project was active, on 7 normalized axes (outward =
* better). Alloys are distinguished by stroke dash style. A second pass marks
* constraint-violation vertices in red. Stock demand is checked against the
* facility stock file; offenders get amber vertex rings and a message in the
* banner between the two spiders. Results are written to session.stock_alerts
* for T6 to consume.
*/

// fixed axis order (report §3.7): CSC first (non-negotiable), then the
// YS/TC/ER correlation triad, then the domain-priority remainder
const T5_AXIS_ORDER = ["CSC", "YS", "TC", "ER", "Hardness", "Density", "LinearTE"];

// per-alloy visual identity (up to 4). Dash patterns are the redundant,
// colorblind-safe channel; colors come from the Wong palette.
const ALLOY_COLORS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7"];
const ALLOY_DASHES = [[], [8, 4], [2, 4], [8, 4, 2, 4]];

function initT5() {
    pipeline.onChange("picks", renderT5Spiders);
    pipeline.onChange("projects", renderT5Spiders);
    pipeline.onChange("loaded", renderT5Spiders);
}

// normalized 0-1 with lower-is-better inversion baked in (outward = better)
function spiderNorm(attrKey, rawValue) {
    const n = pipeline.normAttr(attrKey, rawValue);
    if (n == null || isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

// picks belonging to a given project slot (A = 0, B = 1). In single-project
// mode every pick belongs to A.
function picksForProject(projIdx) {
    const wantB = projIdx === 1;
    return session.picks.filter(function (p) {
        const isB = p.project === "B";
        return wantB ? isB : !isB;
    });
}

function renderT5Spiders() {
    const dual = session.projects.length > 1;
    document.getElementById("canvasT5-B").hidden = !dual;
    document.getElementById("placeholderT5").hidden = session.picks.length > 0;

    // compute stock alerts first; drawing then reads the amber flags from it
    const alerts = computeStockAlerts();
    pipeline.set("stock_alerts", alerts);

    drawSpider("canvasT5-A", 0);
    if (dual) drawSpider("canvasT5-B", 1);

    renderStockAlertBanner();
}

function drawSpider(canvasId, projIdx) {
    const canvas = document.getElementById(canvasId);
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return; // not visible yet
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = 130, maxR = 100;
    const nAx = T5_AXIS_ORDER.length;
    const angle = function (i) { return -Math.PI / 2 + i * (2 * Math.PI / nAx); };

    // --- grid: concentric rings + spokes + axis labels ---
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (frac) {
        ctx.beginPath();
        for (let i = 0; i <= nAx; i++) {
            const r = frac * maxR, a = angle(i % nAx);
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });
    ctx.fillStyle = "#555";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    T5_AXIS_ORDER.forEach(function (key, i) {
        const a = angle(i);
        ctx.strokeStyle = "#ddd";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + maxR * Math.cos(a), cy + maxR * Math.sin(a)); ctx.stroke();
        ctx.fillStyle = "#555";
        ctx.fillText(key, cx + (maxR + 12) * Math.cos(a), cy + (maxR + 10) * Math.sin(a));
    });

    // spider title
    ctx.fillStyle = "#333";
    ctx.font = "600 11px Inter, sans-serif";
    ctx.textAlign = "left";
    const projName = session.projects[projIdx] ? session.projects[projIdx].name : "Project " + (projIdx === 0 ? "A" : "B");
    ctx.fillText(projName, 6, 12);

    const picks = picksForProject(projIdx).slice(0, 4);
    const project = session.projects[projIdx];

    // --- one polygon per alloy ---
    picks.forEach(function (pick, slot) {
        const color = ALLOY_COLORS[slot % 4];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(ALLOY_DASHES[slot % 4]);
        ctx.beginPath();
        T5_AXIS_ORDER.forEach(function (key, i) {
            const raw = session.columns[ATTR_BY_KEY[key].col][pick.rowId];
            const r = spiderNorm(key, raw) * maxR, a = angle(i);
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
    });

    // --- second pass: constraint-violation (red) + stock (amber) vertices ---
    picks.forEach(function (pick, slot) {
        const stockHit = pickHasStockAlert(pick);
        T5_AXIS_ORDER.forEach(function (key, i) {
            const raw = session.columns[ATTR_BY_KEY[key].col][pick.rowId];
            const r = spiderNorm(key, raw) * maxR, a = angle(i);
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);

            if (project && violatesConstraint(project, key, raw)) {
                ctx.beginPath();
                ctx.arc(x, y, 3.5, 0, 6.29);
                if (projIdx === 0) { ctx.fillStyle = "#C1121F"; ctx.fill(); }     // Spider A: filled red
                else { ctx.strokeStyle = "#C1121F"; ctx.lineWidth = 1.6; ctx.stroke(); } // Spider B: open red
            }
            if (stockHit) {
                ctx.beginPath();
                ctx.arc(x, y, 5.5, 0, 6.29);
                ctx.strokeStyle = "#E69F00"; // amber ring = stock problem
                ctx.lineWidth = 1.6;
                ctx.stroke();
            }
        });
    });

    drawSpiderLegend(ctx, picks, project, H);
}

// higher-is-better fails below the effective floor; lower-is-better fails above it
function violatesConstraint(project, attrKey, rawValue) {
    const t = project.thresholds[attrKey];
    if (!t || t.effective == null) return false;
    const attr = ATTR_BY_KEY[attrKey];
    return attr.higherIsBetter ? rawValue < t.effective : rawValue > t.effective;
}

function drawSpiderLegend(ctx, picks, project, H) {
    let y = H - 4 * 14 - 6;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    picks.forEach(function (pick, slot) {
        const color = ALLOY_COLORS[slot % 4];
        const rowName = session.columns["Mixture ID"] ? session.columns["Mixture ID"][pick.rowId] : "Row " + pick.rowId;

        // dashed swatch matching this alloy's stroke style
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.setLineDash(ALLOY_DASHES[slot % 4]);
        ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(30, y); ctx.stroke();
        ctx.setLineDash([]);

        // any constraint violation for this alloy => bold + red legend entry
        const violates = project && T5_AXIS_ORDER.some(function (key) {
            return violatesConstraint(project, key, session.columns[ATTR_BY_KEY[key].col][pick.rowId]);
        });
        const stockHit = pickHasStockAlert(pick);
        ctx.fillStyle = violates ? "#C1121F" : "#333";
        ctx.font = (violates ? "700 " : "") + "10px Inter, sans-serif";
        ctx.fillText((stockHit ? "⚠ " : "") + rowName, 36, y);
        y += 14;
    });
}

/* ---- stock alerts (report §4.6.2) ------------------------------------- */

// recipe fraction (0-1) of a scrap family within an alloy: input column is a
// percentage, so divide by 100
function recipeFraction(rowId, scrapCol) {
    const v = session.columns[scrapCol] ? session.columns[scrapCol][rowId] : 0;
    return (v || 0) / 100;
}

function computeStockAlerts() {
    const alerts = [];
    if (!session.loaded || session.picks.length === 0) return alerts;

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

        // combined check: the two projects together drain the same pile
        if (dual && aPicks.length && bPicks.length) {
            const demandA = aPicks.reduce(function (s, p) { return s + recipeFraction(p.rowId, fam.col) * batchA; }, 0);
            const demandB = bPicks.reduce(function (s, p) { return s + recipeFraction(p.rowId, fam.col) * batchB; }, 0);
            if (demandA + demandB > available) {
                alerts.push({ type: "combined", scrap: fam.key });
            }
        }
    });
    return alerts;
}

// does any stock alert implicate this specific pick? (used to draw amber rings)
function pickHasStockAlert(pick) {
    return session.stock_alerts.some(function (al) {
        if (al.type === "single") return al.rowId === pick.rowId;
        // combined: any scrap this alloy actually uses
        return SCRAP_FAMILIES.some(function (f) {
            return f.key === al.scrap && recipeFraction(pick.rowId, f.col) > 0;
        });
    });
}

function mixtureName(rowId) {
    return session.columns["Mixture ID"] ? session.columns["Mixture ID"][rowId] : "Row " + rowId;
}

function renderStockAlertBanner() {
    const banner = document.getElementById("alertBanner");
    if (!session.stock_alerts.length) { banner.textContent = ""; return; }

    // ⚠ = warning triangle, • = bullet — written as escapes so they
    // survive whatever encoding the browser picks for this .js file
    const lines = session.stock_alerts.map(function (al) {
        if (al.type === "single") {
            return "⚠ Caution: " + mixtureName(al.rowId) + " exceeds available stock for " + al.scrap;
        }
        return "⚠ Caution: Project A and Project B together go beyond stock for " + al.scrap;
    });
    // de-duplicate identical messages
    banner.textContent = Array.from(new Set(lines)).join("   •   ");
}

document.addEventListener("DOMContentLoaded", initT5);
