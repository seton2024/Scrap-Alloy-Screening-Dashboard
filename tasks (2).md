# Task List — Scrap Alloy Screening Dashboard

> Items tagged **FIX <id>** come from `Scrap Alloy Screening Dashboard/CODE_REVIEW.md` (2026-07-07). Phase assignments for all work live in `Scrap Alloy Screening Dashboard/IMPLEMENTATION_PLAN.md`.

---

## Setup & Skeleton

- [x] GitHub repo + 3 branches (`S_dev`, `P_dev`, `main`)
- [x] Dataset verified (tab-separated, Latin-1, 324 632 rows)
- [x] Python environment verified
- [x] Session schema agreed (`pipeline_contract.md`) — **note: `picks` split into `picks_a` and `picks_b` (see T4); `quadtree` replaced by `spatial_grid` loaded from file**
- [x] Alloy naming decided (`mix_[rowIndex]`)
- [x] Stock CSV sample created
- [x] CSS tokens agreed (Wong palette, Inter, spacing)
- [x] `index.html` skeleton (2-tab layout, all canvas elements, T1 modal)
- [x] `style.css` full design system
- [x] `utils/helpers.js` (constraint chip renderer, KDE utils, normalisation, family metadata)

---

## Precompute (Python)

**Everything is precomputed. No computation runs in the browser. Loading = file fetch only.**

- [x] UMAP coordinates → `umap_coords.npy`
- [x] Family labels (argmax + ≤2pp Mixed rule) → `family_labels.npy`
- [x] **TA:** Compare two blob approaches — KDE contours vs hexagon binning; pick the cleaner one visually → ~~`blob_contours.json`~~ <!-- RESOLVED by domain session 2026-07-09 (docs/klaus_t2_aggregation_decision.md): Klaus chose the hybrid two-tier bubble map; KDE contours + blob_contours.json DESCOPED; DBSCAN + square grid rejected with domain grounds -->
- [x] **Two-tier spatial grid (Klaus D4):** `compute_spatial_grid` emits **all** non-empty cells with a `tier` field — `major` (count ≥ min_count, rendered as filled bubbles sized by count) and `fringe` (below cutoff, rendered as fixed-size hollow rings); demo: `data/t2_hybrid_fringe_demo.png` (97 fringe cells / 11,577 alloys currently invisible)
- [x] **TA:** Try 7 → 4 dimension reduction before UMAP (PCA pre-step); compare cluster clarity against current 7D UMAP
- [x] Normalisation table (min/max per column) → `norm_table.json` <!-- currently computed in browser (loading_tab.js computeNormTable) — must move to precompute.py -->
- [x] Violin 1D KDE curves — Scott's rule, 200-point grid, all 7 families × 7 primary properties = 49 curves → `kde_curves.json` <!-- currently computed in browser (loading_tab.js computeKdeCache) — must move to precompute.py -->
- [x] Spatial grid index for UMAP brush — 2D grid (e.g. 100×100 cells) mapping each cell to its rowIds → `spatial_grid.json` (replaces in-browser quadtree build)
- [x] **FIX R4:** the brush index in `spatial_grid.json` must contain **every rowId exactly once** — current `compute_spatial_grid` drops all rows in cells below `min_count`, so brushing sparse regions silently loses data. Split into two structures: thresholded bubbles for rendering, complete index for brushing. Enforce in `validate_artifacts.py`.

---

## Loading Tab

- [ ] Web Worker — **fetch only, zero computation**, steps in sequence: <!-- CURRENT CODE COMPUTES labels/norm/KDE in-browser and simulates the rest — needs rewrite to pure fetch, see loading_tab.js notes -->
  1. Fetch + parse dataset file (columns into typed arrays)
  2. Fetch `umap_coords.npy` → `Float32Array`
  3. Fetch `family_labels.npy` → `Uint8Array`
  4. Fetch `blob_contours.json`
  5. Fetch `norm_table.json`
  6. Fetch `kde_curves.json`
  7. Fetch `spatial_grid.json`
  8. Fetch `stock.csv`
  9. Emit `loaded`
