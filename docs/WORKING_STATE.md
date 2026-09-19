# OviPets Extension — Working State

Last updated: 2026-09-19
Current release baseline: v5.3.0
Current repository phase: Phase 0 — baseline import/CI bootstrap
Next runtime phase: Phase 1 — stability hardening

This file is the first project document every coding agent should read. Keep it short, current, and factual. Historical decisions belong in CHANGELOG or topic docs.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Baseline verification

The supplied v5.3.0 snapshot has been independently rechecked:

- runtime/test JavaScript files syntax-checked: 41 files, 0 failures;
- existing Node test files: 23/23 PASS;
- no bundler/build step is required;
- main technical debt: content.js is approximately 3,360 lines and owns too many responsibilities;
- secondary concentration point: background.js is approximately 730 lines.

## GitHub repository status

The repository now contains the engineering control plane:

- README project hub;
- ARCHITECTURE.md;
- this living state file;
- ROADMAP.md;
- REFACTOR_MAP.md;
- TEST_STRATEGY.md;
- LIVE_QA_CHECKLIST.md;
- CONTRIBUTING.md / AGENTS.md / CLAUDE.md;
- project-specific agents and skills;
- Issues #1–#7 for implementation phases.

The complete runtime/test snapshot is not yet mirrored into GitHub. Issue #2 is the gate that must close before runtime refactor work is performed from GitHub.

## Current source-of-truth order

When documents disagree, use this order:

1. current runtime code and tests;
2. this WORKING_STATE.md;
3. ROADMAP.md and ARCHITECTURE.md;
4. current live DOM audit;
5. newest changelog/release note;
6. older historical docs.

Never restore a retired workflow only because an older document mentions it.

## Next runtime work after Phase 0

1. Add explicit shared-worker start acknowledgement scoped by owner + generation.
2. Add a bounded start deadline and deterministic cleanup on missing ACK.
3. Make Stop/release generation-safe end to end.
4. Separate command "dispatched" state from server/DOM-confirmed mutation state.
5. Filter extension-owned bridge DOM mutations from the global refresh pipeline.
6. Add regression tests for delayed start, missing ACK, stale Stop and generation rollover.
7. Complete live checks for Name the Species wrong-answer lifecycle and friend egg own-tab Turn Egg lifecycle.

## Architecture invariants

- OviPets mutations go through the game's real UI/dispatcher bridge; do not invent direct private API calls.
- One user button starts one independently observable job.
- Only one shared worker lease may be active at a time.
- Every worker lifecycle transition is owner + generation scoped.
- A stale generation must never stop or complete a newer generation.
- Only tabs created and still owned by the extension may be closed automatically.
- Stop must clear durable active state even if the worker tab is already dead.
- MV3 service-worker memory is disposable; authoritative long-lived state must be persisted.
- Feature cancellation/state must not be accidentally shared across unrelated jobs.
- Refactors are behavior-preserving unless the PR explicitly says otherwise.

## Planned sequence

Phase 0: complete GitHub runtime baseline + reproducible CI.
Phase 1: worker/state hardening.
Phase 2: extract pure breeding/domain modules.
Phase 3: extract storage, game bridge, worker client and DOM adapters.
Phase 4: extract feature state machines and UI.
Phase 5: split background services and improve IndexedDB/query efficiency.
Phase 6: live QA, soak testing, release hardening.

See ROADMAP.md for gates and acceptance criteria.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
