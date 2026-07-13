/*
* t4_filter.js — T4 Linked Scatter Panel (Filter view)
* Owner: P2 · Branch: p2-ui
* See docs/nested_model_L1_L2_L3_L4_report.md §3.6, §4.5 (Find Top-K,
* click-to-select, rectangle zoom)
*/

/*
* t4_filter.js — T4 Linked Scatter Panel (Filter view)
*
* Three scatter-style panels the engineer uses to pick alloys:
*   - Panel 1 (fixed):   Yield Strength × CSC
*   - Panel 2 (custom):  X and Y from dropdowns, defaulting from session.axisQueue
*   - Panel 3:           stacked bar showing the scrap mix of each pick
* Plus an "+ Add plot" button that spawns up to 3 more custom scatter panels,
* also seeded from session.axisQueue.
*
* Each scatter panel is independent: its own {axisX, axisY, domain,
* userHasZoomed} state (t4Panels). Default domain = bbox of feasible rows
* (rows passing >= 1 project's full thresholds) padded 5%; manual drag-zoom
* marks the panel userHasZoomed so T1/T3-driven bbox refreshes leave it alone.
*
* Clicking a dot picks that alloy (max 4). Clicking a picked dot removes it.
* Every pick lands in session.picks, which T5 and T6 automatically react to.
*/

const T4_MAX_EXTRA_PLOTS = 3;   // how many extra panels the "+ Add plot" button can spawn
const T4_PICK_LIMIT = 4;        // no more than 4 alloys picked at once, PER PROJECT
const T4_HIT_RADIUS = 15;       // pixels — how close a click has to be to grab a new point
const T4_PICK_RADIUS = 12;      // pixels — how close a click has to be to remove an existing pick
const T4_BBOX_PAD = 0.05;       // 5% padding around a panel's default feasible bbox
let t4ExtraPanelCount = 0;      // count of extra panels currently on screen

// which project a NEW click picks into. Existing picks always stay removable
// regardless of this — it only decides where a fresh pick lands.
let t4ActiveProject = "A";

// per-panel state: id -> { axisX, axisY, userHasZoomed, domain: {xMin,xMax,yMin,yMax}|null }
// ids: "1" (fixed YS/CSC), "2" (built-in choosable), "extra-1".."extra-3"
let t4Panels = {};

function initT4() {
    // The Loading tab finishes -> switch the placeholder off, seed the panels
    // from session.axisQueue, draw for the first time, start listening for clicks.
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT4").hidden = true;
        t4InitPanels();
        renderT4Legend();
        renderT4Panels();
        wireT4CanvasClicks();
        wireT4BarHover();
        window.addEventListener("resize", t4SyncPanelHeights);
    });

    // Any of these three changing means the scatters look different — redraw.
    // active_set also drives each unzoomed panel's default domain (the
    // combined T2 ∩ T3 "zoomed in spot" — see t4ComputeDefaultBBox).
    pipeline.onChange("active_set", function () { t4RefitUnzoomedPanels(); renderT4Panels(); });
    pipeline.onChange("picks",      t4RedrawAllOverlaysAndBar); // the user picked/unpicked — cloud is untouched
    pipeline.onChange("projects",   t4OnProjectsChanged); // T1 thresholds moved / B added-removed

    // Button + dropdown listeners
    document.getElementById("addPlotBtn").addEventListener("click", addScatterPlot);
    document.getElementById("t4-2-x").addEventListener("change", function () { t4OnAxisSelectChanged("2", "axisX", this.value); });
    document.getElementById("t4-2-y").addEventListener("change", function () { t4OnAxisSelectChanged("2", "axisY", this.value); });

    document.getElementById("t4ToggleA").addEventListener("click", function () { t4SetActiveProject("A"); });
    document.getElementById("t4ToggleB").addEventListener("click", function () { t4SetActiveProject("B"); });
}

function t4SetActiveProject(proj) {
    t4ActiveProject = proj;
    document.getElementById("t4ToggleA").classList.toggle("active", proj === "A");
    document.getElementById("t4ToggleB").classList.toggle("active", proj === "B");
}

// re-fit every panel's default bbox (T2 ∩ T3 selection, or feasible bbox —
// see t4ComputeDefaultBBox), but leave any panel the user has manually
// zoomed alone. Called whenever session.projects or session.active_set changes.
function t4RefitUnzoomedPanels() {
    Object.keys(t4Panels).forEach(function (id) {
        const panel = t4Panels[id];
        if (panel.userHasZoomed || !panel.axisX || !panel.axisY) return;
        if (!ATTR_BY_KEY[panel.axisX] || !ATTR_BY_KEY[panel.axisY]) return;
        panel.domain = t4ComputeDefaultBBox(ATTR_BY_KEY[panel.axisX], ATTR_BY_KEY[panel.axisY]);
    });
}

// the toggle only makes sense in dual-project mode; fall back to A if B
// disappears (matches T1's own "removing B clears B's picks" behavior)
function t4OnProjectsChanged() {
    const dual = session.projects.length > 1;
    document.getElementById("t4ProjectToggle").hidden = !dual;
    if (!dual) t4SetActiveProject("A");

    // session.feasible_mask is already fresh here (pipeline recomputes it
    // before "projects" listeners fire)
    t4RefitUnzoomedPanels();
    renderT4Panels();
}

// One colored swatch + label per family, shown once at the top of T4.
function renderT4Legend() {
    let html = "";
    for (let i = 0; i < FAMILY_NAMES.length; i++) {
        html += '<span class="legend-item"><span class="legend-swatch" style="background:' +
                FAMILY_COLORS[i] + '"></span>' + FAMILY_NAMES[i] + '</span>';
    }
    document.getElementById("legendT4").innerHTML = html;
}

// Redraw everything (base cloud + overlay) for the 3 built-in panels and any
// extra panels the user added. Used for changes that can move a panel's
// domain or the cloud's own appearance (load, active_set, projects, add
// plot) — NOT for picks or in-progress drags, which have cheaper dedicated
// paths below (t4RedrawAllOverlaysAndBar / drawScatterOverlay / t4RedrawPanelFull).
function renderT4Panels() {
    if (!session.loaded) return;

    drawScatterBase(document.getElementById("canvasT4-1"), "1");
    drawScatterOverlay("1");
    drawScatterBase(document.getElementById("canvasT4-2"), "2");
    drawScatterOverlay("2");
    drawStackedBar(document.getElementById("canvasT4-bar"));

    for (let n = 1; n <= t4ExtraPanelCount; n++) {
        const canvas = document.getElementById("canvasT4-extra-" + n);
        if (canvas && t4Panels["extra-" + n]) {
            drawScatterBase(canvas, "extra-" + n);
            drawScatterOverlay("extra-" + n);
        }
    }

    t4SyncPanelHeights();
}

