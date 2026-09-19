# Phase 5 Background Services + Data Efficiency — Complete Checkpoint

Date: 2026-09-19
Baseline: validated Phase 4 working tree
Status: Phase 5 complete locally; GitHub runtime import remains gated by Issue #2.

## Result

The MV3 background service worker is now a composition/router layer rather than a state-management monolith.

Current key sizes:

- content.js: 998 lines
- background.js: 165 lines
- bg/state-db.js: 198 lines
- bg/command-journal.js: 167 lines
- bg/worker-manager.js: 409 lines
- bg/egg-tabs.js: 275 lines
- bg/species-alert.js: 40 lines
- bg/state-health.js: 41 lines

## Extracted background services

### bg/state-db.js

Owns:

- IndexedDB open/schema/transactions;
- one-time legacy pet migration;
- whole-pet reads;
- targeted pet reads;
- transactional pet merge;
- fixed task lease rows.

Legacy migration status is cached for the service-worker lifetime so repeated operations do not re-check migration metadata unnecessarily.

### bg/command-journal.js

Owns:

- begin/update/read;
- breed-command reconciliation;
- bounded retention.

Retention policy is deliberately conservative:

- queued: 1 day;
- callback-confirmed / game-state-confirmed / rejected: 30 days;
- dispatched: 90 days;
- unknown/manual statuses: retained.

Pruning is rate-limited to once per 24 hours and records its last pass in the IndexedDB meta store.

### bg/worker-manager.js

Owns the full shared-worker lease/state machine, including atomic claims, start ACK deadlines, generation/tab scoping, Stop, completion, health cleanup and worker-state mirroring.

### bg/species-alert.js

Owns offscreen audio setup plus tab/window attention behavior.

### bg/state-health.js

Owns database/task/command health aggregation and runs rate-limited journal pruning before reporting health.

### bg/egg-tabs.js

Remains the dedicated extension-owned friend-egg tab registry/manager.

## Data efficiency

A new targeted path avoids full pet-database materialization for per-pet work:

- background message: petDbGetMany
- state DB API: getPetsByIds(ids)
- storage client API: getPetsByIds(ids)

Pet Index profile processing and Breeding execution now read only the pet(s) they need. Planning/sort/feed jobs intentionally retain whole-DB reads because they operate across the complete population.

getPetsByIds uses one IndexedDB readonly transaction for the requested set and deduplicates IDs.

## Durable growth

The task store does not need pruning: current task IDs are a fixed set (shared-worker and egg-run) and are overwritten in place, so task-row count is bounded by design.

Permanent friend-request history and friend blacklist are not pruned because their product semantics intentionally prevent duplicate requests/re-adding removed zero-egg friends.

## Test infrastructure

The fake IndexedDB now models object-store keyPath and delete(), allowing retention/meta behavior to be tested more realistically.

New direct tests cover:

- targeted pet DB queries;
- command-journal retention boundaries/rate limiting;
- background state-health aggregation.

## Verification

- JavaScript syntax: PASS
- Node test files: 49/49 PASS
- manifest integrity: PASS
- Phase 1 worker lifecycle regressions: PASS
- Phase 3 dependency-contract regressions: PASS
- Phase 4 feature/UI regressions: PASS
- no IndexedDB schema-version change
- no OviPets page-bridge protocol change
- no live DOM selector change

## Deliberate non-change

Direct-command pacing was not changed in this phase. There is no measured evidence yet that the established pacing is the current bottleneck, and changing it would mix performance tuning with the structural/data work above.

## Next

Phase 6 automated release hardening can proceed: clean-package verification, version/source consistency, load-order/static smoke checks and final regression gates. Current live OviPets contracts still require manual QA before release.
