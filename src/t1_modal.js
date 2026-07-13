// t1_modal.js — T1 Project Setup
//
// T1 - sole writer to session.projects (pipeline.js).
// Interaction sequence: "+ Add Project" opens the modal
//      -> Apply computes effective thresholds and collapses the modal into a header chip
//      -> clicking the chip reopens the modal pre-filled. Max 2 concurrent projects.


// modal state: true if 2 projects are active, false if 1 project
let t1DualActive = false;

function openProjectModal() {
    // are we creating a fresh project, or reopening existing ones to edit?
    if (session.projects.length === 0) {
        renderProjectForms([blankProject("Project A")]);
    } else {
        renderProjectForms(session.projects);
    }
    document.getElementById("projectModalOverlay").hidden = false;
}

function closeProjectModal() {
    document.getElementById("projectModalOverlay").hidden = true;
}

function blankProject(name) {
    const thresholds = {};
    ATTRIBUTES.forEach(function (attr) {
        thresholds[attr.key] = { floor: null, margin: attr.defaultMargin, effective: null };
    });
    return { name: name, batch_kg: 1000, thresholds: thresholds };
}

function renderProjectForms(projects) {
    t1DualActive = projects.length > 1;
    const area = document.getElementById("projectFormArea");
    area.className = "project-forms" + (t1DualActive ? " dual" : "");
    // preserve the secondary-tier reveal state across re-renders
    if (t1SecondaryShown) area.classList.add("show-secondary");
    area.innerHTML = "";
    projects.forEach(function (project, idx) {
        area.appendChild(buildProjectFormEl(project, idx === 0 ? "A" : "B"));
    });
    document.getElementById("addProjectBBtn").hidden = t1DualActive;
    document.getElementById("removeProjectBBtn").hidden = !t1DualActive;
}

function buildProjectFormEl(project, slot) {
    const wrap = document.createElement("div");
    wrap.className = "project-form";
    wrap.dataset.slot = slot;

    wrap.innerHTML =
        '<label>Project ' + slot + ' name</label>' +
        '<input type="text" class="proj-name" value="' + escapeHtml(project.name || "") + '">' +
        '<label>Batch size (tonnes)</label>' +
        '<input type="number" class="proj-batch" min="1" step="1" value="' + (project.batch_kg || 1000) + '">' +
        buildConstraintTableHtml(project);

    return wrap;
}

// one <tr> per attribute;
// secondary-tier CSS calss to hide them 4 "See more".
// title on  <tr> so tooltip show in the wholw row
//  A hidden error line sits under
//
// The floor field is type="text": 
// so to get percictent brouser independent values
function attrRowHtml(attr, project) {
    const t = project.thresholds[attr.key] || { floor: null, margin: attr.defaultMargin };
    const rowClasses =
        (attr.mostUsed ? "most-used " : "") +
        (attr.tier === "secondary" ? "secondary-attr" : "");
    const nt = session.norm_table[attr.col];
    const rangeTitle = nt
        ? "Dataset range: " + formatRangeValue(nt.min) + "–" + formatRangeValue(nt.max)
        : "";
    const rangeHint = nt ? "Range: " + fmtVal(nt.min) + " – " + fmtVal(nt.max) : "";
    return (
        '<tr class="' + rowClasses.trim() + '" data-attr="' + attr.key + '" title="' + escapeHtml(rangeTitle) + '">' +
        "<td>" + escapeHtml(attr.label) + "</td>" +
        "<td>" +
        '<input type="text" inputmode="decimal" class="floor-input" ' +
        'value="' + (t.floor != null ? t.floor : "") + '" onblur="t1FormatFloorOnBlur(this)">' +
        '<div class="field-hint">' + escapeHtml(rangeHint) + '</div>' +
        '<div class="field-error" hidden></div>' +
        "</td>" +
        '<td><input type="number" step="any" class="margin-input" min="0" max="100" value="' + t.margin + '"></td>' +
        "</tr>"
    );
}

