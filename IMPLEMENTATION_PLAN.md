# Implementation Plan — Scrap Alloy Screening Dashboard

**Status:** authoritative plan for all remaining program-level work.
**Sources:** `tasks.md` (open items + inline divergence notes), `docs/nested_model_L1_L2_L3_L4_report.md` (Level 4 algorithms), `docs/pipeline_contract.md`, graphify code graph (2026-07-07), current `src/` state, **`CODE_REVIEW.md` (2026-07-07 — fix IDs R1–R5, S1–S5, P1–P5, M1–M6 referenced throughout; see traceability table at the end)**.
**How to use:** every future implementation chat picks the lowest-numbered phase with open items, works only inside that phase's file list, and satisfies its acceptance checks before moving on. Phases are dependency-ordered — do not skip ahead (Munzner's cascade rule applies at code level too: a wrong contract invalidates every view built on it).

---

## 0. Engineering Invariants (apply to every phase)

These are the bug-prevention and performance rules. Any PR violating one is wrong by definition.

**I1 — Single writer per session key.** `t1_modal.js` writes `projects` only; the loading worker writes dataset fields + `loaded` only; T2 writes `brush_t2`; T3 writes `brush_t3`; T4 writes `picks_a`/`picks_b`; T5 writes `stock_alerts`; `datavis.js` alone derives `active_set` and `feasible_mask`. Views never call each other — the only communication path is *write → `pipeline.onChange` → re-render*.

**I2 — Zero heavy computation in the browser.** No KDE, no normalisation-table scan, no labels argmax, no spatial-index build at runtime. The browser fetches artifacts produced by `data/precompute.py`. If a view needs a statistic that doesn't exist as an artifact, extend `precompute.py`, don't compute it in JS. (Rationale: 324,632 rows; Heinzl responsiveness thresholds — filter/brush responses < 1 s, hover ≤ 0.1 s.)

**I3 — Typed arrays, column-store.** `session.columns[colName]` is `Float64Array` (or `Float32Array` where precision allows), `family_labels` is `Uint8Array`, `umap` is `Float32Array`. Never materialise 324k row objects; reconstruct a row on demand only for tooltips/T6 (O(cols)).

**I4 — O(n) work happens at most once per T1 Apply.** The only full-dataset pass at runtime is recomputing `session.feasible_mask` (Uint8Array, bit per project) when thresholds change. Everything in mousemove/drag handlers must be O(log n) or O(k): spatial-grid lookups, mask reads, set membership. Never filter 324k rows inside a render loop.

**I5 — One render path per view.** Each view exposes exactly one `renderTX()` that redraws from session state. Interaction handlers mutate state and request a render via `requestAnimationFrame` with a dirty flag (coalesces bursts; keeps brushing ≤ 1 frame behind the mouse). No partial ad-hoc canvas draws outside `renderTX()`.

**I6 — Single source of truth for attribute metadata.** `ATTRIBUTES` in `datavis.js` (key, exact column name, direction, tier, format) is the only definition; graphify confirms it is already the bridge node between T1/T4/T5/loading — keep it that way. `precompute.py` must mirror it exactly (degree-sign columns via `chr(0xB0)`); add a checksum: precompute writes the attribute list into `manifest.json`, loader asserts equality at startup and hard-fails with a visible error if they diverge.

**I7 — Direction handling in exactly one place.** `LOWER_IS_BETTER` lives in `datavis.js`; every normalisation, inversion, effective-threshold, feasibility, best-value and spider computation imports it. Duplicated direction tables are the single most likely source of silent correctness bugs in this project.

**I8 — Guard the loading race.** Every `renderTX()` starts with `if (!session.loaded) return;`. T1 modal is the sole component usable before `loaded`.

**I9 — Canvas correctness.** All canvases: handle `devicePixelRatio` (backing store scaled, context scaled once); hit-testing done in the same coordinate space as drawing; `ctx.save()/restore()` around any alpha/dash/pattern change (leaked `setLineDash` is a classic spider/violin bug).

**I10 — Deterministic artifacts.** All Python outputs use fixed seeds (`random_state=42`) and are committed with a `manifest.json` (file name, row count, sha256, generation date, precompute git hash). The loader validates row counts against the manifest before writing to session.

---

## 1. Architecture Snapshot

