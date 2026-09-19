# Phase 2 Pure Breeding Domain Extraction — Checkpoint

Date: 2026-09-19
Baseline: Phase 1 hardened v5.3.0 working tree
Status: validated locally; runtime source still awaiting GitHub baseline import via Issue #2.

## Result

`content.js` was reduced from 3,407 lines to 3,003 lines without changing worker, storage, UI, DOM-selector, or game-command behavior.

Four pure domain modules now own deterministic breeding calculations:

- `domain/colors.js` — color normalization, distance, pure-color lookup, pet target metrics and naming helpers;
- `domain/pedigree.js` — ancestor overlap and lineage keys;
- `domain/breeding-score.js` — pair reachability/probability/scoring and male shortlisting;
- `domain/breeding-plan.js` — enclosure classification, diversity-aware database breed planning and program placement rules.

## Boundary rules

The extracted domain modules do not use DOM APIs, Chrome APIs, storage, game commands, timers, or implicit current time.

`buildDatabaseBreedPlan()` now requires a finite `options.now` supplied by the caller. This keeps planning deterministic and prevents hidden time dependence from entering the domain layer.

## Wiring and tests

The manifest loads the four modules after `jobs/core.js` and before dependent jobs. `content.js` fails fast if they are missing and imports only symbols it uses.

Added:

- `tests/domain-breeding.test.js` — executes the real modules and tests color metrics, pedigree overlap, reachability, diversity tie-breaks, enclosure classification and explicit-time planning;
- `tests/manifest-integrity.test.js` — verifies manifest-referenced files and domain dependency order.

Older source-contract tests were updated so extraction itself is not treated as a failure.

## Verification

- JavaScript syntax: PASS
- Node test files: 27/27 PASS
- no runtime selector/storage schema/worker protocol change
- content.js: 3,407 -> 3,003 lines

## Next extraction

Phase 3 starts with small platform adapters:

1. core/storage-client.js
2. core/game-bridge.js
3. core/worker-client.js
4. route/DOM adapters
5. route-aware scheduler

Each adapter should replace one coherent block while preserving the current job service contract until callers migrate incrementally.
