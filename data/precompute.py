"""
Everything heavy is computed here, ONCE, offline. This script produces:

    umap_coords.npy    Float32 (n_rows, 2)  - the 2-D UMAP embedding
    family_labels.npy  Uint8   (n_rows,)    - scrap family per alloy (0-6, 6=Mixed)
    norm_table.json    {col: {min, max}}    - per-column min/max for [0,1] scaling
    kde_curves.json    {key: {fam: [200]}}  - 1-D violin KDE, 14 attrs x 6 families
    spatial_grid.json  meta + cells         - T2 two-tier overview + complete brush
                                               index

Usage:
    python precompute.py --input <dataset.txt> --outdir <folder>
"""

import argparse
import functools
import json
import time
from collections import defaultdict

# Flush every print immediately
print = functools.partial(print, flush=True)


def checkpoint(msg):
    #Timestamped progress line, e.g.  [14:32:07] UMAP: building k-NN graph
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from scipy.stats import gaussian_kde

# these match the names in the dataset
SCRAP = ["KS1295[%]", "6082[%]", "2024[%]", "bat-box[%]", "3003[%]", "4032[%]"]

DEG = chr(0xB0)

# The 14 interactive attributes: (key, exact column name, higher_is_better, tier).
# The 7 "primary" attributes drive the UMAP; all 14 get a norm entry + KDE curve
ATTRIBUTES = [
    ("YS",        "YS(MPa)",                                            True,  "primary"),
    ("CSC",       "CSC",                                                False, "primary"),
    ("TC",        "Therm.conductivity(W/(mK))",                         True,  "primary"),
    ("ER",        "El. resistivity(ohm m)",                             False, "primary"),
    ("Hardness",  "hardness(Vickers)",                                  True,  "primary"),
    ("Density",   "Density(g/cm3)",                                     False, "primary"),
    ("LinearTE",  "Linear thermal expansion (1/K)(20.0-300.0" + DEG + "C)", False, "primary"),
    ("ThermDiff", "Therm. diffusivity(m2/s)",                           True,  "secondary"),
    ("HeatCap",   "heat capacity(J/(mol K))",                           True,  "secondary"),
    ("ThermRes",  "Therm.resistivity(mK/W)",                            False, "secondary"),
    ("ElCond",    "El.conductivity(S/m)",                               True,  "secondary"),
    ("CTEvol",    "CTEvol(1/K)(20.0-300.0" + DEG + "C)",                False, "secondary"),
    ("TechTE",    "Technical thermal expansion (1/K)(20.0-300.0" + DEG + "C)", False, "secondary"),
    ("Volume",    "Volume(m3/mol)",                                     True,  "secondary"),
]
PRIMARY_COLS = [col for _, col, _, tier in ATTRIBUTES if tier == "primary"]

#tuning constants (locked in the exploration notebook)
MIXED_TIE_PP = 2.0            # top-two scrap ratios within 2pp -> "Mixed"
UMAP_NEIGHBORS = 50           # nn50_md0.1 - the chosen embedding
UMAP_MIN_DIST = 0.1
RANDOM_STATE = 42
KDE_GRID = 200                # points per violin curve (report SS4.4)
KDE_SAMPLE = 4000             # subsample per family for KDE speed (visually identical)
GRID_COLS = 28                # T2 overview grid width (rows derived from aspect)
TUNE_SAMPLE, TUNE_MIN = 35_000, 30   # min_count=30 was tuned on 35k -> scale by density


def load_dataset(path):
    """Read the tab-separated, Latin-1 dataset; keep only the columns we need."""
    cols = SCRAP + [col for _, col, _, _ in ATTRIBUTES]
    df = pd.read_csv(path, sep="\t", encoding="latin-1", usecols=cols)
    return df


def compute_family_labels(df):
    #Family = argmax of the 6 scrap ratios, unless the top two are within MIXED_TIE_PP percentage points -> label 6 (Mixed). Returns Uint8 (n,)."""
    ratios = df[SCRAP].values
    top2 = np.sort(ratios, axis=1)[:, -2:]        # two largest ratios per row
    dominant = np.argmax(ratios, axis=1)          # index of the single largest
    mixed = (top2[:, 1] - top2[:, 0]) <= MIXED_TIE_PP
    return np.where(mixed, 6, dominant).astype(np.uint8)


def compute_norm_table(df):
    #Per-column {min, max} for every one of the 14 attributes. The browser uses these to scale any raw value to [0,1] (mirrors pipeline.js normAttr)."""
    table = {}
    for _, col, _, _ in ATTRIBUTES:
        v = df[col].values
        table[col] = {"min": float(np.nanmin(v)), "max": float(np.nanmax(v))}
    return table