```
data/precompute.py  ──(offline, once)──►  artifacts: umap_coords.npy, family_labels.npy,
                                          blob_contours.json, norm_table.json,
                                          kde_curves.json, spatial_grid.json, manifest.json
                                              │
src/parse_worker.js (Web Worker: FETCH ONLY, 9 steps)
                                              │ postMessage(step done / loaded)
src/datavis.js  ── session state + onChange bus + derived sets (active_set, feasible_mask)
     ▲ writes                                 │ notifies
t1_modal.js   t2_umap.js   t3_violin.js   t4_filter.js   t5_spider.js   t6_table.js
```

Graphify findings folded in: no import cycles (good — keep it that way); duplicated stub communities (`part1 schema` copies, radar-chart stubs ×3, chart-grid stubs ×2) are dead weight — Phase 0 removes them from the shipped tree; `ATTRIBUTES` and `SCRAP_FAMILIES` are the intended cross-community bridges (I6).

---

## 2. Session Contract v2 (Phase 0 deliverable — freeze before any view work)

Changes vs current `docs/pipeline_contract.md`:

```javascript
session = {
    loaded: false,
    columns: {},                 // { colName: Float64Array } — typed, not plain arrays
    umap: Float32Array,          // 324632 × 2
    family_labels: Uint8Array,   // 324632, values 0–6 (6 = Mixed)
    blob_contours: [],           // 6 polygon arrays [[x,y],...] + precomputed centroids
    norm_table: {},              // fetched from norm_table.json (NOT computed in browser)
    kde_cache: {},               // fetched from kde_curves.json (NOT computed in browser)
    spatial_grid: {},            // fetched from spatial_grid.json (REPLACES quadtree)
    stock: {},                   // { scrapName: qty_kg }

    projects: [ /* unchanged: name, batch_kg, thresholds{attr:{floor,margin,effective}} */ ],

    feasible_mask: Uint8Array,   // NEW, derived by pipeline on 'projects' change:
                                 // bit0 = feasible for A, bit1 = feasible for B
    brush_t2: null,              // { rowIds: Set } | null
    brush_t3: {},                // { attrKey: [normMin, normMax] }
    active_set: Set|null,        // derived: brush_t2 ∩ brush_t3; null = "no brush" (≠ empty set)

    picks_a: [],                 // NEW — up to 4 × { rowId, number: 1–4 }  (replaces picks[])
    picks_b: [],                 // NEW — up to 4 × { rowId, number: 1–4 }
    pick_target: 'A',            // NEW — T4 header toggle state ('A' | 'B')

    stock_alerts: []             // unchanged
}
```

Writer table additions: `feasible_mask` — pipeline (derived); `picks_a`/`picks_b`/`pick_target` — T4; `spatial_grid` — loading worker. **Semantics rule:** `active_set === null` means "nothing brushed → everything active"; an actual empty Set means "brush matched nothing". Views must distinguish these (dimming everything on an empty brush is correct; dimming everything when no brush exists is a bug).

---

## Phase 0 — Contract freeze & repo hygiene

*Files: `docs/pipeline_contract.md`, `src/datavis.js`, repo tree.*

1. Rewrite `pipeline_contract.md` to Contract v2 above (picks split, `spatial_grid` replaces `quadtree`, `feasible_mask`, `pick_target`, null-vs-empty `active_set` semantics, typed-array requirement).
2. In `datavis.js`: add `picks_a`, `picks_b`, `pick_target`, `feasible_mask` to the session literal; implement `computeFeasibleMask()` (single O(n) pass over primary columns per project, run on `projects` change); keep a temporary `session.picks` getter that throws — so any stale reader fails loudly during migration rather than silently reading undefined.
3. Delete or `.gitignore` the duplicated stub trees graphify flagged (`Scrap-Alloy-Screening-Dashboard-main/` nested copy, unused radar/chart-grid stubs). They triple node count, confuse tooling, and risk someone editing the wrong copy.
4. Add `manifest.json` handling stub in pipeline (I10) — attribute-list checksum assertion.
5. **[S4]** Generalise the derived-state rule: `stock_alerts` moves out of T5's `picks` handler into the pipeline, computed *before* dependent listeners fire (same mechanism as `feasible_mask`); T1's B-removal writes `projects` before `picks` so no listener sees a stale project list. **[M4]** `recomputeActiveSet` precomputes raw-value bounds per brush instead of calling `normAttr` per row. **[M5]** set `rowCount` before emitting `columns`.