- [ ] Progress display: step dots animate as each file arrives <!-- progress bar + "Step N of 9" counter exist and advance per step, but rendered as a filling bar, not dots; tied to fetch rework above -->
- [ ] **FIX P4:** vendor d3 locally or replace `dsvFormat` with a plain split-based parser — `parse_worker.js` does `importScripts` from a CDN, so no network at the demo = the entire load fails at step 0; also document `python -m http.server` in the README (fetch + Workers don't run under `file://`)
- [ ] **FIX M5:** set `session.rowCount` **before** `pipeline.set("columns", …)` fires (latent subscriber-ordering trap)
- [x] If table kept: pagination (100 rows/page, Prev/Next), "Scrap Family" column read from `family_labels` (no recompute), hover row tint <!-- page size is 500/page in code, not 100 -->

---

## T1 — Project Setup Modal

- [x] HTML structure (name field, 7-row constraint table, batch size, Project B column)
- [x] Apply → inject project chip into header; chip click reopens modal pre-filled
- [x] "+ Add Project B" shows second column; "× Remove" hides it and clears session
- [x] Validation: red border + block Apply for empty name / non-positive floor / non-integer batch size; clamp margin silently to [0–100]
- [x] On Apply: compute effective thresholds, write `session.projects[]`, emit `pipeline.onChange('projects')`
- [x] Re-apply: recompute thresholds; preserve T2/T3 brushes + T4 picks; clear Project B picks only when B is removed
- [x] **TA:** Hover tooltip on each property row showing dataset min–max range
- [x] **TA:** Out-of-range input → red border + error message: *"Choose [property] inside [min–max] values"*
- [x] **TA** Add the format check, so no 0,6  is written when 0.6 is only accepted 
- [x] **TA:** change the floor name
- [ ] **TA:** On Apply, use effective thresholds to pre-filter UMAP (feasible alloys at full opacity from the very first render)
- [x] **FIX P5:** escape user input before injecting into HTML (shared `escapeHtml()` helper) — a project name containing `"` or `<` currently breaks the form input value and the header chip

---

## T2 — UMAP

- [ ] ~~Draw family blob contours~~ → **Render two-tier bubble map** (Klaus D4, docs/klaus_t2_aggregation_decision.md): major cells = filled circles, area ∝ count, family hue + texture; fringe cells = fixed-size hollow rings, family-hue stroke, no fill — tier encoded by fill/shape, NEVER opacity (reserved for feasibility, Klaus D3)
- [x] Show `t2_hybrid_fringe_demo.png` to Klaus for confirmation before freezing the T2 encoding
- [ ] **TA:** Remove all axis lines and axis labels — UMAP has no interpretable axes
- [ ] **TA:** Use T1 project thresholds for feasibility from first render (pre-filter)
- [ ] Rectangle drag → spatial grid lookup (loaded from `spatial_grid.json`) → `session.brush_t2 = { rowIds: Set }`; no quadtree build in browser <!-- rectangle brush works + sets brush_t2, but via full linear scan; must switch to spatial_grid lookup -->
- [ ] When alloys are selected in T4, show their labels (A1–A4, B1–B4) inside the corresponding family region in T2 — positioned at the family centroid (count-weighted mean of that family's major-cell centroids; no contour polygons needed) (exact UMAP position not needed, only the family membership matters); if multiple picks belong to the same blob, offset the labels slightly to avoid overlap; A labels in amber, B labels in blue
- [ ] Hover tooltip: family name, point count, YS/CSC/TC/ER median + IQR (stats precomputed in Python — never computed on mousemove)
- [ ] **FIX R2:** feasibility must test **all** of a project's effective thresholds via a precomputed `feasible_mask` — current `t2IsFeasible` checks only the two plotted axes, so alloys failing e.g. Hardness for both projects still render as feasible
- [ ] **FIX P1:** no full 324k-row redraw inside mousemove — offscreen-canvas blit + rAF dirty flag; only the rubber-band rect redraws per frame (≤0.1 s budget, Heinzl/Munzner)
- [ ] **FIX S2:** brush overlay color → neutral gray (e.g. `rgba(0,0,0,0.12)` + dashed border) — current `rgba(0,114,178,…)` is the bat-box family hue `#0072B2`, an encoding conflict with §3.2.2's own decoupling rule
- [ ] **TA:** Scaled zoom.
- ~~**Infeasible blobs at 10% opacity; feasible at 100% **~~- (declined in implementation)


---

## T3 — Violin Plot

- [x] Static render: 6 family shapes × 7 default property columns, Wong hue fill
- [ ] KDE curves loaded from `kde_curves.json` (precomputed) — no browser computation; normalised 0–1 axis (inverted where lower=better) <!-- violins render correctly BUT from browser-computed kde_cache (loading_tab.js); must switch to fetching kde_curves.json -->
- [x] Constraint lines via `drawConstraintLines()` (black lines, amber/blue/gray chips) <!-- lines + A/B/A+B label boxes drawn; label boxes are black, not amber/blue/gray chips -->
- [ ] **TA:** Increase horizontal spacing between property columns — currently overplotted
- [x] Brush: drag on axis → geometric highlight on existing shape (no KDE recompute); emit `session.brush_t3[prop]`
- [x] Multiple simultaneous brushes; click empty axis clears that property's brush
- [ ] **TA:** Local zoom per column — right-click drag on a violin column to select a value range on the Y-axis; the column rescales so that range fills the full column height, stretching the KDE shape and revealing finer variation that is invisible when zoomed out; constraint lines and brush highlights rescale with it; completely separate from selection (no alloys filtered); double-click resets to full range
- [x] "See more" button reveals 7 secondary properties; active brushes apply immediately
- [ ] **FIX S1:** merge to a single "A+B" chip only when the two effective values are **identical** — current code merges on 4px pixel proximity, which can display two different client constraints as one shared threshold (misstates the Set Intersection input, report §3.2.2)
- [ ] **FIX S2:** brush overlay → neutral gray (same bat-box hue collision as T2)

---

## T4 — Scatter / Filter

**Session schema change:** replace `picks: []` with `picks_a: []` and `picks_b: []` — each holds up to 4 entries `{ rowId, number: 1–4 }`. Update `pipeline_contract.md` accordingly. <!-- NOT DONE: code still uses a single session.picks with a per-entry project:'A'|'B' tag; T4 only ever writes project 'A' -->

- [x] Panel 1: YS vs CSC (fixed)
- [x] Panel 2: custom axes (TC vs YS default; dropdowns to change)
- [ ] Panel 3: stacked bar (6 scrap recipe ratios, % labels on segments > 12px) <!-- bar with 6 segments drawn; % labels on segments not implemented -->
- [x] "+ Add plot" spawns new custom panel
- [ ] Constraint lines via `drawConstraintLines()` — **always present on every panel, including newly added custom panels**; for each panel, read its X-axis and Y-axis names, look up `session.projects[n].thresholds[axisName].effective` for each active project, and draw the A / B / A+B chip line automatically; if a project has no threshold for a chosen axis (e.g. a secondary property), no line is drawn for that project on that axis; newly spawned panels inherit this with zero extra wiring <!-- drawn inline per project in drawScatterPanel, not via the shared helper -->
- [ ] Feasibility zone: **no fill** — the intersection of Project A and B feasible regions is used as the **default zoom target**; on first render and on double-click reset, all panels zoom to the bbox defined by the intersection of both projects' effective thresholds, centering the view on alloys satisfying both; constraint lines are the only visual boundary indicator
- [ ] **Project toggle** — segmented control in the T4 header: `[Project A] [Project B]`; only visible in dual-project mode; controls which project's picks the next click goes into; default is Project A
- [ ] Click-to-select: 8px hit radius; point goes into `session.picks_a` or `session.picks_b` depending on toggle; max 4 per project; renumber on deselect <!-- single-project click-select works (max 4 + renumber on deselect); hit radius is 15px; no picks_a/picks_b, no toggle -->
- [ ] Pick badges in T4: text labels **A1 A2 A3 A4** for Project A picks and **B1 B2 B3 B4** for Project B picks — both sets visible simultaneously on all panels <!-- badges drawn, but black + single set -->
- [ ] Hover tooltip: all 7 primary property values
- [ ] Rectangle drag zoom on active panel; all other panels refit to same row subset on their own axes
- [ ] **TA:** Points must scale up with zoom level
- [ ] Double-click resets all panels to the **intersection zone range** (the bbox of both projects' effective thresholds — not full data range)
- [ ] **TA:** Verify precomputed typed arrays are used for rendering (not re-parsing file each time) <!-- columns are plain JS arrays today, not typed arrays; family_labels is Uint8Array -->
- [ ] **TA:** Consider hexbin KDE overlay precomputed in Python — light density contour under the points (седа)
- [ ] **FIX P2:** click hit-test must search only the active/visible subset — currently a 324k-row linear scan per click, and near-invisible 5%-alpha dimmed points can be picked (mystery picks)
- [ ] **FIX M1:** don't mutate `session.picks` entries before `pipeline.set` — `picks.slice()` is a shallow copy, so renumbering mutates live session objects (contradicts the adjacent "don't mutate session" comment)

---

## T5 — Spider Charts

- [x] Two separate canvases side by side (Spider A · alert banner · Spider B)
- [x] Spider A renders alloys from `session.picks_a`; Spider B renders alloys from `session.picks_b` <!-- routes A vs B picks correctly via the project tag on session.picks; will read picks_a/picks_b once the schema split lands -->
- [x] 7 axes at 2π/7 intervals: CSC → YS → TC → ER → Hardness → Density → LinearTE
- [x] `spiderNorm()` with direction inversion for lower-is-better attributes
- [x] 4 stroke styles: solid / dashed `[8,4]` / dotted `[2,4]` / dash-dot `[8,4,2,4]`
- [x] Red vertex: constraint violation (checked against that project's thresholds); amber vertex: stock alert
- [x] Stock alert — single check: `alloy.recipe[scrap] × batch_kg > stock[scrap]`
- [ ] Stock alert — combined check: **pairwise**, one alloy from A × one alloy from B: `a.recipe × batchA + b.recipe × batchB > stock[scrap]` <!-- FIX R3: current code sums demand over ALL picks per project (up to 4 recipes each) as if all were produced — overstates demand, fires false alarms; report §4.6.5 specifies per-pair -->
- [ ] Alert banner between spiders: two message formats — combined format **names both alloys**; single vs combined visually distinct (icon/indent) <!-- FIX R3/S5: current combined message says "Project A and Project B together…" without alloy names; formats not visually distinct (report §4.6.6) -->
- [x] Write `session.stock_alerts[]` for T6 to read
- [ ] **TA:** Click on a spider axis label → highlight the matching property row in the corresponding T6 table (A or B)
- [ ] **FIX M2:** derive spider centre/radius/legend positions from canvas size — currently hardcoded `cy=130, maxR=100`; legend can overlap the chart on short canvases

---

## T6 — Characteristics Table

**Two separate tables** — one for Project A picks, one for Project B picks. In single-project mode only the A table is shown. <!-- NOT DONE: T6 renders ONE combined table from session.picks; no A/B split -->

- [ ] **Table A** — columns populate from `session.picks_a` (up to 4, amber column headers) <!-- single table exists (columns per pick), but no amber A styling / picks_a source -->
- [ ] **Table B** — columns populate from `session.picks_b` (up to 4, blue column headers); hidden in single-project mode
- [ ] Each table has 2 sections: Recipe (6 scrap %) · Output properties (17 rows) + CALPHAD disclaimer row <!-- current: Recipe (6) + 14 property rows + disclaimer; 17-row + chem wt% set not present -->
- [ ] Per-property formatting: YS 0dp · CSC 3dp · TC 1dp · ER sci 2sf · Hardness 1dp · Density 3dp · LinearTE sci 2sf · scrap % 1dp · chem wt% 2dp <!-- uniform toFixed(3) today -->
- [ ] Red cell: output property fails that project's effective threshold
- [ ] Amber cell: recipe row for scrap involved in stock alert
- [ ] **TA:** Highlight best value per property row within each table — green/bold on the winning cell (respects direction: higher- or lower-is-better)
- [ ] **TA:** When T5 spider axis is clicked, highlight the matching row in the corresponding table (A or B) with a border + scroll into view
- [ ] **FIX S3:** subscribe T6 to `projects` and `stock_alerts` — currently `picks` only, so the table goes stale after a T1 re-apply and never sees alert changes (contract lists T6 as a `stock_alerts` reader)
- [ ] **FIX S5:** full disclaimer text per report §4.7.5: *"Values are CALPHAD predictions. Verify by laboratory measurement before production use."* <!-- current row says only "Values are CALPHAD predictions." -->

---

## Pipeline Wiring (`datavis.js`)

- [ ] T2 brush → recompute `active_set` → T3 highlights + T4 dims update <!-- active_set recomputes and T4 re-dims, but T3 does NOT subscribe to active_set so it doesn't re-highlight on a T2 brush -->
- [x] T3 brush → recompute `active_set` → T2 re-dims + T4 updates
- [ ] T4 pick (A or B toggle) → updates `picks_a` or `picks_b` → corresponding spider re-renders → stock alerts recompute → corresponding T6 table repopulates <!-- single-project chain works (pick → T5 + stock + T6); no A/B toggle / picks_a / picks_b routing -->
- [ ] T5 axis hover → highlights matching row in T6 table A or B
- [x] T1 Apply / Re-apply → recompute thresholds → all views re-render; preserve brushes + picks; removing Project B clears `picks_b` and hides Spider B + Table B <!-- threshold recompute + re-render + brush/pick preservation + B-pick clear + Spider B hide all work; Table B N/A (T6 not split yet) -->
- [ ] Deselection: empty T2 click clears `brush_t2`; empty T3 axis clears that property brush; "Reset all" clears everything including both pick sets <!-- empty-T2 and empty-T3 clears work; no "Reset all" control -->
- [ ] End-to-end test: dual-project mode, identical thresholds (A+B chip), constraint outside data range, 5th alloy per project blocked, stock at zero, T1 re-apply mid-session
- [ ] **FIX S4:** derived state (`stock_alerts`, `feasible_mask`) computed inside the pipeline **before** dependent listeners fire — currently subscriber-order dependent: T5 computes alerts in its own `picks` handler (T6 freshness depends on script-load order), and T1 sets `picks` before `projects` when removing Project B (transient wrong Spider B)
- [ ] **FIX M4:** `recomputeActiveSet` should compare precomputed raw-value bounds per brush instead of calling `normAttr` per row (~5× faster, identical result)

---

## Docs & Slides

- [x] Nested model Levels 1–4 complete
- [ ] Revise report §3.4: KDE-contour blobs → two-tier bubble map, with the domain justification + verbatim quotes from `docs/klaus_t2_aggregation_decision.md`; note this session as partial member checking (updates the stated methodology limitation)
- [ ] **FIX R5:** report contradicts itself and the code — §2.5 says UMAP on the "14-attribute output space", §4.2 + `precompute.py` use the 7 primary attributes; fix the §2.5 text (an L2 vs L4 inconsistency is exactly what the nested model exists to catch)
- [ ] **FIX M6:** delete report §4.2 sentence claiming the fitted StandardScaler params are saved for runtime constraint normalization — nothing saves or uses them (runtime correctly uses min/max)
- [ ] **FIX M3:** regenerate all slide screenshots **after** the `kde_curves.json` swap — `KDE_SAMPLE` differs (browser 1500 vs Python 4000), so violin shapes change slightly
- [x] Plain-language summary for friend (`dashboard_summary_for_friend.md`)
- [x] `pipeline_contract.md` written as standalone doc
- [ ] Slides: narrative arc (problem → design → demo → decisions)
- [ ] Slides: one per view with screenshot + encoding decisions
- [ ] Slides: limitations + future work
- [ ] Live demo script timed and rehearsed
- [ ] Submission package (code + data + README)