// A pick was added/removed: only the overlay layers + the composition bar
// depend on session.picks — the base clouds are untouched.
function t4RedrawAllOverlaysAndBar() {
    drawScatterOverlay("1");
    drawScatterOverlay("2");
    for (let n = 1; n <= t4ExtraPanelCount; n++) {
        if (t4Panels["extra-" + n]) drawScatterOverlay("extra-" + n);
    }
    drawStackedBar(document.getElementById("canvasT4-bar"));
}

// Redraw just ONE panel's base + overlay (axis change, single-panel zoom
// commit, single-panel zoom reset) — every other panel is independent and
// untouched.
function t4RedrawPanelFull(panelId) {
    const canvas = document.getElementById(t4CanvasId(panelId));
    if (!canvas) return;
    drawScatterBase(canvas, panelId);
    drawScatterOverlay(panelId);
    t4SyncPanelHeights();
}

/* ==================================================================
 * Panel setup — axis defaults from session.axisQueue (docs/pipeline_contract
 * §axisQueue): T1 constraints first, then T3 brush axes, in the order they
 * were queued.
 * ================================================================== */

// UTS (ultimate tensile strength) isn't a column in this dataset; YS (yield
// strength) is the closest analogue and already anchors panel 1, so it's the
// fallback whenever the spec calls for a default axis and the queue is empty.
const T4_FALLBACK_AXIS = "YS";

function t4InitPanels() {
    const firstQueueAxis = session.axisQueue.length ? session.axisQueue[0].axis : null;
    t4Panels = {
        "1": { axisX: "YS", axisY: "CSC", userHasZoomed: false, domain: null },
        "2": { axisX: firstQueueAxis || T4_FALLBACK_AXIS, axisY: "CSC", userHasZoomed: false, domain: null }
    };
    t4Panels["1"].domain = t4ComputeDefaultBBox(ATTR_BY_KEY.YS, ATTR_BY_KEY.CSC);
    t4Panels["2"].domain = t4ComputeDefaultBBox(ATTR_BY_KEY[t4Panels["2"].axisX], ATTR_BY_KEY.CSC);

    populateAxisSelect(document.getElementById("t4-2-x"), t4Panels["2"].axisX);
    populateAxisSelect(document.getElementById("t4-2-y"), t4Panels["2"].axisY);
}

// user changed one of panel 2 / an extra panel's axis dropdowns
function t4OnAxisSelectChanged(panelId, axisField, newKey) {
    const panel = t4Panels[panelId];
    if (!panel) return;
    panel[axisField] = newKey;
    panel.userHasZoomed = false;
    panel.domain = (ATTR_BY_KEY[panel.axisX] && ATTR_BY_KEY[panel.axisY])
        ? t4ComputeDefaultBBox(ATTR_BY_KEY[panel.axisX], ATTR_BY_KEY[panel.axisY])
        : null;
    t4RedrawPanelFull(panelId);
}

// which axes are already in use as X (resp. Y) across every existing panel
function t4UsedAxes(field) {
    return Object.keys(t4Panels).map(function (id) { return t4Panels[id][field]; });
}

// "+ Add plot" axis picker (pipeline_contract axisQueue spec):
//   1. walk the queue for the first axis not yet used as X anywhere -> axisY = CSC
//   2. queue exhausted for the X role -> walk it again for the first axis not
//      yet used as Y -> axisX = CSC
//   3. queue empty / fully used both ways -> CSC / YS fallback
function t4PickAxisForNewPanel() {
    const queue = session.axisQueue;
    const usedX = t4UsedAxes("axisX");
    for (let i = 0; i < queue.length; i++) {
        if (usedX.indexOf(queue[i].axis) === -1) {
            return { axisX: queue[i].axis, axisY: "CSC", presetXRange: queue[i].brushRange };
        }
    }
    const usedY = t4UsedAxes("axisY");
    for (let i = 0; i < queue.length; i++) {
        if (usedY.indexOf(queue[i].axis) === -1) {
            return { axisX: "CSC", axisY: queue[i].axis, presetXRange: null };
        }
    }
    return { axisX: T4_FALLBACK_AXIS, axisY: "CSC", presetXRange: null };
}

// convert a T3 brush_t3 range (stored normalized [0,1], 1 = "best") back to
// raw data units on this attribute, mirroring pipeline.normAttr's inversion
function t4DenormAttr(key, n) {
    const a = ATTR_BY_KEY[key];
    const nt = a && session.norm_table[a.col];
    if (!nt) return null;
    const span = nt.max - nt.min;
    return a.higherIsBetter ? nt.min + n * span : nt.min + (1 - n) * span;
}

function t4DenormRange(key, normRange) {
    const r0 = t4DenormAttr(key, normRange[0]), r1 = t4DenormAttr(key, normRange[1]);
    return r0 <= r1 ? [r0, r1] : [r1, r0];
}

/* ==================================================================
 * Feasibility — session.feasible_mask (pipeline.js) is a Uint8Array, 1 =
 * row meets ALL of at least one active project's effective thresholds
 * (every attribute that project constrains, not just the two axes on
 * screen). Pipeline recomputes it reactively whenever session.projects
 * changes, before "projects" subscribers fire, so it's always current here.
 * ================================================================== */
function t4IsFeasible(i) {
    return session.feasible_mask ? session.feasible_mask[i] === 1 : pipeline.rowIsFeasible(i);
}

// default (un-zoomed) domain for a panel: bbox of every feasible row on
// these two axes, padded 5%; falls back to the full data range if nothing
// is feasible yet (e.g. no projects defined)
function t4ComputeFeasibleBBox(attrX, attrY) {
    const ntX = session.norm_table[attrX.col], ntY = session.norm_table[attrY.col];
    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const n = session.rowCount;
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, found = false;

    for (let i = 0; i < n; i++) {
        if (!t4IsFeasible(i)) continue;
        found = true;
        const vx = colX[i], vy = colY[i];
        if (vx < xLo) xLo = vx; if (vx > xHi) xHi = vx;
        if (vy < yLo) yLo = vy; if (vy > yHi) yHi = vy;
    }
    if (!found) { xLo = ntX.min; xHi = ntX.max; yLo = ntY.min; yHi = ntY.max; }

    const padX = (xHi - xLo) * T4_BBOX_PAD || (ntX.max - ntX.min) * T4_BBOX_PAD || 1;
    const padY = (yHi - yLo) * T4_BBOX_PAD || (ntY.max - ntY.min) * T4_BBOX_PAD || 1;
    return { xMin: xLo - padX, xMax: xHi + padX, yMin: yLo - padY, yMax: yHi + padY };
}

