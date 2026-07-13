****# Visualization Design Report — Nested Model Levels 1, 2 & 3 (v4)
## Project: Aluminum Alloy Screening Dashboard
### IEEE SciVis Contest 2025 Dataset
---

## Methodology Framing

This project applies two complementary frameworks:

- **Munzner's Nested Model** (2009): a four-level model for visualization design and validation. This report covers Levels 1 (Domain Characterization), 2 (Data/Operation Abstraction), and 3 (Visual Encoding and Interaction Design).
- **Sedlmair et al.'s Design Study Methodology** (2012): a nine-phase process for problem-driven visualization research. The work presented here corresponds to the **Learn**, **Winnow**, **Cast**, and **Discover** phases.

**Scope statement:** This design study treats a single aluminum scrap recycling facility as the unit of analysis. The target user is one senior process engineer at this facility, with this specific workflow. Generalizability to other facilities, roles, or material systems is explicitly out of scope and has not been validated.

**Methodological limitations:**

1. *Single interview:* Domain knowledge was gathered through a structured interview with one practicing engineer. This is consistent with the Sedlmair et al. acknowledgment that front-line analyst access is often constrained by cost-of-access barriers. Single-interview findings are treated as working hypotheses, not population-level claims.

2. *Member checking not performed:* The task analysis and user characterization in this document were not returned to the domain expert for validation prior to submission. This is a known limitation. The domain expert's responses were recorded verbatim during the interview and are cited directly in this report; the interpretation of those responses into abstract tasks represents the authors' analysis and has not been independently verified by the expert.

---

## Level 1: Domain / Problem Characterization

### 1.1 User Profile

The target user is a **senior process engineer** at a European aluminum scrap recycling facility (14 years of experience). Key characteristics:

- Operates under **time pressure**: orders must be resolved within hours (*"a client calls Monday morning, they need 80 tons by Thursday"*)
- Thinks in terms of **recipes** (mixing ratios of scrap alloys), not abstract material properties
- Relies on **tacit knowledge** over data exploration: *"I learned it from a cracked batch in 2019 that cost us a client relationship for six months"*
- Applies **property-specific margins** above client constraint floors due to simulation error, intake composition variability, and furnace process variation
- Does **not** operate at the microstructural level: *"I know the consequence — the part cracks. The CSC number is enough for me to make decisions."*
- Currently uses Excel, which the expert described as *"built for lookup, and a bad lookup at that"*

### 1.2 Domain Situation

The engineer receives client orders specifying hard property constraints and selects a recipe — six scrap mixing ratios summing to 100% — predicted by CALPHAD simulation to satisfy them.

**Simultaneous order management:** The engineer manages multiple client orders concurrently but resolves them sequentially due to tool limitations: *"I solve for client A first, commit mentally to an allocation, then see what's left for client B. And sometimes I get to client B and realize I've painted myself into a corner."* This is an identified suboptimal behavior caused by tool constraints.

**Property-specific margins:** The engineer requires buffer above constraint floors, and the required buffer varies by property: *"For yield strength I typically want at least 8 to 10 percent above the client minimum... For CSC I want more buffer — 15 percent clear of it minimum. The consequences are asymmetric. If I get cracking in the mold I've lost the entire batch. No negotiation."* Density is more predictable (*"maybe 3 to 5 percent is enough"*); conductivity is newer territory (*"I've been going with 10 percent but that's not based on hard experience"*).

**Scrap flexibility:** *"If I know a certain scrap mix can serve three different client types, that pile becomes more valuable to me and I'll pay more for it at intake. But I've never been able to quantify that."*

**Discovery gap:** *"I'm making decisions from a dataset I've never actually seen as a whole."* On finding unusual recipes: *"If there's something with extraordinary properties sitting in row 47,832 that doesn't show up in my filtered results because I set one threshold slightly wrong — I will never find it. Never."*

### 1.3 Domain Tasks

| #   | Domain Task                                                                                                          | Evidence                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Session setup**: name the project; define 1–2 client constraint profiles with per-property margin thresholds       | Engineer receives client spec by phone before opening any tool; margins are property-specific                                                                                                                                                                                           |
| T2a | **Overview**: get a holistic sense of the distribution and range of the full alloy space                             | *"I have no idea what the landscape looks like... I'm making decisions from a dataset I've never actually seen as a whole"*                                                                                                                                                             |
| T2b | **Detect structure**: identify natural groupings and neighborhoods in the alloy space                                | *"Maybe they all share a similar ratio. Maybe there's a pattern. I have no idea"*                                                                                                                                                                                                       |
| T3  | **Identify flexible families**: find which scrap families simultaneously satisfy multiple client constraint profiles | *"Show me scrap families flexible enough to satisfy multiple different specs"* — set intersection, not simple filtering                                                                                                                                                                 |
| T4  | **Explore and rank candidates**: within a family, find the best K=4 alloys across active constraint properties       | *"I want to see the three or four options that are realistically buildable, with enough buffer"*                                                                                                                                                                                        |
| T5  | **Compare shortlisted candidates**: put up to 4 candidates side by side                                              | *"I type them into a small table. Manually. I'm making a judgment call."*                                                                                                                                                                                                               |
| T6  | **Export**: generate a PDF recipe summary for floor workers and clients                                              | Floor workers need mixing instructions + chemical composition; clients need property predictions; PDF also serves as the reference document if a client asks an unexpected property question later (*"Took me twenty minutes to find the right row. Client was on the phone waiting."*) |

**Note on T1 — concurrent order limit:** The dashboard supports a maximum of two simultaneous client constraint profiles. The domain expert described cases with two to three concurrent orders; the limit of two is a deliberate UI scope decision. Supporting two profiles already introduces significant interface complexity. Extension to three or more profiles is flagged as future work requiring separate usability validation.

### 1.4 Domain Vocabulary

- **Recipe**: six scrap mixing percentages summing to 100%
- **Dominant scrap**: the scrap alloy with the highest mixing percentage in a given recipe (tie-breaking rule in Section 2.3)
- **Constraint floor**: the hard threshold a client specifies for a property
- **Effective threshold**: constraint floor adjusted upward (for "higher is better") or downward (for "lower is better") by the property-specific margin
- **Margin / buffer**: the distance between a recipe's predicted value and the constraint floor; property-dependent
- **Flexible zone**: the subset of alloy space where recipes satisfy the effective thresholds of two distinct client profiles simultaneously; corresponds to the Set Intersection abstract task
- **CSC**: Hot Crack Susceptibility Coefficient — the engineer's primary proxy for solidification risk

---

## Level 2: Data / Operation Abstraction

### 2.1 Dataset

**Source:** IEEE SciVis Contest 2025 (Bugelnig & Requena, 2024). Zenodo doi: 10.5281/zenodo.15189444. File: `Dataset_VisContest_Rapid_Alloy_development_v3.txt`, tab-separated, Latin-1 encoding.

**Note on dataset version:** The contest website describes approximately 100,000 rows. The actual file (v3) contains **324,632 rows** and **70 columns** (6 input variables, 64 output variables). All computations in this report are based on the v3 file.

**Note on column name discrepancies:** The contest website and the actual file use different names for two scrap columns. The file contains `bat-box[%]` (website: "Batterybox [%]") and `4032[%]` (website: "4043 [%]"). All implementation references use the column names as they appear in the file.

### 2.2 Data Type Abstraction

| Munzner type | Value |
|---|---|
| Dataset type | Table |
| Items | Alloy candidates (rows) — 324,632 total |
| Attributes | Quantitative continuous (all 70 columns) |
| Ordering | None — rows are independent Latin hypercube samples |

No categorical variables exist in the raw data. The dominant scrap variable is derived (Section 2.3).

### 2.3 Derived Attribute: Dominant Scrap and Tie-Breaking Rule

Dominant scrap = argmax of the 6 input mixing ratio columns per row.

**Tie-breaking rule:** If the two highest mixing ratios differ by 2 percentage points or less, the alloy is classified as **"Mixed"** rather than assigned to either scrap family.

**Empirical validation (computed on v3 dataset):**

| Category | Count | Percentage |
|---|---|---|
| KS1295 | 50,160 | 15.5% |
| 6082 | 50,160 | 15.5% |
| 2024 | 50,160 | 15.5% |
| bat-box | 50,160 | 15.5% |
| 3003 | 50,160 | 15.5% |
| 4032 | 50,160 | 15.5% |
| **Mixed** | **23,672** | **7.3%** |

The six dominant-scrap categories are perfectly balanced by construction (Latin hypercube sampling). The "Mixed" category at 7.3% is well below the threshold at which it would dominate the visualization or undermine the analytical purpose of the color grouping. The tie-breaking rule is validated.

