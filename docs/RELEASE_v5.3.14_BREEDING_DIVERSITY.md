# v5.3.14 — Breeding Male Diversity

Date: 2026-09-21

## Goal

Reduce repeated male ancestry in Breeding Campaign without throwing away meaningful Body 1 quality.

## Selection rule

1. Build the normal male ranking for each female.
2. Use the legacy top male as the Body 1 baseline.
3. Another male joins the same Body 1 equivalent pool only when it has the same exact target-endpoint mask on Body 1 and every remaining non-exact Body 1 RGB channel differs from the baseline by at most 15 points.
4. For each male in that pool, calculate independent target distances for Body 2, Scales, Extra 1 and Extra 2.
5. The male's secondary score is the minimum of those four values, not the total or average.
6. Lower secondary score wins. Equal secondary scores fall back to recent male use, lineage use, then the existing pair-purity comparator.
7. Outside the equal-mask / 15-point pool, strict Body 1 ranking remains authoritative.

Example: `FF FF FA` and `FF FF FC` can remain in the same eligible pool. A male with secondary distances `20, 14, 40, 25` scores 14; an equivalent male whose best secondary slot is 12 is preferred.

## Regression evidence

- `FF FF FA` and `FF FF FC` are recognized as near-equivalent.
- >15-point remaining Body 1 differences are not equivalent.
- `[20,14,40,25]` resolves to 14.
- A legacy Body 1 winner can be replaced by an equivalent male with best secondary 12 instead of 14.
- Near-equivalent males remain eligible even when base shortlist limit is 1.
- Same-species, cooldown, ownership, and ancestor-overlap filters remain unchanged.

## Verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: 59/59 PASS
- Focused breeding/planner soak: 20 rounds × 6 files = 120 executions, 0 failures
- Clean-extracted final ZIP: 59/59 PASS
- Final ZIP SHA-256: `a124923cddfdac4e2dbef7c575dc4fb6bfb6213a1093bda2d88894869c44b863`

## Runtime import

The packaged publish helper now targets `release/v5.3.14-runtime-import`. Issue #2 remains open until the complete runtime/test tree is imported and CI reproduces the gates from a clean checkout.