// bbox (padded 5%) of an arbitrary row-id iterable on two axes; null if the
// iterable is empty. Used to zoom to the T2 ∩ T3 combined selection.
function t4ComputeBBoxFromRows(attrX, attrY, rowIds) {
    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, found = false;
    rowIds.forEach(function (i) {
        found = true;
        const vx = colX[i], vy = colY[i];
        if (vx < xLo) xLo = vx; if (vx > xHi) xHi = vx;
        if (vy < yLo) yLo = vy; if (vy > yHi) yHi = vy;
    });
    if (!found) return null;
    const padX = (xHi - xLo) * T4_BBOX_PAD || 1;
    const padY = (yHi - yLo) * T4_BBOX_PAD || 1;
    return { xMin: xLo - padX, xMax: xHi + padX, yMin: yLo - padY, yMax: yHi + padY };
}

// default (un-zoomed) domain for a panel — prefers the combined T2 ∩ T3
// selection (session.active_set) when one is active, since that's the
// "zoomed in spot" the user is currently narrowing toward; falls back to
// the broader feasible bbox (project thresholds) when nothing is brushed.
function t4ComputeDefaultBBox(attrX, attrY) {
    if (session.active_set) {
        const bbox = t4ComputeBBoxFromRows(attrX, attrY, session.active_set);
        if (bbox) return bbox;
    }
    return t4ComputeFeasibleBBox(attrX, attrY);
}

// T3 brush cleared (middle-click, see t3_violin.js) -> snap every linked
// panel back to its default (T2 ∩ T3, or feasible) bbox on that axis
function t4ResetPanelZoomForAxis(axis) {
    let touched = false;
    Object.keys(t4Panels).forEach(function (id) {
        const panel = t4Panels[id];
        if (panel.axisX !== axis && panel.axisY !== axis) return;
        if (!ATTR_BY_KEY[panel.axisX] || !ATTR_BY_KEY[panel.axisY]) return;
        panel.userHasZoomed = false;
        panel.domain = t4ComputeDefaultBBox(ATTR_BY_KEY[panel.axisX], ATTR_BY_KEY[panel.axisY]);
        touched = true;
    });
    if (touched) renderT4Panels();
}

// T3 brush committed on `axis` with normalized [lo,hi] -> update that axis's
// bound on every linked, not-manually-zoomed panel
function t4SyncPanelZoomFromBrush(axis, normRange) {
    const [lo, hi] = t4DenormRange(axis, normRange);
    let touched = false;
    Object.keys(t4Panels).forEach(function (id) {
        const panel = t4Panels[id];
        if (panel.userHasZoomed) return;
        if (!panel.domain) return;
        if (panel.axisX === axis) { panel.domain.xMin = lo; panel.domain.xMax = hi; touched = true; }
        if (panel.axisY === axis) { panel.domain.yMin = lo; panel.domain.yMax = hi; touched = true; }
    });
    if (touched) renderT4Panels();
}

// Numeric tick marks + values along X and Y, evenly spaced across the
// panel's current domain — so the axes carry an actual value scale, not
// just the attribute name and relative dot position.
const T4_TICK_COUNT = 4; // -> 5 labels per axis, including both ends

function t4DrawAxisTicks(ctx, xLo, xHi, yLo, yHi, xToPx, yToPx, mL, mT, plotW, plotH) {
    ctx.font = "8px Inter, sans-serif";
    ctx.strokeStyle = "#ccc";
    ctx.fillStyle = "#666";
    ctx.lineWidth = 1;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let t = 0; t <= T4_TICK_COUNT; t++) {
        const v = xLo + (t / T4_TICK_COUNT) * (xHi - xLo);
        const px = xToPx(v);
        ctx.beginPath();
        ctx.moveTo(px, mT + plotH);
        ctx.lineTo(px, mT + plotH + 3);
        ctx.stroke();
        ctx.fillText(fmtVal(v), px, mT + plotH + 11);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let t = 0; t <= T4_TICK_COUNT; t++) {
        const v = yLo + (t / T4_TICK_COUNT) * (yHi - yLo);
        const py = yToPx(v);
        ctx.beginPath();
        ctx.moveTo(mL - 3, py);
        ctx.lineTo(mL, py);
        ctx.stroke();
        ctx.fillText(fmtVal(v), mL - 5, py);
    }
}

/* ==================================================================
 * Draw one scatter panel: axes, all 324K dots (feasibility-encoded),
 * constraint lines. Split into a static-ish "base" layer and a cheap
 * "overlay" layer (pick markers + live drag rectangle) so that picking an
 * alloy or dragging a zoom box never has to repaint the 324K-point cloud —
 * see docs perf plan / .canvas-stack in style.css. Each panel's canvas id
 * (e.g. "canvasT4-1") has a sibling overlay canvas (e.g. "canvasT4-1-ov")
 * stacked on top of it via CSS.
 * ================================================================== */
function t4CanvasId(panelId) {
    if (panelId === "1") return "canvasT4-1";
    if (panelId === "2") return "canvasT4-2";
    const m = /^extra-(\d+)$/.exec(panelId);
    return m ? "canvasT4-extra-" + m[1] : null;
}

function t4OverlayCanvasId(panelId) {
    const base = t4CanvasId(panelId);
    return base ? base + "-ov" : null;
}

