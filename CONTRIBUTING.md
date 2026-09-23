# Contributing

## Branch policy

main is the stable baseline. Runtime work should use short-lived branches and pull requests.

Suggested prefixes: fix/, refactor/, perf/, test/, docs/.

## Before editing

Read docs/WORKING_STATE.md, docs/ROADMAP.md, ARCHITECTURE.md, and relevant topic/live-DOM documentation.

## Change policy

- One behavior change or one extraction boundary per PR.
- Do not combine a broad file move with a behavior redesign.
- Preserve storage schemas unless the PR includes migration + tests.
- Preserve worker owner/generation semantics.
- Do not invent selectors; update DOM evidence first.
- Do not introduce direct private OviPets API calls.
- Do not close tabs the extension did not create and still own.

## Required verification

Run node scripts/verify-js.js and every tests/*.test.js file. Add regression tests for bugs when practical. Update WORKING_STATE.md for architecture/state changes.
