/*
* t2_umap.js — T2 UMAP Overview (two-tier bubble map + spatial-grid brush)
* Owner: P2 · Branch: p2-ui
* See docs/klaus_t2_aggregation_decision.md for why bubbles, not raw points.
*
* Renders session.quadtree (= data/spatial_grid.json, loaded verbatim by
* loading_tab.js — a uniform grid over the UMAP embedding, every cell
* carrying its member rowIds). No axes, no individual points, no zoom —
* deliberately out of scope per the design brief.
*/

const T2_FRINGE_RADIUS = 3.5;
const T2_MAJOR_MAX_RADIUS = 26;

let t2Brush = null;       // { x0,y0,x1,y1 } in canvas px, while dragging
let t2Dragging = false;
let t2Patterns = null;    // CanvasPattern[7], built once per canvas context
let t2Tooltip = null;     // the floating tooltip <div>

function initT2() {
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT2").hidden = true;
        renderT2();
    });
    pipeline.onChange("projects", renderT2);
    pipeline.onChange("picks", renderT2);

    t2Tooltip = document.createElement("div");
    t2Tooltip.className = "tooltip";
    t2Tooltip.hidden = true;
    document.body.appendChild(t2Tooltip);

    const canvas = document.getElementById("canvasT2");
    canvas.addEventListener("mousedown", t2OnMouseDown);
    canvas.addEventListener("mousemove", t2OnMouseMove);
    canvas.addEventListener("mouseleave", function () { t2Tooltip.hidden = true; });
    window.addEventListener("mouseup", t2OnMouseUp);
}

/* ==================================================================
 * Scale: UMAP data space <-> canvas pixels. Independent x/y stretch to
 * fill the whole canvas — bubble radii are set directly in pixels (see
 * renderT2), not derived from this scale, so stretching doesn't distort
 * their shape, only how spread out the layout looks.
 * ================================================================== */
function t2BuildScale(meta, W, H) {
    const margin = 16;
    const [x0, x1, y0, y1] = meta.extent;
    const dataW = x1 - x0, dataH = y1 - y0;
    const scaleX = (W - 2 * margin) / dataW;
    const scaleY = (H - 2 * margin) / dataH;

    const cellW = dataW / meta.grid_cols, cellH = dataH / meta.grid_rows;

    return {
        toPx: function (x, y) { return [margin + (x - x0) * scaleX, margin + (y - y0) * scaleY]; },
        pxToData: function (px, py) { return [x0 + (px - margin) / scaleX, y0 + (py - margin) / scaleY]; },
        x0: x0, y0: y0, cellW: cellW, cellH: cellH,
        gridCols: meta.grid_cols, gridRows: meta.grid_rows
    };
}

/* 8x8 offscreen canvas per family: solid hue + a texture overlay so
 * families stay distinct in greyscale too. Built once, cached on
 * t2Patterns (rebuilt if the canvas context ever changes). */
function t2BuildPatterns(ctx) {
    return FAMILY_TEXTURES.map(function (texture, famIdx) {
        const c = document.createElement("canvas");
        c.width = 8; c.height = 8;
        const pctx = c.getContext("2d");
        pctx.fillStyle = FAMILY_COLORS[famIdx];
        pctx.fillRect(0, 0, 8, 8);

        pctx.strokeStyle = "rgba(0,0,0,0.4)";
        pctx.fillStyle = "rgba(0,0,0,0.4)";
        pctx.lineWidth = 1.4;
        pctx.beginPath();
        switch (texture) {
            case "horizontal": pctx.moveTo(0, 4); pctx.lineTo(8, 4); break;
            case "vertical":   pctx.moveTo(4, 0); pctx.lineTo(4, 8); break;
            case "diagonal":   pctx.moveTo(0, 0); pctx.lineTo(8, 8); break;
            case "crosshatch": pctx.moveTo(0, 4); pctx.lineTo(8, 4); pctx.moveTo(4, 0); pctx.lineTo(4, 8); break;
            case "dots":       pctx.arc(4, 4, 1.4, 0, 2 * Math.PI); break;
            case "stipple":
                [[2, 2], [6, 3], [3, 6], [6, 7]].forEach(function (p) { pctx.moveTo(p[0] + 1, p[1]); pctx.arc(p[0], p[1], 1, 0, 2 * Math.PI); });
                break;
            case "wave":
                pctx.moveTo(0, 4); pctx.quadraticCurveTo(2, 1, 4, 4); pctx.quadraticCurveTo(6, 7, 8, 4);
                break;
            default: break; // "solid" — no overlay
        }
        pctx.stroke();
        pctx.fill();
        return ctx.createPattern(c, "repeat");
    });
}

/* ==================================================================
 * Feasibility — the ONLY thing opacity encodes. Checks every effective
 * threshold of a project (not just 2 axes), per FIX R2.
 * ================================================================== */