### 2.4 Attribute Selection and Tiers

All 14 interactive attributes are retained. They are divided into two tiers based on domain evidence:

#### Primary tier — 7 attributes (visible by default in constraint panel):

All 7 primary attributes are domain-grounded. Within the primary tier, a **most-used sub-group of 4** is foregrounded in the default dashboard view, based on two independent sources of evidence: (1) domain interview — these are the properties Klaus named most frequently and which appear in the majority of client specifications; (2) correlation structure — YS, TC, and ER form a tightly coupled triad (YS↔ER r=0.948, YS↔TC r=−0.915, ER↔TC r=−0.982), meaning together with CSC they encode the dominant axes of variation in the property space. The remaining three primary attributes (Hardness, Density, Linear thermal expansion) are domain-relevant but arise in specific client contexts rather than the general case.

| Attribute                      | Domain justification                                                                                                                                 | Most-used |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| YS (MPa)                       | Named explicitly by domain expert as primary decision criterion; anchor of the YS–TC–ER correlation triad                                            | ✓         |
| CSC                            | Primary proxy for crack risk; *"is CSC above my threshold? Then I don't use the recipe"*; non-negotiable in every order                              | ✓         |
| Thermal conductivity (W/(m·K)) | EV battery client requirement; *"My clients say conductivity. Always. Higher is better."*; strongly correlated with YS and ER                        | ✓         |
| Electrical resistivity (ohm·m) | EV battery client requirement; *"The EV client gave me resistivity. Lower is better."*; strongest pairwise correlation in dataset (r=−0.982 with TC) | ✓         |
| Hardness (Vickers)             | Named explicitly by domain expert                                                                                                                    |           |
| Density (g/cm³)                | *"Density in kilograms per cubic meter — that's my number. Affects shipping weight, pricing."*                                                       |           |
| Linear thermal expansion (1/K) | One direct client case: component interfacing with steel, thermal cycling stress; *"They gave me a single number, linear coefficient."*              |           |

#### Secondary tier — 7 attributes:

| Attribute | Note |
|---|---|
| Thermal diffusivity (m²/s) | No direct domain evidence; potentially relevant for process engineers |
| Heat capacity (J/(mol·K)) | No direct domain evidence; potentially relevant for foundry process control |
| Thermal resistivity (mK/W) | Mathematical inverse of thermal conductivity; retained for completeness; domain expert uses conductivity convention |
| Electrical conductivity (S/m) | Mathematical inverse of electrical resistivity; retained for completeness; domain expert uses resistivity convention for electrical |
| CTEvol — Volumetric thermal expansion (1/K) | Domain expert confirmed linear coefficient is always used; volumetric not encountered in client specs |
| Technical thermal expansion (1/K) | No domain evidence distinguishing this from linear coefficient |
| Volume (m³/mol) | No domain evidence in 14 years: *"Not once has anyone asked me about molar volume. Don't make me think in moles."* |

**Note on mathematical inverses:** Thermal resistivity and thermal conductivity encode the same physical quantity. Electrical conductivity and electrical resistivity encode the same physical quantity. Both are retained in the secondary tier to avoid excluding data. However, visualizing both simultaneously for the same physical quantity would be misleading due to non-linear axis scaling creating apparent pattern differences. Engineers are expected to use one convention per domain; the secondary tier is available for edge cases.

#### Excluded from interactive visualization (38 attributes):

All microstructure parameters (volume fractions, solidification temperatures, solidification intervals, eutectic parameters). Justification: *"Specific phases forming? I wouldn't be able to name them. That's genuinely my lab colleague's territory."* CSC serves as a sufficient proxy for solidification risk decisions.

#### PDF export only (12 attributes):

Chemical composition: Al, Si, Cu, Ni, Mg, Mn, Fe, Cr, Ti, Zr, V, Zn (wt.%). These are needed by floor workers for process control and are not decision-relevant during screening.

### 2.5 Task Abstraction

| Domain Task                                 | Abstract Task        | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2a — Holistic overview                     | **Summarize**        | *"I'm making decisions from a dataset I've never actually seen as a whole"*. **Computational operation:** offline dimensionality reduction via UMAP (Uniform Manifold Approximation and Projection) applied to the 14-attribute **output (property) space**, producing stored 2D coordinates per alloy. Pre-computed once in Python and loaded at runtime; the projection is never recomputed at runtime, guaranteeing a stable layout across sessions. **Why output space rather than input space:** Tasks T2a and T2b require understanding what property combinations are achievable, not navigating recipe compositions. The 6-dimensional input space is a compositional simplex (mixing ratios sum to 100%); projecting it would show recipe similarity, not property similarity. Clients specify requirements in property space; the engineer decides in property space. The dominant-scrap color encoding then overlays input-space grouping information onto the output-space layout, allowing the question "which recipe families tend to produce which property regions?" to be answered visually. **Preprocessing:** All 14 attributes are Z-score normalized (zero mean, unit variance) prior to UMAP. This is required because attributes span incomparable scales (YS in hundreds of MPa; Volume on the order of 10⁻⁵ m³/mol); without normalization, Euclidean distance is dominated by whichever attribute has the largest absolute variance. After normalization, a unit difference on any axis represents one standard deviation, and Euclidean distance is a fair measure of dissimilarity across all dimensions. **Hyperparameters:** `metric=euclidean` (appropriate after Z-score normalization); `n_neighbors=50` (balances local cluster resolution against global inter-family structure at this dataset size; lower values produce fragmented micro-clusters, higher values collapse within-family variation); `min_dist=0.1` (compact clusters that still preserve within-family spread); `random_state=42` (fixed seed). UMAP is used rather than density estimation or histogram aggregation because the task requires perception of neighborhood structure (which alloys are similar to each other in property space), not bin-level statistics. |
| T2b — Detect groupings                      | **Cluster**          | *"Maybe there's a pattern. I have no idea."* The abstract Cluster operation is the dominant-scrap grouping defined in Section 2.3: for each alloy, the argmax of the 6 input mixing ratios (with tie-breaking) produces a categorical group assignment. This is a formally computed derived attribute, not a visual percept. The result is 7 group labels pre-assigned to every row. How these group assignments are encoded visually in the UMAP layout is a Level 3 decision. UMAP itself is the Summarize operation (T2a); it does not compute or define the grouping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T3 — Flexible zone                          | **Set Intersection** | Finding alloys that satisfy effective threshold A AND effective threshold B simultaneously is not a predicate filter on a single attribute set — it is the intersection of two independently filtered subsets. Each profile's effective threshold (floor ± margin) is applied independently; only rows satisfying both effective thresholds are retained in the intersection. Raw constraint floors are not used for this operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T1/T4 — Apply thresholds, reduce candidates | **Filter**           | Standard predicate filter on quantitative attributes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T4 — Find best K candidates                 | **Find Top-K**       | K = 4, fixed. **Primary justification:** the domain expert described wanting "three or four options that are realistically buildable"; K=4 is the upper bound of that stated range. **Secondary constraint:** K=4 is separately compatible with the maximum number of simultaneously distinguishable colors under RG colorblindness (deuteranopia/protanopia). This accessibility constraint does not determine K; it confirms that the domain-grounded value does not require a different encoding strategy. If the Level 3 encoding were changed (e.g., shape rather than color), K=4 would remain valid on domain grounds alone. Ranking criterion: **minimum margin across all active constraints** (weakest-link principle). The alloy ranked first is the one where even its worst-performing property has the highest buffer above its effective threshold. Directly grounded in: *"If the client needs 160 MPa and my recipe gives exactly 161, I'm nervous."*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T5 — Side-by-side evaluation                | **Compare**          | *"I type them into a small table. Manually."*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T6 — Inspect full alloy record              | **Lookup**           | Retrieve and display all 17 characteristics (+ chemical composition) for up to 4 selected alloys in a side-by-side in-dashboard table. PDF export has been descoped (TA guidance). The engineer uses this table for floor-worker handoff and personal session reference. Alert flags from T5 are mirrored on relevant table rows. Abstract task revised from **Derive** (produce new artifact) to **Lookup** (retrieve existing data record). |

### 2.6 Per-Property Margin Defaults

Margins are editable per property in the constraint panel. Defaults are grounded in the domain interview:

| Property | Default margin | Direction | Justification |
|---|---|---|---|
| YS | 10% | Higher is better | *"At least 8 to 10 percent above the client minimum — simulation error, intake variation, and furnace variation stack up"* |
| CSC | 15% | Lower is better | *"I want to be 15 percent clear of it minimum. Consequences are asymmetric. If I get cracking in the mold I've lost the entire batch. No negotiation."* |
| Density | 5% | Lower is better | *"More predictable. The simulation tends to be reliable there. Maybe 3 to 5 percent is enough."* |
| Thermal / Electrical conductivity or resistivity | 10% | Property-dependent | *"Not based on hard experience, that's just me being cautious with something I don't fully trust yet."* |
| All other properties | 10% | Property-dependent | Conservative default; no domain evidence available |

---

## Summary Cascade: Level 1 → Level 2

| Level 1 (Domain) | Level 2 (Abstraction) |
|---|---|
| Engineer needs holistic overview (T2a) | Summarize via UMAP projection (pre-computed, output property space, 324,632 points) |
| Engineer needs to detect groupings (T2b) | Cluster — dominant-scrap grouping (Section 2.3); pre-computed categorical assignment |
| Engineer manages 2 client orders simultaneously (T3) | Set Intersection on effective thresholds (floor + margin per property) |
| Engineer applies hard client constraints (T1/T4) | Filter on 14 quantitative attributes |
| Engineer needs top 4 candidates (T4) | Find Top-K, K=4 (domain-grounded), weakest-link ranking |
| Engineer compares final candidates (T5) | Compare |
| Engineer needs full alloy record to hand off (T6) | Lookup — in-dashboard 17-attribute table; PDF export removed (TA guidance) |
| Stock availability affects recipe feasibility (T5/T6) | New supplementary data — pre-loaded stock file; low-stock and dual-project conflict alerts |
| Floor workers need chemical composition for execution | 12 chemical attributes in T6 characteristics table |
| Microstructure is lab territory | 38 attributes excluded; 2 direct interview quotes |
| Margins differ by property; consequences asymmetric | Per-property editable defaults, all interview-grounded |
| Mathematical inverse pairs (thermal, electrical) | Both retained; domain-preferred convention is primary tier; inverse in secondary tier |
| "Mixed" category size unknown | Computed on v3 dataset: 7.3% — validated as residual, not dominant |
| Member checking not performed | Stated explicitly as methodological limitation |

---

## Level 3: Visual Encoding and Interaction Design

### 3.1 Dashboard Architecture and View Sequence

The dashboard is organized as a linear workflow mapping to the task sequence T1 → T2 → T3 → T4 → T5 → T6, supporting progressive narrowing from the full alloy space to a final recipe document. T1 (session setup) does not occupy a permanent view area; it is a modal workflow. The remaining views are arranged spatially to reflect the workflow order.

**View layout:**

| Position | View | Task |
|---|---|---|
| Top bar | Project legend chips | T1 (persistent reference) |
| Left | UMAP Overview | T2a, T2b |
| Centre | Violin Plot | T3 |
| Right | Linked Scatter Panel | T4 |
| Bottom | Spider Chart(s) | T5 |
| Action | PDF export (per project) | T6 |

### 3.2 Cross-View Design Principles

#### 3.2.1 Colorblind-Safe Encoding Strategy

The target user population is male-dominated; approximately 8% of men have red-green color deficiency (deuteranopia/protanopia). Color hue alone is insufficient for 7-category data under these conditions.

**Primary channel:** color hue using the Okabe-Ito / Wong 8-color palette (`#E69F00`, `#56B4E9`, `#009E73`, `#0072B2`, `#D55E00`, `#CC79A7`, `#888888`). This palette was designed specifically for colorblind safety and is validated for deuteranopia and protanopia.

**Redundant channel:** texture fill is applied to all filled marks (blob fills at UMAP overview scale, dot fills at individual point scale, violin area fills) using the same 7-family assignment:

| Family | Color | Texture |
|---|---|---|
| KS1295 | #E69F00 orange | solid fill |
| 6082 | #56B4E9 sky blue | horizontal lines |
| 2024 | #009E73 green | dots |
| bat-box | #0072B2 blue | diagonal lines (45°) |
| 3003 | #D55E00 vermilion | crosshatch |
| 4032 | #CC79A7 pink | vertical lines |
| Mixed | #888888 grey | stipple |

The encoding is interpretable in full greyscale via texture alone. **Scope of redundancy:** texture is effective and perceptible at blob/overview scale (filled areas, violin fills). At individual point scale (4–6px diameter), crosshatch, horizontal lines, and dot patterns are not reliably distinguishable. At high zoom, color hue is therefore the primary discriminator; texture is vestigial. This is an accepted trade-off: at high zoom the visible region contains far fewer points and the engineer is typically within one family region, reducing cross-family ambiguity at cluster boundaries.

#### 3.2.2 Project Constraint Encoding

Constraints are encoded as **line marks** in all data views (T2, T3, T4). Project identity is encoded via **line style and annotation label**, not color. Using family palette hues for constraint lines would create a direct encoding conflict: `#E69F00` (KS1295 family) would simultaneously mean "Project A's threshold" in the same view. This conflict is eliminated by decoupling project identity from the color channel entirely.

Both project constraint lines use the same style: **solid black** (`#222222`). Project identity is communicated exclusively by a small **label box** anchored to each line:

- **Single project:** one solid black line per axis; label box reading "A" placed at the top of the line.
- **Two projects, different threshold values:** two solid black lines are drawn on the same axis. The "A" box is positioned at the top of its line; the "B" box at the bottom of its line (or at mid-height when the bottom position would overlap a tick label). This staggering ensures both boxes remain readable even when lines are close together.
- **Two projects, identical threshold values:** a single line is drawn with a combined **"A+B"** label box. No second line is drawn.

This vocabulary is consistent across all views (T3, T4). Eliminating the dashed / solid distinction removes any implied hierarchy between projects (both are equally weighted client requirements) and avoids the perceptual difficulty of reading short dashes against texture-filled violin areas.

**Exceptions:** T5 (spider chart) and T6 (PDF) represent project information as separate per-project views rather than overlaid lines, because their tasks (Compare, Derive) are project-specific rather than cross-project comparisons.

#### 3.2.3 UMAP Feasibility Encoding (Dual-Project)

When two projects are active, feasibility state in the UMAP is encoded via **opacity only**. Family hue and texture remain the primary encoding channels at all times and are never overridden.

| Feasibility state | Opacity |
|---|---|
| Feasible for at least one active project | Full (100%) |
| Feasible for neither project | Dimmed (10%) |

The distinction between "satisfies A only," "satisfies B only," and "satisfies both" is handled at the T3 violin view, where constraint lines per property column make the per-family, per-project intersection directly readable. The UMAP's role is global orientation (T2a) and family structure (T2b), not fine-grained per-project discrimination. Encoding 4 feasibility states via hue in the UMAP would conflict with the 7-color family palette; opacity-only avoids this conflict while preserving the UMAP's primary purpose.

In single-project mode, out-of-spec points are dimmed identically (Section 3.2.4).

#### 3.2.4 Opacity for Out-of-Spec Points

Points that do not satisfy the active project constraint(s) are **dimmed in opacity** rather than hidden. Hiding data removes positional information and creates a false impression that the feasible region is the entire data space. Dimming preserves the full distribution in view while directing attention to the feasible region, allowing the engineer to perceive proximity to the feasibility boundary.

### 3.3 T1 — Project Setup

**Interaction sequence:**

1. **"Add Project" button** → modal window opens containing: project name text field + constraint table (7 primary attributes × 3 columns: Property | Floor | Margin %). The 4 most-used attributes (YS, CSC, TC, ER) are visually foregrounded within the table. Pre-populated with domain-grounded defaults (Section 2.6).
2. **Apply** → modal collapses to a **legend chip** in the top bar, encoding: project name (text) + project hue (color swatch). Screen real estate is minimized for a value that changes infrequently.
3. **Edit** → clicking the legend chip reopens the modal. This gating is intentional: it reflects the domain reality that constraint profiles are set once per client call and rarely revised mid-session, preventing accidental edits.
4. **Second project** → "Add Project" again → identical flow; second chip appears alongside the first. Maximum 2 projects supported (Section 1.3, T1 note).

**Per-view legends:** when 2 projects are active, every visualization displays a small legend (project name + color swatch). The swatch color appears only in UI chrome (legend chips, view legends) and not in any data-space mark — it does not conflict with the family color encoding. Project A chip uses a black swatch; Project B uses a dark grey swatch, matching the constraint line styles (solid black / dashed grey) for visual consistency. With 1 project active, no legend appears — family encoding is unambiguous without a project identity distinction.

### 3.4 T2 — UMAP Overview