def _normalize(values, cmin, cmax, higher_is_better):
    #Scale to [0,1] where 1 = best. Lower-is-better attrs are inverted
    span = cmax - cmin
    if span == 0:
        return np.full_like(values, 0.5, dtype=np.float64)
    n = (values - cmin) / span
    return n if higher_is_better else 1.0 - n


def compute_kde_curves(df, labels, norm_table):
    #1-D KDE per attribute per non-Mixed family, on a 200-point grid over the normalized [0,1] axis (inversion already baked in). 
    grid = np.linspace(0.0, 1.0, KDE_GRID)
    rng = np.random.RandomState(RANDOM_STATE)
    curves = {}
    for ai, (key, col, higher, _) in enumerate(ATTRIBUTES, 1):
        checkpoint(f"KDE: attribute {ai}/{len(ATTRIBUTES)} ({key})")
        nt = norm_table[col]
        nv_all = _normalize(df[col].values, nt["min"], nt["max"], higher)
        curves[key] = {}
        for fam in range(7):
            vals = nv_all[labels == fam]
            vals = vals[~np.isnan(vals)]
            if vals.size > KDE_SAMPLE:              # subsample for speed
                vals = rng.choice(vals, KDE_SAMPLE, replace=False)
            if vals.size < 2 or np.ptp(vals) == 0:  # too few / zero-width -> flat
                curves[key][str(fam)] = [0.0] * KDE_GRID
                continue
            dens = gaussian_kde(vals, bw_method="scott")(grid)
            curves[key][str(fam)] = [round(float(d), 6) for d in dens]
    return curves


def compute_umap_coords(df):
    #UMAP on the standardized 7 primary attributes -> Float32 (n, 2).
    #always unseeded -> umap parallelizes across all cores (several times faster)
    checkpoint(f"UMAP: standardizing {len(df):,} rows x {len(PRIMARY_COLS)} attrs")
    x = df[PRIMARY_COLS].values.astype(np.float32)
    x_norm = StandardScaler().fit_transform(x)

    import umap  # imported lazily: heavy, only needed here

    checkpoint(f"UMAP: fitting (n_neighbors={UMAP_NEIGHBORS}, min_dist={UMAP_MIN_DIST}, "
               "FAST parallel, unseeded) "
               "- watch the phase/epoch output below, this is the slow step")
    reducer = umap.UMAP(n_neighbors=UMAP_NEIGHBORS, min_dist=UMAP_MIN_DIST,
                        metric="euclidean", n_jobs=-1,
                        verbose=True)
    coords = reducer.fit_transform(x_norm).astype(np.float32)
    checkpoint("UMAP: done")
    return coords


def _family_centroid(cells, coords, labels, family):
    #Count-weighted mean (cx, cy) over `family`'s MAJOR cells; used in T2  
    major = [c for c in cells if c["dominant"] == family and c["tier"] == "major"]
    source = major if major else [c for c in cells if c["dominant"] == family]
    if source:
        w = np.array([c["count"] for c in source], dtype=np.float64)
        cx = float(np.average([c["cx"] for c in source], weights=w))
        cy = float(np.average([c["cy"] for c in source], weights=w))
    else:
        pts = coords[labels == family]
        if len(pts) == 0:
            return None
        cx, cy = float(pts[:, 0].mean()), float(pts[:, 1].mean())
    return [round(cx, 4), round(cy, 4)]


