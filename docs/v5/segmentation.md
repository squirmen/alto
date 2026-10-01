# Crown segmentation for ALTO — what was measured, what improved, and where it stops

September 2026. Four rounds, roughly 75,000 evaluated configurations, two sealed test
runs. This is the summary; `rounds/ROUND1.md`, `ROUND2.md` and `ROUND3.md` carry the
detail, and `ledger.jsonl` with `findings.jsonl` carry every attempt and every reason.

---

## The problem

A reviewer of the ALTO site wrote, in passing: *a LiDAR specialist could build a better
crown-segmentation algorithm.* Measured against 219 human-labelled crowns, they were
right. ALTO's production segmentation splits one tree into several 22.8% of the time, and
**73.3% of the time for crowns over 100 m²** — the large trees that dominate canopy
cover, carbon and shade, and which the whole service-value chain is built on.

## What it does now

On eight sealed sites never used for tuning, 83 labelled trees:

| | objective | one crown per tree | split | recall | IoU |
|---|--:|--:|--:|--:|--:|
| **this work** | **0.622** | **0.735** | **0.024** | **0.759** | **0.540** |
| Dalponte & Coomes 2016, tuned | 0.568 | 0.711 | 0.036 | 0.747 | 0.473 |
| Silva et al. 2016, tuned | 0.528 | 0.602 | 0.072 | 0.675 | 0.470 |
| marker watershed, tuned | 0.515 | 0.578 | 0.036 | 0.615 | 0.465 |
| **v4, what ALTO ships** | 0.512 | 0.554 | 0.096 | 0.651 | 0.476 |
| Li et al. 2012, tuned | 0.501 | 0.554 | 0.024 | 0.578 | 0.457 |

Paired bootstrap over the same sites — the right test, because sites differ from each
other far more than methods differ on a site:

```
vs Li 2012           +0.122  [+0.037, +0.173]   leads in  99.9%
vs marker watershed  +0.117  [+0.041, +0.170]             99.9%
vs v4 in production  +0.110  [+0.040, +0.188]             99.9%
vs Silva 2016        +0.094  [+0.012, +0.172]             98.6%
vs Dalponte 2016     +0.060  [+0.020, +0.103]             99.9%
```

**Every interval excludes zero.** Splitting falls from 9.6% to 2.4%; median IoU rises
from 0.476 to 0.540. On development sites, crowns of 50–100 m² go from 62.5% correct to
95.8% and crowns over 100 m² from 27.3% to 81.8%.

Round 2 could not separate itself from a tuned Dalponte — it led in 82.6% of resamples
with the interval crossing zero. This can, at 99.9%. What changed between them was not
the algorithm but the data it reads, which is the point of the whole exercise.

## How it works

Marker-controlled watershed on a canopy height model built from vegetation returns only,
with four things added. The height model matters as much as the algorithm: the starter
kit's CHM includes buildings, so segmentation run on it partly segments rooftops.

1. **Saddle merge.** Two crowns are joined when the canopy between their peaks barely
   dips — a real gap means two trees, a shallow dip means one tree the watershed cut in
   half.
2. **Greenness gate.** A cell below the height floor joins the canopy if the 0.075 m
   imagery says it is vegetation, but only as an isolated component: the picture may
   start a new tree, never fatten an existing one. This finds the small street trees the
   point cloud barely samples.
3. **Edge trim at 0.65.** Cells below 65% of a crown's own top are dropped. This removes
   the low skirt in the gaps between trees, where the over-extension lives.
4. **Crown closing**, which turns out to contribute nothing and is kept only because it
   costs nothing.

### What each part is actually worth

Removing one mechanism at a time, paired bootstrap on the drop:

```
smoothing         +0.109  [+0.072, +0.154]
edge trim 0.65    +0.086  [+0.030, +0.145]
greenness gate    +0.082  [+0.033, +0.125]
pit fill          +0.022  [-0.009, +0.059]
saddle merge      +0.008  [-0.010, +0.025]
crown closing     +0.000  [-0.002, +0.004]
```

The saddle merge was round 1's entire result — 3,618 attempts, present in every one of
the top 50 configurations — and contributes nothing once the edge trim exists, because
the trim removes the low connections the merge was repairing. It would have shipped as
the headline without the ablation.

