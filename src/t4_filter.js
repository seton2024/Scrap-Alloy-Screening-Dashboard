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
*   - Panel 2 (custom):  X and Y from dropdowns
*   - Panel 3:           stacked bar showing the scrap mix of each pick
* Plus an "+ Add plot" button that spawns up to 3 more custom scatter panels.
*
* Clicking a dot picks that alloy (max 4). Clicking a picked dot removes it.
* Every pick lands in session.picks, which T5 and T6 automatically react to.
*/

const T4_MAX_EXTRA_PLOTS = 3;   // how many extra panels the "+ Add plot" button can spawn
const T4_PICK_LIMIT = 4;        // no more than 4 alloys picked at once, PER PROJECT
const T4_HIT_RADIUS = 15;       // pixels — how close a click has to be to grab a new point
const T4_PICK_RADIUS = 12;      // pixels — how close a click has to be to remove an existing pick
let t4ExtraPanelCount = 0;      // count of extra panels currently on screen

// which project a NEW click picks into. Existing picks always stay removable
// regardless of this — it only decides where a fresh pick lands.
let t4ActiveProject = "A";

function initT4() {
    // The Loading tab finishes -> switch the placeholder off, wire up the dropdowns,
    // draw the panels for the first time, and start listening for clicks.
    pipeline.onChange("loaded", function () {
        document.getElementById("placeholderT4").hidden = true;
        populateAxisSelect(document.getElementById("t4-2-x"), "TC");
        populateAxisSelect(document.getElementById("t4-2-y"), "YS");
        renderT4Legend();
        renderT4Panels();
        wireT4CanvasClicks();
    });

    // Any of these three changing means the scatters look different — redraw.
    pipeline.onChange("active_set", renderT4Panels);   // T2/T3 brushes narrowed the set
    pipeline.onChange("picks",      renderT4Panels);   // the user picked/unpicked
    pipeline.onChange("projects",   t4OnProjectsChanged); // T1 thresholds moved / B added-removed

    // Button + dropdown listeners
    document.getElementById("addPlotBtn").addEventListener("click", addScatterPlot);
    document.getElementById("t4-2-x").addEventListener("change", renderT4Panels);
    document.getElementById("t4-2-y").addEventListener("change", renderT4Panels);

    document.getElementById("t4ToggleA").addEventListener("click", function () { t4SetActiveProject("A"); });
    document.getElementById("t4ToggleB").addEventListener("click", function () { t4SetActiveProject("B"); });
}

function t4SetActiveProject(proj) {
    t4ActiveProject = proj;
    document.getElementById("t4ToggleA").classList.toggle("active", proj === "A");
    document.getElementById("t4ToggleB").classList.toggle("active", proj === "B");
}

