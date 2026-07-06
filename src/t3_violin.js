/*
* t3_violin.js — T3 Violin Plot (Set Intersection view)
* See docs/nested_model_L1_L2_L3_L4_report.md §3.5, §4.4
*
* A matrix of violins: 6 scrap families (rows) × N property columns. Each
* violin is a 1D KDE (precomputed at load into session.kde_cache) drawn on
* the shared normalized 0-1 axis, where rightward = better (the inversion
* for lower-is-better attrs is already baked into the cached curve).
*
* Layered on top: solid-black constraint lines per active project (label
* boxes A / B / A+B), and translucent brush overlays. Dragging a horizontal
* range inside a column brushes that property; a plain click clears it.
* Brushes are written to session.brush_t3 via pipeline.set, which recomputes
* the cross-view active_set.
*/

let t3SecondaryVisible = false;
let t3Layout = null;        // stashed each render so mouse handlers can hit-test
let t3Patterns = null;      // family texture CanvasPatterns, built once
let t3Drag = null;          // in-progress brush drag, or null

function initT3() {
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT3").hidden = true;
        document.getElementById("seeMoreBtn").hidden = false;
        renderT3();
    });
    pipeline.onChange("projects", renderT3);   // constraint lines depend on projects
    pipeline.onChange("brush_t3", renderT3);   // redraw when brushes change

    document.getElementById("seeMoreBtn").addEventListener("click", toggleSecondaryAttributes);

    const canvas = document.getElementById("canvasT3");
    canvas.addEventListener("mousedown", t3OnMouseDown);
    canvas.addEventListener("mousemove", t3OnMouseMove);
    window.addEventListener("mouseup", t3OnMouseUp);
}

function toggleSecondaryAttributes() {
    t3SecondaryVisible = !t3SecondaryVisible;
    document.getElementById("seeMoreBtn").textContent = t3SecondaryVisible ? "See less" : "See more";
    renderT3();
}

// which attributes are currently shown as columns
function t3VisibleAttrs() {
    return t3SecondaryVisible ? ATTRIBUTES : PRIMARY_ATTRS;
}