def compute_spatial_grid(coords, labels, df):
    #T2 overview: a coarse square grid over the embedding, 
    n = len(coords)
    min_count = max(TUNE_MIN, round(TUNE_MIN * n / TUNE_SAMPLE))

    x0, x1 = float(coords[:, 0].min()), float(coords[:, 0].max())
    y0, y1 = float(coords[:, 1].min()), float(coords[:, 1].max())
    sx, sy = (x1 - x0) * 0.02, (y1 - y0) * 0.02      # 2% padding
    x0 -= sx; x1 += sx; y0 -= sy; y1 += sy
    rows = max(1, round(GRID_COLS * (y1 - y0) / (x1 - x0)))

    ix = np.clip(((coords[:, 0] - x0) / (x1 - x0) * GRID_COLS).astype(int), 0, GRID_COLS - 1)
    iy = np.clip(((coords[:, 1] - y0) / (y1 - y0) * rows).astype(int), 0, rows - 1)

    ys = df["YS(MPa)"].values
    csc = df["CSC"].values

    buckets = defaultdict(list)
    for p in range(n):
        buckets[(int(ix[p]), int(iy[p]))].append(p)

    cells = []
    for (gx, gy), pos in buckets.items():
        pos = np.array(pos)
        bc = np.bincount(labels[pos], minlength=7)
        cells.append({
            "gx": gx, "gy": gy,
            "cx": round(float(coords[pos, 0].mean()), 4),   # member centroid
            "cy": round(float(coords[pos, 1].mean()), 4),
            "count": int(len(pos)),
            "tier": "major" if len(pos) >= min_count else "fringe",
            "dominant": int(bc.argmax()),
            "purity": round(float(bc.max() / len(pos)), 3),
            "ys_med": round(float(np.median(ys[pos])), 1),
            "csc_med": round(float(np.median(csc[pos])), 3),
            "rowIds": [int(r) for r in pos],
        })

    # completeness guards: every row must land in exactly one cell
    total_count = sum(c["count"] for c in cells)
    if total_count != n:
        raise AssertionError(
            f"spatial_grid row-count mismatch: cells hold {total_count:,} rows, "
            f"dataset has {n:,} - a cell is dropping or double-counting rows")
    all_ids = (np.concatenate([np.asarray(c["rowIds"], dtype=np.int64) for c in cells])
              if cells else np.empty(0, dtype=np.int64))
    if not np.array_equal(np.sort(all_ids), np.arange(n, dtype=np.int64)):
        raise AssertionError(
            "spatial_grid rowId coverage broken: rowIds across all cells are not "
            "exactly {0..n-1} once each (missing and/or duplicated rowIds present)")

    family_centroids = [_family_centroid(cells, coords, labels, f) for f in range(7)]

    major_n = sum(1 for c in cells if c["tier"] == "major")
    fringe_n = len(cells) - major_n
    fringe_rows = sum(c["count"] for c in cells if c["tier"] == "fringe")
    checkpoint(f"      spatial_grid: {major_n} major cells, {fringe_n} fringe cells, "
               f"{fringe_rows:,} rows in fringe cells ({100 * fringe_rows / n:.1f}% of data)")

    return {
        "meta": {
            "schema": 2,
            "embedding": "nn50_md0.1", "extent": [x0, x1, y0, y1],
            "grid_cols": GRID_COLS, "grid_rows": int(rows), "min_count": int(min_count),
            "family_centroids": family_centroids,
        },
        "cells": cells,
    }


def _dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)

    args = parser.parse_args()

    t_all = time.time()

    #checkpoints are needed so it doestn't feel stuck
    checkpoint(f"[1/6] Loading dataset: {args.input}")
    df = load_dataset(args.input)
    checkpoint(f"[1/6] Loaded {len(df):,} rows x {df.shape[1]} cols")

  
    checkpoint("[2/6] Family labels (argmax + <=2pp Mixed rule)")
    labels = compute_family_labels(df)
    counts = np.bincount(labels, minlength=7)
    print("      counts (KS1295,6082,2024,bat-box,3003,4032,Mixed):", counts.tolist())
    np.save("family_labels.npy", labels)
    checkpoint("[2/6] -> family_labels.npy written")

    checkpoint("[3/6] Normalisation table (min/max per column)")
    norm_table = compute_norm_table(df)
    _dump(norm_table, "norm_table.json")
    checkpoint(f"[3/6] -> norm_table.json written ({len(norm_table)} columns)")

    checkpoint("[4/6] Violin KDE curves (14 attrs x 6 families)")
    t = time.time()
    kde = compute_kde_curves(df, labels, norm_table)
    _dump(kde, "kde_curves.json")
    checkpoint(f"[4/6] -> kde_curves.json written  ({time.time()-t:.1f}s)")


    # UMAP (the expensive step) + everything derived from it#
    checkpoint("[5/6] UMAP embedding - THE SLOW STEP (10-30+ min on full data "
               "when seeded; use --fast for parallel). Progress prints below.")
    t = time.time()
    coords = compute_umap_coords(df)
    np.save("umap_coords.npy", coords)
    checkpoint(f"[5/6] -> umap_coords.npy written {coords.shape}  ({time.time()-t:.1f}s)")

    checkpoint("[6/6] Spatial grid (two-tier bubbles + complete brush index)")
    grid = compute_spatial_grid(coords, labels, df)
    _dump(grid, "spatial_grid.json")
    m = grid["meta"]
    checkpoint(f"[6/6] -> spatial_grid.json written: {len(grid['cells'])} cells "
               f"(grid {m['grid_cols']}x{m['grid_rows']}, min_count={m['min_count']}, "
               f"schema={m['schema']})")

    checkpoint(f"DONE in {(time.time()-t_all)/60:.1f} min -> data")


if __name__ == "__main__":
    main()