function drawScatterBase(canvas, panelId) {
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;                    // canvas not visible yet — skip and try again later
    const ctx = hd.ctx, W = hd.W, H = hd.H;

    ctx.clearRect(0, 0, W, H);          // wipe the canvas before every redraw

    // every panel gets real default axes on creation (see t4InitPanels /
    // addScatterPlot), so there's no user-facing "choose axes" placeholder
    // state to render here — an invalid panel just stays a blank canvas
    const panel = t4Panels[panelId];
    if (!panel || !panel.axisX || !panel.axisY || panel.axisX === "__none__" || panel.axisY === "__none__") {
        canvas._t4geom = null;
        return;
    }

    const attrX = ATTR_BY_KEY[panel.axisX], attrY = ATTR_BY_KEY[panel.axisY];
    if (!attrX || !attrY) return;
    const ntX = session.norm_table[attrX.col], ntY = session.norm_table[attrY.col];
    if (!ntX || !ntY) return;

    if (!panel.domain) panel.domain = t4ComputeDefaultBBox(attrX, attrY);

    // Room for axis labels: left/right/top/bottom margins. Wider than a bare
    // attribute-key label needs, to also fit the numeric tick values below.
    const mL = 48, mR = 10, mT = 10, mB = 32;
    const plotW = W - mL - mR, plotH = H - mT - mB;

    // Axis frame (just an L-shape).
    ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + plotH); ctx.lineTo(mL + plotW, mT + plotH);
    ctx.stroke();

    // This panel's own independent zoom domain (see t4Panels).
    const xLo = panel.domain.xMin, xHi = panel.domain.xMax;
    const yLo = panel.domain.yMin, yHi = panel.domain.yMax;

    // Turn a raw data value into a pixel position (and remember it for click hits).
    function xToPx(v) { return mL + ((v - xLo) / (xHi - xLo)) * plotW; }
    function yToPx(v) { return mT + plotH - ((v - yLo) / (yHi - yLo)) * plotH; }

    // Numeric tick values, then the attribute-key labels below/left of those.
    t4DrawAxisTicks(ctx, xLo, xHi, yLo, yHi, xToPx, yToPx, mL, mT, plotW, plotH);
    ctx.fillStyle = "#333"; ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(attrX.key, mL + plotW / 2, mT + plotH + 24);
    ctx.save();
    ctx.translate(mL - 38, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(attrY.key, 0, 0);
    ctx.restore();

    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const n = session.rowCount;

    // Points scale up as the view zooms in, based on how much smaller the
    // current domain is than the full data range. Capped so it can't
    // balloon into overlapping blobs at extreme zoom.
    const zoomFactor = Math.sqrt(((ntX.max - ntX.min) / (xHi - xLo)) * ((ntY.max - ntY.min) / (yHi - yLo)));
    const dotR = Math.max(1, Math.min(4, zoomFactor));

    // Cache one quadtree per panel over this axis pair's RAW data coordinates
    // (not pixels — pixels move on every zoom, which would force a rebuild
    // far more often than the axis actually changes). Used for O(log n)-ish
    // hit-testing (t4QuadtreeNearest) instead of scanning all n rows per
    // click/hover. Rebuilt only when the panel's axis pair actually changes.
    const quadKey = panel.axisX + "|" + panel.axisY;
    if (panel.quadtreeKey !== quadKey || !panel.quadtree) {
        panel.quadtree = d3.quadtree()
            .x(function (i) { return colX[i]; })
            .y(function (i) { return colY[i]; })
            .addAll(d3.range(n));
        panel.quadtreeKey = quadKey;
    }

    // xToPx/yToPx are closures (fine for the occasional tick/constraint-line
    // call) but the loop below can run up to 324K times, so the pixel
    // mapping is inlined to skip the function-call overhead per point.
    const invXSpan = plotW / (xHi - xLo), invYSpan = plotH / (yHi - yLo);

    // Clip so points outside the current (possibly zoomed-in) domain don't
    // bleed into the axis-label margins.
    ctx.save();
    ctx.beginPath();
    ctx.rect(mL, mT, plotW, plotH);
    ctx.clip();

    // Bucket every VISIBLE row by (family, feasibility) — up to 7*2=14
    // groups — so the whole cloud costs at most 14 beginPath()/fill()/
    // stroke() calls instead of one pair per point. Per-call canvas
    // overhead, not path complexity, is what makes 324K individual
    // drawFamilyMarker() calls slow, so batching same-style points into one
    // path is the actual win. Viewport culling (skip rows outside the
    // current domain, padded by one marker radius so an edge-straddling
    // marker still shows its visible sliver) means a zoomed-in panel only
    // pays for the points it can actually show.
    const padXData = dotR / invXSpan, padYData = dotR / invYSpan;
    const cullXLo = xLo - padXData, cullXHi = xHi + padXData;
    const cullYLo = yLo - padYData, cullYHi = yHi + padYData;
    const nonFeasibleByFam = FAMILY_MARKERS.map(function () { return []; });
    const feasibleByFam    = FAMILY_MARKERS.map(function () { return []; });
    for (let i = 0; i < n; i++) {
        const vx = colX[i], vy = colY[i];
        if (vx < cullXLo || vx > cullXHi || vy < cullYLo || vy > cullYHi) continue;
        const fam = session.family_labels[i];
        (t4IsFeasible(i) ? feasibleByFam : nonFeasibleByFam)[fam].push(i);
    }

    function flushBucket(rows, shape, fillColor, strokeColor, lineWidth) {
        if (!rows.length) return;
        ctx.beginPath();
        let fillable = true;
        for (let k = 0; k < rows.length; k++) {
            const i = rows[k];
            const px = mL + (colX[i] - xLo) * invXSpan;
            const py = mT + plotH - (colY[i] - yLo) * invYSpan;
            fillable = traceFamilyMarkerPath(ctx, shape, px, py, dotR);
        }
        if (fillColor && fillable) { ctx.fillStyle = fillColor; ctx.fill(); }
        if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth || 1; ctx.stroke(); }
    }

    // Pass 1: non-feasible (fails every active project) — faint, no border,
    // marker shape = this row's family (FAMILY_MARKERS, pipeline.js), same
    // as everywhere else in the dashboard. Drawn first so feasible points
    // always sit on top.
    ctx.globalAlpha = 0.15;
    FAMILY_MARKERS.forEach(function (shape, fam) {
        flushBucket(nonFeasibleByFam[fam], shape, FAMILY_COLORS[fam], null);
    });

    // Pass 2: feasible (passes >= 1 active project) — full opacity, border =
    // this row's family color but darker (not a flat black outline).
    ctx.globalAlpha = 1;
    FAMILY_MARKERS.forEach(function (shape, fam) {
        flushBucket(feasibleByFam[fam], shape, FAMILY_COLORS[fam], FAMILY_COLORS_DARK[fam], 1.5);
    });
    ctx.restore();
    ctx.globalAlpha = 1;

    // Threshold lines from T1, one per axis. Projects with the IDENTICAL
    // effective value on an axis merge into one neutral "A+B" line instead of
    // two overlapping ones; otherwise each project gets its own color
    // (A=amber, B=blue) so it's clear which line belongs to which client.
    t4DrawConstraintLine(ctx, attrX.key, true,  xToPx, mL, mT, plotW, plotH);
    t4DrawConstraintLine(ctx, attrY.key, false, yToPx, mL, mT, plotW, plotH);

    // Save everything the click/zoom handlers AND the overlay layer need to
    // translate cursor <-> data (dotR sizes the overlay's pick markers too).
    canvas._t4geom = { mL, mT, plotW, plotH, xToPx, yToPx, colX, colY, panelId, xLo, xHi, yLo, yHi, dotR };
}

