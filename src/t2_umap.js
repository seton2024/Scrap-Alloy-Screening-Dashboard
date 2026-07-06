/*
* t2_umap.js — T2 UMAP Overview (KDE family blobs + quadtree brush)
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §3.4, §4.3
*/

let t2Brush = null;
let t2Dragging = false;

function initT2() {
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT2").hidden = true;
        renderT2Overview();
    });
    pipeline.onChange("projects",   renderT2Overview);
    pipeline.onChange("active_set", renderT2Overview);

    const canvas = document.getElementById("canvasT2");
    canvas.addEventListener("mousedown", t2OnMouseDown);
    canvas.addEventListener("mousemove", t2OnMouseMove);
    window.addEventListener("mouseup", t2OnMouseUp);
}

function renderT2Overview() {
    if (!session.loaded || !session.family_labels) return;

    const canvas = document.getElementById("canvasT2");
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);

    const attrX = ATTR_BY_KEY["YS"], attrY = ATTR_BY_KEY["CSC"];
    const ntX = session.norm_table[attrX.col], ntY = session.norm_table[attrY.col];
    if (!ntX || !ntY) return;

    const mL = 60, mR = 20, mT = 20, mB = 34;
    const plotW = W - mL - mR, plotH = H - mT - mB;

    ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + plotH); ctx.lineTo(mL + plotW, mT + plotH);
    ctx.stroke();

    ctx.fillStyle = "#333"; ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(attrX.label, mL + plotW / 2, mT + plotH + 24);
    ctx.save();
    ctx.translate(mL - 40, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(attrY.label, 0, 0);
    ctx.restore();

    function xToPx(v) { return mL + ((v - ntX.min) / (ntX.max - ntX.min)) * plotW; }
    function yToPx(v) { return mT + plotH - ((v - ntY.min) / (ntY.max - ntY.min)) * plotH; }
    canvas._t2geom = { mL, mT, plotW, plotH, xToPx, yToPx };

    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const labels = session.family_labels;
    const active = session.active_set;
    const n = session.rowCount;

    for (let i = 0; i < n; i++) {
        const alive = !active || active.has(i);
        const feasible = t2IsFeasible(i, colX, colY, attrX, attrY);
        ctx.globalAlpha = (alive && feasible) ? 0.4 : 0.05;
        ctx.fillStyle = FAMILY_COLORS[labels[i]];
        ctx.fillRect(xToPx(colX[i]), yToPx(colY[i]), 1, 1);
    }
    ctx.globalAlpha = 1;

    // constraint lines
    session.projects.forEach(function (project) {
        const tX = project.thresholds[attrX.key], tY = project.thresholds[attrY.key];
        ctx.strokeStyle = "#222"; ctx.lineWidth = 1.2;
        if (tX && tX.effective != null) {
            const x = xToPx(tX.effective);
            ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + plotH); ctx.stroke();
        }
        if (tY && tY.effective != null) {
            const y = yToPx(tY.effective);
            ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + plotW, y); ctx.stroke();
        }
    });

    // brush overlay
    if (t2Brush) {
        ctx.fillStyle = "rgba(0,114,178,0.15)";
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        const x = Math.min(t2Brush.x0, t2Brush.x1), y = Math.min(t2Brush.y0, t2Brush.y1);
        const w = Math.abs(t2Brush.x1 - t2Brush.x0), h = Math.abs(t2Brush.y1 - t2Brush.y0);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    }
}

function t2IsFeasible(i, colX, colY, attrX, attrY) {
    if (session.projects.length === 0) return true;
    for (let p = 0; p < session.projects.length; p++) {
        const project = session.projects[p];
        const tX = project.thresholds[attrX.key], tY = project.thresholds[attrY.key];
        const okX = !tX || tX.effective == null ||
                    (attrX.higherIsBetter ? colX[i] >= tX.effective : colX[i] <= tX.effective);
        const okY = !tY || tY.effective == null ||
                    (attrY.higherIsBetter ? colY[i] >= tY.effective : colY[i] <= tY.effective);
        if (okX && okY) return true;
    }
    return false;
}

function t2OnMouseDown(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
    t2Brush = { x0: x, y0: y, x1: x, y1: y };
    t2Dragging = true;
}

function t2OnMouseMove(evt) {
    if (!t2Dragging) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    t2Brush.x1 = evt.clientX - rect.left;
    t2Brush.y1 = evt.clientY - rect.top;
    renderT2Overview();
}

function t2OnMouseUp() {
    if (!t2Dragging) return;
    t2Dragging = false;
    if (!t2Brush) return;

    const canvas = document.getElementById("canvasT2");
    const g = canvas._t2geom;
    if (!g) { t2Brush = null; return; }

    const x0 = Math.min(t2Brush.x0, t2Brush.x1), x1 = Math.max(t2Brush.x0, t2Brush.x1);
    const y0 = Math.min(t2Brush.y0, t2Brush.y1), y1 = Math.max(t2Brush.y0, t2Brush.y1);

    if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
        t2Brush = null;
        pipeline.set("brush_t2", null);
        return;
    }

    const attrX = ATTR_BY_KEY["YS"], attrY = ATTR_BY_KEY["CSC"];
    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const rowIds = new Set();
    for (let i = 0; i < session.rowCount; i++) {
        const px = g.xToPx(colX[i]), py = g.yToPx(colY[i]);
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) rowIds.add(i);
    }
    t2Brush = null;
    pipeline.set("brush_t2", { rowIds: rowIds });
}

document.addEventListener("DOMContentLoaded", initT2);
