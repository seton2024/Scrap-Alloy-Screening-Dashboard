// t5_spider.js - T5 Spider Chart (Comparison view) + stock alerts 
// One spider per active project: up to 4 alloys picked, distinguished by stroke dash style. 



const T5_AXIS_ORDER = ["CSC", "YS", "TC", "ER", "Hardness", "Density", "LinearTE"];


const ALLOY_INK = "#222";
const ALLOY_DASHES = [[], [8, 4], [2, 4], [8, 4, 2, 4]];

// per-canvas axis-label hit boxes, stashed each render so the hover handler
// can hit-test without redoing the trig; keyed by canvas id
let t5Layout = {};

function initT5() {
    pipeline.onChange("picks", renderT5Spiders);
    pipeline.onChange("projects", renderT5Spiders);
    pipeline.onChange("loaded", renderT5Spiders);

    // TA: hover a spider axis label -> highlight the matching T6 row
    [["canvasT5-A", "A"], ["canvasT5-B", "B"]].forEach(function (pair) {
        const canvas = document.getElementById(pair[0]);
        canvas.addEventListener("mousemove", function (evt) { t5OnHoverMove(evt, pair[0], pair[1]); });
        canvas.addEventListener("mouseleave", function () { t5SetHoveredAxis(null); });
    });
}

function t5HitAxisLabel(canvasId, x, y) {
    const L = t5Layout[canvasId];
    if (!L) return null;
    for (let i = 0; i < L.labels.length; i++) {
        const b = L.labels[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
}

function t5OnHoverMove(evt, canvasId, project) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const key = t5HitAxisLabel(canvasId, evt.clientX - rect.left, evt.clientY - rect.top);
    t5SetHoveredAxis(key ? { key: key, project: project } : null);
}

// touch the pipeline when the hovered axis actually changes 
function t5SetHoveredAxis(next) {
    const cur = session.hovered_axis;
    const unchanged = (!cur && !next) || (cur && next && cur.key === next.key && cur.project === next.project);
    if (unchanged) return;
    pipeline.set("hovered_axis", next);
}

// normalized 0-1 with lower-is-better inversion baked in (outward = better)
function spiderNorm(attrKey, rawValue) {
    const n = pipeline.normAttr(attrKey, rawValue);
    if (n == null || isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function renderT5Spiders() {
    const dual = session.projects.length > 1;
    document.getElementById("canvasT5-B").hidden = !dual;
    document.getElementById("placeholderT5").hidden = session.picks.length > 0;

    // session.stock_alerts is already fresh here
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

    //adaptive sizing
    const titleH = 16;
    const legendRowH = 14, legendRows = 4;
    const legendH = legendRows * legendRowH + 8;
    const labelPad = 20; // clearance for axis label text sticking out past the radius

    const cx = W / 2;
    const availH = H - titleH - legendH;
    const cy = titleH + availH / 2;
    const maxR = Math.max(20, Math.min(availH / 2, cx) - labelPad);
    const legendTop = H - legendH + 6;

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
    const labelBoxes = []; // hit-test regions for hover, see t5HitAxisLabel
    T5_AXIS_ORDER.forEach(function (key, i) {
        const a = angle(i);
        ctx.strokeStyle = "#ddd";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + maxR * Math.cos(a), cy + maxR * Math.sin(a)); ctx.stroke();
        ctx.fillStyle = "#555";
        const lx = cx + (maxR + 12) * Math.cos(a), ly = cy + (maxR + 10) * Math.sin(a);
        ctx.fillText(key, lx, ly);
        const tw = ctx.measureText(key).width;
        labelBoxes.push({ key: key, x: lx - tw / 2 - 3, y: ly - 7, w: tw + 6, h: 14 });
    });
    t5Layout[canvasId] = { labels: labelBoxes };

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
        ctx.strokeStyle = ALLOY_INK;
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
        ctx.fillStyle = ALLOY_INK;
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

    drawSpiderLegend(ctx, picks, project, legendTop, legendRowH);
}

// higher-is-better fails below the effective floor; lower-is-better fails above it
function violatesConstraint(project, attrKey, rawValue) {
    const t = project.thresholds[attrKey];
    if (!t || t.effective == null) return false;
    const attr = ATTR_BY_KEY[attrKey];
    return attr.higherIsBetter ? rawValue < t.effective : rawValue > t.effective;
}

function drawSpiderLegend(ctx, picks, project, legendTop, rowH) {
    let y = legendTop;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    picks.forEach(function (pick, slot) {
        const rowName = session.columns["Mixture ID"] ? session.columns["Mixture ID"][pick.rowId] : "Row " + pick.rowId;

        // dashed swatch matching this alloy's stroke style
        ctx.strokeStyle = ALLOY_INK; ctx.lineWidth = 2;
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
        y += rowH;
    });
}

//STOCK ALLERTS (computation in pipline)

// does any stock alert implicate this specific pick? (used to draw amber rings)
function pickHasStockAlert(pick) {
    return session.stock_alerts.some(function (al) {
        if (al.type === "single") return al.rowId === pick.rowId;
        // combined: only the two specific alloys in the offending pair — not
        // every alloy that happens to touch that scrap (that was the R3 bug)
        return al.rowIdA === pick.rowId || al.rowIdB === pick.rowId;
    });
}

function mixtureName(rowId) {
    return session.columns["Mixture ID"] ? session.columns["Mixture ID"][rowId] : "Row " + rowId;
}

// 2 allert types: 
//          single: ⚠;
//          combined: names BOTH implicated alloys and ↳;
function renderStockAlertBanner() {
    const banner = document.getElementById("alertBanner");
    if (!session.stock_alerts.length) { banner.innerHTML = ""; return; }

    // de-duplicate by content, not by object identity (single: rowId+scrap;
    // combined: the specific A+B pair+scrap)
    const seen = new Set();
    const unique = session.stock_alerts.filter(function (al) {
        const key = al.type === "single"
            ? "s|" + al.rowId + "|" + al.scrap
            : "c|" + al.rowIdA + "|" + al.rowIdB + "|" + al.scrap;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    banner.innerHTML = unique.map(function (al) {
        if (al.type === "single") {
            return "<div class='alert-line alert-single'>&#9888; " + escapeHtml(mixtureName(al.rowId)) +
                   " exceeds available stock for " + escapeHtml(al.scrap) + "</div>";
        }
        return "<div class='alert-line alert-combined'>&#8627; " + escapeHtml(mixtureName(al.rowIdA)) + " (A) + " +
               escapeHtml(mixtureName(al.rowIdB)) + " (B) together exceed stock for " + escapeHtml(al.scrap) + "</div>";
    }).join("");
}

document.addEventListener("DOMContentLoaded", initT5);
