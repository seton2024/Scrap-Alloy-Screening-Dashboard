// t2_umap.js - T2 UMAP overview (2-tier bubble map & spatial-grid brush)
//
// Renders session.quadtree (= data/spatial_grid.json, loaded verbatim by
// loading_tab.js - a uniform grid over the UMAP embedding, every cell carries its member rowIds


const T2_FRINGE_RADIUS = 3.5;
const T2_MAJOR_MAX_RADIUS = 26;

let t2Brush = null;       // { x0,y0,x1,y1 } in canvas px, while dragging
let t2Dragging = false;
let t2Patterns = null;
let t2Tooltip = null;     

function initT2() {
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT2").hidden = true;
        renderT2();
    });
    pipeline.onChange("projects", renderT2);
    pipeline.onChange("brush_t2", renderT2);

    t2Tooltip = document.createElement("div");
    t2Tooltip.className = "tooltip";
    t2Tooltip.hidden = true;
    document.body.appendChild(t2Tooltip);

    const canvas = document.getElementById("canvasT2");
    canvas.addEventListener("mousedown", t2OnMouseDown);
    canvas.addEventListener("mousemove", t2OnMouseMove);
    canvas.addEventListener("mouseleave", function () { t2Tooltip.hidden = true; });
    canvas.addEventListener("dblclick", function () { pipeline.set("brush_t2", null); });
    window.addEventListener("mouseup", t2OnMouseUp);
}

// Scale: UMAP data space - canvas pixels. We use independently x/y stretch to fill the whole canvas. Bubblr radii are set directly in pixels 
// Stretching doesn't distort their shape, only how spread out the layout looks

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

// 8x8 offscreen canvas per family. So, its identical to T3 buildFamilyPatterns()
// The same family reads as the same texture on both views.
// Built once, cached on t2Patterns

function t2BuildPatterns(ctx) {
    return FAMILY_TEXTURES.map(function (texture, famIdx) {
        const s = 8;
        const off = document.createElement("canvas");
        off.width = s; off.height = s;
        const o = off.getContext("2d");
        o.fillStyle = FAMILY_COLORS[famIdx];
        o.fillRect(0, 0, s, s);
        o.strokeStyle = "rgba(255,255,255,0.65)";
        o.fillStyle = "rgba(255,255,255,0.7)";
        o.lineWidth = 1;
        o.beginPath();
        switch (texture) {
            case "horizontal": o.moveTo(0, 2.5); o.lineTo(s, 2.5); o.moveTo(0, 6.5); o.lineTo(s, 6.5); o.stroke(); break;
            case "vertical":   o.moveTo(2.5, 0); o.lineTo(2.5, s); o.moveTo(6.5, 0); o.lineTo(6.5, s); o.stroke(); break;
            case "diagonal":   o.moveTo(0, 8); o.lineTo(8, 0); o.moveTo(-2, 2); o.lineTo(2, -2); o.moveTo(6, 10); o.lineTo(10, 6); o.stroke(); break;
            case "crosshatch": o.moveTo(0, 8); o.lineTo(8, 0); o.moveTo(0, 0); o.lineTo(8, 8); o.stroke(); break;
            case "dots":       o.arc(4, 4, 1.4, 0, 6.29); o.fill(); break;
            case "wave":       o.moveTo(0, 4); o.quadraticCurveTo(2, 1, 4, 4); o.quadraticCurveTo(6, 7, 8, 4); o.stroke(); break;
        }
        return ctx.createPattern(off, "repeat");
    });
}

// stroke-only marker per FAMILY_MARKERS (pipeline.js's shared
// drawFamilyMarker), centered at (px,py) with characteristic size r. Used
// for fringe cells only - majors stay circular filled bubbles per the T2 spec.
function t2DrawMarker(ctx, shape, px, py, r, color) {
    drawFamilyMarker(ctx, shape, px, py, r, null, color, 1.3);
}

