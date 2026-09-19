# Automated Regression Soak — 2026-09-19

Release candidate: v5.3.0

## Result

- Full Node regression suite: 50 test files per round.
- Consecutive rounds executed: 20.
- Total test-file executions: 1,000.
- Failures: 0.
- Typical full-suite duration in this environment: about 3.64 seconds per round.

The execution harness has a per-call time limit, so the 20 rounds were completed across several shell invocations. Every completed round reported 50/50 PASS and 0 failures.

## What this proves

This is a repeatability/flakiness check for the automated harness after the Phase 1–6 refactor. It adds confidence that worker lifecycle, feature state machines, IndexedDB/journal behavior and module wiring do not exhibit obvious nondeterministic failures under repeated execution.

## What this does not prove

This is not a substitute for a multi-hour live OviPets soak. It cannot prove current OviPets DOM behavior, server responses, browser resource usage over hours, real Name the Species retry behavior, or friend-egg dedicated-tab behavior.

## Reproduce

Run:

`node scripts/run-regression-soak.js 20`

A live multi-hour soak remains a required manual release gate in docs/LIVE_QA_CHECKLIST.md.