**Marks:** area (blob fills at overview zoom); point (individual dots at high zoom).

**Encoding channels:**

| Channel | Single project | Dual project |
|---|---|---|
| Position (x, y) | UMAP 2D coordinates (output property space) | same |
| Color hue | Family (Wong palette, 7 colors) | Family (Wong palette, unchanged) |
| Texture | Family (redundant at blob scale; vestigial at point scale) | same |
| Opacity | Out-of-spec: 10% dimmed; in-spec: 100% | Feasible for ≥1 project: 100%; feasible for neither: 10% |

**T2 functions as a summary overview only.** Individual point rendering has been removed by TA guidance: the view is not intended as a record-level lookup tool. At 324,632 points, individual-point zoom serves no meaningful decision purpose and adds implementation complexity with no analytical gain. The UMAP's function is T2a (holistic overview of structure) and T2b (detect family groupings); both are fully served at blob level.

**Blob computation:** family blobs are computed as **kernel density estimates (KDE)** per family using a Gaussian kernel with bandwidth selected via Scott's rule (`h = n^(−1/5) × σ`, applied per dimension). The blob boundary is the 75th-percentile contour of each family's UMAP-projected points. Texture fill is applied within each contour (Section 3.2.1). Scott's rule requires no manual parameter selection and is reproducible given the fixed UMAP seed.

**Rendering strategy:** Canvas 2D API. Only ~7 KDE contour fills are drawn per frame — trivial render cost. A **quadtree spatial index** is still pre-built at load time to support rectangle / lasso brush selection (querying which alloy rows fall inside the drawn region), but it is not used for per-point rendering.

**Constraint encoding:** opacity only (Section 3.2.4). Constraint line marks are not drawn in T2 — at 324,632-point density, line marks would be obscured and would conflict with KDE contour boundaries.

**Interactions:**
- Pan and zoom (blob shapes scale smoothly; no mode transition)
- Rectangle / lasso select → quadtree query → linked brush to T3 violin and T4 scatter panel
- **Hover tooltip:** hovering over a blob region shows a family-level summary — family name, total point count, median and IQR for YS / CSC / TC / ER for that family.

### 3.5 T3 — Violin Plot (Set Intersection View)

**Purpose:** reveals which scrap families satisfy the effective thresholds of one or both client projects across property distributions. By TA guidance the view now exposes distributions for **all 14 interactive attributes**, organized in two tiers.

**Marks:** violin area fills; vertical line marks (constraints).

**Layout:**
- **Y axis:** 6 scrap families (KS1295, 6082, 2024, bat-box, 3003, 4032). The Mixed category is omitted: its property distribution is diffuse and not characterizable as a family profile (tie-breaking rule, Section 2.3).
- **X axis:** a single shared normalized scale (0 = worst in dataset, 1 = best), inverted per property where lower is better, so rightward = better consistently.
- **Default view — 7 property columns:** the 7 primary attributes (YS, CSC, TC, ER, Hardness, Density, Linear TE) are shown by default. Each occupies a sub-region of the shared x-axis separated by a gap; column labels appear above each sub-region. Expanding from the original 4 to all 7 primary attributes ensures the engineer sees the full set relevant to client specifications before deciding whether to refine further.
- **"See more" toggle:** a disclosure button below the default columns reveals the **secondary 7 attributes** (Thermal diffusivity, Heat capacity, Thermal resistivity, Electrical conductivity, CTEvol, Technical thermal expansion, Volume) as additional columns in the same layout style. These are collapsed by default because they are either mathematical inverses of primary attributes or lack direct client-specification evidence (Section 2.4). The toggle persists within a session; the engineer can expand and collapse as needed.
- **Violin texture fill:** encodes family (same scheme as T2, Section 3.2.1). Each violin is a **1D KDE** per property per family, Gaussian kernel, Scott's rule bandwidth — consistent with T2 blob computation.

**Constraint encoding:** vertical line marks per property column, styled per Section 3.2.2 (solid black "A" / dashed grey "B"). With 1 project: 1 line per column. With 2 projects: 2 lines per column. A family whose violin body extends beyond both constraint lines across all 4 property columns is in the T3 flexible zone (Set Intersection).

**Constraint line position on the normalized axis:** the effective threshold (floor ± margin) is mapped to the 0–1 scale using the full dataset min and max for each property, pre-computed at load time:

- For higher-is-better properties: `x = (effective_threshold − property_min) / (property_max − property_min)`
- For lower-is-better properties (inverted axis): `x = 1 − (effective_threshold − property_min) / (property_max − property_min)`

If the engineer sets a floor outside the dataset range, the constraint line appears outside the violin area with an annotation: "constraint met by all" (line left of axis origin) or "constraint met by none" (line right of axis end).

### 3.6 T4 — Linked Scatter Panel (Filter View)

**Marks:** points; line marks (constraints); area mark (feasibility zone shading); area mark (stacked bar).

**Layout (revised by TA):** 3 panels by default, arranged in a single column.
- **Panel ① (fixed):** YS vs CSC — the two most universally constrained properties; this plot always appears and cannot be removed or reconfigured.
- **Panel ② (custom):** user-configurable X and Y axis via dropdown selectors; default TC vs YS.
- **Panel ③ (stacked bar):** scrap composition of selected alloys; always last.
- **"+ Add plot" button:** appears below Panel ③. Each click spawns one additional custom scatter plot (identical layout to Panel ②, with independent axis dropdowns). There is no hard cap on additional panels, though screen real estate naturally limits practical use to 1–2 extras.
- **Shared legend:** a single family color/texture legend strip appears at the **top of the entire filter panel**, above Panel ①. This replaces per-plot legends, reducing visual clutter given that all scatter plots share the same encoding vocabulary.

**Encoding channels:**
- Position (x, y): quantitative property values
- Color hue: family (Wong palette)
- Opacity: selected alloys full; unselected partial
- Number label (1–4): ordinal identity of selected alloys

**Constraint encoding:** per the revised project line encoding (Section 3.2.2): solid black lines with label boxes ("A" / "B" / "A+B"). With 1 project: a green shaded rectangle marks the feasibility zone. With 2 projects: two overlapping low-opacity fills — warm amber tint for Project A's zone, cool blue tint for Project B's — maintaining the A/B identity from T1 within the shading; the overlap region receives a combined tint. T3 (violin) remains the designated view for intersection reasoning.

**Interactions:**
- Rectangle drag → zoom; double-click resets
- Click-to-select (max 4 alloys); numbered labels 1–4
- Axis dropdowns on all non-fixed panels
- Stacked bar panel ③: for each selected alloy, a stacked bar showing the 6 scrap mixing percentages with labels on segments wider than 12 px. Hovering any point in any scatter plot shows a tooltip with all 7 primary attributes, allowing the engineer to inspect Hardness, Density, and Linear TE before committing a selection to T5.

### 3.7 T5 — Spider Chart (Comparison View)

**One spider chart per active project.** Each chart contains only alloys selected while that project's context was active. With 2 projects: 2 spider charts side by side.

**Marks:** polygon (radar area per alloy); line (spokes); point (axis value positions).

**Axis ordering:** CSC → YS → TC → ER → Hardness → Density → Linear TE. Justification: (1) CSC is placed first — it is the non-negotiable criterion (*"is CSC above my threshold? Then I don't use the recipe"*); (2) YS, TC, and ER are placed adjacent because they form the dominant correlation triad (r = 0.948, −0.915, −0.982) — adjacency makes their co-variation visible as a cohesive polygon segment; (3) Hardness, Density, and Linear TE follow in domain priority order. Axis order is fixed and not user-adjustable; a stable order allows the engineer to develop spatial heuristics for the polygon shape across sessions.

**Encoding channels:**
- Radial position on each spoke: normalized property value (0 = worst in dataset, 1 = best)
- Color hue of polygon outline and fill (semi-transparent): alloy identity (Wong palette, up to 4 per spider)
- **Threshold alert:** applied per alloy per axis — the specific **polygon vertex** on a failing spoke is rendered in red, and the corresponding **legend entry** for that alloy is rendered bold and red. The axis label itself is not altered. This makes the alert alloy-specific: the engineer sees exactly which alloy is failing on which property without cross-referencing the legend.

**Axis normalization and inversion:** all 7 primary attributes are normalized to 0–1 using dataset min and max. Attributes where lower is better (CSC, Density, Electrical resistivity, Linear thermal expansion) are inverted so that outward = better on every spoke. The chart allows qualitative comparison of attribute profiles across up to 4 alloys on normalized axes, where outward = better on every spoke. Note: polygon area is not interpretable as an overall quality measure — reordering the axes without changing any data values changes the polygon area. Area is an artifact of axis sequence, not a valid data encoding.