// mouse event -> CSS-pixel coordinates. The drawing context is scaled by the
// device pixel ratio (see setupHiDPICanvas), so our drawing space IS CSS
// pixels — hit-testing just needs the offset from the canvas's top-left, no
// extra scaling.
function canvasCoords(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

// build one 8x8 texture tile per family and wrap it as a repeating pattern
function buildFamilyPatterns(ctx) {
    const patterns = [];
    for (let idx = 0; idx < 7; idx++) {
        const s = 8;
        const off = document.createElement("canvas");
        off.width = s; off.height = s;
        const o = off.getContext("2d");
        o.fillStyle = FAMILY_COLORS[idx];
        o.fillRect(0, 0, s, s);
        o.strokeStyle = "rgba(255,255,255,0.65)";
        o.fillStyle = "rgba(255,255,255,0.7)";
        o.lineWidth = 1;
        o.beginPath();
        switch (FAMILY_TEXTURES[idx]) {
            case "horizontal": o.moveTo(0, 2.5); o.lineTo(s, 2.5); o.moveTo(0, 6.5); o.lineTo(s, 6.5); o.stroke(); break;
            case "vertical":   o.moveTo(2.5, 0); o.lineTo(2.5, s); o.moveTo(6.5, 0); o.lineTo(6.5, s); o.stroke(); break;
            case "diagonal":   o.moveTo(0, 8); o.lineTo(8, 0); o.moveTo(-2, 2); o.lineTo(2, -2); o.moveTo(6, 10); o.lineTo(10, 6); o.stroke(); break;
            case "crosshatch": o.moveTo(0, 8); o.lineTo(8, 0); o.moveTo(0, 0); o.lineTo(8, 8); o.stroke(); break;
            case "dots":       o.arc(4, 4, 1.4, 0, 6.29); o.fill(); break;
            case "stipple":    o.arc(2, 2, 0.9, 0, 6.29); o.arc(6, 6, 0.9, 0, 6.29); o.arc(6, 2, 0.9, 0, 6.29); o.arc(2, 6, 0.9, 0, 6.29); o.fill(); break;
            // "solid": nothing extra
        }
        patterns.push(ctx.createPattern(off, "repeat"));
    }
    return patterns;
}

function renderT3() {
    if (!session.loaded || !session.kde_cache || Object.keys(session.kde_cache).length === 0) return;

    const canvas = document.getElementById("canvasT3");
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return; // canvas not visible yet (e.g. Dashboard tab hidden)
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    if (!t3Patterns) t3Patterns = buildFamilyPatterns(ctx);

    ctx.clearRect(0, 0, W, H);

    const attrs = t3VisibleAttrs();
    const nCols = attrs.length;
    const nFam = 6; // Mixed excluded from violins (report §3.5)

    // layout geometry
    const mL = 66, mR = 12, mT = 26, mB = 22;
    const plotW = W - mL - mR;
    const plotH = H - mT - mB;
    const colGap = 8;
    const colInnerW = (plotW - (nCols - 1) * colGap) / nCols;
    const laneH = plotH / nFam;
    const halfThick = laneH * 0.42;

    const colX = function (i) { return mL + i * (colInnerW + colGap); };
    const laneCenter = function (f) { return mT + f * laneH + laneH / 2; };

    t3Layout = { attrs: attrs, mL: mL, mT: mT, plotH: plotH, colInnerW: colInnerW, colGap: colGap, colX: colX, nCols: nCols };

    // family row labels (left) + faint lane separators
    ctx.font = "11px Inter, sans-serif";
    ctx.textBaseline = "middle";
    for (let f = 0; f < nFam; f++) {
        ctx.fillStyle = FAMILY_COLORS[f];
        ctx.textAlign = "right";
        ctx.fillText(FAMILY_NAMES[f], mL - 8, laneCenter(f));
        ctx.strokeStyle = "#eee";
        ctx.beginPath(); ctx.moveTo(mL, mT + f * laneH); ctx.lineTo(mL + plotW, mT + f * laneH); ctx.stroke();
    }

    // one violin per (attr column, family row)
    attrs.forEach(function (attr, ci) {
        const x0 = colX(ci);

        // column header (short key)
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = "10px Inter, sans-serif";
        ctx.fillText(attr.key, x0 + colInnerW / 2, mT - 12);

        // shared per-column density scale so families are comparable
        let maxDens = 0;
        for (let f = 0; f < nFam; f++) {
            const d = session.kde_cache[attr.key][f];
            for (let g = 0; g < d.length; g++) if (d[g] > maxDens) maxDens = d[g];
        }
        if (maxDens === 0) maxDens = 1;

        for (let f = 0; f < nFam; f++) {
            drawViolin(ctx, session.kde_cache[attr.key][f], x0, colInnerW, laneCenter(f), halfThick, maxDens, f);
        }
    });

    drawBrushOverlays(ctx);
    drawConstraintLines(ctx);
}

function drawViolin(ctx, density, x0, innerW, cy, halfThick, maxDens, familyIdx) {
    const n = density.length;
    ctx.beginPath();
    // top edge, left -> right
    for (let g = 0; g < n; g++) {
        const x = x0 + (g / (n - 1)) * innerW;
        const th = (density[g] / maxDens) * halfThick;
        if (g === 0) ctx.moveTo(x, cy - th); else ctx.lineTo(x, cy - th);
    }
    // bottom edge, right -> left (mirror)
    for (let g = n - 1; g >= 0; g--) {
        const x = x0 + (g / (n - 1)) * innerW;
        const th = (density[g] / maxDens) * halfThick;
        ctx.lineTo(x, cy + th);
    }
    ctx.closePath();
    ctx.fillStyle = t3Patterns[familyIdx];
    ctx.fill();
    ctx.strokeStyle = FAMILY_COLORS[familyIdx];
    ctx.lineWidth = 1;
    ctx.stroke();
}

// translucent shading over each brushed column's [min,max] range
function drawBrushOverlays(ctx) {
    const L = t3Layout;
    ctx.save();
    ctx.fillStyle = "rgba(0, 114, 178, 0.16)";
    ctx.strokeStyle = "rgba(0, 114, 178, 0.6)";
    L.attrs.forEach(function (attr, ci) {
        const range = session.brush_t3[attr.key];
        if (!range) return;
        const x0 = L.colX(ci);
        const xa = x0 + range[0] * L.colInnerW;
        const xb = x0 + range[1] * L.colInnerW;
        ctx.fillRect(xa, L.mT, xb - xa, L.plotH);
        ctx.strokeRect(xa, L.mT, xb - xa, L.plotH);
    });
    // live preview of the in-progress drag
    if (t3Drag) {
        const x0 = L.colX(t3Drag.col);
        const a = Math.min(t3Drag.startNorm, t3Drag.curNorm);
        const b = Math.max(t3Drag.startNorm, t3Drag.curNorm);
        ctx.fillRect(x0 + a * L.colInnerW, L.mT, (b - a) * L.colInnerW, L.plotH);
    }
    ctx.restore();
}

// solid-black vertical constraint line per active project, per column, at the
// effective threshold's normalized x-position, with an A / B / A+B label box
function drawConstraintLines(ctx) {
    const L = t3Layout;
    if (session.projects.length === 0) return;

    L.attrs.forEach(function (attr, ci) {
        const x0 = L.colX(ci);
        const positions = []; // { proj: 'A'|'B', x }
        session.projects.forEach(function (project, pIdx) {
            const t = project.thresholds[attr.key];
            if (!t || t.effective == null) return;
            let nrm = pipeline.normAttr(attr.key, t.effective);
            if (nrm == null) return;
            nrm = Math.max(0, Math.min(1, nrm)); // clamp into the column
            positions.push({ proj: pIdx === 0 ? "A" : "B", x: x0 + nrm * L.colInnerW });
        });
        if (positions.length === 0) return;

        // A+B merge when the two lines land within 4px of each other
        if (positions.length === 2 && Math.abs(positions[0].x - positions[1].x) < 4) {
            drawConstraintLine(ctx, positions[0].x, "A+B", "top");
        } else {
            positions.forEach(function (p) {
                drawConstraintLine(ctx, p.x, p.proj, p.proj === "A" ? "top" : "bottom");
            });
        }
    });
}

function drawConstraintLine(ctx, x, label, labelPos) {
    const L = t3Layout;
    ctx.save();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, L.mT);
    ctx.lineTo(x, L.mT + L.plotH);
    ctx.stroke();

    // label box, staggered top (A / A+B) vs bottom (B) so close lines stay readable
    const boxW = label.length > 1 ? 22 : 14, boxH = 13;
    const by = labelPos === "top" ? L.mT + 1 : L.mT + L.plotH - boxH - 1;
    ctx.fillStyle = "#222";
    ctx.fillRect(x - boxW / 2, by, boxW, boxH);
    ctx.fillStyle = "#fff";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, by + boxH / 2 + 0.5);
    ctx.restore();
}