**Immediate zero-risk text fixes (do alongside Phase 0):** **[R5]** fix report §2.5 — UMAP input is the 7 primary attributes, not 14 (matches §4.2 + `precompute.py`); **[M6]** delete the §4.2 StandardScaler-params-saved-for-runtime sentence; **[S5-part]** restore the full CALPHAD disclaimer wording wherever quoted.

**Acceptance:** contract doc, session literal, and this plan agree exactly; `grep -rn "session.picks[^_]" src/` returns nothing except the throwing getter; page still boots.

---

## Phase 1 — Finish the Python precompute (everything the browser will fetch)

*Files: `data/precompute.py`, artifacts, `manifest.json`. No JS changes.*

1. ~~`blob_contours.json` / KDE contour extraction~~ — **DESCOPED** (domain decision 2026-07-09, `docs/klaus_t2_aggregation_decision.md`): Klaus chose the **hybrid two-tier bubble map**. Instead: `compute_spatial_grid` emits **all** non-empty cells with a `tier` field — `major` (count ≥ min_count) and `fringe` (below cutoff) — plus per-family count-weighted centroids for T2 pick labels. Reference rendering: `data/t2_hybrid_fringe_demo.png` (`data/hybrid_demo.py`). DBSCAN and square-grid variants rejected with recorded domain grounds; do not revisit.
2. **`norm_table.json`** — per-column min/max for all 14 attrs + 6 scrap columns (currently `computeNormTable` in the browser — moves here verbatim).
3. **`kde_curves.json`** — 14 attributes × 6 families, Scott's rule, 200-point grid on the normalised (direction-inverted) [0,1] axis, exactly matching what `computeKdeCache` does today so T3 renders identically after the swap. Store as flat arrays.
4. **`spatial_grid.json`** — brush index replacing the quadtree: grid over UMAP bounds (start 128×128; tune so median cell < 100 rowIds), `cells[i] = [rowId,...]`, plus `{xmin,xmax,ymin,ymax,cols,rows}` meta. Rectangle query = cell-range union, O(cells hit + k). **[R4] ⛔** The current `compute_spatial_grid` drops all rows in cells below `min_count` — those rowIds land in *no* cell, so brushing sparse regions silently loses data. Split into two structures: thresholded bubbles for rendering, a **complete** index (every rowId exactly once) for brushing.
5. **`manifest.json`** — I10 fields for every artifact.
6. **Validation script** (`data/validate_artifacts.py`): asserts row counts = 324,632 everywhere, labels ∈ [0,6] with the known 15.5%×6 / 7.3% distribution, norm min < max per column, every KDE curve length 200 and non-negative, every rowId in spatial_grid < n_rows and each rowId appears exactly once. Run after every regeneration.

**Acceptance:** `python data/validate_artifacts.py` passes; artifact total size logged (target: all JSON artifacts combined < 25 MB — if `spatial_grid.json` explodes, store rowIds as base64 Uint32 or split per-cell offsets, decided here, not later).

---

## Phase 2 — Loading pipeline rewrite (fetch-only worker)

*Files: `src/parse_worker.js`, `src/loading_tab.js`, `src/datavis.js`.*

