// t3_violin.js - T3 Violin Plot (Set Intersection view)

// Uses 1D KDE, normalised axis 
// from T1 lines with projrst constarin lines

// gestures:
// left-click           focus on/off (column grows, others shrink)
// left-click + drag    filter selection -> session.brush_t3, cross-view filter
// right-click + drag   local zoom (header renders italic) -> display-only, never touches session/pipeline
// right-click          cancel this column's zoom
// middle-click         cancel this column's filter selection


let t3SecondaryVisible = false;
let t3Layout = null;            // stashed each render so mouse handlers can hit-test
let t3Patterns = null;          // family texture CanvasPatterns, built once
let t3Drag = null;              // in-progress brush drag (left-click), or null
let t3ZoomDrag = null;          // in-progress local-zoom drag (right-click), or null
let t3ColumnZoom = {};          // attr.key -> [lo, hi] normalized sub-range currently filling the column; absent = full [0,1]
let t3ExpandedCol = null;       // attr.key of the focused (widened) column, or null

function initT3() {
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT3").hidden = true;
        document.getElementById("seeMoreBtn").hidden = false;
        renderT3();
    });
    pipeline.onChange("projects", renderT3);   // constraint lines depend on projects
    pipeline.onChange("brush_t3", renderT3);   // redraw when brushes change (does NOT auto-zoom — applying a
                                                // column's own selection doesn't zoom into it)
    // Only T2's own UMAP brush drives the auto-zoom — not T3's own column
    // brushes, and not any T2+T3 combination.
    pipeline.onChange("brush_t2", function () { t3SyncZoomToT2Brush(); renderT3(); });

    document.getElementById("seeMoreBtn").addEventListener("click", toggleSecondaryAttributes);

    const canvas = document.getElementById("canvasT3");
    canvas.addEventListener("mousedown", t3OnMouseDown);
    canvas.addEventListener("mousemove", t3OnMouseMove);
    canvas.addEventListener("contextmenu", function (evt) { evt.preventDefault(); }); // right-click drives zoom
    window.addEventListener("mouseup", t3OnMouseUp);
}

// toggle between showing just the primary attributes (7) vs all 14
function toggleSecondaryAttributes() {
    t3SecondaryVisible = !t3SecondaryVisible;
    document.getElementById("seeMoreBtn").textContent = t3SecondaryVisible ? "See less" : "See more";
    renderT3();
}

// which attributes are currently shown as columns
function t3VisibleAttrs() {
    return t3SecondaryVisible ? ATTRIBUTES : PRIMARY_ATTRS;
}

// convert a mouse event's into coordinates relative to the canvas for zoom/brush hit-testing
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
            // one full wavelength per 8px tile, so it repeats seamlessly
            case "wave":       o.moveTo(0, 4); o.quadraticCurveTo(2, 1, 4, 4); o.quadraticCurveTo(6, 7, 8, 4); o.stroke(); break;
            // "solid": nothing extra
        }
        patterns.push(ctx.createPattern(off, "repeat"));
    }
    return patterns;
}

