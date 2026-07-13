# Aluminum Alloy Screening Dashboard

A browser-based dashboard for screening **324,632 simulated aluminum scrap-alloy recipes** (dataset). An engineer defines one or two client "projects" (property thresholds + batch size), and the dashboard helps them find, compare, and validate scrap-recipe candidates that satisfy those requirements - including checking the results against available scrap stock.

Built for the Data Visualization course, by Group 13 (Syra, Tonoyan).

---

## Goal

The dashboard is designed around a real domain problem, grounded in an expert interview:

The goal is a single tool that replaces Excel-and-memory workflow with one coherent path - **see the whole landscape → narrow to scrap families flexible enough for one or two client specs at once → shortlist and compare a handful of concrete candidates → verify against real constraints and stock** - matching the T1–T6 view sequence above. See `nested_model_L1_L2_L3_L4_report.md` for the full domain research and the nested-model design rationale behind every encoding choice in the dashboard.

---

## What it does

The dataset has 70 columns per alloy: 6 scrap-mixture input ratios (summing to 100%) and 64 measured/predicted output properties (yield strength, hot-crack susceptibility, thermal/electrical conductivity, etc.). The dashboard is a linked set of six views:

| View | Purpose |
|------|---------|
| **T1** | Modal to define Project A (and optionally Project B): property floors + tolerance margins → effective thresholds, plus batch size |
| **T2 - Overview** | A two-tier bubble map of the UMAP-embedded property space, aggregated by scrap family. Brush a region to filter; opacity encodes feasibility against the active project(s), bubble border weight encodes which project (A/B/both) a cluster satisfies |
| **T3 - Property Distributions** | Violin plots (precomputed KDE) per family for each of the 14 interactive properties, with constraint lines and brushable ranges |
| **T4 - Filter & Select** | Linked scatter panels (fixed + custom axes) plus a scrap-composition bar chart. Click to pick up to 4 alloys per project; drag to zoom (all panels refit to the same row subset); double-click resets to the intersection of both projects' feasible ranges |
| **T5 - Compare Candidates** | Spider/radar charts for the picked alloys (one per project), with constraint-violation and stock-shortfall markers |
| **T6 - Characteristics** | Full property lookup table for the picked alloys |

All views read from one shared, in-memory state object (`session` in `src/datavis.js`); each field has exactly one writer, and every other view is a read-only subscriber. See the comments at the top of `datavis.js` for the exact contract.

---

## Project structure

```
alloy/
├── src/                      # everything that runs in the browser
│   ├── index.html            # page shell: Loading tab + Dashboard tab (T1-T6 layout)
│   ├── datavis.js            # shared session state, pub/sub hub, attribute/family config
│   ├── loading_tab.js        # drives the loading Web Worker, renders the raw-data preview table
│   ├── parse_worker.js       # Web Worker: parses the uploaded dataset file + fetches all precomputed files
│   ├── t1_modal.js / .css    # Project Setup modal
│   ├── t2_umap.js            # UMAP bubble-map overview
│   ├── t3_violin.js          # violin plots
│   ├── t4_filter.js          # scatter panels + scrap-composition bar
│   ├── t5_spider.js          # spider/radar comparison + stock-alert logic
│   ├── t6_table.js           # characteristics table
│   └── style.css             # design system (Wong/Okabe-Ito palette, layout, components)
│
├── data/
│   ├── precompute.py         # offline pipeline - produces every *.npy/*.json file below
│   ├── umap_coords.npy       # Float32 (n, 2) - UMAP embedding of the 7 primary properties
│   ├── family_labels.npy     # Uint8 (n,) - dominant scrap family per alloy (0-5, 6=Mixed)
│   ├── norm_table.json       # per-column {min, max}, used to scale raw values to [0,1]
│   ├── kde_curves.json       # 1-D violin KDE curves, 14 properties × 7 families × 200 points
│   ├── spatial_grid.json     # T2's aggregated grid: bubble geometry + complete per-cell row index
│   ├── stock.json            # per-family available scrap stock (kg), read by T5
│   └── Dataset_VisContest_Rapid_Alloy_development_v3.txt   # ! NOT in the repo, see below
│
├── nested_model_L1_L2_L3_L4_report.md   # design report (nested model, encoding decisions)
├── tasks.md
└── README.md
```