// the toggle only makes sense in dual-project mode; fall back to A if B
// disappears (matches T1's own "removing B clears B's picks" behavior)
function t4OnProjectsChanged() {
    const dual = session.projects.length > 1;
    document.getElementById("t4ProjectToggle").hidden = !dual;
    if (!dual) t4SetActiveProject("A");
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

// Redraw everything: the 3 built-in panels and any extra panels the user added.
function renderT4Panels() {
    if (!session.loaded) return;

    drawScatterPanel(document.getElementById("canvasT4-1"), "YS", "CSC");
    const xKey = document.getElementById("t4-2-x").value;
    const yKey = document.getElementById("t4-2-y").value;
    drawScatterPanel(document.getElementById("canvasT4-2"), xKey, yKey);
    drawStackedBar(document.getElementById("canvasT4-bar"));

    for (let n = 1; n <= t4ExtraPanelCount; n++) {
        const canvas = document.getElementById("canvasT4-extra-" + n);
        const xSel = document.getElementById("t4-extra-" + n + "-x");
        const ySel = document.getElementById("t4-extra-" + n + "-y");
        if (canvas && xSel && ySel) drawScatterPanel(canvas, xSel.value, ySel.value);
    }
}

/* ==================================================================
 * Zoom — rectangle-drag on one panel selects a row subset; every panel
 * (including that one) then refits ITS OWN axes to that subset's bounding
 * box. With no manual zoom active, the default view is the intersection of
 * both projects' feasible ranges (not the full data range) — this doubles
 * as both "first render" and "double-click reset" per the design brief.
 * ================================================================== */
let t4ZoomRowIds = null; // Set of rowIds from the last drag-zoom, or null = default view
let t4ZoomDrag = null;   // { canvas, x0,y0,x1,y1 } while a zoom drag is in progress

// one project's feasible sub-range on one attribute — a threshold is
// one-sided (>= floor for higher-is-better, <= floor for lower-is-better),
// so "feasible" clips only the near edge, the far edge stays the data bound
function t4FeasibleRange(project, attr, dataMin, dataMax) {
    const t = project && project.thresholds[attr.key];
    if (!t || t.effective == null) return [dataMin, dataMax];
    return attr.higherIsBetter ? [t.effective, dataMax] : [dataMin, t.effective];
}

// default (un-zoomed) axis range: intersection of A's and B's feasible
// ranges. Gracefully degrades — single project -> just A's range; no
// projects / no threshold on this attribute -> the full data range.
function t4DefaultRange(attr, nt) {
    const rangeA = t4FeasibleRange(session.projects[0], attr, nt.min, nt.max);
    const rangeB = t4FeasibleRange(session.projects[1], attr, nt.min, nt.max);
    const lo = Math.max(rangeA[0], rangeB[0]), hi = Math.min(rangeA[1], rangeB[1]);
    return (lo < hi) ? [lo, hi] : [nt.min, nt.max]; // empty intersection -> show everything rather than nothing
}

// the range this panel should actually use for one axis right now
function t4AxisRange(attr, nt) {
    if (t4ZoomRowIds) {
        let lo = Infinity, hi = -Infinity;
        const col = session.columns[attr.col];
        t4ZoomRowIds.forEach(function (id) {
            const v = col[id];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        });
        if (lo < hi) return [lo, hi];
    }
    return t4DefaultRange(attr, nt);
}

// Draw one scatter panel: axes, all 324K dots, constraint lines, and pick badges.
function drawScatterPanel(canvas, xKey, yKey) {
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;                    // canvas not visible yet — skip and try again later
    const ctx = hd.ctx, W = hd.W, H = hd.H;

    ctx.clearRect(0, 0, W, H);          // wipe the canvas before every redraw

    // If the user hasn't picked X or Y yet (new blank panel), show a friendly note
    // instead of a broken chart. Setting _t4geom = null makes clicks a no-op here.
    if (!xKey || !yKey || xKey === "__none__" || yKey === "__none__") {
        ctx.fillStyle = "#888"; ctx.font = "11px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("Choose X and Y attributes", W / 2, H / 2);
        canvas._t4geom = null;
        return;
    }

    const attrX = ATTR_BY_KEY[xKey], attrY = ATTR_BY_KEY[yKey];
    if (!attrX || !attrY) return;
    const ntX = session.norm_table[attrX.col], ntY = session.norm_table[attrY.col];
    if (!ntX || !ntY) return;

    // Room for axis labels: left/right/top/bottom margins.
    const mL = 40, mR = 10, mT = 10, mB = 26;
    const plotW = W - mL - mR, plotH = H - mT - mB;

    // Axis frame (just an L-shape).
    ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + plotH); ctx.lineTo(mL + plotW, mT + plotH);
    ctx.stroke();

    // Axis labels — Y is rotated 90° so it reads sideways.
    ctx.fillStyle = "#333"; ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(attrX.key, mL + plotW / 2, mT + plotH + 18);
    ctx.save();
    ctx.translate(mL - 28, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(attrY.key, 0, 0);
    ctx.restore();

    // Axis range: either the shared zoom row-subset's bbox on THIS panel's
    // own attributes, or (by default) the intersection of both projects'
    // feasible ranges — see t4AxisRange.
    const [xLo, xHi] = t4AxisRange(attrX, ntX);
    const [yLo, yHi] = t4AxisRange(attrY, ntY);

    // Turn a raw data value into a pixel position (and remember it for click hits).
    function xToPx(v) { return mL + ((v - xLo) / (xHi - xLo)) * plotW; }
    function yToPx(v) { return mT + plotH - ((v - yLo) / (yHi - yLo)) * plotH; }

    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const labels = session.family_labels;
    const active = session.active_set;   // null if no brush is active
    const n = session.rowCount;

    // Points scale up as the view zooms in (TA), based on how much smaller
    // the current range is than the full data range. Capped so it can't
    // balloon into overlapping blobs at extreme zoom.
    const zoomFactor = Math.sqrt(((ntX.max - ntX.min) / (xHi - xLo)) * ((ntY.max - ntY.min) / (yHi - yLo)));
    const dotR = Math.max(1, Math.min(4, zoomFactor));

    // Clip so points outside the current (possibly zoomed-in) range don't
    // bleed into the axis-label margins.
    ctx.save();
    ctx.beginPath();
    ctx.rect(mL, mT, plotW, plotH);
    ctx.clip();

    // Draw every alloy as a small dot. Points inside the current brush are
    // brighter, points outside are almost invisible.
    for (let i = 0; i < n; i++) {
        const alive = !active || active.has(i);
        ctx.globalAlpha = alive ? 0.35 : 0.05;
        ctx.fillStyle = FAMILY_COLORS[labels[i]];
        ctx.fillRect(xToPx(colX[i]) - dotR, yToPx(colY[i]) - dotR, dotR * 2, dotR * 2);
    }
    // restore() reverts globalAlpha to whatever it was AT save() time (not
    // necessarily 1) — the reset must happen AFTER restore, not before it,
    // or everything drawn next (badges, lines) inherits a stale dimmed alpha
    ctx.restore();
    ctx.globalAlpha = 1;

    // Threshold lines from T1, one per axis. Projects with the IDENTICAL
    // effective value on an axis merge into one neutral "A+B" line instead of
    // two overlapping ones (FIX S1 — merge on exact match, not pixel
    // proximity); otherwise each project gets its own color (A=amber,
    // B=blue) so it's clear which line belongs to which client.
    t4DrawConstraintLine(ctx, attrX.key, true,  xToPx, mL, mT, plotW, plotH);
    t4DrawConstraintLine(ctx, attrY.key, false, yToPx, mL, mT, plotW, plotH);

    // Badges over each picked alloy: "A1"-"A4" / "B1"-"B4", always black —
    // the letter+number already says which project, no need for a second
    // (color) channel here. Drawn last so they always sit on top of the dot cloud.
    session.picks.forEach(function (pick) {
        const px = xToPx(colX[pick.rowId]), py = yToPx(colY[pick.rowId]);
        const isB = pick.project === "B";
        ctx.fillStyle = "#222";
        ctx.beginPath(); ctx.arc(px, py, 9, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 9px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText((isB ? "B" : "A") + pick.number, px, py);
    });

    // Live rectangle preview while dragging a zoom selection on THIS canvas.
    if (t4ZoomDrag && t4ZoomDrag.canvas === canvas) {
        const x = Math.min(t4ZoomDrag.x0, t4ZoomDrag.x1), y = Math.min(t4ZoomDrag.y0, t4ZoomDrag.y1);
        const w = Math.abs(t4ZoomDrag.x1 - t4ZoomDrag.x0), h = Math.abs(t4ZoomDrag.y1 - t4ZoomDrag.y0);
        ctx.fillStyle = "rgba(0,0,0,0.10)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }

    // Save everything the click/zoom handlers need to translate cursor <-> data.
    canvas._t4geom = { mL, mT, plotW, plotH, xToPx, yToPx, colX, colY };
}

// One axis's constraint line(s). Projects that share the exact same
// effective value on this axis merge into a single neutral "A+B" line;
// otherwise each gets its own colored line + tiny label at the line's end.
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
        const color = merged ? "#555" : (idxs[0] === 1 ? "#0072B2" : "#E69F00");
        const label = merged ? "A+B" : (idxs[0] === 1 ? "B" : "A");
        const pos = toPx(Number(rawVal));

        // the current view may be zoomed to a range that no longer includes
        // this threshold — skip it instead of drawing outside the plot box
        const inRange = isVertical ? (pos >= mL && pos <= mL + plotW) : (pos >= mT && pos <= mT + plotH);
        if (!inRange) return;

        ctx.strokeStyle = color; ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (isVertical) { ctx.moveTo(pos, mT); ctx.lineTo(pos, mT + plotH); }
        else { ctx.moveTo(mL, pos); ctx.lineTo(mL + plotW, pos); }
        ctx.stroke();

        ctx.fillStyle = color;
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

// Panel 3: one vertical bar per pick, split into 6 textured segments showing
// what fraction of the recipe each scrap family contributes.
function drawStackedBar(canvas) {
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);
    if (!t4Patterns) t4Patterns = t4BuildPatterns(ctx);

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
        SCRAP_FAMILIES.forEach(function (scrap, fi) {
            const pct = row[scrap.col] || 0;       // this scrap's % in the recipe
            const h = (pct / 100) * barH;          // convert % to pixel height
            ctx.fillStyle = t4Patterns[fi];
            ctx.fillRect(x, yCursor, barW, h);
            ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
            ctx.strokeRect(x, yCursor, barW, h);

            // % label — only when the segment is tall enough to actually fit one
            if (h > 12) {
                ctx.fillStyle = "#fff";
                ctx.font = "9px Inter, sans-serif";
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(Math.round(pct) + "%", x + barW / 2, yCursor + h / 2);
            }
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

// Attach mouse handlers to the two built-in scatter canvases. Extra panels
// wire their own in addScatterPlot(). mousedown/move/up (not "click") so a
// real drag can zoom while a plain click still picks.
function wireT4CanvasClicks() {
    ["canvasT4-1", "canvasT4-2"].forEach(t4WireCanvas);
    window.addEventListener("mouseup", t4OnCanvasMouseUp);
}

function t4WireCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.addEventListener("mousedown", t4OnCanvasMouseDown);
    c.addEventListener("mousemove", t4OnCanvasMouseMove);
    c.addEventListener("dblclick", t4OnCanvasDblClick);
}

function t4CanvasPos(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    return [evt.clientX - rect.left, evt.clientY - rect.top];
}

function t4OnCanvasMouseDown(evt) {
    const [x, y] = t4CanvasPos(evt);
    t4ZoomDrag = { canvas: evt.currentTarget, x0: x, y0: y, x1: x, y1: y };
}

function t4OnCanvasMouseMove(evt) {
    if (!t4ZoomDrag || t4ZoomDrag.canvas !== evt.currentTarget) return;
    const [x, y] = t4CanvasPos(evt);
    t4ZoomDrag.x1 = x; t4ZoomDrag.y1 = y;
    // FIX P1-style: only redraw the ONE panel being dragged (for the live
    // rectangle preview) — redrawing every panel's 324k points on every
    // mousemove would be laggy. The other panels only refit once, on mouseup.
    t4RedrawSinglePanel(evt.currentTarget);
}

// redraws just one scatter canvas, looking up its X/Y attributes the same
// way renderT4Panels() does for each of the 3 panel "shapes"
function t4RedrawSinglePanel(canvas) {
    if (canvas.id === "canvasT4-1") { drawScatterPanel(canvas, "YS", "CSC"); return; }
    if (canvas.id === "canvasT4-2") {
        drawScatterPanel(canvas, document.getElementById("t4-2-x").value, document.getElementById("t4-2-y").value);
        return;
    }
    const m = canvas.id.match(/^canvasT4-extra-(\d+)$/);
    if (m) {
        const xSel = document.getElementById("t4-extra-" + m[1] + "-x");
        const ySel = document.getElementById("t4-extra-" + m[1] + "-y");
        if (xSel && ySel) drawScatterPanel(canvas, xSel.value, ySel.value);
    }
}

// double-click resets the shared zoom subset -> every panel falls back to
// its default (intersection-zone) range
function t4OnCanvasDblClick() {
    t4ZoomRowIds = null;
    renderT4Panels();
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
        // too small to be a real drag — treat it as a plain click-to-pick instead
        if (g) t4HandlePickClick(g, drag.x0, drag.y0);
        renderT4Panels();
        return;
    }

    // rows whose (x,y) on THIS panel's axes fall inside the dragged
    // rectangle become the new shared zoom subset for every panel
    const rowIds = new Set();
    const active = session.active_set;
    for (let i = 0; i < session.rowCount; i++) {
        if (active && !active.has(i)) continue;
        const px = g.xToPx(g.colX[i]), py = g.yToPx(g.colY[i]);
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) rowIds.add(i);
    }
    if (rowIds.size > 0) t4ZoomRowIds = rowIds;
    renderT4Panels();
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

    // Step 2: no badge nearby → look for the closest unpicked point within HIT_RADIUS.
    if (bestIdx < 0) {
        let bestDist = T4_HIT_RADIUS * T4_HIT_RADIUS;
        const active = session.active_set;
        for (let i = 0; i < session.rowCount; i++) {
            if (active && !active.has(i)) continue;   // skip anything filtered out by brushes
            const dx = g.xToPx(g.colX[i]) - px, dy = g.yToPx(g.colY[i]) - py;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
    }
    if (bestIdx < 0) return;                     // clicked empty space — do nothing

    // Step 3: toggle. Remove if already picked (whichever project it's in —
    // an existing badge is always removable regardless of the active
    // toggle); otherwise add it to whichever project is currently active.
    // FIX M1: .slice() only copies the ARRAY — the pick objects inside were
    // still the same live references as session.picks, so renumbering below
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

// "+ Add plot" — spawns another custom scatter panel with its own X/Y dropdowns.
// Capped at T4_MAX_EXTRA_PLOTS extras (so a max of 5 panels total).
function addScatterPlot() {
    if (t4ExtraPanelCount >= T4_MAX_EXTRA_PLOTS) return;
    t4ExtraPanelCount += 1;
    const n = t4ExtraPanelCount;

    // Build the new panel's HTML by hand and stitch it into the extras row.
    const panel = document.createElement("div");
    panel.className = "scatter-panel";
    panel.id = "panelT4-extra-" + n;
    panel.innerHTML =
        '<div class="axis-select">' +
        '  <label>X: <select id="t4-extra-' + n + '-x"></select></label>' +
        '  <label>Y: <select id="t4-extra-' + n + '-y"></select></label>' +
        '</div>' +
        '<canvas id="canvasT4-extra-' + n + '" width="360" height="240"></canvas>';
    document.getElementById("t4ExtraPlots").appendChild(panel);

    // New panels start with blank dropdowns so the user has to pick attributes
    // deliberately — nothing is auto-copied from the other panels.
    populateAxisSelect(document.getElementById("t4-extra-" + n + "-x"), null);
    populateAxisSelect(document.getElementById("t4-extra-" + n + "-y"), null);

    // Same wiring as the built-in panels: dropdown change → redraw; drag → zoom; click → pick.
    document.getElementById("t4-extra-" + n + "-x").addEventListener("change", renderT4Panels);
    document.getElementById("t4-extra-" + n + "-y").addEventListener("change", renderT4Panels);
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