**Threshold alert (constraint violation):** no geometric ring. Two redundant signals: a red polygon vertex on the failing spoke, and a bold legend entry for that alloy. **Colorblindness caveat:** red can be confused with orange-brown under deuteranopia/protanopia; `#E69F00` (KS1295) may appear nearby. The bold legend entry is the primary failure indicator for colorblind users; the red vertex is redundant for full-color users.

**Stock alert (new, TA-added):** the dashboard pre-loads a supplementary stock file containing current available quantity (kg) per scrap alloy. This data is not part of the SciVis dataset; it is a facility-specific input loaded at session start. Two alert conditions are evaluated per selected alloy in T5:

1. **Low stock:** the alloy's recipe requires a scrap alloy whose available stock falls below a critical threshold. The corresponding spider axis vertex is flagged with an **amber warning marker** (distinct from the red constraint-violation marker) and the legend entry shows a stock-warning icon.
2. **Dual-project stock conflict:** when two projects are active, the combined quantity of a scrap alloy needed to fulfil both recipes simultaneously exceeds available stock. This is flagged with the same amber marker and a specific legend annotation: *"Insufficient stock for A+B simultaneously."*

**Open question (to be resolved with user):** the exact numeric threshold for "low stock" (absolute kg vs. percentage of recipe requirement vs. projected depletion rate) and the visual disambiguation between single-project and dual-project stock alerts (separate marker shapes vs. combined) have not yet been finalized. This will require a follow-up domain session before Level 4 (Algorithm) encoding is specified.

### 3.8 T6 — Alloy Characteristics Table (revised by TA)

**PDF export has been removed.** The external-document workflow (PDF per project for client submission) has been descoped. In its place, T6 is an **in-dashboard characteristics panel** that appears when one or more alloys are selected in T4.

**Panel content (per selected alloy, up to 4 side-by-side columns):**
1. **Recipe:** 6 scrap mixing ratios (summing to 100%), shown as a stacked bar + numeric values
2. **All 17 characteristics** in a scrollable table:
   - 7 primary attributes (YS, CSC, TC, ER, Hardness, Density, Linear TE)
   - 5 additional output properties (Thermal diffusivity, Heat capacity, Electrical conductivity, CTEvol, Technical thermal expansion)
   - 5 secondary attributes (Thermal resistivity, Volume, and the remaining secondary-tier outputs)

   *Note: the exact composition of the 17 fields will be confirmed once the final attribute-tier mapping is frozen. The count "17" is the user's target; it corresponds to the 14 interactive attributes plus 3 supplementary output fields.*

3. **Chemical composition:** Al, Si, Cu, Ni, Mg, Mn, Fe, Cr, Ti, Zr, V, Zn (wt.%) — retained for floor worker reference

**Alert integration:** the characteristics table inherits alert state from T5. Properties flagged with a red constraint-violation marker or amber stock-warning marker in the spider chart show the corresponding color-coded flag on the relevant row in the table, creating redundant in-table communication of the alert without requiring the engineer to cross-reference the spider.

**Simulation disclaimer:** a fixed disclaimer row appears at the bottom of the panel: *"Values are CALPHAD predictions. Verify by laboratory measurement before production use."*

**Abstract task change:** the domain task T6 ("Generate recipe document") was abstracted as **Derive** (produce a new external artifact) in the original mapping. With the PDF removed, T6 is now abstracted as **Lookup** — retrieve and display the full attribute record for a selected alloy. The previous justification for Derive (serving two audiences — clients and floor workers via a portable document) no longer applies.

---

## Summary Cascade: Level 1 → Level 2 → Level 3

| Level 1 (Domain) | Level 2 (Abstraction) | Level 3 (Encoding) |
|---|---|---|
| Engineer needs holistic overview (T2a) | Summarize via UMAP (pre-computed, output property space) | KDE blob overview only (TA: no individual point zoom); opacity for out-of-spec; quadtree for brush queries |
| Engineer needs to detect groupings (T2b) | Cluster — dominant-scrap assignment (Section 2.3) | Hue + texture encode family; dual-project feasibility via opacity only |
| Engineer manages 2 client orders (T3) | Set Intersection on effective thresholds | Violin: 6 families × 7 primary attributes (default) + 7 secondary ("See more"); both project lines solid black, label box "A"/"B"/"A+B" |
| Engineer applies hard constraints (T1/T4) | Filter on 14 quantitative attributes | 3-panel filter (YS vs CSC fixed, 1 custom, stacked bar); shared top legend; "+ Add plot" button |
| Engineer needs top 4 candidates (T4) | Find Top-K, K=4 (domain-grounded upper bound) | Click-to-select up to 4; numbered labels 1–4; hover tooltip shows all 7 primary attributes |
| Engineer compares final candidates (T5) | Compare | One spider per project; 7 axes; red vertex for constraint violation; amber vertex for stock alert (thresholds TBD) |
| Engineer needs full alloy record to hand off (T6) | Lookup — in-dashboard table | 17 characteristics + recipe + chemical composition side-by-side; PDF export removed (TA); alert flags mirrored from T5 |
| Stock availability is a real operational constraint | New pre-loaded supplementary data | Amber stock-warning vertex in T5; mirrored in T6 table; low-stock and dual-project conflict alerts |
| Colorblind-safe encoding required | 7 categorical families | Wong palette (hue) + texture fill (redundant); encoding interpretable in greyscale |
| Constraints rarely change mid-session | — | T1 gated behind legend chip click; modal collapses after apply |
| Member checking not performed | Stated limitation | — |

---

## Level 4: Algorithm

Level 4 specifies the concrete computational algorithms, data structures, and implementation contracts for every view. Three recurring pitfalls: (1) **performance** — 324,632 rows must never be iterated naively in the render loop; (2) **numerical correctness** — normalization, KDE bandwidth, and UMAP coordinates must be deterministic and reproducible across sessions; (3) **pipeline integrity** — all views share a single `datavis.js` session state object; writes happen only from T1 (constraint changes) and the loading pipeline.

---

### 4.0 Loading Pipeline and Loading Tab

The dashboard opens on a dedicated **Loading tab** — always the first tab visible. The engineer can interact with T1 (project setup modal) immediately; all other views render empty placeholder states until `datavis.js` reports `state.loaded = true`. All loading steps run in a **Web Worker** to avoid blocking the main thread.

#### 4.0.1 Browser-side loading sequence

| Step | Operation | Estimated time |
|---|---|---|
| 1 | Parse raw dataset: tab-separated, Latin-1, 324,632 × 70 cols → typed column arrays | 3–5 s |
| 2 | Load precomputed `umap_coords.npy` → Float32Array (324,632 × 2) | < 1 s |
| 3 | Load precomputed `family_labels.npy` → Uint8Array (324,632) | < 1 s |
| 4 | Load precomputed `blob_contours.json` → per-family polygon vertex arrays | < 1 s |
| 5 | Compute normalization table: dataset-wide min/max per column, single O(n) pass | ~1 s |
| 6 | Compute 1D KDE: 7 properties × 7 families = 49 curves, 200-point grid each | 5–8 s |
| 7 | Build quadtree over 324,632 UMAP coordinate pairs | ~2 s |
| 8 | Parse stock CSV → `stock[scrap_family_name] = qty_kg` lookup object | < 1 s |
| 9 | Write all results to `datavis.js`; emit `state.loaded = true` | — |

**Total estimated time: ~13–19 seconds.** The Loading tab displays the current step label in sequence so the engineer can follow progress.

**Column-store layout:** the dataset is stored as `columns[colName] = TypedArray` rather than `rows[i] = {col: value}`. This avoids allocating 324,632 JavaScript objects, reduces garbage collection pressure, and keeps per-column KDE iterations cache-local. A row is reconstructed on demand as `{col: columns[col][rowIndex]}` when needed for tooltips or T6 lookup.

#### 4.0.2 Loading tab data table

Once `state.loaded = true`, the Loading tab becomes a data-preview table showing the full dataset. It is not connected to the cross-view selection pipeline — it is read-only inspection.

- **Pagination:** 100 rows per page. Previous / Next buttons. Page counter: "Page 3 of 3,247".
- **Columns:** all 70 meaningful columns, plus one computed column: **"Scrap Family"** (string label derived from `family_labels` Uint8Array, e.g. "KS1295", "Mixed"). Family column is read-only.
- **Hover state:** `mouseover` a row → light background tint `rgba(0,0,0,0.06)`. A tooltip appears showing full values of any cells truncated by column width. No click action, no column sorting, no search/filter.