function t2RowIsFeasible(i) {
    if (session.projects.length === 0) return true;
    for (let p = 0; p < session.projects.length; p++) {
        const thresholds = session.projects[p].thresholds;
        let ok = true;
        for (const key in thresholds) {
            const t = thresholds[key];
            if (!t || t.effective == null) continue;
            const a = ATTR_BY_KEY[key];
            const v = session.columns[a.col][i];
            const pass = a.higherIsBetter ? v >= t.effective : v <= t.effective;
            if (!pass) { ok = false; break; }
        }
        if (ok) return true; // satisfies this project fully -> feasible
    }
    return false;
}

function t2CellIsFeasible(cell) {
    for (let k = 0; k < cell.rowIds.length; k++) {
        if (t2RowIsFeasible(cell.rowIds[k])) return true;
    }
    return false;
}

/* ==================================================================
 * Render
 * ================================================================== */
function renderT2() {
    if (!session.loaded || !session.quadtree) return;

    const canvas = document.getElementById("canvasT2");
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);

    if (!t2Patterns) t2Patterns = t2BuildPatterns(ctx);

    const quadtree = session.quadtree;
    const geom = t2BuildScale(quadtree.meta, W, H);
    canvas._t2geom = geom;
    if (!quadtree._byKey) quadtree._byKey = t2IndexByGridKey(quadtree.cells);

    const maxMajorCount = quadtree.cells.reduce(function (m, c) { return c.tier === "major" ? Math.max(m, c.count) : m; }, 1);
    const rUnit = T2_MAJOR_MAX_RADIUS / Math.sqrt(maxMajorCount);

    quadtree.cells.forEach(function (cell) {
        const [px, py] = geom.toPx(cell.cx, cell.cy);
        const feasible = t2CellIsFeasible(cell);
        // feasible cells sit at 75% opacity (not 100%) so overlapping bubbles
        // blend instead of one fully hiding another; infeasible stays faint
        ctx.globalAlpha = feasible ? 0.75 : 0.1;

        if (cell.tier === "major") {
            const r = rUnit * Math.sqrt(cell.count);
            ctx.beginPath();
            ctx.arc(px, py, r, 0, 2 * Math.PI);
            ctx.fillStyle = t2Patterns[cell.dominant];
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(px, py, T2_FRINGE_RADIUS, 0, 2 * Math.PI);
            ctx.strokeStyle = FAMILY_COLORS[cell.dominant];
            ctx.lineWidth = 1.3;
            ctx.stroke();
        }
    });
    ctx.globalAlpha = 1;

    t2DrawPickLabels(geom);

    if (t2Brush) {
        const x = Math.min(t2Brush.x0, t2Brush.x1), y = Math.min(t2Brush.y0, t2Brush.y1);
        const w = Math.abs(t2Brush.x1 - t2Brush.x0), h = Math.abs(t2Brush.y1 - t2Brush.y0);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }
}

function t2IndexByGridKey(cells) {
    const map = new Map();
    cells.forEach(function (c) { map.set(c.gx + "," + c.gy, c); });
    return map;
}

/* ==================================================================
 * Pick labels — A1-A4 amber / B1-B4 blue, at each family's centroid
 * (precomputed in spatial_grid.json meta), offset in a 3-column grid.
 * ================================================================== */
function t2DrawPickLabels(geom) {
    const canvas = document.getElementById("canvasT2");
    const ctx = canvas.getContext("2d");
    const centroids = session.quadtree.meta.family_centroids;
    const byFamily = {};

    session.picks.forEach(function (pick) {
        const fam = session.family_labels[pick.rowId];
        (byFamily[fam] = byFamily[fam] || []).push(pick);
    });

    Object.keys(byFamily).forEach(function (fam) {
        const centroid = centroids[fam];
        if (!centroid) return;
        const [cx, cy] = geom.toPx(centroid[0], centroid[1]);

        byFamily[fam].forEach(function (pick, idx) {
            const dx = (idx % 3 - 1) * 18;
            const dy = Math.floor(idx / 3) * 15;
            const label = (pick.project === "B" ? "B" : "A") + pick.number;
            const color = pick.project === "B" ? "#0072B2" : "#E69F00";

            ctx.font = "bold 11px Inter, sans-serif";
            const tw = ctx.measureText(label).width;
            const px = cx + dx, py = cy + dy;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(px - tw / 2 - 4, py - 9, tw + 8, 16, 8) : ctx.rect(px - tw / 2 - 4, py - 9, tw + 8, 16);
            ctx.fill();

            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.fillText(label, px, py + 3);
        });
    });
}

/* ==================================================================
 * Hover — O(1) cell lookup via the grid, tooltip with lazily-computed
 * median/IQR (only over the hovered cell's own rowIds, only on hover).
 * ================================================================== */