// LOCAL ZOOM
function t3GetZoom(key) {
    return t3ColumnZoom[key] || [0, 1];
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// AUTO-ZOOM TO T2's SELECTION ONLY
// Only T2's own UMAP brush drives this — never T3's own column brushes, and
// never a T2+T3 combination. Applying a column's own selection (left-drag)
// does not zoom into it; only T2's rectangle brush does.

// [lo, hi] normalized range T2's brush spans on one attribute, or null if
// there's no active T2 brush (or it's empty/degenerate on this attribute).
function t3ComputeT2ZoomForColumn(attrKey) {
    const brush = session.brush_t2;
    if (!brush) return null;
    const col = session.columns[ATTR_BY_KEY[attrKey].col];
    let lo = Infinity, hi = -Infinity;
    brush.rowIds.forEach(function (id) {
        const v = col[id];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    });
    if (lo > hi) return null;
    const nLo = pipeline.normAttr(attrKey, lo), nHi = pipeline.normAttr(attrKey, hi);
    if (nLo == null || nHi == null) return null;
    const zLo = clamp01(Math.min(nLo, nHi)), zHi = clamp01(Math.max(nLo, nHi));
    if (zHi - zLo < 1e-6) return null; // degenerate span -> treat as "no zoom"
    return [zLo, zHi];
}

// whenever T2's brush changes, zoom every column to T2's zoomed area (or
// back to full [0,1] if T2 has no active brush)
function t3SyncZoomToT2Brush() {
    if (!session.brush_t2) { t3ColumnZoom = {}; return; }
    ATTRIBUTES.forEach(function (attr) {
        const z = t3ComputeT2ZoomForColumn(attr.key);
        if (z) t3ColumnZoom[attr.key] = z; else delete t3ColumnZoom[attr.key];
    });
}

// underlying normalized value -> display fraction (0..1) within the column
function t3ToDisplay(key, normVal) {
    const z = t3GetZoom(key);
    return (normVal - z[0]) / (z[1] - z[0]);
}

// display fraction (0..1) within the column -> underlying normalized value
function t3ToUnderlying(key, dispFrac) {
    const z = t3GetZoom(key);
    return z[0] + dispFrac * (z[1] - z[0]);
}

// resample a density curve so its domain [lo,hi] maps onto the full [0,1] display width
function t3ZoomedDensity(density, lo, hi) {
    if (lo === 0 && hi === 1) return density;
    const n = density.length;
    const out = new Array(n);
    for (let g = 0; g < n; g++) {
        const p = lo + (g / (n - 1)) * (hi - lo);
        const idxF = clamp01(p) * (n - 1);
        const i0 = Math.floor(idxF), i1 = Math.min(n - 1, i0 + 1);
        const frac = idxF - i0;
        out[g] = density[i0] + (density[i1] - density[i0]) * frac;
    }
    return out;
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
    const nFam = 7;

    // layout geometry
    const mL = 66, mR = 12, mT = 26, mB = 22;
    const plotW = W - mL - mR;
    const plotH = H - mT - mB;
    const GAP_FRACTION = 0.15, MIN_GAP = 4, MAX_GAP = 20;
    const colGap = Math.max(MIN_GAP, Math.min(MAX_GAP, (plotW / nCols) * GAP_FRACTION));
    const laneH = plotH / nFam;
    const halfThick = laneH * 0.42;


    // focus mode (other columns shrink, focus growes EXPAND_FACTOR times, others shatre the leftover place)
    const EXPAND_FACTOR = 3;
    const expandedIdx = t3ExpandedCol ? attrs.findIndex(function (a) { return a.key === t3ExpandedCol; }) : -1;
    const totalGap = (nCols - 1) * colGap;
    const unit = expandedIdx >= 0
        ? (plotW - totalGap) / (nCols - 1 + EXPAND_FACTOR)
        : (plotW - totalGap) / nCols;
    const colWidths = attrs.map(function (a, i) { return i === expandedIdx ? unit * EXPAND_FACTOR : unit; });
    const colXs = [];
    (function () {
        let x = mL;
        for (let i = 0; i < nCols; i++) { colXs.push(x); x += colWidths[i] + colGap; }
    })();

    const colX = function (i) { return colXs[i]; };
    const colWidth = function (i) { return colWidths[i]; };
    const laneCenter = function (f) { return mT + f * laneH + laneH / 2; };

    t3Layout = { attrs: attrs, mL: mL, mT: mT, plotH: plotH, colGap: colGap, colX: colX, colWidth: colWidth, nCols: nCols };

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

    drawColumnSeparators(ctx, colX, colWidth, colGap, nCols, mT, plotH);

    // one violin per (attr column, family row)
    attrs.forEach(function (attr, ci) {
        const x0 = colX(ci);
        const w = colWidth(ci);

        // focused column gets a faint highlight band
        if (ci === expandedIdx) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.035)";
            ctx.fillRect(x0, mT, w, plotH);
        }

        // column header (short key) — italic while zoomed (plain right-click
        // resets it), bold while focused (click again to un-focus).
        const zoom = t3GetZoom(attr.key);
        const isZoomed = zoom[0] !== 0 || zoom[1] !== 1;
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const fontParts = [];
        if (isZoomed) fontParts.push("italic");
        if (ci === expandedIdx) fontParts.push("bold");
        fontParts.push("10px Inter, sans-serif");
        ctx.font = fontParts.join(" ");
        ctx.fillText(attr.key, x0 + w / 2, mT - 12);

        // shared per-column density scale so families are comparable
        let maxDens = 0;
        for (let f = 0; f < nFam; f++) {
            const d = session.kde_cache[attr.key][f];
            for (let g = 0; g < d.length; g++) if (d[g] > maxDens) maxDens = d[g];
        }
        if (maxDens === 0) maxDens = 1;

        for (let f = 0; f < nFam; f++) {
            const raw = session.kde_cache[attr.key][f];
            const density = isZoomed ? t3ZoomedDensity(raw, zoom[0], zoom[1]) : raw;
            drawViolin(ctx, density, x0, w, laneCenter(f), halfThick, maxDens, f);
        }
    });

    drawBrushOverlays(ctx);
    drawConstraintLines(ctx);
    drawZoomDragPreview(ctx);
}