// Overlay layer: pick markers (crosses + chip labels) and the live drag
// rectangle. Reads the base canvas's saved geometry so it never has to
// recompute (or repaint) the point cloud — this is what makes picking and
// zoom-dragging cheap regardless of dataset size.
function drawScatterOverlay(panelId) {
    const baseCanvas = document.getElementById(t4CanvasId(panelId));
    const overlayCanvas = document.getElementById(t4OverlayCanvasId(panelId));
    if (!baseCanvas || !overlayCanvas) return;
    const hd = setupHiDPICanvas(overlayCanvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);

    const g = baseCanvas._t4geom;
    if (!g) return; // base hasn't produced a valid layout yet — nothing to overlay

    // Pick markers: a black cross at the alloy's position plus a black/white
    // "A1"-"A4" / "B1"-"B4" chip beside it.
    session.picks.forEach(function (pick) {
        const px = g.xToPx(g.colX[pick.rowId]), py = g.yToPx(g.colY[pick.rowId]);
        const label = (pick.project === "B" ? "B" : "A") + pick.number;
        t4DrawPickMarker(ctx, px, py, label, g.dotR);
    });

    // Live rectangle preview while dragging a zoom selection on THIS canvas.
    if (t4ZoomDrag && t4ZoomDrag.canvas === baseCanvas) {
        const x = Math.min(t4ZoomDrag.x0, t4ZoomDrag.x1), y = Math.min(t4ZoomDrag.y0, t4ZoomDrag.y1);
        const w = Math.abs(t4ZoomDrag.x1 - t4ZoomDrag.x0), h = Math.abs(t4ZoomDrag.y1 - t4ZoomDrag.y0);
        ctx.fillStyle = "rgba(0,0,0,0.10)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }
}

// cross (×) marker + black chip label, per item 8/10 of the pick-rendering
// spec — sized relative to the panel's current dot radius so it stays
// visible over overlapping square markers at any zoom level
function t4DrawPickMarker(ctx, px, py, label, dotR) {
    const half = Math.max(6, dotR * 3); // ~1.5x the *diameter* of a regular marker
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - half, py - half); ctx.lineTo(px + half, py + half);
    ctx.moveTo(px + half, py - half); ctx.lineTo(px - half, py + half);
    ctx.stroke();

    ctx.font = "bold 9px Inter, sans-serif";
    const tw = ctx.measureText(label).width;
    const cx = px + half + 4, cy = py - half - 4;
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - tw / 2 - 4, cy - 7.5, tw + 8, 15, 7);
    else ctx.rect(cx - tw / 2 - 4, cy - 7.5, tw + 8, 15);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
}

// One axis's constraint line(s). Projects that share the exact same
// effective value on this axis merge into a single "A+B" line; otherwise
// each gets its own line + tiny label at the line's end. Lines are always
// black — the label text (A / B / A+B) already says which project owns it,
// so color isn't needed as a second channel here.
const T4_CONSTRAINT_INK = "#111827";

function t4DrawConstraintLine(ctx, attrKey, isVertical, toPx, mL, mT, plotW, plotH) {
    const groups = {}; // effective value -> [projectIdx, ...]
    session.projects.forEach(function (project, idx) {
        const t = project.thresholds[attrKey];
        if (!t || t.effective == null) return;
        (groups[t.effective] = groups[t.effective] || []).push(idx);
    });

    ctx.font = "9px Inter, sans-serif";
    Object.keys(groups).forEach(function (rawVal) {
        const idxs = groups[rawVal];
        const merged = idxs.length > 1;
        const label = merged ? "A+B" : (idxs[0] === 1 ? "B" : "A");
        const pos = toPx(Number(rawVal));

        // the current view may be zoomed to a range that no longer includes
        // this threshold — skip it instead of drawing outside the plot box
        const inRange = isVertical ? (pos >= mL && pos <= mL + plotW) : (pos >= mT && pos <= mT + plotH);
        if (!inRange) return;

        ctx.strokeStyle = T4_CONSTRAINT_INK; ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (isVertical) { ctx.moveTo(pos, mT); ctx.lineTo(pos, mT + plotH); }
        else { ctx.moveTo(mL, pos); ctx.lineTo(mL + plotW, pos); }
        ctx.stroke();

        ctx.fillStyle = T4_CONSTRAINT_INK;
        if (isVertical) { ctx.textAlign = "center"; ctx.fillText(label, pos, mT - 2); }
        else { ctx.textAlign = "right"; ctx.fillText(label, mL - 2, pos - 2); }
    });
}

// Same 8x8 textured swatch as T2/T3 (buildFamilyPatterns in t3_violin.js) so
// a scrap family reads as the same texture everywhere, not just the same hue.
let t4Patterns = null;
function t4BuildPatterns(ctx) {
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
            // "solid": nothing extra
        }
        return ctx.createPattern(off, "repeat");
    });
}

/* ==================================================================
 * Panel 3: one vertical bar per pick, split into 6 textured segments
 * showing what fraction of the recipe each scrap family contributes.
 * Segment labels are dark ink (#111827); a hover tooltip backs up any
 * segment too short to fit its inline label.
 * ================================================================== */
let t4BarHitRegions = []; // { x, y, w, h, famIdx, pct, totalPct } — rebuilt every draw, read by hover