function buildConstraintTableHtml(project) {
    let rows = "";
    ATTRIBUTES.forEach(function (attr) { rows += attrRowHtml(attr, project); });
    return (
        '<table class="constraint-table">' +
        "<thead><tr><th>Property</th><th>Threshold</th><th>Margin %</th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
        "</table>"
    );
}

// "See more" / "See less" toggle: flips a class on the form container
// (no re-render, so nothing typed is lost).
// CSS handles hiding/showing the secondary rows based on that class.
let t1SecondaryShown = false;

function toggleT1Secondary() {
    t1SecondaryShown = !t1SecondaryShown;
    document.getElementById("projectFormArea").classList.toggle("show-secondary", t1SecondaryShown);
    document.getElementById("t1SeeMoreBtn").textContent =
        t1SecondaryShown ? "See less" : "See more (7 secondary properties)";
}

function addProjectB() {
    const formsNow = readFormsFromDom();
    formsNow.push(blankProject("Project B"));
    renderProjectForms(formsNow);
}

function removeProjectB() {
    const formsNow = readFormsFromDom();
    renderProjectForms([formsNow[0]]);
}

// read the current state of the forms in the DOM and return an array of project objects
function readFormsFromDom() {
    const forms = document.querySelectorAll("#projectFormArea .project-form");
    return Array.prototype.map.call(forms, formElToProject);
}

// convert a single form DOM element into a project object
function formElToProject(formEl) {
    const thresholds = {};
    formEl.querySelectorAll(".constraint-table tr").forEach(function (row) {
        const attrKey = row.dataset.attr;
        if (!attrKey) return;
        const floorInput = row.querySelector(".floor-input");
        const marginInput = row.querySelector(".margin-input");
        thresholds[attrKey] = {
            floor: floorInput.value === "" ? null : parseFloat(floorInput.value),
            margin: clamp(parseFloat(marginInput.value) || 0, 0, 100),
            effective: null
        };
    });

    return {
        name: formEl.querySelector(".proj-name").value.trim(),
        batch_kg: parseInt(formEl.querySelector(".proj-batch").value, 10),
        thresholds: thresholds
    };
}

// clamp a number to a min/max range for margin input
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// strict integer check without truncation for batch size, kg
function isPositiveIntegerString(value) {
    return /^\d+$/.test(String(value).trim()) && parseInt(value, 10) >= 1;
}

// strict decimal check for threshold input (used in batch size)
function isValidDecimalFormat(value) {
    return /^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(value).trim());
}

function t1FormatFloorOnBlur(input) {
    const raw = input.value.trim();
    if (!isValidDecimalFormat(raw)) return;
    const v = parseFloat(raw);
    const abs = Math.abs(v);
    if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) {
        input.value = v.toExponential(2); // visual confirmation it parsed as sci notation
    }
}

// effective threshold
//   higher-is-better: floor * (1 + margin / 100)
//   lower-is-better:  floor * (1 - margin / 100)
function computeEffective(floor, margin, higherIsBetter) {
    return higherIsBetter ? floor * (1 + margin / 100) : floor * (1 - margin / 100);
}

