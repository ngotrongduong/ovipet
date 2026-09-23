# v5.3.14 — Breeding Male Diversity

Date: 2026-09-21

## Goal

Reduce repeated male ancestry in Breeding Campaign without sacrificing meaningful Body 1 quality.

## Rule

1. Build the normal male ranking for each female.
2. Use the legacy top male as the Body 1 baseline.
3. Other males join the same Body 1 equivalent pool only when:
   - they have the same exact target-endpoint mask on Body 1; and
   - every non-exact Body 1 RGB channel differs from the baseline by at most 15 points.
4. For each male in that pool, calculate independent slot distances to target for Body 2, Scales, Extra 1 and Extra 2.
5. The male's secondary score is the **minimum** of those four slot distances, not the total or average.
6. Lower secondary score wins. If equal, keep the existing recent-male-use and lineage-use diversity tie-breaks, then the existing pair-purity comparator.
7. Outside the 15-point/equal-mask pool, normal strict Body 1 ranking remains authoritative.

Example: a male with secondary distances `20, 14, 40, 25` has secondary score `14`. Another equivalent-Body-1 male with best secondary distance `12` is preferred.

## Safety/invariants preserved

- same-species pairing only;
- owned/present/not-on-cooldown filters unchanged;
- visible ancestor overlap still excludes a pairing;
- database-first direct breeding workflow unchanged;
- no new game command or UI mutation path.

## Regression

- `FF FF FA` and `FF FF FC` are recognized as Body 1 near-equivalent.
- >15-point remaining Body 1 difference is not equivalent.
- `[20,14,40,25]` resolves to secondary score 14.
- a legacy Body 1 winner can be replaced by an equivalent male whose best secondary slot is 12 instead of 14.
- near-equivalent males remain eligible even with shortlist limit 1.
- outside tolerance, normal ranking still wins.

Automated verification: JavaScript syntax PASS; release consistency PASS; full suite 59/59 PASS; focused breeding/planner soak 20 rounds × 6 files = 120 executions, 0 failures. Final ZIP clean-extraction verification is performed after packaging.