function t2CellAt(geom, px, py) {
    const [dx, dy] = geom.pxToData(px, py);
    const gx = Math.floor((dx - geom.x0) / geom.cellW);
    const gy = Math.floor((dy - geom.y0) / geom.cellH);
    if (gx < 0 || gy < 0 || gx >= geom.gridCols || gy >= geom.gridRows) return null;
    return session.quadtree._byKey.get(gx + "," + gy) || null;
}

function t2MedianIQR(values) {
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const q = function (p) { return sorted[Math.floor(p * (sorted.length - 1))]; };
    return { median: q(0.5), q1: q(0.25), q3: q(0.75) };
}

function t2ShowTooltip(cell, clientX, clientY) {
    const familyName = FAMILY_NAMES[cell.dominant];
    let rows = "";
    if (session.columns) {
        ["YS", "CSC", "TC", "ER"].forEach(function (key) {
            const a = ATTR_BY_KEY[key];
            const col = session.columns[a.col];
            const values = cell.rowIds.map(function (id) { return col[id]; });
            const stats = t2MedianIQR(values);
            rows += a.key + ": " + stats.median.toFixed(2) + " (IQR " + stats.q1.toFixed(2) + "–" + stats.q3.toFixed(2) + ")<br>";
        });
    }
    t2Tooltip.innerHTML = "<b>" + familyName + "</b> — " + cell.count + " alloys<br>" + rows;
    t2Tooltip.style.left = (clientX + window.scrollX + 12) + "px";
    t2Tooltip.style.top = (clientY + window.scrollY + 12) + "px";
    t2Tooltip.hidden = false;
}

/* ==================================================================
 * Mouse handling — drag = rectangle brush, plain move = hover tooltip.
 * ================================================================== */
function t2CanvasPos(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    return [evt.clientX - rect.left, evt.clientY - rect.top];
}

function t2OnMouseDown(evt) {
    const [x, y] = t2CanvasPos(evt);
    t2Brush = { x0: x, y0: y, x1: x, y1: y };
    t2Dragging = true;
    t2Tooltip.hidden = true;
}

function t2OnMouseMove(evt) {
    if (t2Dragging) {
        const [x, y] = t2CanvasPos(evt);
        t2Brush.x1 = x; t2Brush.y1 = y;
        renderT2();
        return;
    }

    const canvas = document.getElementById("canvasT2");
    const geom = canvas._t2geom;
    if (!geom || !session.quadtree) return;
    const [x, y] = t2CanvasPos(evt);
    const cell = t2CellAt(geom, x, y);
    if (cell) t2ShowTooltip(cell, evt.clientX, evt.clientY);
    else t2Tooltip.hidden = true;
}

function t2OnMouseUp() {
    if (!t2Dragging) return;
    t2Dragging = false;
    if (!t2Brush) return;

    const canvas = document.getElementById("canvasT2");
    const geom = canvas._t2geom;
    const x0px = Math.min(t2Brush.x0, t2Brush.x1), x1px = Math.max(t2Brush.x0, t2Brush.x1);
    const y0px = Math.min(t2Brush.y0, t2Brush.y1), y1px = Math.max(t2Brush.y0, t2Brush.y1);

    if (!geom || (x1px - x0px < 4 && y1px - y0px < 4)) {
        t2Brush = null;
        pipeline.set("brush_t2", null);
        return;
    }

    const [dx0, dy0] = geom.pxToData(x0px, y0px);
    const [dx1, dy1] = geom.pxToData(x1px, y1px);
    const rowIds = new Set();

    session.quadtree.cells.forEach(function (cell) {
        // exact rectangular bounds of this grid cell, in data space
        const cx0 = geom.x0 + cell.gx * geom.cellW, cx1 = cx0 + geom.cellW;
        const cy0 = geom.y0 + cell.gy * geom.cellH, cy1 = cy0 + geom.cellH;
        if (cx1 < dx0 || cx0 > dx1 || cy1 < dy0 || cy0 > dy1) return; // no overlap

        const fullyInside = cx0 >= dx0 && cx1 <= dx1 && cy0 >= dy0 && cy1 <= dy1;
        if (fullyInside) {
            cell.rowIds.forEach(function (id) { rowIds.add(id); });
        } else if (session.umap) {
            // boundary cell: check each member's exact point (cheap — cells are small)
            cell.rowIds.forEach(function (id) {
                const px = session.umap[id * 2], py = session.umap[id * 2 + 1];
                if (px >= dx0 && px <= dx1 && py >= dy0 && py <= dy1) rowIds.add(id);
            });
        } else {
            cell.rowIds.forEach(function (id) { rowIds.add(id); }); // no umap yet — fall back to whole cell
        }
    });

    t2Brush = null;
    pipeline.set("brush_t2", { rowIds: rowIds });
}

document.addEventListener("DOMContentLoaded", initT2);