---

### 4.1 T1 Session Setup Algorithm

T1 is the **sole writer** to `datavis.js` session state. All other views are read-only consumers. The modal is accessible at any time, including during loading.

#### 4.1.1 Effective threshold calculation

The engineer enters a **Floor** (hard client minimum) and **Margin %** (property-specific safety buffer) per attribute. The **effective threshold** — the value drawn as a constraint line in T3/T4/T5 and used in all feasibility computations — is:

```
Higher-is-better (YS, TC, Hardness, Electrical Conductivity):
    effective = floor × (1 + margin / 100)

Lower-is-better (CSC, ER, Density, Linear TE, Thermal Resistivity):
    effective = floor × (1 − margin / 100)
```

This calculation runs once on Apply. All views read `session.projects[p].thresholds[attr].effective` directly — they never access Floor or Margin.

**Default margins** (domain-grounded, Section 2.6): YS 10%, CSC 15%, Density 5%, all others 10%.

#### 4.1.2 Batch size field

Each project includes a **Batch size (kg)** numeric input (default: 1000 kg). This value is used exclusively by the T5 stock alert algorithm (Section 4.6.2) to convert recipe fractions into absolute required quantities. It has no effect on constraint lines, violin shapes, or scatter plots.

#### 4.1.3 Dual-project activation

A **"+ Add Project B"** button appears below the Project A form. When clicked:
- A second form column appears (identical fields: name, constraint table for 7 primary attributes, batch size)
- Session state gains a second entry in `session.projects[]`
- T3 immediately renders a second constraint line per property column
- T4 renders a second feasibility zone tint
- T5 renders a second spider chart

Maximum 2 projects. A **"× Remove Project B"** button clears all Project B data from session state and collapses the second form column.

#### 4.1.4 Input validation

| Field | Rule | On violation |
|---|---|---|
| Project name | Non-empty string | Red border; Apply button disabled |
| Floor (all properties) | Positive number | Red border; Apply button disabled |
| Margin % | 0–100 | Silently clamped to [0, 100]; no error shown |
| Batch size (kg) | Positive integer ≥ 1 | Red border; Apply button disabled |

#### 4.1.5 Session state written on Apply

```javascript
session.projects = [
    {
        name: "Project A",
        batch_kg: 1000,
        thresholds: {
            YS:       { floor: 250, margin: 10, effective: 275 },
            CSC:      { floor: 0.8, margin: 15, effective: 0.68 },
            TC:       { floor: 140, margin: 10, effective: 154 },
            ER:       { floor: 3e-8, margin: 10, effective: 2.7e-8 },
            Hardness: { floor: 85,  margin: 10, effective: 93.5 },
            Density:  { floor: 2.8, margin: 5,  effective: 2.66 },
            LinearTE: { floor: 2.2e-5, margin: 10, effective: 1.98e-5 }
        }
    }
    // second entry appended if Project B is active
];
```

All views subscribe via `pipeline.onChange('projects', renderCallback)` and re-render on any change.

#### 4.1.6 Re-apply behavior

When the engineer edits T1 and clicks Apply again:

**Persist (do not reset):**
- T2 brush region (spatial selection in UMAP space)
- T3 range brushes (per-property axis selections)
- T4 selected alloys (numbered 1–4; numbering unchanged)

**Recompute and re-render:**
- All effective thresholds → T3 constraint lines redraw
- T4 feasibility zones redraw
- T5 constraint violation markers recompute (same alloy selection, new thresholds)
- T5/T6 stock alerts recheck against new batch size
- T6 cell color coding updates

**Edge case — Project B removed:** if re-apply removes Project B (second project deleted), Project B's T4 picks are cleared from the selection. Project A's picks persist unchanged.

---

### 4.2 Offline Pre-computation Pipeline (Python)

---

All computationally expensive operations are performed once in Python before the dashboard loads. The browser receives only pre-computed arrays; no dimensionality reduction or blob KDE computation runs at runtime.

**Step 1 — Data loading**

```python
import pandas as pd
df = pd.read_csv('Dataset_VisContest_Rapid_Alloy_development_v3.txt',
                 sep='\t', encoding='latin-1')
```

The 6 input columns (scrap mixing ratios) and 64 output columns are separated. All downstream computation uses column names exactly as they appear in the file (`bat-box[%]`, `4032[%]`).

**Step 2 — Attribute selection and normalization**

The 7 priority output attributes are selected by exact column name. Z-score normalization is applied per column:

```python
from sklearn.preprocessing import StandardScaler
X = df[PRIORITY_COLS].values          # shape (324632, 7)
X_norm = StandardScaler().fit_transform(X)
```

Z-score normalization is required because attributes span incomparable absolute scales (YS ~200–360 MPa; Volume ~10⁻⁵ m³/mol). After normalization, a unit difference on any attribute represents one standard deviation; Euclidean distance treats all attributes equally. `StandardScaler` is fit on the full dataset; the same scaler parameters (mean, std per column) are saved for use in the constraint-normalization step at runtime.

**Step 3 — UMAP**

```python
import umap
reducer = umap.UMAP(n_neighbors=50, min_dist=0.1,
                    metric='euclidean', random_state=42)
coords = reducer.fit_transform(X_norm)   # shape (324632, 2)
np.save('umap_coords.npy', coords.astype(np.float32))
```

Hyperparameter justification:
- `n_neighbors=50`: balances local cluster resolution against global inter-family structure at this dataset size. Lower values (e.g., 15) produce fragmented micro-clusters that obscure family groupings; higher values (e.g., 200) collapse within-family variation into single dense blobs. 50 was selected as the mid-point of the stable range for datasets of this size.
- `min_dist=0.1`: allows compact clusters while preserving within-family spread. A smaller value (0.01) packs clusters so tightly that the KDE 75th-percentile contours collapse; a larger value (0.5) produces diffuse blobs with significant inter-family overlap.
- `metric='euclidean'`: appropriate after Z-score normalization because all axes are now commensurate.
- `random_state=42`: fixed seed ensures a stable, reproducible layout across runs. The layout is computed once and never re-run at runtime; the fixed seed is the mechanism that makes the spatial encoding reliable across sessions.

**Step 4 — Dominant-scrap classification**

```python
INPUT_COLS = ['KS1295[%]', '6082[%]', '2024[%]', 'bat-box[%]', '3003[%]', '4032[%]']
ratios = df[INPUT_COLS].values
top2 = np.sort(ratios, axis=1)[:, -2:]
dominant = np.argmax(ratios, axis=1)
mixed_mask = (top2[:, 1] - top2[:, 0]) <= 2.0
labels = np.where(mixed_mask, 6, dominant)   # 6 = Mixed
np.save('family_labels.npy', labels.astype(np.uint8))
```

The tie-breaking threshold is 2 percentage points. The resulting label array maps directly to the 7-color Wong palette and 7 texture patterns.

**Step 5 — KDE blob pre-computation**

```python
from scipy.stats import gaussian_kde
from sklearn.preprocessing import StandardScaler

for fam_idx in range(6):    # Mixed excluded from blobs
    pts = coords[labels == fam_idx]          # UMAP 2D coords for this family
    kde = gaussian_kde(pts.T, bw_method='scott')
    # Evaluate on grid
    x_grid = np.linspace(coords[:,0].min(), coords[:,0].max(), 300)
    y_grid = np.linspace(coords[:,1].min(), coords[:,1].max(), 300)
    XX, YY = np.meshgrid(x_grid, y_grid)
    Z = kde(np.vstack([XX.ravel(), YY.ravel()])).reshape(300, 300)
    # 75th-percentile contour threshold
    threshold = np.percentile(Z[Z > 0], 75)
    # Extract contour polygon (via matplotlib contour or skimage find_contours)
    ...
```

Scott's rule bandwidth: `h = n^(-1/(d+4)) × σ` where `d = 2` (2D UMAP space) and `σ` is the standard deviation of each axis for that family's subset. The bandwidth is computed independently per family and per axis by `scipy.stats.gaussian_kde` with `bw_method='scott'`. The 75th-percentile contour threshold is computed from the non-zero KDE values; this produces blobs that enclose the denser core of each family cluster rather than the full extent. Contour polygons are saved as JSON arrays of `[x, y]` vertices for direct Canvas 2D path construction.

---

### 4.3 Runtime Rendering — T2 UMAP (Canvas 2D)

**Quadtree spatial index**

