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
const T4_PICK_LIMIT = 4;        // no more than 4 alloys picked at once (report §T4)
const T4_HIT_RADIUS = 15;       // pixels — how close a click has to be to grab a new point
const T4_PICK_RADIUS = 12;      // pixels — how close a click has to be to remove an existing pick
let t4ExtraPanelCount = 0;      // count of extra panels currently on screen

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
    pipeline.onChange("projects",   renderT4Panels);   // T1 thresholds moved

    // Button + dropdown listeners
    document.getElementById("addPlotBtn").addEventListener("click", addScatterPlot);
    document.getElementById("t4-2-x").addEventListener("change", renderT4Panels);
    document.getElementById("t4-2-y").addEventListener("change", renderT4Panels);
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

    // Turn a raw data value into a pixel position (and remember it for click hits).
    function xToPx(v) { return mL + ((v - ntX.min) / (ntX.max - ntX.min)) * plotW; }
    function yToPx(v) { return mT + plotH - ((v - ntY.min) / (ntY.max - ntY.min)) * plotH; }

    const colX = session.columns[attrX.col], colY = session.columns[attrY.col];
    const labels = session.family_labels;
    const active = session.active_set;   // null if no brush is active
    const n = session.rowCount;

    // Draw every alloy as a small 2×2 dot. Points inside the current brush are
    // brighter, points outside are almost invisible. 2×2 is deliberate — 1×1
    // pixels are too small to spot or click.
    for (let i = 0; i < n; i++) {
        const alive = !active || active.has(i);
        ctx.globalAlpha = alive ? 0.35 : 0.05;
        ctx.fillStyle = FAMILY_COLORS[labels[i]];
        ctx.fillRect(xToPx(colX[i]) - 1, yToPx(colY[i]) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    // Threshold lines from T1: one vertical line at effective X threshold and
    // one horizontal line at effective Y threshold, per active project.
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

    // Numbered black badges over each picked alloy. Drawn last so they always sit
    // on top of the dot cloud.
    session.picks.forEach(function (pick) {
        const px = xToPx(colX[pick.rowId]), py = yToPx(colY[pick.rowId]);
        ctx.fillStyle = "#222";
        ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(pick.number, px, py);
    });

    // Save everything the click handler needs to translate cursor → data.
    canvas._t4geom = { mL, mT, plotW, plotH, xToPx, yToPx, colX, colY };
}

// Panel 3: one vertical bar per pick, split into 6 colored segments showing
// what fraction of the recipe each scrap family contributes.
function drawStackedBar(canvas) {
    const hd = setupHiDPICanvas(canvas);
    if (!hd) return;
    const ctx = hd.ctx, W = hd.W, H = hd.H;
    ctx.clearRect(0, 0, W, H);

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
            ctx.fillStyle = FAMILY_COLORS[fi];
            ctx.fillRect(x, yCursor, barW, h);
            yCursor += h;
        });
        // Alloy number under the bar so you can tell them apart.
        ctx.fillStyle = "#333"; ctx.font = "bold 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("#" + pick.number, x + barW / 2, H - 10);
    });
}

// Attach the click listener to the two built-in scatter canvases. Extra panels
// wire their own click listeners in addScatterPlot().
function wireT4CanvasClicks() {
    ["canvasT4-1", "canvasT4-2"].forEach(function (id) {
        const c = document.getElementById(id);
        if (c) c.addEventListener("click", t4OnCanvasClick);
    });
}

// One click on any scatter panel: figure out what the user was pointing at,
// then either remove that pick (if it's already picked) or add it as a new one.
function t4OnCanvasClick(evt) {
    const canvas = evt.currentTarget;
    const g = canvas._t4geom;
    if (!g) return;                              // panel isn't showing a chart yet

    // Cursor position in canvas pixels.
    const rect = canvas.getBoundingClientRect();
    const px = evt.clientX - rect.left, py = evt.clientY - rect.top;

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

    // Step 3: toggle. Remove if already picked, add if there's room, otherwise ignore.
    const picks = session.picks.slice();         // copy so we don't mutate session directly
    const existing = picks.findIndex(function (p) { return p.rowId === bestIdx; });
    if (existing >= 0) {
        picks.splice(existing, 1);
        picks.forEach(function (p, i) { p.number = i + 1; });   // keep numbers 1,2,3 contiguous
    } else {
        if (picks.length >= T4_PICK_LIMIT) return;
        picks.push({ rowId: bestIdx, number: picks.length + 1, project: "A" });
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

    // Same wiring as the built-in panels: dropdown change → redraw; click → pick.
    document.getElementById("t4-extra-" + n + "-x").addEventListener("change", renderT4Panels);
    document.getElementById("t4-extra-" + n + "-y").addEventListener("change", renderT4Panels);
    document.getElementById("canvasT4-extra-" + n).addEventListener("click", t4OnCanvasClick);

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