// vertical line between each collumn
function drawColumnSeparators(ctx, colX, colWidth, colGap, nCols, mT, plotH) {
    ctx.save();
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (let ci = 0; ci < nCols - 1; ci++) {
        const xSep = colX(ci) + colWidth(ci) + colGap / 2;
        ctx.beginPath();
        ctx.moveTo(xSep, mT);
        ctx.lineTo(xSep, mT + plotH);
        ctx.stroke();
    }
    ctx.restore();
}

// draw one violin shape for a given (column, family) pair, filling it with the family texture and outlining it in the family color
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

// translucent shading over each brushed column's [min,max] range (left drag)
function drawBrushOverlays(ctx) {
    const L = t3Layout;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.setLineDash([4, 3]);
    L.attrs.forEach(function (attr, ci) {
        const range = session.brush_t3[attr.key]; // stored in underlying [0,1] space, independent of column zoom
        if (!range) return;
        const x0 = L.colX(ci);
        const w = L.colWidth(ci);
        const da = clamp01(t3ToDisplay(attr.key, range[0]));
        const db = clamp01(t3ToDisplay(attr.key, range[1]));
        if (db <= da) return; // brush range falls entirely outside the current zoom window
        const xa = x0 + da * w;
        const xb = x0 + db * w;
        ctx.fillRect(xa, L.mT, xb - xa, L.plotH);
        ctx.strokeRect(xa, L.mT, xb - xa, L.plotH);
    });
    ctx.setLineDash([]);
    // live preview of the in-progress brush drag
    if (t3Drag) {
        const x0 = L.colX(t3Drag.col);
        const w = L.colWidth(t3Drag.col);
        const a = Math.min(t3Drag.startNorm, t3Drag.curNorm);
        const b = Math.max(t3Drag.startNorm, t3Drag.curNorm);
        ctx.fillRect(x0 + a * w, L.mT, (b - a) * w, L.plotH);
    }
    ctx.restore();
}

// dashed outline over the range being selected during a right-click
function drawZoomDragPreview(ctx) {
    if (!t3ZoomDrag) return;
    const L = t3Layout;
    const x0 = L.colX(t3ZoomDrag.col);
    const w = L.colWidth(t3ZoomDrag.col);
    const a = Math.min(t3ZoomDrag.startNorm, t3ZoomDrag.curNorm);
    const b = Math.max(t3ZoomDrag.startNorm, t3ZoomDrag.curNorm);
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x0 + a * w, L.mT, (b - a) * w, L.plotH);
    ctx.restore();
}

// solid-black vertical constraint line per active project, per column
function drawConstraintLines(ctx) {
    const L = t3Layout;
    if (session.projects.length === 0) return;

    L.attrs.forEach(function (attr, ci) {
        const x0 = L.colX(ci);
        const w = L.colWidth(ci);
        const positions = []; // { proj: 'A'|'B', effective, x }
        session.projects.forEach(function (project, pIdx) {
            const t = project.thresholds[attr.key];
            if (!t || t.effective == null) return;
            let nrm = pipeline.normAttr(attr.key, t.effective);
            if (nrm == null) return;
            nrm = clamp01(nrm);
            const disp = clamp01(t3ToDisplay(attr.key, nrm)); // remap through this column's zoom; pinned to the edge if zoomed past it
            positions.push({ proj: pIdx === 0 ? "A" : "B", effective: t.effective, x: x0 + disp * w });
        });
        if (positions.length === 0) return;

        if (positions.length === 2 && positions[0].effective === positions[1].effective) {
            drawConstraintLine(ctx, positions[0].x, "A+B", "top");
        } else {
            positions.forEach(function (p) {
                drawConstraintLine(ctx, p.x, p.proj, p.proj === "A" ? "top" : "bottom");
            });
        }
    });
}

// draw one vertical constraint line with a small label box at the top or bottom
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

// BRUSH / ZOOM GESTURES

// which column contains logical x, and the normalized position within it f 
function t3HitColumn(x) {
    const L = t3Layout;
    if (!L) return null;
    for (let ci = 0; ci < L.nCols; ci++) {
        const x0 = L.colX(ci);
        const w = L.colWidth(ci);
        if (x >= x0 && x <= x0 + w) {
            return { col: ci, norm: (x - x0) / w };
        }
    }
    return null;
}

