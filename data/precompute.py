"""
precompute.py — offline pre-computation pipeline
Owner: P2 - Branch: p2-data
See docs/nested_model_L1_L2_L3_L4_report.md Level 4 SS4.2 for the full
derivation and hyperparameter justification for every step below.

Produces the files consumed by the browser at load time:
    umap_coords.npy      Float32Array (n_rows, 2)
    family_labels.npy    Uint8Array (n_rows,)
    blob_contours.json   6 polygon vertex arrays [[x, y], ...]

Usage:
    python precompute.py --input Dataset_VisContest_Rapid_Alloy_development_v3.txt --outdir .
"""

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from scipy.stats import gaussian_kde

INPUT_COLS = ["KS1295[%]", "6082[%]", "2024[%]", "bat-box[%]", "3003[%]", "4032[%]"]

# 7 priority output attributes selected per report SS2.4 (exact column names
# in the actual v3 file still need hands-on confirmation per the pre-coding
# checklist in project_schedule.md)
PRIORITY_COLS = ["YS", "CSC", "TC", "ER", "Hardness", "Density", "LinearTE"]

MIXED_TIE_THRESHOLD_PP = 2.0  # percentage points; report SS2.3


def load_dataset(path):
    return pd.read_csv(path, sep="\t", encoding="latin-1")


def compute_umap_coords(df):
    x = df[PRIORITY_COLS].values
    x_norm = StandardScaler().fit_transform(x)

    import umap  # imported lazily: only required for this step

    reducer = umap.UMAP(n_neighbors=50, min_dist=0.1, metric="euclidean", random_state=42)
    coords = reducer.fit_transform(x_norm)
    return coords.astype(np.float32)


def compute_family_labels(df):
    ratios = df[INPUT_COLS].values
    top2 = np.sort(ratios, axis=1)[:, -2:]
    dominant = np.argmax(ratios, axis=1)
    mixed_mask = (top2[:, 1] - top2[:, 0]) <= MIXED_TIE_THRESHOLD_PP
    labels = np.where(mixed_mask, 6, dominant)  # 6 = Mixed
    return labels.astype(np.uint8)


def compute_blob_contours(coords, labels, grid_size=300, percentile=75):
    """One 2D KDE + percentile contour per non-Mixed family (index 0-5)."""
    contours = []
    x_grid = np.linspace(coords[:, 0].min(), coords[:, 0].max(), grid_size)
    y_grid = np.linspace(coords[:, 1].min(), coords[:, 1].max(), grid_size)
    xx, yy = np.meshgrid(x_grid, y_grid)

    for fam_idx in range(6):
        pts = coords[labels == fam_idx]
        kde = gaussian_kde(pts.T, bw_method="scott")
        z = kde(np.vstack([xx.ravel(), yy.ravel()])).reshape(grid_size, grid_size)
        threshold = np.percentile(z[z > 0], percentile)

        # TODO: extract contour polygon at `threshold` (matplotlib.contour or
        # skimage.measure.find_contours) and append as [[x, y], ...]
        contours.append([])

    return contours


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--outdir", default=".")
    args = parser.parse_args()

    df = load_dataset(args.input)

    labels = compute_family_labels(df)
    counts = np.bincount(labels, minlength=7)
    print("Family counts (KS1295, 6082, 2024, bat-box, 3003, 4032, Mixed):", counts.tolist())
    np.save(f"{args.outdir}/family_labels.npy", labels)

    coords = compute_umap_coords(df)
    np.save(f"{args.outdir}/umap_coords.npy", coords)

    contours = compute_blob_contours(coords, labels)
    with open(f"{args.outdir}/blob_contours.json", "w") as f:
        json.dump(contours, f)


if __name__ == "__main__":
    main()
