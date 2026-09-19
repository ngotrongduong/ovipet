# Contributing

## Branch policy

main is the stable baseline. Runtime work should use short-lived branches and pull requests.

Suggested prefixes:

- fix/
- refactor/
- perf/
- test/
- docs/

## Before editing

Read:

1. docs/WORKING_STATE.md
2. docs/ROADMAP.md
3. ARCHITECTURE.md
4. relevant topic/live-DOM documentation

## Change policy

- One behavior change or one extraction boundary per PR.
- Do not combine a broad file move with a behavior redesign.
- Preserve storage schemas unless the PR includes migration + tests.
- Preserve worker owner/generation semantics.
- Do not invent selectors; update DOM evidence first.
- Do not introduce direct private OviPets API calls.
- Do not close tabs the extension did not create and still own.

## Required verification

Run the repository verification script and all Node test files.

For bugs, add a regression test where practical.

For architecture/state changes, update WORKING_STATE.md.

For a changed live DOM assumption, update the DOM audit or LIVE_QA_CHECKLIST.md.

## Review

Every runtime PR should receive:

1. specialist review for the affected subsystem;
2. regression review;
3. CI;
4. live/manual QA when CI cannot prove the contract.