function drawStackedBar(canvas) {
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);
    if (!t4Patterns) t4Patterns = t4BuildPatterns(ctx);
    t4BarHitRegions = [];

    // Empty state — nothing to show without picks.
    if (session.picks.length === 0) {
        ctx.fillStyle = "#888"; ctx.font = "11px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("Pick alloys in a scatter to see their scrap mix", W / 2, H / 2);
        return;
    }

    const picks = session.picks;
    const barW = 42, gap = 22, mT = 20, mB = 30;
    const totalW = picks.length * barW + (picks.length - 1) * gap;
    const startX = (W - totalW) / 2;
    const barH = H - mT - mB;

    picks.forEach(function (pick, pi) {
        const row = pipeline.getRow(pick.rowId);
        const x = startX + pi * (barW + gap);
        let yCursor = mT;                          // track where the next segment starts

        // "percentage of this bar" per item 12 — normalized against the sum
        // of this alloy's own segments, so it's exact even if the recipe
        // percentages don't add up to precisely 100.
        const totalPct = SCRAP_FAMILIES.reduce(function (sum, scrap) { return sum + (row[scrap.col] || 0); }, 0) || 1;

        SCRAP_FAMILIES.forEach(function (scrap, fi) {
            const pct = row[scrap.col] || 0;       // this scrap's % in the recipe
            const h = (pct / 100) * barH;          // convert % to pixel height
            ctx.fillStyle = t4Patterns[fi];
            ctx.fillRect(x, yCursor, barW, h);
            ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
            ctx.strokeRect(x, yCursor, barW, h);

            // % label — only when the segment is tall enough to actually fit one
            if (h > 12) {
                ctx.fillStyle = "#111827";
                ctx.font = "9px Inter, sans-serif";
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(Math.round(pct) + "%", x + barW / 2, yCursor + h / 2);
            }

            t4BarHitRegions.push({ x: x, y: yCursor, w: barW, h: Math.max(h, 1), famIdx: fi, pct: pct, totalPct: totalPct });
            yCursor += h;
        });
        // Alloy badge under the bar — black, same as the scatter panels
        // (the "A"/"B" letter in the label already says which project).
        ctx.fillStyle = "#222";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillText((pick.project === "B" ? "B" : "A") + pick.number, x + barW / 2, H - 10);
    });
}

// Hover tooltip over a bar segment: "{Family Name} — {percentage}%",
// percentage = this family's share of the bar / total share of the bar × 100.
let t4BarTooltip = null;
function wireT4BarHover() {
    t4BarTooltip = document.createElement("div");
    t4BarTooltip.className = "tooltip";
    t4BarTooltip.hidden = true;
    document.body.appendChild(t4BarTooltip);

    const canvas = document.getElementById("canvasT4-bar");
    canvas.addEventListener("mousemove", function (evt) {
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
        const hit = t4BarHitRegions.find(function (r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; });
        if (!hit) { t4BarTooltip.hidden = true; return; }
        const pct = (hit.pct / hit.totalPct) * 100;
        t4BarTooltip.innerHTML = FAMILY_NAMES[hit.famIdx] + " — " + pct.toFixed(1) + "%";
        t4BarTooltip.style.left = (evt.clientX + window.scrollX + 12) + "px";
        t4BarTooltip.style.top = (evt.clientY + window.scrollY + 12) + "px";
        t4BarTooltip.hidden = false;
    });
    canvas.addEventListener("mouseleave", function () { t4BarTooltip.hidden = true; });
}

/* ==================================================================
 * Canvas alignment (item 9) — panel 2 has a real <select> axis row above
 * its canvas; panel 1 only has a plain label in the same slot, so its
 * canvas would otherwise sit a few px higher. Force panel 1's row to match
 * panel 2's measured height instead of guessing at it in CSS.
 * ================================================================== */
function t4SyncPanelHeights() {
    const reference = document.querySelector("#panelT4-2 .axis-select");
    const target = document.querySelector("#panelT4-1 .axis-select");
    if (!reference || !target) return;
    target.style.minHeight = reference.offsetHeight + "px";
}

// Attach mouse handlers to the two built-in scatter canvases. Extra panels
// wire their own in addScatterPlot(). mousedown/move/up (not "click") so a
// real drag can zoom while a plain click still picks.
function wireT4CanvasClicks() {
    t4ScatterTooltip = document.createElement("div");
    t4ScatterTooltip.className = "tooltip";
    t4ScatterTooltip.hidden = true;
    document.body.appendChild(t4ScatterTooltip);

    ["canvasT4-1", "canvasT4-2"].forEach(t4WireCanvas);
    window.addEventListener("mouseup", t4OnCanvasMouseUp);
}

function t4WireCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.addEventListener("mousedown", t4OnCanvasMouseDown);
    c.addEventListener("mousemove", t4OnCanvasMouseMove);
    c.addEventListener("mouseleave", t4HideTooltip);
}

/* ==================================================================
 * Nearest-point hit-testing, shared by hover and click-to-pick. Uses the
 * panel's cached quadtree (drawScatterBase — raw data-space coordinates,
 * rebuilt only when the axis pair changes) instead of an O(n) scan over
 * every row. The search radius is converted from pixels to a per-axis
 * DATA-space half-extent so quadtree pruning stays correct even when X and
 * Y have very different scales (e.g. a ~1e-8 electrical-resistivity axis
 * next to a ~200 MPa yield-strength axis) — the actual nearest-point
 * comparison inside the search is still real squared PIXEL distance, so
 * results are identical to what the old O(n) scan would have found.
 * ================================================================== */
function t4QuadtreeNearest(panelId, g, px, py, pixelRadius) {
    const panel = t4Panels[panelId];
    const qt = panel && panel.quadtree;
    if (!qt) return -1; // shouldn't happen — drawScatterBase always builds it before g is saved

    const dataRx = pixelRadius / g.plotW * (g.xHi - g.xLo);
    const dataRy = pixelRadius / g.plotH * (g.yHi - g.yLo);
    const dataX = g.xLo + (px - g.mL) / g.plotW * (g.xHi - g.xLo);
    const dataY = g.yHi - (py - g.mT) / g.plotH * (g.yHi - g.yLo);

    let bestIdx = -1, bestDistSq = pixelRadius * pixelRadius;
    qt.visit(function (node, x0, y0, x1, y1) {
        if (!node.length) {
            let leaf = node;
            do {
                const i = leaf.data;
                const dx = g.xToPx(g.colX[i]) - px, dy = g.yToPx(g.colY[i]) - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestDistSq) { bestDistSq = d2; bestIdx = i; }
            } while ((leaf = leaf.next));
        }
        // prune this subtree unless its bounding box intersects the search box
        return x0 > dataX + dataRx || x1 < dataX - dataRx || y0 > dataY + dataRy || y1 < dataY - dataRy;
    });
    return bestIdx;
}

/* ==================================================================
 * Hover tooltip: mixture name, all 7 primary properties, 6 recipe %.
 * Throttled by wall-clock time (not requestAnimationFrame — rAF is paced
 * to the tab's actual paint cycle, which some environments suspend or
 * delay unpredictably; a plain time check has no such dependency) — even
 * with quadtree-accelerated hit-testing, raw mousemove can fire far more
 * often than a tooltip needs to update.
 * ================================================================== */
let t4ScatterTooltip = null;
let t4LastHoverAt = 0;
const T4_HOVER_THROTTLE_MS = 40; // ~25 checks/sec — smooth, caps the scan rate

