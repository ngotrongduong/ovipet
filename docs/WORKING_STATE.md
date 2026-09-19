# OviPets Extension — Working State

Last updated: 2026-09-19
Current release baseline: v5.3.0
Current repository phase: Phase 0 — baseline import/CI bootstrap
Current runtime hardening status: Phase 1 implementation validated on managed local baseline; not yet mirrored to GitHub runtime source

This file is the first project document every coding agent should read. Keep it short, current, and factual. Historical decisions belong in CHANGELOG or topic docs.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Baseline verification

Original supplied v5.3.0 snapshot:

- runtime/test JavaScript syntax: PASS;
- Node test files: 23/23 PASS;
- no bundler/build step is required;
- main technical debt: content.js is approximately 3,360 lines and owns too many responsibilities;
- secondary concentration point: background.js is approximately 730 lines.

Managed Phase 1 working baseline currently verifies:

- JavaScript syntax: PASS;
- Node test files: 25/25 PASS;
- lifecycle regression tests cover worker start ACK/timeout, generation-safe Stop, sender-tab scoping and stale completion;
- feed dispatch no longer masquerades as confirmed full food state;
- page-bridge transport DOM is filtered from global refresh churn.

These Phase 1 runtime changes are validated locally but are not yet the GitHub runtime baseline. Issue #2 remains the repository gate.

## GitHub repository status

The repository contains the engineering control plane: README, architecture/roadmap/refactor/test/live-QA docs, agent workflow/research, contribution rules, project-specific agents/skills, PR template, and Issues #1–#7.

The complete runtime/test snapshot is not yet mirrored into GitHub. Issue #2 must close before GitHub becomes the authoritative runtime source and before broad modularization begins.

## Phase 1 work already validated locally

- explicit workerStarted ACK scoped by owner + generation;
- bounded worker-start deadline with exact-generation cleanup;
- stopping state reserves the current generation throughout asynchronous Stop cleanup;
- Start during stopping is refused instead of being falsely reported as already running;
- worker phase/completion is scoped by generation + owning worker tab;
- stale generation completion cannot release a newer claim;
- feed persists feedDispatchedAt instead of manufacturing foodPercent=100/foodCheckedAt;
- recent feed dispatch gets a short 10-minute duplicate guard while observed food state remains authoritative;
- temporary page-bridge forms are marked as extension-owned;
- mutation batches consisting only of bridge-owned DOM are ignored by global refresh scheduling.

Still open:

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- friend-request state remains intentionally "dispatched" unless a reliable confirmation signal is observed;
- runtime/test source must be imported into GitHub and CI must reproduce the suite.

## Source-of-truth order

1. current runtime code and tests;
2. this WORKING_STATE.md;
3. ROADMAP.md and ARCHITECTURE.md;
4. current live DOM audit;
5. newest changelog/release note;
6. older historical docs.

Never restore a retired workflow only because an older document mentions it.

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
- Command dispatch is not the same as confirmed game mutation.
- Refactors are behavior-preserving unless the PR explicitly says otherwise.

## Planned sequence

Phase 0: complete GitHub runtime baseline + reproducible CI.
Phase 1: finish live verification and merge the validated worker/state hardening.
Phase 2: extract pure breeding/domain modules.
Phase 3: extract storage, game bridge, worker client and DOM adapters.
Phase 4: extract feature state machines and UI.
Phase 5: split background services and improve IndexedDB/query efficiency.
Phase 6: live QA, soak testing, release hardening.

See ROADMAP.md for gates and acceptance criteria.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
