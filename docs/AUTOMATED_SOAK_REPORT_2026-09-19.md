# Automated Regression Soak — 2026-09-19

Release candidate: v5.3.1 UI-only Turn Egg RC

## Result

- Full Node regression suite: 51 test files per round.
- Consecutive completed rounds after the v5.3.1 UI-only Turn Egg redesign: 20.
- Total test-file executions: 1,020.
- Failures: 0.
- Typical full-suite duration in this environment: about 3.68 seconds per round.

The execution harness has a per-call time limit, so the 20 completed rounds were split across multiple shell invocations. Every completed round reported 51/51 PASS and 0 failures.

## Live Edge regression covered before soak

Real Microsoft Edge QA exposed a startup ReferenceError because `copyBlacklistCsv` remained in `uiPanelActions` after its function had been removed during refactoring. The function was restored and `tests/content-ui-action-wiring.test.js` was added so an undefined shorthand panel action now fails the suite before release.

## What this proves

This is a repeatability/flakiness check for the automated harness after the Phase 1–6 refactor the Edge live-wiring fix, and the UI-only Turn Egg redesign.

## What this does not prove

This is not a substitute for a multi-hour live OviPets soak. It cannot prove current server responses, real Name the Species wrong-answer behavior, or the redesigned friend-egg dedicated-tab UI flow; those remain live Edge gates.

## Reproduce

`node scripts/run-regression-soak.js 20`
