# v5.3.15 — Same-FF Target-Improvement Breeding

Date: 2026-09-21

## Goal

Add a second Breeding Campaign strategy whose goal is to improve an existing Body 1 FF line toward the fixed target colors, rather than combine different FF pairs to pursue a pure line.

## Planning flow

1. Scan the complete enclosure snapshot.
2. Select every owned, present, off-cooldown female with complete target color data.
3. For each female, enumerate every owned, present, off-cooldown male of the same species with complete target color data across all enclosures.
4. Reject ancestor-overlap pairs.
5. Require the male's exact Body 1 target-endpoint mask to equal the female's mask. For the current `#FFFFFF` Body 1 target, this means the same FF pair/set.
6. Measure male Body 2, Scales, Extra 1 and Extra 2 independently against target.
7. Male primary score = the minimum of those four slot distances. Lower wins.
8. If primary score ties, prefer lower recent male use, then lower lineage use, then lower total secondary distance, then stable ID ordering.
9. Execute the selected pair through the same direct breeding command path as the existing female-first campaign.

## Important distinction

The existing **Pure-line campaign** remains unchanged. It still seeks complementary Body 1 FF structure. The new **Same-FF target campaign** deliberately keeps the female on the same Body 1 FF line and optimizes the other colors.

## Regression examples

- A female and male with the same FF mask can pair even when stored in arbitrary enclosures.
- A male with a different FF mask is excluded even if his secondary colors are perfect.
- A related same-FF male is excluded.
- A same-FF male with best secondary distance 12 beats another at 14.
- A female with no exact Body 1 FF pair remains unpaired.

## Verification

- JavaScript syntax: PASS
- Full Node suite: 59/59 PASS before release packaging

## Runtime import

The packaged publish helper targets `release/v5.3.15-runtime-import`.
