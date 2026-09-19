# Phase 3 Platform Adapter Extraction — Checkpoint B

Date: 2026-09-19
Baseline: validated Phase 2 working tree
Status: adapter and job-contract boundary validated locally; GitHub runtime import remains gated by Issue #2.

## Result

content.js is now 2,480 lines, down from 3,407 at the Phase 1 hardened baseline.

Extracted core adapters:

- core/storage-client.js
- core/game-bridge.js
- core/worker-client.js
- core/scheduler.js
- core/game-actions.js

Extracted DOM adapters:

- dom/routes.js
- dom/profile.js
- dom/hatchery.js
- dom/tabs.js
- dom/overview.js
- dom/friends.js
- dom/chat.js

Additional pure domain boundary:

- domain/pet-record.js

## Job dependency contract

The one-button jobs no longer receive or reference one broad `legacy` helper object.

They now receive explicit dependencies such as:

- routes
- profileDom / hatcheryDom
- domain.colors / domain.petRecord / domain.breedingPlan
- gameActions
- settings
- narrow catalog/profile-index/ninja/sweep services

A dedicated regression test fails if the old legacy helper bag is reintroduced.

## Game actions

Direct game mutations that are reusable outside a feature state machine now live in `core/game-actions.js`:

- feedPet
- requestFriend
- removeFriendDirect
- breedPairDirect
- fastMovePetToEnclosure

This module owns command validation/dispatch only; feature policy remains elsewhere.

## Route-aware scheduling and DOM contracts

The coalesced refresh scheduler keeps the existing 50 ms behavior and filters bridge-owned mutation churn.

Obvious route-no-op work is skipped early.

Selector-heavy DOM reading has moved into route-specific adapters with characterization tests. Feature orchestration remains in content.js until Phase 4.

## Verification

- JavaScript syntax: PASS
- Node test files: 39/39 PASS
- content.js: 2,480 lines
- manifest dependency-order test: PASS
- Phase 1 worker regression tests: PASS
- no storage schema change
- no page-bridge protocol change
- no known live selector semantic change

## Next

Phase 4 begins with the smallest feature state machine, preserving behavior and using the extracted core/DOM/domain contracts. UI extraction follows feature extraction, not before it.