At page load, a quadtree is constructed from the 324,632 UMAP coordinate pairs. The implementation uses a standard point-region quadtree with a bucket capacity of 4. Each leaf stores (umap_x, umap_y, row_index). Construction time is O(n log n); query for a rectangle [x₁,y₁,x₂,y₂] is O(log n + k) where k is the number of points returned.

The quadtree is the only structure that stores individual point data in the browser. It is used exclusively for brush selection queries — not for rendering.

**KDE blob rendering**

```javascript
// For each of the 6 non-Mixed families:
ctx.beginPath();
contourPolygon.forEach(([x, y], i) => {
    const [px, py] = dataToCanvas(x, y);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
});
ctx.closePath();
ctx.globalAlpha = opacity;          // 1.0 (feasible) or 0.1 (infeasible)
ctx.fillStyle = familyPattern[fam]; // CanvasPattern with Wong hue + texture
ctx.fill();
ctx.strokeStyle = familyColor[fam];
ctx.lineWidth = 1.5;
ctx.stroke();
```

Texture patterns are pre-rendered onto 8×8 or 16×16 offscreen canvases at page load and wrapped with `ctx.createPattern(offscreen, 'repeat')`. Each family has a distinct pattern (solid fill, horizontal lines, dots, diagonal lines, crosshatch, vertical lines, stipple). The pattern is applied once per family blob draw; because there are only 6–7 blobs, the render budget is trivial.

**Opacity encoding for feasibility**

```javascript
const opacity = isFeasible(row) ? 1.0 : 0.1;
```

`isFeasible` evaluates the active project constraints against the row's property values at blob level: a family blob is rendered at full opacity if any point in that family satisfies at least one active project's effective thresholds; at 0.1 opacity if none do. This is an approximate family-level check — per-point opacity would require rendering individual points, which has been removed.

---

### 4.4 Violin 1D KDE and Brush Highlight (T3)

**Per-property per-family bandwidth and evaluation**

```javascript
// For property p, family f:
const values = subset.map(row => row[p]);              // raw values for this family
const norm = values.map(v => normalize(v, p));         // map to [0,1]; invert if lower=better
const n = norm.length;
const std = stdDev(norm);
const h = Math.pow(n, -1/5) * std;                    // Scott's rule, 1D: n^(-1/5) * σ
const grid = linspace(0, 1, 200);                     // 200 evaluation points
const kde = grid.map(x =>
    norm.reduce((sum, xi) =>
        sum + gaussianKernel((x - xi) / h), 0) / (n * h)
);
```

`gaussianKernel(u) = (1/√(2π)) × exp(−u²/2)`. The KDE is evaluated on a fixed 200-point grid over [0,1]. The result is a density curve; it is rendered as a mirrored area path (violin shape) with the axis as the centre line.

**Normalization**

Property min and max are computed from the full 324,632-row dataset at load time and stored in a lookup table. For each property:
- Higher-is-better: `norm = (value − prop_min) / (prop_max − prop_min)`
- Lower-is-better (CSC, ER, Density, Linear TE): `norm = 1 − (value − prop_min) / (prop_max − prop_min)`

When the engineer sets a constraint, the effective threshold is mapped to the same normalized axis using the same min/max, ensuring constraint lines are positioned consistently with violin body positions.

**Brush highlight — no KDE recomputation**

When the engineer drags a range `[a, b]` on a T3 property axis:
- The existing violin KDE shape is **never recomputed**
- A semi-transparent overlay is drawn over the `[a, b]` portion of the existing violin path only, shading the region geometrically
- The shaded region visually represents the fraction of that family's distribution falling in the selected attribute range — this is a purely geometric operation on the already-rendered shape
- The brush emits the selected row IDs (from the underlying data) to `datavis.js` for use by T2 and T4; it does not trigger any KDE update

**"See more" reveal and brush on hidden columns**

Secondary attribute violin columns are pre-computed with the same KDE pipeline at load but their DOM elements are set to `display: none`. The disclosure button toggles `display: block` and triggers a single redraw; no recomputation occurs. If a brush range is active when "See more" is toggled, the highlight is applied to the newly visible columns immediately on reveal — no additional interaction required.

---

### 4.5 Canvas 2D Scatter Rendering and Zoom (T4)

T4 plots individual points from the active T2 ∩ T3 intersection set. The maximum intersection size is 324,632; in practice, after two or more brushes it is typically in the low thousands.

```javascript
function drawScatter(ctx, points, axisX, axisY, selection, constraints) {
    points.forEach(row => {
        const x = toCanvasX(row[axisX]);
        const y = toCanvasY(row[axisY]);
        const alpha = selection.has(row.id) ? 1.0 : 0.35;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = familyColor[row.family];
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
    });
    drawConstraintLines(ctx, constraints, axisX, axisY);
    drawFeasibilityZone(ctx, constraints, axisX, axisY);
}
```

Points outside the active selection are rendered at 35 % opacity (not hidden). Constraint lines are drawn after points so they are always visible above the point layer.

**Feasibility zone shading**

Single-project: fill the rectangle bounded by the YS effective threshold (x) and CSC effective threshold (y) in the direction of better performance, using `rgba(0,180,0,0.12)`.

Dual-project: two independent fills — Project A in `rgba(230,159,0,0.10)` (amber), Project B in `rgba(0,114,178,0.10)` (blue). Both fills are drawn independently; the overlap region naturally compounds to approximately double the opacity, providing a visual cue for the intersection without requiring an explicit computation.

**Rectangle drag zoom**

The only zoom mechanism in T4 is a rectangle drag. No mouse-scroll zoom. No range sliders.

1. The engineer drags a rectangle on any active scatter panel — the **active panel**
2. Record the drag bounding box in data space: `[xMin, xMax, yMin, yMax]` from the active panel's axis scales
3. Identify the row IDs of all points whose active panel coordinates fall within this bounding box
4. The **active panel** zooms its canvas to show only this bounding box
5. All **other scatter panels** independently refit their own axis ranges to show the same subset of row IDs — each panel uses `[min(rows[ownAxisX]), max(rows[ownAxisX])]` for its X and `[min(rows[ownAxisY]), max(rows[ownAxisY])]` for its Y. Axes are never shared across panels.
6. **Double-click on any panel** resets all panels to their full dataset axis range simultaneously

**Click-to-select**

On mouseclick, iterate over all currently visible points and find the nearest point within a hit radius of 8 pixels (canvas coordinates). If found:
- If fewer than 4 alloys are selected: add to selection, assign next available number (1–4)
- If already selected: deselect; renumber remaining selections contiguously (e.g., removing pick 2 from {1,2,3,4} produces {1,2,3})
- If 4 already selected and new point clicked: no action (engineer must deselect one first)

The numbered badge is rendered at the point coordinates in all scatter panels simultaneously.

---

### 4.6 Spider Chart Algorithm (T5)

**Two separate spider charts** are rendered when two projects are active — Spider A (left) for Project A constraints, Spider B (right) for Project B constraints. The same up-to-4 selected alloys are overlaid on both charts. Each spider independently evaluates its own project's effective thresholds for constraint violation markers.

#### 4.6.1 Axis normalization, direction inversion, and polygon projection

```javascript
// Axis angles: 7 axes at equal 2π/7 intervals, starting at top (−π/2)
const ANGLES = Array.from({length: 7}, (_, i) => -Math.PI/2 + i * 2*Math.PI/7);
// Axis order: CSC → YS → TC → ER → Hardness → Density → LinearTE

const LOWER_IS_BETTER = {CSC: true, ER: true, Density: true, LinearTE: true};

function spiderNorm(value, attr) {
    const norm = (value - ATTR_MIN[attr]) / (ATTR_MAX[attr] - ATTR_MIN[attr]);
    return LOWER_IS_BETTER[attr] ? 1 - norm : norm;
}
// Centre = 0 (worst on every axis). Outer ring = 1 (best on every axis).

function spiderVertex(normValue, axisIndex, cx, cy, R) {
    const r = normValue * R;
    return [cx + r * Math.cos(ANGLES[axisIndex]),
            cy + r * Math.sin(ANGLES[axisIndex])];
}
```

Uses the same `ATTR_MIN` / `ATTR_MAX` lookup table computed at load time (Section 4.0.1, Step 5). **Polygon area is not a valid quality metric** — reordering axes changes area without changing any data value. Area is never communicated to the engineer.

#### 4.6.2 Stroke style per alloy

| Alloy number | `ctx.setLineDash(...)` |
|---|---|
| 1 | `[]` — solid |
| 2 | `[8, 4]` — dashed |
| 3 | `[2, 4]` — dotted |
| 4 | `[8, 4, 2, 4]` — dash-dot |