**The mechanisms are not a bolt-on.** Added to each independently tuned baseline they
give +0.009 on watershed, +0.009 on Silva, +0.005 on Li, and make Dalponte slightly
worse — a fraction of the 0.032 that separates the tuned watershed from this work. The
winning configuration seeds at 5 m, which only survives because the gate admits what is
shorter, and holds a fixed 2 m window, which only survives because the merge and trim
hold large crowns together. It is a co-adapted set, not a portable trick.

## Where it stops, and why more work will not help

Every label polygon was redrawn by a plausible drawing error and the score recomputed:

```
0.5 m tighter    0.5399
0.25 m tighter   0.5792
as drawn         0.6177
0.25 m looser    0.6242   <- better than as drawn
0.5 m looser     0.6114
```

A half-metre either way spans **0.078**. Three rounds and ~50,000 attempts moved the
objective **0.0986** in total. Where one person chose to put the crown edge is worth about
eighty per cent of everything the algorithm work achieved — and there is one labeller and
no second rater, so that uncertainty sits unquantified under every number here.

An oracle bound says algorithmic headroom exists in principle: a detection that were
exactly the label's own canopy cells would score 0.808 IoU against the 0.525 achieved. It
simply cannot be verified on this benchmark. **The next useful step is a second rater on
fifty crowns, not a fourth round.** It is a day's work, and it would put error bars on
this document, on the September benchmark and on the reviewer's critique at the same time.

## Things that were tried and failed

Kept because a record of dead ends is worth more than repeating them.

| tried | result |
|---|---|
| height-scaled radius cap | IoU falls monotonically; crowns are not discs, the spill is between crowns not radial |
| greenness as a crown trimmer | IoU 0.503 → 0.378; shaded leaf is not green, the trim eats canopy |
| greenness in the boundary cost | worse at every weight; at the boundary, greenness separates in-crown from out-of-crown thirty times worse than height |
| convex-hull crowns | 0.525 → 0.517, worse when dilated |
| multi-scale seeding | `n_scales=1` in 78% of leading configurations |
| variable seed window | `win_b=0` in 100%; a fixed 2 m window wins once the trim holds crowns together |
| learned crown membership | 0.668 against a 0.683 majority baseline on held-out sites; learns sites, not crowns |
| 0.25 m grid | aggregate says +0.002, paired over sites says −0.007 and it leads in 21%; 3× the compute |
| Dalponte growth rule + mechanisms | 0.599 against 0.618, and its published thresholds are inert once the trim runs |
| smarter trims (Otsu, quantile, absolute drop) | all below a fixed fraction of crown top |

## Method errors caught along the way

Recorded because they are the reason to trust the rest.

- **Bounding-box IoU** flattered every round-1 number. Labels are now rasterised and
  compared as masks. The same error produced the retracted 7.8% split figure in the
  September findings.
- **An axis's optimum outside its grid**, four times: the saddle merge in round 1 (a
  thousand wasted attempts), the edge trim at 0.3 when the optimum is 0.65, then twelve
  axes pinned at once. The loop now audits for this every 200 iterations.
- **A comparator that was never run.** Li 2012 measured crown membership from the tree's
  apex instead of its nearest assigned cell, scored 0.227, and would have been a
  strawman. Then a "Dalponte pin" that constrained the grid but not the candidates ran
  2,400 attempts that were all watersheds.
- **Three data defects in layers being used without being looked at**: buildings in the
  kit's CHM, imagery cropped to the site box while the stack carries a 20 m pad, and
  imagery point-sampled at one pixel per 0.5 m cell when each cell covers about 72.
- **Unpaired comparisons pointing the wrong way**, twice, both times in round 3.
- **A membership model trained on the wrong question**: over every crown, when no site
  labels more than 62% of its canopy, so it was being taught that correctly detected
  trees are not trees.

## Deployment

Production does not need the imagery. Auckland-wide LINZ coverage at working resolution
is roughly 444,000 tiles; a configuration tuned without any imagery term reaches 0.599 on
development sites against 0.618 with it, and 0.519 for what ships today. The large-crown
fix survives intact — it is the small street trees that are lost, since finding those was
the gate's whole purpose.

The point cloud is already local: 3,149 tiles, 33 GB, 1,606 km².
