/*
* t1_modal.js — T1 Project Setup
*
* T1 is the sole writer to session.projects (pipeline.js). Interaction
* sequence: "+ Add Project" opens the modal -> Apply computes effective
* thresholds and collapses the modal into a header chip -> clicking the
* chip reopens the modal pre-filled. Max 2 concurrent projects.
*
* All 14 attributes appear in the constraint table, but the 7 secondary-tier
* rows stay hidden until "See more" is clicked. Every threshold is OPTIONAL:
* leave a floor blank and that property simply doesn't constrain anything.
* ATTRIBUTES / PRIMARY_ATTRS / SECONDARY_ATTRS come from pipeline.js.
*/

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
        '<input type="text" class="proj-name" value="' + (project.name || "") + '">' +
        '<label>Batch size (kg)</label>' +
        '<input type="number" class="proj-batch" min="1" step="1" value="' + (project.batch_kg || 1000) + '">' +
        buildConstraintTableHtml(project);

    return wrap;
}

// one <tr> per attribute; secondary-tier rows get an extra class so CSS can
// hide them until "See more" toggles .show-secondary on the container.
function attrRowHtml(attr, project) {
    const t = project.thresholds[attr.key] || { floor: null, margin: attr.defaultMargin };
    const rowClasses =
        (attr.mostUsed ? "most-used " : "") +
        (attr.tier === "secondary" ? "secondary-attr" : "");
    return (
        '<tr class="' + rowClasses.trim() + '" data-attr="' + attr.key + '">' +
        "<td>" + attr.label + "</td>" +
        '<td><input type="number" class="floor-input" value="' + (t.floor != null ? t.floor : "") + '"></td>' +
        '<td><input type="number" class="margin-input" min="0" max="100" value="' + t.margin + '"></td>' +
        "</tr>"
    );
}

function buildConstraintTableHtml(project) {
    let rows = "";
    ATTRIBUTES.forEach(function (attr) { rows += attrRowHtml(attr, project); });
    return (
        '<table class="constraint-table">' +
        "<thead><tr><th>Property</th><th>Floor</th><th>Margin %</th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
        "</table>"
    );
}

// "See more" / "See less" toggle: flips a class on the form container (no
// re-render, so nothing typed is lost). CSS handles hiding/showing the
// secondary rows based on that class.
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

function readFormsFromDom() {
    const forms = document.querySelectorAll("#projectFormArea .project-form");
    return Array.prototype.map.call(forms, formElToProject);
}

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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// strict integer check: parseInt(batchInput.value, 10) would silently
// truncate "1000.5" into a valid 1000, letting a non-integer batch size
// through. Validation requires the raw string to be a whole number.
function isPositiveIntegerString(value) {
    return /^\d+$/.test(String(value).trim()) && parseInt(value, 10) >= 1;
}

// effective threshold (report §4.1.1):
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
        const batchValid = isPositiveIntegerString(batchInput.value);
        nameInput.classList.toggle("invalid", !nameValid);
        batchInput.classList.toggle("invalid", !batchValid);
        if (!nameValid || !batchValid) valid = false;

        const project = formElToProject(formEl);

        // Thresholds are OPTIONAL. A blank floor is perfectly fine — that
        // property just doesn't constrain anything. We only compute an
        // effective threshold when a floor was actually entered, and we only
        // flag a floor as invalid if a value WAS typed but isn't positive.
        ATTRIBUTES.forEach(function (attr) {
            const t = project.thresholds[attr.key];
            const floorInput = formEl.querySelector('.constraint-table tr[data-attr="' + attr.key + '"] .floor-input');
            if (t.floor === null) {
                floorInput.classList.remove("invalid"); // blank = allowed
                return;
            }
            const floorValid = t.floor > 0;
            floorInput.classList.toggle("invalid", !floorValid);
            if (!floorValid) { valid = false; return; }
            t.effective = computeEffective(t.floor, t.margin, attr.higherIsBetter);
        });

        projects.push(project);
    });

    if (!valid) return;

    // Re-apply behavior (report §4.1.6): effective thresholds are always
    // recomputed above. T2/T3 brushes and T4 picks are untouched here, so
    // they persist across re-apply automatically. The one exception: if
    // Project B is being removed, only Project B's picks are cleared.
    const hadProjectB = session.projects.length > 1;
    const hasProjectB = projects.length > 1;
    if (hadProjectB && !hasProjectB) {
        pipeline.set("picks", session.picks.filter(function (pick) { return pick.project !== "B"; }));
    }

    pipeline.set("projects", projects);
    renderProjectChips(projects);
    closeProjectModal();
}

function renderProjectChips(projects) {
    const container = document.getElementById("projectChips");
    container.innerHTML = "";
    projects.forEach(function (project, idx) {
        const chip = document.createElement("div");
        chip.className = "project-chip" + (idx === 1 ? " project-b" : "");
        // title = full name as a native tooltip, since the visible name is
        // truncated with an ellipsis once the chip hits its max width
        chip.title = project.name;
        chip.innerHTML =
            '<span class="chip-swatch"></span>' +
            '<span class="chip-name">' + project.name + "</span>";
        chip.onclick = openProjectModal;
        container.appendChild(chip);
    });
}