function t4OnHoverMove(canvas, clientX, clientY) {
    const g = canvas._t4geom;
    if (!g) { t4HideTooltip(); return; }
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;

    const bestIdx = t4QuadtreeNearest(g.panelId, g, px, py, T4_HIT_RADIUS);
    if (bestIdx < 0) { t4HideTooltip(); return; }
    t4ShowTooltip(bestIdx, clientX, clientY);
}

function t4ShowTooltip(rowId, clientX, clientY) {
    const mixtureId = session.columns["Mixture ID"] ? session.columns["Mixture ID"][rowId] : "Row " + rowId;
    let html = "<b>" + escapeHtml(String(mixtureId)) + "</b><br>";
    PRIMARY_ATTRS.forEach(function (attr) {
        html += attr.key + ": " + fmtVal(session.columns[attr.col][rowId]) + "<br>";
    });
    SCRAP_FAMILIES.forEach(function (fam) {
        html += fam.key + ": " + fmtVal(session.columns[fam.col][rowId]) + "%<br>";
    });
    t4ScatterTooltip.innerHTML = html;
    t4ScatterTooltip.style.left = (clientX + window.scrollX + 12) + "px";
    t4ScatterTooltip.style.top = (clientY + window.scrollY + 12) + "px";
    t4ScatterTooltip.hidden = false;
}

function t4HideTooltip() {
    if (t4ScatterTooltip) t4ScatterTooltip.hidden = true;
}

function t4CanvasPos(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    return [evt.clientX - rect.left, evt.clientY - rect.top];
}

function t4OnCanvasMouseDown(evt) {
    t4HideTooltip();
    if (evt.button === 1) {
        evt.preventDefault(); // stop the browser's middle-click autoscroll from kicking in
        t4ResetPanelZoom(evt.currentTarget);
        return;
    }
    if (evt.button !== 0) return; // only the left button drags a zoom/pick
    const [x, y] = t4CanvasPos(evt);
    t4ZoomDrag = { canvas: evt.currentTarget, x0: x, y0: y, x1: x, y1: y };
}

let t4ZoomDrag = null;   // { canvas, x0,y0,x1,y1 } while a zoom drag is in progress

function t4OnCanvasMouseMove(evt) {
    if (t4ZoomDrag && t4ZoomDrag.canvas === evt.currentTarget) {
        const [x, y] = t4CanvasPos(evt);
        t4ZoomDrag.x1 = x; t4ZoomDrag.y1 = y;
        // Only redraw the ONE panel being dragged (for the live rectangle
        // preview) — every other panel is untouched since panels no longer
        // share zoom state.
        t4RedrawSinglePanel(evt.currentTarget);
        return;
    }

    // not dragging -> hover, throttled by wall-clock time. Read everything
    // off evt synchronously, right here — evt.currentTarget goes null the
    // moment this handler returns, so nothing about evt can be reused later.
    const now = performance.now();
    if (now - t4LastHoverAt < T4_HOVER_THROTTLE_MS) return;
    t4LastHoverAt = now;
    t4OnHoverMove(evt.currentTarget, evt.clientX, evt.clientY);
}

// Live drag preview: redraws only the dragged panel's OVERLAY (the
// rectangle) — the 324K-point base cloud is never touched during a drag.
function t4RedrawSinglePanel(canvas) {
    const panelId = t4PanelIdForCanvas(canvas.id);
    if (panelId) drawScatterOverlay(panelId);
}

function t4PanelIdForCanvas(canvasId) {
    if (canvasId === "canvasT4-1") return "1";
    if (canvasId === "canvasT4-2") return "2";
    const m = canvasId.match(/^canvasT4-extra-(\d+)$/);
    return m ? "extra-" + m[1] : null;
}

// middle-click resets JUST this panel back to its feasible (Project A ∪ B)
// bbox — panels are independent, so this never touches any other panel's
// zoom, and it doesn't touch picks/active_set either. "Reset" here means
// back to the current T2 ∩ T3 selection (not a full reset to the broad
// project-feasible view) — t4ComputeDefaultBBox only falls back to that
// broader view when nothing is brushed in T2/T3 at all.
function t4ResetPanelZoom(canvas) {
    const panelId = t4PanelIdForCanvas(canvas.id);
    const panel = t4Panels[panelId];
    if (!panel || !ATTR_BY_KEY[panel.axisX] || !ATTR_BY_KEY[panel.axisY]) return;
    panel.userHasZoomed = false;
    panel.domain = t4ComputeDefaultBBox(ATTR_BY_KEY[panel.axisX], ATTR_BY_KEY[panel.axisY]);
    t4RedrawPanelFull(panelId);
}

function t4OnCanvasMouseUp() {
    if (!t4ZoomDrag) return;
    const drag = t4ZoomDrag;
    t4ZoomDrag = null;

    const canvas = drag.canvas;
    const g = canvas._t4geom;
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);

    if (!g || (x1 - x0 < 5 && y1 - y0 < 5)) {
        // too small to be a real drag — treat it as a plain click-to-pick instead.
        // Either way the drag-rectangle preview needs to be cleared off this
        // panel's overlay; if the click actually changed session.picks,
        // pipeline's "picks" listener (t4RedrawAllOverlaysAndBar) redraws the
        // overlay again right after — a cheap, harmless second pass.
        if (g) {
            t4HandlePickClick(g, drag.x0, drag.y0);
            drawScatterOverlay(g.panelId);
        }
        return;
    }

    // this panel ALONE zooms to the dragged rectangle's data bounds — panels
    // no longer share zoom state (item 7)
    const panel = t4Panels[g.panelId];
    if (panel) {
        const dataX0 = g.xLo + (x0 - g.mL) / g.plotW * (g.xHi - g.xLo);
        const dataX1 = g.xLo + (x1 - g.mL) / g.plotW * (g.xHi - g.xLo);
        const dataY0 = g.yHi - (y1 - g.mT) / g.plotH * (g.yHi - g.yLo);
        const dataY1 = g.yHi - (y0 - g.mT) / g.plotH * (g.yHi - g.yLo);
        let xMin = Math.min(dataX0, dataX1), xMax = Math.max(dataX0, dataX1);
        let yMin = Math.min(dataY0, dataY1), yMax = Math.max(dataY0, dataY1);
        // an axis-only drag (real mouse/trackpad jitter easily moves in just
        // one direction) leaves that axis's span at ~0 — left unguarded,
        // xToPx/yToPx then divide by zero, every point renders at NaN, and
        // every future click's distance check silently fails (NaN <= r is
        // always false) — permanently "breaking" picking on this panel
        if (xMax - xMin < 1e-9) { const pad = (g.xHi - g.xLo) * 0.01 || 1; xMin -= pad; xMax += pad; }
        if (yMax - yMin < 1e-9) { const pad = (g.yHi - g.yLo) * 0.01 || 1; yMin -= pad; yMax += pad; }
        panel.domain = { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
        panel.userHasZoomed = true;
    }
    // Panels are independent — only THIS one's base+overlay needs to redraw.
    t4RedrawPanelFull(g.panelId);
}