/* ---- brush interaction ------------------------------------------------ */

// which column contains logical x, and the normalized position within it
function t3HitColumn(x) {
    const L = t3Layout;
    if (!L) return null;
    for (let ci = 0; ci < L.nCols; ci++) {
        const x0 = L.colX(ci);
        if (x >= x0 && x <= x0 + L.colInnerW) {
            return { col: ci, norm: (x - x0) / L.colInnerW };
        }
    }
    return null;
}

function t3OnMouseDown(evt) {
    if (!t3Layout) return;
    const p = canvasCoords(evt.currentTarget, evt);
    const hit = t3HitColumn(p.x);
    if (!hit) return;
    t3Drag = { col: hit.col, startNorm: hit.norm, curNorm: hit.norm };
}

function t3OnMouseMove(evt) {
    if (!t3Drag) return;
    const p = canvasCoords(evt.currentTarget, evt);
    t3Drag.curNorm = Math.max(0, Math.min(1, (p.x - t3Layout.colX(t3Drag.col)) / t3Layout.colInnerW));
    renderT3();
}

function t3OnMouseUp() {
    if (!t3Drag) return;
    const attr = t3Layout.attrs[t3Drag.col];
    const a = Math.min(t3Drag.startNorm, t3Drag.curNorm);
    const b = Math.max(t3Drag.startNorm, t3Drag.curNorm);
    const brushes = Object.assign({}, session.brush_t3);

    if (b - a < 0.01) {
        delete brushes[attr.key];   // a click (no real drag) clears this column's brush
    } else {
        brushes[attr.key] = [a, b];
    }
    t3Drag = null;
    pipeline.set("brush_t3", brushes); // triggers active_set recompute + redraw
}

document.addEventListener("DOMContentLoaded", initT3);