// One row per family: filled+textured swatch (= major bubble look) next to
// the fringe marker outline, plus a one-line caption. Built once - the tiny
// canvases don't need to redraw on every renderT2() call, only exist.
let t2LegendBuilt = false;
function t2RenderLegend() {
    if (t2LegendBuilt) return;
    t2LegendBuilt = true;

    let html = "";
    for (let i = 0; i < FAMILY_NAMES.length; i++) {
        html += '<span class="legend-item">' +
            '<canvas class="legend-swatch-canvas" width="16" height="16" data-fam="' + i + '" data-kind="swatch"></canvas>' +
            '<canvas class="legend-marker-canvas" width="16" height="16" data-fam="' + i + '" data-kind="marker"></canvas>' +
            FAMILY_NAMES[i] +
            '</span>';
    }
    // plain ASCII only in this string - the page is served as Latin-1, and a
    // literal non-ASCII char here (curly quote, proportional sign) would
    // mojibake exactly like the degree-sign issue documented in pipeline.js
    html += '<div class="legend-caption">Filled bubble = large cluster, size scales with count &middot; outline shape = small cluster (fixed size) &middot; ' +
            'faded = doesn\'t match the active project, or outside the current selection</div>' +
            '<div class="legend-caption">Bubble border: thin = Project A only &middot; thick = Project B only &middot; ' +
            'double line = matches both</div>';

    const container = document.getElementById("legendT2");
    container.innerHTML = html;

    container.querySelectorAll("canvas").forEach(function (c) {
        const fam = Number(c.dataset.fam);
        const cctx = c.getContext("2d");
        if (c.dataset.kind === "swatch") {
            cctx.beginPath();
            cctx.arc(8, 8, 7, 0, 2 * Math.PI);
            cctx.fillStyle = t2Patterns[fam];
            cctx.fill();
            cctx.strokeStyle = "rgba(0,0,0,0.55)";
            cctx.stroke();
        } else {
            t2DrawMarker(cctx, FAMILY_MARKERS[fam], 8, 8, 6, FAMILY_COLORS[fam]);
        }
    });
}

/* ==================================================================
 * Brush dimming - cells with no member inside the active brush get faded
 * further on top of their feasibility opacity. No active brush -> nothing
 * is dimmed by this (feasibility alone still applies).
 * ================================================================== */
const T2_UNBRUSHED_DIM = 0.2;

function t2CellInBrush(cell) {
    const brush = session.brush_t2;
    if (!brush) return true;
    for (let k = 0; k < cell.rowIds.length; k++) {
        if (brush.rowIds.has(cell.rowIds[k])) return true;
    }
    return false;
}

/* ==================================================================
 * Feasibility - checks every effective threshold of a project (not just
 * 2 axes), per FIX R2. Split per-project (not just "any project") so the
 * contour stroke below can tell A-only from B-only from both. The per-row
 * check itself is shared with T4 (pipeline.rowMeetsProject); T2 still needs
 * its own per-project (not just OR'd) cell aggregation, which the shared
 * session.feasible_mask alone can't answer.
 * ================================================================== */
function t2CellMeetsProject(cell, project) {
    for (let k = 0; k < cell.rowIds.length; k++) {
        if (pipeline.rowMeetsProject(project, cell.rowIds[k])) return true;
    }
    return false;
}

// feasible for opacity purposes = matches at least one active project (or
// no project exists yet, in which case nothing is filtered) - same
// definition as session.feasible_mask, but aggregated per-cell here
function t2CellIsFeasible(cell) {
    if (session.projects.length === 0) return true;
    for (let k = 0; k < cell.rowIds.length; k++) {
        if (pipeline.rowIsFeasible(cell.rowIds[k])) return true;
    }
    return false;
}

