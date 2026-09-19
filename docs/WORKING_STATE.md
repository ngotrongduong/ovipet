# OviPets Extension — Working State

Last updated: 2026-09-19
Current release baseline: v5.3.2
Current repository phase: Phase 0 — baseline import/CI bootstrap
Current local implementation status: Phases 1–5 and Phase 6 automated gates validated locally; authenticated live/manual release gates remain. Runtime source is not yet mirrored to GitHub.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Current verification

Original supplied v5.3.0 snapshot:

- JavaScript syntax: PASS;
- Node test files: 52/52 PASS;
- content.js was approximately 3,360 lines.

Current managed release-candidate baseline:

- JavaScript syntax: PASS;
- release consistency gate: PASS;
- Node test files: 51/51 PASS;
- clean extracted RC package reproduces the same gates;
- automated regression soak after the Edge live-wiring fix: 20 completed rounds, 1,020 test-file executions, 0 failures;
- content.js: 998 lines;
- background.js: 165 lines;
- worker-tab cleanup now verifies the tab is still an OviPets tab before automatic close;
- all major feature state machines live under features/;
- panel/dashboard live under ui/;
- background DB/journal/worker/alert/health responsibilities live under bg/.

Issue #2 remains the repository gate: the complete runtime/test tree is not yet mirrored into GitHub, so GitHub is not yet the authoritative runtime source.

## Local implementation already validated

### Phase 1 — stability
Worker ACK/deadline, generation/tab-safe lifecycle, truthful dispatched-vs-confirmed state and observer filtering.

### Phase 2 — domain
Pure color/pet-record/pedigree/breeding scoring/planning modules.

### Phase 3 — adapters and dependency direction
Core storage/game/worker/scheduler/game-action adapters, route-specific DOM readers and removal of the broad legacy job helper bag.

### Phase 4 — feature state machines and UI
Own Eggs, Pet Index, Friend Sweep, Hatchlings, Breeding, Dashboard and Panel extracted. content.js is now the composition/wiring layer plus a limited set of live Edit/profile action helpers.

### Phase 5 — background services and data efficiency
state-db, command-journal, worker-manager, species-alert and state-health extracted; targeted pet reads added; legacy migration cached; command history bounded. Task rows are bounded by fixed IDs.

### Phase 6 — automated release hardening
Release-version/source consistency, manifest/background import integrity, clean-package verification, repeated automated soak and worker-tab ownership-close regression coverage are green.

### v5.3.2 Species learning / terminal Error rule

Edge QA confirmed the wrong-answer Error is terminal for the current egg. The answer is saved as negative evidence, the egg reports `exhausted`, only the extension-owned tab closes, and the parent coordinator will not reopen that egg during the same Hatchery/Friend visit. Species Inspector can export browser-visible DOM/image/options, client-side source hints and narrow same-origin network evidence for later analysis.

## Still open

These require a real authenticated browser/live environment and are not marked complete without evidence:

- Name the Species wrong-answer lifecycle on current OviPets;
- friend egg dedicated-tab Turn Egg lifecycle on current OviPets;
- Windows Edge unpacked-extension UI/load smoke;
- manual worker Start/Stop/reload recovery check;
- multi-hour live-game soak;
- full runtime/test source imported into GitHub and clean-checkout CI green;
- friend-request state remains intentionally "dispatched" unless a reliable confirmation signal is observed.

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
- Every worker lifecycle transition is owner + generation + owning-tab scoped where applicable.
- A stale generation must never stop or complete a newer generation.
- Only tabs created and still owned by the extension may be closed automatically.
- A worker tab that the user navigates away from OviPets must not be auto-closed.
- Panel action wiring must not reference undefined shorthand actions; Edge live QA caught and fixed `copyBlacklistCsv` after refactor.
- Stop must clear durable active state even if the worker tab is already dead.
- MV3 service-worker memory is disposable; authoritative long-lived state must be persisted.
- Feature cancellation/state must not be accidentally shared across unrelated jobs.
- Command dispatch is not the same as confirmed game mutation.
- Turn Egg is UI-only: `pet_turn_egg` must never be dispatched through the page bridge or game-bridge client.
- Refactors are behavior-preserving unless the PR explicitly says otherwise.

## Planned sequence

Phase 0: complete GitHub runtime baseline + reproducible CI.
Phases 1–5: validated locally.
Phase 6: automated gates validated locally; live/manual/repository gates remain.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