// middle-click a column: deselect — clear its filter selection, drop its
// axisQueue brush entry, snap this column's own zoom back to T2's zoomed
// area (or full range if T2 has none active), and snap any linked T4 panel
// back to its default bbox for this axis
function t3DeselectColumn(key) {
    if (key in session.brush_t3) {
        const brushes = Object.assign({}, session.brush_t3);
        delete brushes[key];
        pipeline.set("brush_t3", brushes); // brush changed -> cross-view recompute + redraw
    }
    const t2Zoom = t3ComputeT2ZoomForColumn(key);
    if (t2Zoom) t3ColumnZoom[key] = t2Zoom; else delete t3ColumnZoom[key];
    pipeline.axisQueueClear(key);
    t4ResetPanelZoomForAxis(key);
    renderT3();
}

// left-click drags a filter selection; right-click drags a local zoom
// window; middle-click deselects. All start from the same column hit-test
function t3OnMouseDown(evt) {
    if (!t3Layout) return;
    const p = canvasCoords(evt.currentTarget, evt);
    const hit = t3HitColumn(p.x);
    if (!hit) return;
    if (evt.button === 1) {
        evt.preventDefault(); // stop the browser's middle-click autoscroll from kicking in
        t3DeselectColumn(t3Layout.attrs[hit.col].key);
    } else if (evt.button === 2) {
        evt.preventDefault();
        t3ZoomDrag = { col: hit.col, startNorm: hit.norm, curNorm: hit.norm };
    } else if (evt.button === 0) {
        t3Drag = { col: hit.col, startNorm: hit.norm, curNorm: hit.norm };
    }
}

function t3OnMouseMove(evt) {
    if (!t3Drag && !t3ZoomDrag) return;
    const p = canvasCoords(evt.currentTarget, evt);
    if (t3Drag) {
        t3Drag.curNorm = Math.max(0, Math.min(1, (p.x - t3Layout.colX(t3Drag.col)) / t3Layout.colWidth(t3Drag.col)));
    }
    if (t3ZoomDrag) {
        t3ZoomDrag.curNorm = Math.max(0, Math.min(1, (p.x - t3Layout.colX(t3ZoomDrag.col)) / t3Layout.colWidth(t3ZoomDrag.col)));
    }
    renderT3();
}

function t3OnMouseUp() {
    if (t3Drag) {
        const attr = t3Layout.attrs[t3Drag.col];
        const aDisp = Math.min(t3Drag.startNorm, t3Drag.curNorm);
        const bDisp = Math.max(t3Drag.startNorm, t3Drag.curNorm);
        const brushes = Object.assign({}, session.brush_t3);
        let brushesChanged;

        if (bDisp - aDisp < 0.01) {
            // a click (no real drag): TOGGLE focus on this column
            // clicking a focused column un-focuses it,
            // clicking a different one switches focus to it
            // brushesChanged = attr.key in brushes;
            // delete brushes[attr.key];
            t3ExpandedCol = (t3ExpandedCol === attr.key) ? null : attr.key;
        } else {
            // convert this column's current display fractions back to the underlying
            // [0,1] value space before storing, so the brush is meaningful regardless of zoom
            brushes[attr.key] = [t3ToUnderlying(attr.key, aDisp), t3ToUnderlying(attr.key, bDisp)];
            brushesChanged = true;
        }
        t3Drag = null;
        if (brushesChanged) {
            const range = brushes[attr.key];
            pipeline.set("brush_t3", brushes); // triggers active_set recompute + redraw
            pipeline.axisQueueUpsert(attr.key, "T3", range);
            t4SyncPanelZoomFromBrush(attr.key, range);
        } else {
            renderT3();
        }
    }

    if (t3ZoomDrag) {
        // Local zoom - a display transform (no session change)
        const attr = t3Layout.attrs[t3ZoomDrag.col];
        const aDisp = Math.min(t3ZoomDrag.startNorm, t3ZoomDrag.curNorm);
        const bDisp = Math.max(t3ZoomDrag.startNorm, t3ZoomDrag.curNorm);
        if (bDisp - aDisp >= 0.01) {
            t3ColumnZoom[attr.key] = [t3ToUnderlying(attr.key, aDisp), t3ToUnderlying(attr.key, bDisp)];
        } else {
            // plain right-click cancels the manual zoom -> back to T2's
            // zoomed area for this column (or full range if T2 has none active)
            const t2Zoom = t3ComputeT2ZoomForColumn(attr.key);
            if (t2Zoom) t3ColumnZoom[attr.key] = t2Zoom; else delete t3ColumnZoom[attr.key];
        }
        t3ZoomDrag = null;
        renderT3();
    }
}

document.addEventListener("DOMContentLoaded", initT3);