#### 4.6.3 Constraint violation markers

After drawing all alloy polygons, a second rendering pass draws alert markers:

```javascript
alloys.forEach(alloy => {
    AXES.forEach((attr, i) => {
        const norm      = spiderNorm(alloy[attr], attr);
        const threshold = spiderNorm(project.thresholds[attr].effective, attr);
        if (norm < threshold) {
            const [vx, vy] = spiderVertex(norm, i, cx, cy, R);
            // Spider A: filled red circle
            // Spider B: open red circle (outline only)
            drawConstraintMarker(ctx, vx, vy, isProjectA ? 'filled' : 'open');
        }
    });
});
```

Legend entry for any alloy with at least one failing axis: **bold + red text**.

#### 4.6.4 Stock alert — single alloy

Checks whether one alloy's recipe alone exhausts available stock for any scrap family:

```javascript
for (const scrap of SCRAP_FAMILIES) {
    const required_kg = alloy.recipe[scrap] * project.batch_kg;
    if (required_kg > stock[scrap]) {
        drawAmberMarker(alloy);   // amber marker at all 7 vertices of this alloy's polygon
        singleAlerts.push(
            `⚠ Caution: ${alloy.name} exceeds available stock for ${scrap}`
        );
    }
}
```

#### 4.6.5 Stock alert — dual-project combined check

Checks whether two alloys from different projects together exhaust stock when produced simultaneously:

```javascript
for (const scrap of SCRAP_FAMILIES) {
    for (const alloy_a of spiderA_alloys) {
        for (const alloy_b of spiderB_alloys) {
            const combined = alloy_a.recipe[scrap] * projects[0].batch_kg
                           + alloy_b.recipe[scrap] * projects[1].batch_kg;
            if (combined > stock[scrap]) {
                drawAmberMarker(alloy_a);   // on Spider A
                drawAmberMarker(alloy_b);   // on Spider B
                combinedAlerts.push(
                    `⚠ Caution: ${alloy_a.name} and ${alloy_b.name} go beyond stock for ${scrap}`
                );
            }
        }
    }
}
```

The single-alloy check (4.6.4) runs first. The combined check (4.6.5) runs additionally and independently — both messages can fire for the same scrap if both conditions are met.

#### 4.6.6 Alert banner

A text banner is rendered **between Spider A and Spider B** — not a modal, not blocking. The engineer can continue interacting with the dashboard while the banner is visible.

- One line per triggered scrap family, stacked vertically
- Single-alloy format: *"⚠ Caution: [Alloy Name] exceeds available stock for [Scrap Family]"*
- Combined format: *"⚠ Caution: [Alloy A Name] and [Alloy B Name] go beyond stock for [Scrap Family]"*
- Messages from single and combined checks are visually distinct (different icon or indentation) so the engineer can tell which type of problem each line describes

---

### 4.7 Characteristics Table Algorithm (T6)

#### 4.7.1 Data lookup

On any T4 selection change, extract full rows from the column-store for the selected alloy IDs:

```javascript
const alloyData = selectedRowIds.map(rowId => {
    const obj = {};
    ALL_DISPLAY_COLS.forEach(col => { obj[col] = columns[col][rowId]; });
    return obj;
});
```

O(n_cols) per alloy — trivial. `ALL_DISPLAY_COLS` covers the 6 recipe columns, 17 output attribute columns, and 12 chemical composition columns.

#### 4.7.2 Table structure

Three grouped row sections:

| Section | Rows | Count |
|---|---|---|
| Recipe | 6 scrap family fractions (%) | 6 |
| Output properties | 7 primary + 10 secondary output attributes | 17 |
| Chemical composition | Al, Si, Cu, Ni, Mg, Mn, Fe, Cr, Ti, Zr, V, Zn (wt.%) | 12 |
| — | CALPHAD disclaimer row (spans all columns) | 1 |

Column layout: **Property (unit)** | **Alloy 1** | **Alloy 2** | **Alloy 3** | **Alloy 4**. Columns auto-populate as alloys are selected in T4; empty columns are hidden until needed.

#### 4.7.3 Per-property number formatting

A static lookup table defines display format per property:

| Property | Format |
|---|---|
| YS (MPa) | 0 decimal places — e.g. `287 MPa` |
| CSC | 3 decimal places — e.g. `0.743` |
| TC (W/(m·K)) | 1 decimal place — e.g. `148.3` |
| ER (ohm·m) | Scientific notation, 2 sig figs — e.g. `2.8 × 10⁻⁸` |
| Hardness (Vickers) | 1 decimal place — e.g. `94.3` |
| Density (g/cm³) | 3 decimal places — e.g. `2.714` |
| Linear TE (1/K) | Scientific notation, 2 sig figs — e.g. `2.1 × 10⁻⁵` |
| Scrap fractions | 1 decimal place (%) — e.g. `34.2%` |
| Chemical composition (wt.%) | 2 decimal places — e.g. `0.82%` |

#### 4.7.4 Cell color coding

For each output property cell, read alert state from `datavis.js` (T6 never recomputes alerts):

- Value fails the effective threshold for that alloy's project → **red cell background**
- Stock alert active for this alloy AND this row is one of the contributing scrap family recipe rows → **amber cell background** (recipe section only)
- No alert → no background color

#### 4.7.5 CALPHAD disclaimer

Fixed row at the bottom of the table, full width, spanning all alloy columns:
*"Values are CALPHAD predictions. Verify by laboratory measurement before production use."*

---

## Summary Cascade: Level 1 → Level 2 → Level 3 → Level 4

| Level 1 (Domain) | Level 2 (Abstraction) | Level 3 (Encoding) | Level 4 (Algorithm) |
|---|---|---|---|
| Engineer needs holistic overview (T2a) | Summarize via UMAP | KDE blob overview; opacity for out-of-spec | Python UMAP (n_neighbors=50, min_dist=0.1, seed=42); 75th-pct contour blobs precomputed in Python; Canvas 2D + quadtree for brush queries |
| Engineer detects groupings (T2b) | Cluster — dominant-scrap assignment | Hue + texture per family | Argmax of 6 input cols; ≤2pp tie → Mixed (label 6); saved as Uint8Array at Python step |
| Engineer manages 2 client orders (T3) | Set Intersection on effective thresholds | Violin: 6 families × 7 primary attrs (default) + "See more" secondary; brush shades region | Scott's rule 1D KDE, 200-point grid, computed once at browser load (never recomputed); brush = geometric highlight [a,b] on existing shape; secondary cols hidden until toggle |
| Engineer applies hard constraints (T1/T4) | Filter on 14 quantitative attributes | 3-panel scatter + constraint lines + feasibility zone | T1: effective = floor × (1 ± margin/100); validation rules; re-apply persists all selections; batch_kg stored per project for stock check |
| Engineer needs top 4 candidates (T4) | Find Top-K, K=4 | Click-to-select; numbered 1–4; badges on all panels | Distance loop, 8px hit radius; contiguous renumber on deselect; rectangle drag zoom: active panel zooms to drag bbox; all other panels independently refit to same row subset on own axes; double-click resets all |
| Engineer compares candidates (T5) | Compare | Two separate spiders (one per project); stroke style 1–4; red vertex = violation; amber vertex = stock alert; text banner between spiders | 7 axes at 2π/7 rad intervals; spiderNorm with LOWER_IS_BETTER inversion; single stock check: recipe[scrap]×batch_kg > stock[scrap]; combined check: A+B combined > stock[scrap]; two distinct message formats in banner |
| Engineer needs full record for handoff (T6) | Lookup — in-dashboard table | 17 output attrs + recipe + 12 chemical composition side-by-side; alert flags mirrored from T5 | Column-store row extraction O(n_cols); per-property format lookup table; alert state read from datavis.js only; CALPHAD disclaimer row |
| Loading performance (324K rows) | — | Loading tab with step-by-step progress; no blocking overlay | Web Worker for all steps; column-store typed arrays; ~13–19 s total; pagination table 100 rows/page; hover tint + tooltip for truncated cells |
| Session setup rarely changes mid-session | — | T1 gated behind legend chip; modal collapses on Apply | Effective threshold formula per direction; validation; re-apply: recompute thresholds + re-render all views; persist T2/T3/T4 state; removal of Project B clears B picks only |
| Stock availability is an operational constraint | New supplementary data (stock CSV) | Amber marker + text banner between spiders; red for constraint violation, amber for stock | recipe_fraction × batch_kg > stock[scrap] → single alert message; alloy_A × batch_A + alloy_B × batch_B > stock[scrap] → combined alert message naming both alloys and the scrap |