/* Blob contour stroke - which project(s) a major cell satisfies, encoded
 * as stroke weight only (no color, so it never fights the family hue fill).
 * Assumes the path is already set on ctx (beginPath + arc, not yet
 * stroked); strokes it in place 1-3 times without re-declaring the path.
 *   A only   -> 1px solid #111827
 *   B only   -> 3px solid #111827
 *   A and B  -> "railroad track": 5px #111827, 2px white gap, 1px #111827
 *   neither  -> no stroke at all (fill alone carries the 20% opacity cue) */
const T2_CONTOUR_INK = "#111827";

function t2StrokeContour(ctx, feasibleA, feasibleB) {
    if (feasibleA && feasibleB) {
        ctx.strokeStyle = T2_CONTOUR_INK; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = "#fff";         ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = T2_CONTOUR_INK; ctx.lineWidth = 1; ctx.stroke();
    } else if (feasibleB) {
        ctx.strokeStyle = T2_CONTOUR_INK; ctx.lineWidth = 3; ctx.stroke();
    } else if (feasibleA) {
        ctx.strokeStyle = T2_CONTOUR_INK; ctx.lineWidth = 1; ctx.stroke();
    }
    // neither -> no stroke
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
    t2RenderLegend();

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
        // blend instead of one fully hiding another; infeasible (neither
        // project) stays faint at 20%, per the blob-contour spec
        let alpha = feasible ? 0.75 : 0.2;
        if (!t2CellInBrush(cell)) alpha *= T2_UNBRUSHED_DIM; // outside the active selection
        ctx.globalAlpha = alpha;

        if (cell.tier === "major") {
            const r = rUnit * Math.sqrt(cell.count);
            ctx.beginPath();
            ctx.arc(px, py, r, 0, 2 * Math.PI);
            ctx.fillStyle = t2Patterns[cell.dominant];
            ctx.fill();

            const feasibleA = session.projects[0] ? t2CellMeetsProject(cell, session.projects[0]) : false;
            const feasibleB = session.projects[1] ? t2CellMeetsProject(cell, session.projects[1]) : false;
            t2StrokeContour(ctx, feasibleA, feasibleB);
        } else {
            // fringe cells have no fill/texture channel - the family's
            // FAMILY_MARKERS shape (pipeline.js) is their only redundant
            // channel besides stroke color, so they stay tellable apart in
            // greyscale/b&w print same as the textured major bubbles
            t2DrawMarker(ctx, FAMILY_MARKERS[cell.dominant], px, py, T2_FRINGE_RADIUS, FAMILY_COLORS[cell.dominant]);
        }
    });
    ctx.globalAlpha = 1;

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
 * Hover - O(1) cell lookup via the grid, tooltip with lazily-computed
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
    t2Tooltip.innerHTML = "<b>" + familyName + "</b> - " + cell.count + " alloys<br>" + rows;
    t2Tooltip.style.left = (clientX + window.scrollX + 12) + "px";
    t2Tooltip.style.top = (clientY + window.scrollY + 12) + "px";
    t2Tooltip.hidden = false;
}

/* ==================================================================
 * Mouse handling - drag = rectangle brush, plain move = hover tooltip.
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
        // too small to be a real drag (a plain click) - just drop the
        // transient rectangle preview, leave any existing selection alone;
        // deselecting is a deliberate double-click, not an accidental click
        t2Brush = null;
        renderT2();
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
            // boundary cell: check each member's exact point (cheap - cells are small)
            cell.rowIds.forEach(function (id) {
                const px = session.umap[id * 2], py = session.umap[id * 2 + 1];
                if (px >= dx0 && px <= dx1 && py >= dy0 && py <= dy1) rowIds.add(id);
            });
        } else {
            cell.rowIds.forEach(function (id) { rowIds.add(id); }); // no umap yet - fall back to whole cell
        }
    });

    t2Brush = null;
    pipeline.set("brush_t2", { rowIds: rowIds });
}

document.addEventListener("DOMContentLoaded", initT2);
