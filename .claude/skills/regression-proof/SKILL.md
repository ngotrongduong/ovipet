---
name: regression-proof
description: Use when fixing an OviPets bug or protecting a fragile behavior before refactor.
---

# Regression Proof

1. State the invariant that failed.
2. Reproduce with a focused test when practical.
3. Confirm the test fails for the correct reason.
4. Make the smallest fix.
5. Run the focused test.
6. Run the full suite.
7. Run the relevant specialist review.
8. Run oweh-regression-reviewer before merge.

A test should prove behavior/state, not merely that a function name or source string exists, unless source structure itself is the contract.
