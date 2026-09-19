# OviPets Extension — Working State

Last updated: 2026-09-19
Current release baseline: v5.3.0
Current repository phase: Phase 0 — baseline import/CI bootstrap
Current local implementation status: Phase 1–3 validated + Phase 4 Own Eggs, Pet Index, Friend Sweep and Hatchlings extracted; runtime source not yet mirrored to GitHub

This file is the first project document every coding agent should read. Keep it short, current, and factual. Historical decisions belong in CHANGELOG or topic docs.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Current verification

Original supplied v5.3.0 snapshot:

- JavaScript syntax: PASS;
- Node test files: 23/23 PASS;
- original content.js was approximately 3,360 lines.

Current managed working baseline:

- JavaScript syntax: PASS;
- Node test files: 43/43 PASS;
- content.js: 1,648 lines;
- Phase 1 lifecycle/mutation hardening remains covered;
- deterministic domain modules own breeding/pet-record rules;
- named core/DOM adapters replace broad platform coupling;
- jobs no longer depend on a broad legacy helper bag;
- four long-running feature state machines now live under features/.

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

The refresh pipeline is partially route-aware. Jobs receive explicit adapters/domain objects and narrow feature services.

### Phase 4 — feature state machines

Extracted:

- features/own-eggs.js
- features/pet-index.js
- features/friend-sweep.js
- features/hatchlings.js

Still in content.js:

- Breeding Campaign state machine;
- UI panel/dashboard presentation and wiring;
- a small set of live Edit-tab mutation helpers used by feature adapters.

## Still open

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- friend-request state remains intentionally "dispatched" unless a reliable confirmation signal is observed;
- full runtime/test source must be imported into GitHub and CI must reproduce the suite;
- complete Phase 4 by extracting Breeding Campaign and UI.

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
Phase 1: finish live verification and merge validated hardening.
Phase 2: domain extraction — validated locally.
Phase 3: adapters/DOM/dependency-contract extraction — validated locally.
Phase 4: complete Breeding + UI extraction.
Phase 5: split background services and improve IndexedDB/query efficiency.
Phase 6: live QA, soak testing, release hardening.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