1. Rewrite worker to the 9 fetch steps of tasks.md (dataset parse → 6 artifact fetches → stock.csv → `loaded`). Parsing the TSV stays in the worker (it's I/O-bound decoding, not analytics) and writes straight into preallocated `Float64Array`s (I3) transferred to the main thread as Transferables — zero copy.
2. Delete `computeFamilyLabels`, `computeNormTable`, `computeKdeCache`, `computeOneViolin`, `gaussianKernel` etc. from `loading_tab.js` (graphify community 5 shrinks to fetch/progress/table code only). Anything still importing them must break the build — fix those imports to read session fields.
3. Progress UI: step dots (9 dots, fill as each resolves) per tasks.md, replacing bar+counter. On any fetch failure: named error state ("kde_curves.json failed — regenerate artifacts"), no silent spinner.
4. Loading-tab preview table: set page size to 100 (code currently 500), family column read from `family_labels` — already done, just fix the constant.
5. Manifest assertion (I6/I10) before `loaded` is emitted.
6. **[P4]** Vendor d3 locally or replace `dsvFormat` in the worker with a plain split-based parser (faster anyway) — the CDN `importScripts` is a demo-day single point of failure. Document `python -m http.server` in the README (fetch + Workers don't run under `file://`).

**Acceptance:** cold load end-to-end < 10 s on the dev machine with progress visible (Heinzl 10 s threshold); DevTools performance profile shows no main-thread task > 50 ms during load; `grep -n "computeKde\|computeNorm\|computeFamily" src/` empty.

---

## Phase 3 — Pick-schema migration + T1 completion

*Files: `src/t1_modal.js`, `src/t4_filter.js`, `src/t5_spider.js`, `src/t6_table.js`, `src/datavis.js`.*

1. **Migration:** replace every read/write of `session.picks` with `picks_a`/`picks_b`. T5 routing logic already branches on the project tag — becomes a direct read. Remove the throwing getter once grep is clean.
2. **T4 header toggle** `[Project A][Project B]` writing `pick_target`; rendered only when `projects.length === 2`; resets to `'A'` when B is removed.
3. **T1 remaining TAs:**
   - Hover tooltip per property row showing dataset min–max (read `norm_table` — available even mid-load? No: disable tooltips until `loaded`, I8).
   - Out-of-range floor → red border + message *"Choose [property] inside [min–max] values"*; blocks Apply.
   - Rename the "Floor" label (TA wording — e.g. "Client minimum"; confirm exact term with TA, one string constant).
   - On Apply: `computeFeasibleMask()` runs (Phase 0) so T2 pre-filters from first render.
4. **Re-apply semantics** (already mostly working): removing B clears `picks_b` only; verify with the new schema.
5. **[P5]** `escapeHtml()` helper in `src/dataVis.js`, applied wherever user strings meet `innerHTML`/attribute values (project name in form input + header chip today; T6 headers later).

**Acceptance:** dual-project flow — pick 4 for A, toggle, pick 4 for B, 5th blocked per project, deselect renumbers contiguously within its own project; remove B → `picks_b` empty, `picks_a` untouched; out-of-range floor blocked with message.

---

## Phase 4 — T2 UMAP overview

*Files: `src/t2_umap.js`.*

1. Render the **two-tier bubble map** from `spatial_grid.json` (Klaus D4): major cells = filled circles, area ∝ count, Wong hue + texture `CanvasPattern`, thin dark stroke; fringe cells = fixed-size hollow rings, family-hue stroke, no fill. Tier is encoded by fill/shape, never opacity (Klaus D3 — opacity stays reserved for feasibility). ~400 marks/frame — trivial budget. Fringe cells are first-class brush targets (Klaus D5).
2. Remove all axis lines/labels (UMAP axes are non-interpretable — Munzner: don't imply meaning that isn't there).
3. Feasibility opacity from `feasible_mask` at family level: blob at 1.0 if any member row is feasible for ≥1 active project, else 0.1 — computed once per mask change by a single pass storing 7 booleans, not per frame. **[R2]** This *replaces* `t2IsFeasible`, which checks only the two plotted axes — feasibility means passing **all** of a project's effective thresholds; never derive it from a per-view axis subset.
4. Rectangle brush → `spatial_grid` cell-range lookup (replace the linear scan) → `brush_t2 = {rowIds}`; empty-area click clears. Must be O(cells + k). **[P1]** No full-dataset redraw inside mousemove: static layers render to an offscreen canvas once per data/threshold change; the drag handler blits + draws only the rubber-band rect, coalesced via rAF dirty flag (I5). **[S2]** Brush overlay = neutral gray (`rgba(0,0,0,0.12)` + dashed border), not `#0072B2` — that's the bat-box family hue (encoding conflict, same logic as report §3.2.2).
5. Pick labels: A1–A4 / B1–B4 pills at the family centroid (count-weighted mean of major-cell centroids, from Phase 1 JSON) with the 3-column offset layout from report §4.3; drawn last, on top.
6. Hover tooltip (≤ 0.1 s): family name, count, median + IQR for YS/CSC/TC/ER. **These stats must come from precompute** — add `family_stats` to `norm_table.json` or its own artifact in Phase 1 (do not compute medians over 50k rows on mousemove). *(Note: this is the one Phase 1 addition discovered downstream — add it to `precompute.py` now.)*

**Risk flag [to confirm with TA]:** pick-label colors amber `#E69F00` / blue `#0072B2` are also the KS1295 and bat-box family hues — this contradicts the report's own §3.2.2 rule that project identity stays out of the family color channel. The white-text pill shape mitigates it, but be ready to defend or switch to black/white pills.

**Acceptance:** no axes; blobs textured + dimmed correctly the moment T1 is applied; brushing 50k points updates T3/T4 dims < 1 s; hover tooltip instantaneous; labels never overlap within a blob.

---

## Phase 5 — T3 violin

*Files: `src/t3_violin.js`, small CSS.*

1. Swap KDE source: render from fetched `kde_cache` (`kde_curves.json`), delete the browser-computed path. Shapes must be pixel-identical to current output (same grid, same bandwidth) — verify by overlay screenshot before/after.
2. Increase horizontal column spacing (TA: currently overplotted) — spacing constant in one place, recompute layout from it.
3. Constraint chips: amber A / blue B / gray A+B label boxes via the shared `drawConstraintLines()` (currently black boxes) — matches T4 vocabulary. **[S1]** "A+B" merges only when the two effective values are **identical** (ε on the value, not 4px pixel proximity — two different client constraints must never display as one). **[S2]** Brush overlay → same neutral gray as T2.
4. **Local zoom per column** (TA): right-click drag on a column selects a value range → that column rescales so the range fills full height; KDE path is *geometrically* rescaled (no recompute, I2); constraint lines and brush overlays transform with the same scale; double-click resets; per-column zoom state lives inside T3 (view-local, not session — it filters nothing). Suppress the context menu on the canvas.
5. Subscribe T3 to `active_set` changes so a T2 brush re-highlights violins (currently missing — pipeline wiring gap).

**Acceptance:** T2 brush visibly updates T3 highlights; right-drag zoom on YS column stretches shape + lines + brush overlay consistently, double-click restores; brushes on multiple columns compose; "See more" columns inherit active brushes on reveal.

---

## Phase 6 — T4 filter/scatter

*Files: `src/t4_filter.js`.*

1. Constraint lines on every panel through the shared `drawConstraintLines()` helper reading `projects[n].thresholds[axis].effective` for the panel's current axes (skip missing thresholds, e.g. secondary attrs) — spawned panels inherit with zero wiring (replace the inline per-project drawing).
2. **Intersection bbox as default zoom** (`intersectionBbox()` from report §4.5): applied on first render, after every T1 Apply, and on double-click reset. No feasibility fill.
3. Click-select: 8px hit radius (currently 15), routed by `pick_target` into `picks_a`/`picks_b`, ≤ 4 per project, contiguous renumber on deselect. **[P2]** Hit test against *currently visible, active* points only (no 324k scan per click; dimmed 5%-alpha points are not pickable — near-invisible picks are mystery picks), nearest-wins. **[M1]** Renumbering must not mutate live `session` pick objects — deep-copy entries before editing, then `pipeline.set`.
4. Badges: amber A1–A4 + blue B1–B4 pills on all panels simultaneously (same pill renderer as T2 — share it in the helper module, `src/dataVis.js`; tasks.md calls this `utils/helpers.js` but the repo file is `dataVis.js`).
5. Hover tooltip: all 7 primary values, per-property formatting (use the Phase 7 format table — put `formatValue(attr, v)` in `src/dataVis.js` now).
6. Rectangle-drag zoom: active panel zooms to drag bbox; **other panels refit axes to the same rowId subset**; double-click → intersection bbox everywhere. Maintain per-panel `viewRange` state; renders read it (I5).
7. Point radius scales with zoom level (TA): `r = clamp(3 × sqrt(zoomFactor), 3, 8)`.
8. Stacked-bar % labels on segments wider than 12 px.
9. Performance: the per-frame loop iterates the active subset only. Maintain `activeRows: Uint32Array` recomputed on `active_set`/mask change (O(n) once, I4), never `points.forEach` over 324k with an alpha branch per frame. If the unbrushed initial view is too slow, draw the dimmed layer once to an offscreen canvas and blit it, redrawing only the bright layer per interaction.
10. Typed-array verification TA item: columns arrive typed from Phase 2 — assert `columns.YS instanceof Float64Array` at init.
11. *(Optional, last)* hexbin density underlay precomputed in Python — only if time remains; separate artifact, off by default.

**Acceptance:** new "+ Add plot" panel shows constraint lines with zero extra code; drag-zoom on panel 1 refits panels 2+ to the same subset < 1 s; double-click lands on intersection bbox, not full range; picks route by toggle; badges + tooltips correct; Chrome profile of a drag shows no frame > 16 ms after the first.

---

## Phase 7 — T5/T6 completion

*Files: `src/t5_spider.js`, `src/t6_table.js`, `src/datavis.js` (one event).*

0. **[R3] Fix the combined stock check first** — it must be **pairwise** (one alloy from A × one alloy from B, per report §4.6.5), not a sum over all picks per project: the engineer produces one recipe per order, so summing 4 candidate recipes overstates demand and fires false alarms. The combined banner message must **name both alloys**; single vs combined messages must be visually distinct (§4.6.6) **[S5]**. Amber markers then flag only the actual offending pair via the alert's rowIds — `pickHasStockAlert`'s "any scrap this alloy uses" fallback goes away. **[M2]** Derive `cy`/`maxR`/legend positions from canvas size (hardcoded `cy=130, maxR=100` today).

1. **T6 split:** Table A (amber headers, from `picks_a`) + Table B (blue headers, from `picks_b`, hidden in single-project mode). Shared builder parameterised by project — no copy-paste.
2. Row set: Recipe (6 scrap %) + 17 output properties + 12 chemical wt.% + CALPHAD disclaimer row. **The exact 17-property list must be frozen first** — 14 interactive + 3 supplementary; pick the 3 from the excluded outputs with TA/domain sign-off and record them in `datavis.js` `T6_ROWS` (single source, I6). *(Currently 14 rows — flag if the "+3" remains unresolved rather than inventing them.)*
3. Per-property formatting via the shared `formatValue()` table (report §4.7.3: YS 0dp, CSC 3dp, TC 1dp, ER sci-2sf, Hardness 1dp, Density 3dp, LinearTE sci-2sf, scrap % 1dp, chem 2dp) — replaces uniform `toFixed(3)`.
4. Cell coding: red = fails *that project's* effective threshold (respect direction, I7); amber = recipe row of a scrap in an active stock alert (read `stock_alerts`, never recompute, contract rule). **[S3]** T6 subscribes to `projects` and `stock_alerts` in addition to picks — today it only watches `picks`, so it goes stale on T1 re-apply and never sees alert changes. **[S5]** Disclaimer row carries the full §4.7.5 wording: *"Values are CALPHAD predictions. Verify by laboratory measurement before production use."*
5. Best-value per row within each table: green/bold on the winner, direction-aware (I7); skip rows where <2 picks.
6. **T5→T6 cross-highlight:** clicking a spider axis label emits `pipeline.emit('t5_axis_click', {project, attr})`; the matching table row gets a border highlight + `scrollIntoView`. Axis-label hit zones = precomputed label bounding boxes on the spider canvas.

**Acceptance:** dual mode shows A and B tables independently populated; formats match the table above cell-by-cell; a threshold raised in T1 re-reddens cells without touching picks; axis-label click scrolls + highlights the right row in the right table.

---

## Phase 8 — Pipeline wiring completion, reset, end-to-end test

*Files: `src/datavis.js`, `src/index.html` (Reset button), all views touched only via their public render fns.*

1. Close the remaining wiring gaps: T2 brush → `active_set` → **T3 highlight** (done in Phase 5, verify here) and T4 dim; T4 pick → correct spider → stock alerts → correct table.
2. **"Reset all"** control: clears `brush_t2`, `brush_t3`, both pick sets, `pick_target`→'A', T4 zooms to intersection bbox, T3 local zooms reset. One function in pipeline, views react through onChange only (I1).
3. **End-to-end test script** (the tasks.md scenario, written as `docs/e2e_checklist.md` with expected outcomes): dual-project mode; identical thresholds on one attr (A+B chip renders once); constraint outside data range ("met by all/none" annotation); 5th pick blocked per project; stock file with a zero entry (single + combined alerts fire, banner formats correct, T6 amber rows); T1 re-apply mid-session (brushes + picks persist, zoom snaps, cells recolor); Reset all.
4. **Responsiveness audit** against Heinzl thresholds: measure (performance.now logs) hover paths ≤ 100 ms, brush/filter/apply < 1 s, load < 10 s with progress. Record numbers in the checklist — they're demo/report ammunition.

**Acceptance:** every line of the e2e checklist passes twice in a row from a cold load; no console errors across the full scenario.

---

## Phase 9 — Docs & slides support (non-code, do last)

Slides (narrative arc, one per view with encoding justifications, limitations), timed demo script, submission package (code + regenerated artifacts + README with `precompute.py` usage, `validate_artifacts.py`, and the `python -m http.server` serving instruction **[P4]**). Pull the "why" answers from the nested-model report; pull the measured timings from Phase 8. **[M3]** Take all slide screenshots *after* the Phase 5 `kde_curves.json` swap — violin shapes shift slightly (`KDE_SAMPLE` 1500 → 4000).

---

## Open decisions to resolve with TA/user (blockers marked ⛔)

| # | Decision | Blocks | Default if unresolved |
|---|---|---|---|
| 1 | ~~KDE contours vs hexbin for T2~~ **RESOLVED 2026-07-09**: hybrid two-tier bubble map, chosen by domain expert (`docs/klaus_t2_aggregation_decision.md`); pending his confirmation of `t2_hybrid_fringe_demo.png` | — | — |
| 2 | Exact replacement wording for "Floor" | Phase 3 §3 | "Client minimum" |
| 3 | ⛔ The 3 supplementary properties completing the 17-row T6 set | Phase 7 §2 | Ship 14 + note in report |
| 4 | Pick-pill amber/blue vs family-hue conflict (§3.2.2) | Phase 4 §5, cosmetic | Keep pills, defend via shape+text redundancy |
| 5 | Low-stock numeric threshold semantics (report §3.7 open question) | none (current binary check works) | Keep `required > stock` binary check |
| 6 | Spatial grid resolution (128×128 start) | Phase 1 §4 | Tune to median cell < 100 ids |

---

## Phase → tasks.md traceability

| tasks.md section | Covered by phase |
|---|---|
| Precompute: norm_table, kde_curves, spatial_grid, blob contours TODO | 1 |
| Loading Tab: fetch-only worker, dots, page size | 2 |
| T1: tooltips, range validation, floor rename, pre-filter | 3 |
| T2: contours, no axes, grid brush, pick labels, tooltip | 4 (+1 for family_stats) |
| T3: kde_curves source, spacing, chips, local zoom | 5 |
| T4: schema split, toggle, 8px, badges, bbox zoom, linked refit, point scale, % labels, typed arrays, tooltip | 3 + 6 |
| T5: axis-click → T6 | 7 |
| T6: A/B split, 17 rows, formats, red/amber, best-value, cross-highlight | 7 |
| Pipeline: T2→T3 gap, pick routing, Reset all, e2e | 5 + 8 |
| Docs & slides | 9 |

---

## CODE_REVIEW.md → phase traceability

R1 (T2 isn't a UMAP) needs no separate fix — Phase 4 replaces the view wholesale; don't polish the current file.

| Fix | What | Phase |
|---|---|---|
| R2 | Feasibility = all thresholds via `feasible_mask`, not plotted axes | 0 (mask) + 4 (use) |
| R3 | Pairwise combined stock check; banner names both alloys | 7 §0 |
| R4 | Complete brush index — no rows dropped by `min_count` | 1 §4 + validation §6 |
| R5 | Report §2.5: UMAP input is 7 attrs, not 14 | Immediate (with Phase 0) |
| S1 | "A+B" merge on identical values only, not 4px proximity | 5 §3 |
| S2 | Neutral-gray brush overlays (no family-hue collision) | 4 §4 + 5 §3 |
| S3 | T6 subscribes to `projects` + `stock_alerts` | 7 §4 |
| S4 | Derived state computed in pipeline before dependents fire | 0 §5 |
| S5 | Banner formats distinct; full CALPHAD disclaimer wording | 7 §0/§4 |
| P1 | Offscreen blit + rAF; no 324k redraw in mousemove | 4 §4 (pattern shared with 6 §9) |
| P2 | Click hit-test on visible/active subset only | 6 §3 |
| P3 | Wasteful norm-table copies — dies with fetch-only rewrite | 2 (by deletion) |
| P4 | Vendor d3; README http.server instruction | 2 §6 + 9 |
| P5 | `escapeHtml()` for all user strings in HTML | 3 §5 |
| M1 | No mutation of session picks before `pipeline.set` | 6 §3 |
| M2 | Spider geometry derived from canvas size | 7 §0 |
| M3 | Slide screenshots only after KDE-source swap | 9 |
| M4 | `recomputeActiveSet` on raw bounds | 0 §5 |
| M5 | `rowCount` set before `columns` emit | 0 §5 / 2 |
| M6 | Delete stale StandardScaler sentence in report §4.2 | Immediate (with Phase 0) |
