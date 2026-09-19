# OviPets Extension — Working State

Last updated: 2026-09-19
Current release baseline: v5.3.0
Current repository phase: Phase 0 — baseline import/CI bootstrap
Current local implementation status: Phase 1 hardening + Phase 2 domain extraction + Phase 3 adapter/dependency-contract extraction validated; runtime source not yet mirrored to GitHub

This file is the first project document every coding agent should read. Keep it short, current, and factual. Historical decisions belong in CHANGELOG or topic docs.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Baseline verification

Original supplied v5.3.0 snapshot:

- runtime/test JavaScript syntax: PASS;
- Node test files: 23/23 PASS;
- no bundler/build step is required;
- original content.js was approximately 3,360 lines.

Current managed working baseline:

- JavaScript syntax: PASS;
- Node test files: 39/39 PASS;
- content.js: 2,480 lines;
- Phase 1 lifecycle/mutation hardening remains covered;
- pure breeding and pet-record rules live in deterministic domain modules;
- storage/game bridge/worker/scheduler/game-action adapters are separate;
- route/profile/hatchery/tabs/overview/friends/chat DOM readers are separate;
- jobs no longer depend on a broad legacy helper bag.

Issue #2 remains the repository gate: the complete runtime/test tree is not yet mirrored into GitHub, so GitHub is not yet the authoritative runtime source.

## Local implementation already validated

### Phase 1 — stability

- explicit workerStarted ACK scoped by owner + generation + owning worker tab;
- bounded start deadline with exact-generation cleanup;
- generation-safe Stop/release/completion;
- feed dispatch is not persisted as confirmed full food state;
- bridge-owned temporary DOM is filtered from refresh scheduling.

### Phase 2 — domain

Extracted:

- domain/colors.js
- domain/pet-record.js
- domain/pedigree.js
- domain/breeding-score.js
- domain/breeding-plan.js

Domain planning/metadata time is explicit where needed so tests stay deterministic.

### Phase 3 — adapters and dependency direction

Extracted:

- core/storage-client.js
- core/game-bridge.js
- core/worker-client.js
- core/scheduler.js
- core/game-actions.js
- dom/routes.js
- dom/profile.js
- dom/hatchery.js
- dom/tabs.js
- dom/overview.js
- dom/friends.js
- dom/chat.js

The refresh pipeline is partially route-aware.

The one-button jobs receive explicit adapters/domain objects and narrow feature services. A regression test forbids reintroducing the old legacy helper bag.

## Still open

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- friend-request state remains intentionally "dispatched" unless a reliable confirmation signal is observed;
- full runtime/test source must be imported into GitHub and CI must reproduce the suite;
- Phase 4 feature-state-machine extraction has not yet been completed.

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
Phase 2: domain extraction — validated locally.
Phase 3: adapters/DOM/dependency-contract extraction — validated locally.
Phase 4: extract feature state machines and UI.
Phase 5: split background services and improve IndexedDB/query efficiency.
Phase 6: live QA, soak testing, release hardening.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