---

## Requirements

**To run the dashboard** (no regeneration of the precomputed files needed - they're already committed in `data/`):
- Any modern browser with Web Worker support (Chrome, Firefox, Edge - all recent versions)
- A local static file server (see [Running the dashboard](#running-the-dashboard) - opening `index.html` directly via `file://` will **not** work)
- Internet access on first load, to fetch D3 from a CDN (`https://d3js.org/d3.v7.min.js`) - used for the preview table and a few DOM helpers. It is not vendored locally.

**To regenerate the precomputed files** (only needed if the raw dataset changes):
- Python 3.10+
- `pandas`, `numpy`, `scikit-learn`, `scipy`, `umap-learn`

```
pip install pandas numpy scikit-learn scipy umap-learn
```

---

## The raw dataset file

`data/Dataset_VisContest_Rapid_Alloy_development_v3.txt` is **not committed** to this repository (it's listed in `.gitignore` - it's large, and it's the IEEE SciVis Contest's dataset, not ours to redistribute). You need a copy of it from the contest organizers or a teammate, placed at exactly that path.

The file is **tab-separated, Latin-1 encoded**, one row per simulated alloy, with a header row. Two different parts of the project read this same file independently:

1. **`precompute.py`** reads it once, offline, to produce everything in the table above.
2. **The browser** also parses it - every time someone uses the dashboard, they select this file via the Loading tab's file picker. This second parse only extracts the raw per-row column values (fast, done in a Web Worker); it does not repeat any of the heavy computation from step 1.

---

## Setting up from scratch

### 1. Clone and get the dataset
```
git clone <this-repo-url>
cd alloy
```
Place `Dataset_VisContest_Rapid_Alloy_development_v3.txt` in `data/`.

### 2. Generate the precomputed files (skip if `data/*.npy` and `data/*.json` are already present and up to date)
```
cd data
pip install pandas numpy scikit-learn scipy umap-learn
python precompute.py --input Dataset_VisContest_Rapid_Alloy_development_v3.txt
```
This takes **10-30+ minutes**, almost entirely spent on the UMAP embedding step (`[6/7]`) - everything else finishes in seconds. Progress is printed to the console as each of the 7 steps completes. It writes `umap_coords.npy`, `family_labels.npy`, `norm_table.json`, `kde_curves.json`, `spatial_grid.json`, and `stock.json` into the current directory (run it from inside `data/`, as shown above).

### 3. Serve the project locally
The app uses `fetch()` and Web Workers, both of which browsers block under the `file://` protocol - you must serve it over HTTP. Serve from the **repository root** (not from `src/`), since `parse_worker.js` fetches files via a `../data/...` relative path:

```
# from the repo root
python -m http.server 8000
```
Any other static server works too (`npx http-server`, the VS Code "Live Server" extension, etc.) as long as it serves the repo root.

### 4. Open it
Navigate to `http://localhost:8000/src/index.html`. On the **Loading** tab, choose the same dataset file from step 1 (`Dataset_VisContest_Rapid_Alloy_development_v3.txt`). Loading takes roughly 10-20 seconds - a progress bar shows which of the 8 steps is running. Once it says "Dataset ready.", switch to the **Dashboard** tab.

---

## Notes / known limitations

- D3 is loaded from a CDN - the app will fail to load with no internet connection.
- The dataset file must be selected fresh every session (nothing persists across page reloads); this is intentional - it's a fast fetch-only step, not a repeat of the offline computation.
- `stock.json` currently ships with a flat placeholder value (10,000 kg) for every scrap family - swap in real facility stock numbers by editing that file or `compute_stock_table()` in `precompute.py`.