function applyProjects() {
    const forms = document.querySelectorAll("#projectFormArea .project-form");
    let valid = true;
    const projects = [];

    forms.forEach(function (formEl) {
        const nameInput = formEl.querySelector(".proj-name");
        const batchInput = formEl.querySelector(".proj-batch");

        const nameValid = nameInput.value.trim() !== "";
        nameInput.classList.toggle("invalid", !nameValid);
        if (!nameValid) valid = false;

        // format check first: a batch value the browser couldn't parse at all
        // (e.g. a locale-mismatched decimal) reads as badInput, distinct from
        // a value it parsed but rejected as non-integer/<=0.
        const batchValid = !batchInput.validity.badInput && isPositiveIntegerString(batchInput.value);
        batchInput.classList.toggle("invalid", !batchValid);
        if (!batchValid) valid = false;

        const project = formElToProject(formEl);

        // Thresholds are OPTIONAL
        //      Only flag a floor as invalid if a value WAS typed but isn't usable.
        //      Validation reads floorInput.value directly (the raw typed string), to catch every malformed case before any number math happens
        ATTRIBUTES.forEach(function (attr) {
            const t = project.thresholds[attr.key];
            const row = formEl.querySelector('.constraint-table tr[data-attr="' + attr.key + '"]');
            const floorInput = row.querySelector(".floor-input");
            const errorEl = row.querySelector(".field-error");
            const raw = floorInput.value.trim();

            function fail(message) {
                floorInput.classList.add("invalid");
                errorEl.hidden = false;
                errorEl.textContent = message;
                valid = false;
            }

            if (raw === "") {
                floorInput.classList.remove("invalid");
                errorEl.hidden = true;
                t.floor = null;
                return; // blank = allowed, no threshold for this property
            }

            if (!isValidDecimalFormat(raw)) {
                fail('"' + raw + '" is not a valid number — use digits and a period, e.g. 0.6 or 2.3e-5 (not a comma or letters)');
                return;
            }

            const floorVal = parseFloat(raw);
            if (floorVal <= 0) {
                fail("Value must be a positive number");
                return;
            }

            const nt = session.norm_table[attr.col];
            if (nt && (floorVal < nt.min || floorVal > nt.max)) {
                fail("Choose " + attr.label + " inside " + formatRangeValue(nt.min) + "–" + formatRangeValue(nt.max) + " values");
                return;
            }

            floorInput.classList.remove("invalid");
            errorEl.hidden = true;
            t.floor = floorVal;
            t.effective = computeEffective(floorVal, t.margin, attr.higherIsBetter);
        });

        projects.push(project);
    });

    if (!valid) return;

    // Re-apply behavior:
    //      effective thresholds are always recomputed above.
    //      T2/T3 brushes and T4 picks are untouched here,
    //      if Project B is being removed, Project B's picks are cleared.
    const hadProjectB = session.projects.length > 1;
    const hasProjectB = projects.length > 1;

    // "projects" fires BEFORE "picks" — views that key off dual/single mode
    // (T5's Spider B visibility, stock_alerts) already see the correct
    // project count by the time any resulting "picks" trim lands, instead of
    // rendering one transient frame against the stale project count.
    updateAxisQueueFromProjects(projects);
    pipeline.set("projects", projects);
    if (hadProjectB && !hasProjectB) {
        pipeline.set("picks", session.picks.filter(function (pick) { return pick.project !== "B"; }));
    }

    renderProjectChips(projects);
    closeProjectModal();
}

// for every axis with an active constraint (in constraint-table row order),
// push or update a { axis, source: 'T1', brushRange: null } axisQueue entry.
// T4 listens for "projects" and recomputes each panel's feasible bbox from
// this (skipping panels the user has manually zoomed).
function updateAxisQueueFromProjects(projects) {
    ATTRIBUTES.forEach(function (attr) {
        const active = projects.some(function (p) {
            const t = p.thresholds[attr.key];
            return t && t.effective != null;
        });
        if (active) pipeline.axisQueueUpsert(attr.key, "T1", null);
    });
}


function renderProjectChips(projects) {
    const container = document.getElementById("projectChips");
    container.innerHTML = "";
    projects.forEach(function (project, idx) {
        const chip = document.createElement("div");
        chip.className = "project-chip" + (idx === 1 ? " project-b" : "");
        chip.title = project.name;
        chip.innerHTML =
            '<span class="chip-swatch"></span>' +
            '<span class="chip-name">' + escapeHtml(project.name) + "</span>";
        chip.onclick = openProjectModal;
        container.appendChild(chip);
    });
}
