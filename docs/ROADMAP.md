# OviPets Stability-First Roadmap

This roadmap intentionally prioritizes correctness and recoverability before large-scale file movement.

## Phase 0 — Baseline and guardrails

Status: in progress.

Deliverables:

- v5.3.0 source and tests under version control;
- local-only files ignored;
- CI runs JavaScript syntax verification and all Node tests;
- architecture invariants documented;
- living WORKING_STATE.md established;
- agent/skill workflow added.

Exit gate:

- baseline can be reproduced from a clean checkout;
- syntax and all existing tests pass;
- no secrets, local session locks or machine-specific settings are committed.

## Phase 1 — Worker and mutation-state hardening

Goal: remove the highest-risk race and false-success failure modes before refactoring.

Work:

- explicit worker-start ACK containing owner + generation;
- bounded start deadline;
- deterministic cleanup of failed starts;
- generation-safe Stop/release/complete;
- worker state-machine regression tests;
- distinguish dispatched vs confirmed feed/request mutations;
- extension-owned DOM marker/filter;
- live verification of the two remaining OviPets DOM contracts.

Exit gate:

- no state transition can release a different generation;
- a worker that never ACKs cannot hold the lease indefinitely;
- false command dispatch cannot be persisted as confirmed success;
- all old and new tests pass;
- live QA checklist records observed DOM behavior.

## Phase 2 — Pure domain extraction

Goal: reduce content.js without changing browser behavior.

Extract first:

- target/color helpers;
- color distance/bracketing;
- pedigree safety;
- partner scoring;
- breeding-plan calculations.

Rules:

- modules have no document/window/chrome/timer dependencies;
- write unit tests before or with extraction;
- preserve output for existing fixtures.

Exit gate:

- breeding domain can be tested in isolation;
- content.js no longer owns pure breeding math;
- no storage schema or DOM behavior change.

## Phase 3 — Platform adapters

Extract:

- core/storage-client.js;
- core/game-bridge.js;
- core/worker-client.js;
- core/scheduler.js;
- dom/routes.js and route-specific DOM readers.

Goal: replace the broad legacy dependency bag with explicit service contracts.

Exit gate:

- jobs depend on small named services;
- selectors live in DOM adapters rather than orchestration;
- storage calls are centralized;
- global refresh begins moving toward route-aware scheduling.

## Phase 4 — Feature state machines and UI

Extract:

- own egg processing;
- friend sweep;
- pet indexing;
- hatchling processing;
- breeding campaign;
- panel/dashboard rendering and handlers.

Exit gate:

- content-entry.js is bootstrap/orchestration only;
- feature modules own their state machines;
- UI does not own automation state;
- cancellation is feature-scoped.

## Phase 5 — Background and data efficiency

Split background responsibilities:

- bg/state-db.js;
- bg/command-journal.js;
- bg/worker-manager.js;
- bg/egg-tabs.js;
- bg/species-alert.js.

Efficiency work:

- avoid repeated full pet DB materialization;
- add focused pet queries only where measurements justify them;
- cache migration status for service-worker lifetime;
- prune durable command/task history;
- adaptive mutation pacing/backoff.

Exit gate:

- background.js is mostly event/message registration;
- long runs show bounded durable state growth;
- large pet databases do not cause unnecessary full scans.

## Phase 6 — Release hardening

Add:

- manifest integrity test;
- sanitized DOM fixtures;
- extension-load smoke test;
- multi-hour soak checklist;
- MV3 suspend/restart recovery tests where practical;
- Windows Chrome manual QA matrix;
- release checklist and changelog discipline.

Release gate:

- CI green;
- regression reviewer green;
- live QA green;
- no unresolved P0/P1 issue;
- recovery from tab close/service-worker restart is verified;
- version docs and manifest agree.

## Change-size policy

Prefer one behavior change or one extraction boundary per PR. Do not combine a large behavior redesign with a large file move. Every phase must remain bisectable.