// A plain click (no real drag): figure out what the user was pointing at,
// then either remove that pick (if it's already picked) or add it as a new one.
function t4HandlePickClick(g, px, py) {
    // Step 1: was the click near one of the numbered badges? If yes, that pick
    // wins the click. Bigger radius here so badges are always easy to remove.
    let bestIdx = -1;
    for (let p = 0; p < session.picks.length; p++) {
        const pick = session.picks[p];
        const dx = g.xToPx(g.colX[pick.rowId]) - px;
        const dy = g.yToPx(g.colY[pick.rowId]) - py;
        if (dx * dx + dy * dy <= T4_PICK_RADIUS * T4_PICK_RADIUS) {
            bestIdx = pick.rowId;
            break;
        }
    }

    // Step 2: no badge nearby → look for the closest unpicked point within
    // HIT_RADIUS. NOT filtered by session.active_set: drawScatterBase draws
    // every row regardless of active_set (only feasibility affects how a
    // point looks), so gating clicks by active_set made plenty of visibly
    // on-screen points unclickable — most noticeably right after a T2/T3
    // brush, since that's exactly when active_set stops being null and the
    // panel also auto-zooms, making the mismatch impossible to miss.
    if (bestIdx < 0) {
        bestIdx = t4QuadtreeNearest(g.panelId, g, px, py, T4_HIT_RADIUS);
    }
    if (bestIdx < 0) return;                     // clicked empty space — do nothing

    // Step 3: toggle. Remove if already picked (whichever project it's in —
    // an existing badge is always removable regardless of the active
    // toggle); otherwise add it to whichever project is currently active.
    // .slice() only copies the ARRAY — the pick objects inside were still
    // the same live references as session.picks, so renumbering below
    // used to mutate session directly. Copy each pick object too.
    const picks = session.picks.map(function (p) { return { rowId: p.rowId, number: p.number, project: p.project }; });
    const existing = picks.findIndex(function (p) { return p.rowId === bestIdx; });

    if (existing >= 0) {
        const removedProject = picks[existing].project;
        picks.splice(existing, 1);
        // renumber only within the affected project, so A's and B's numbers
        // (1..4 each) stay contiguous independently of each other
        let n = 1;
        picks.forEach(function (p) { if (p.project === removedProject) p.number = n++; });
    } else {
        const countInProject = picks.filter(function (p) { return p.project === t4ActiveProject; }).length;
        if (countInProject >= T4_PICK_LIMIT) return;
        picks.push({ rowId: bestIdx, number: countInProject + 1, project: t4ActiveProject });
    }
    pipeline.set("picks", picks);                // T5 and T6 will see this and redraw
}

// "+ Add plot" — spawns another custom scatter panel with its own X/Y dropdowns,
// seeded from session.axisQueue. Capped at T4_MAX_EXTRA_PLOTS extras.
function addScatterPlot() {
    if (t4ExtraPanelCount >= T4_MAX_EXTRA_PLOTS) return;
    t4ExtraPanelCount += 1;
    const n = t4ExtraPanelCount;
    const id = "extra-" + n;

    // Build the new panel's HTML by hand and stitch it into the extras row.
    const panel = document.createElement("div");
    panel.className = "scatter-panel";
    panel.id = "panelT4-extra-" + n;
    panel.innerHTML =
        '<div class="axis-select">' +
        '  <label>X: <select id="t4-extra-' + n + '-x"></select></label>' +
        '  <label>Y: <select id="t4-extra-' + n + '-y"></select></label>' +
        '</div>' +
        '<div class="canvas-stack">' +
        '  <canvas id="canvasT4-extra-' + n + '" width="360" height="240"></canvas>' +
        '  <canvas id="canvasT4-extra-' + n + '-ov" class="t4-overlay" width="360" height="240"></canvas>' +
        '</div>';
    document.getElementById("t4ExtraPlots").appendChild(panel);

    const picked = t4PickAxisForNewPanel();
    const bbox = t4ComputeDefaultBBox(ATTR_BY_KEY[picked.axisX], ATTR_BY_KEY[picked.axisY]);
    if (picked.presetXRange) {
        const [lo, hi] = t4DenormRange(picked.axisX, picked.presetXRange);
        bbox.xMin = lo; bbox.xMax = hi;
    }
    t4Panels[id] = { axisX: picked.axisX, axisY: picked.axisY, userHasZoomed: false, domain: bbox };

    populateAxisSelect(document.getElementById("t4-extra-" + n + "-x"), picked.axisX);
    populateAxisSelect(document.getElementById("t4-extra-" + n + "-y"), picked.axisY);

    // Same wiring as the built-in panels: dropdown change → redraw; drag → zoom; click → pick.
    document.getElementById("t4-extra-" + n + "-x").addEventListener("change", function () { t4OnAxisSelectChanged(id, "axisX", this.value); });
    document.getElementById("t4-extra-" + n + "-y").addEventListener("change", function () { t4OnAxisSelectChanged(id, "axisY", this.value); });
    t4WireCanvas("canvasT4-extra-" + n);

    // Once we've maxed out, gray out the button so nobody can spawn more.
    if (t4ExtraPanelCount >= T4_MAX_EXTRA_PLOTS) {
        document.getElementById("addPlotBtn").disabled = true;
    }
    renderT4Panels();
}

// Fill a <select> with one <option> per attribute. Pass defKey to pre-select
// one; pass null to make it start blank with a "-- Choose axis --" placeholder.
function populateAxisSelect(selectEl, defKey) {
    selectEl.innerHTML = "";
    if (defKey === null) {
        const blank = document.createElement("option");
        blank.value = "__none__";
        blank.textContent = "-- Choose axis --";
        blank.selected = true;
        selectEl.appendChild(blank);
    }
    ATTRIBUTES.forEach(function (attr) {
        const opt = document.createElement("option");
        opt.value = attr.key;
        opt.textContent = attr.label;
        if (attr.key === defKey) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

document.addEventListener("DOMContentLoaded", initT4);
