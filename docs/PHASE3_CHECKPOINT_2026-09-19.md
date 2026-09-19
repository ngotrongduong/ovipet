# Phase 3 Platform Adapter Extraction — Checkpoint A

Date: 2026-09-19
Baseline: validated Phase 2 working tree
Status: first Phase 3 boundary complete locally; GitHub runtime import remains gated by Issue #2.

## Result

`content.js` is now 2,796 lines, down from 3,407 at the Phase 1 hardened baseline and 3,003 after Phase 2.

Extracted:

- `core/storage-client.js`
- `core/game-bridge.js`
- `core/worker-client.js`
- `dom/routes.js`

## Storage client

Owns runtime request normalization, the `owehPets` background/IndexedDB facade, local storage reads/writes and multi-key reads. The existing job helper contract is preserved.

## Game bridge

Owns page command/ping events, request IDs/timeouts, and command-journal transitions. Tests verify the durable `dispatched` boundary is written before crossing into MAIN world and that missing callbacks fail as `bridge-timeout`.

## Worker client

Owns task/shared-worker requests, local owner/generation identity, duplicate Start ACK behavior, phase/done reporting, reload resync and heartbeat. The three worker identity globals were removed from `content.js` while preserving Phase 1 lifecycle semantics.

## Route adapter

Owns only low-risk route/ID/hash interpretation. Live selectors for Hatchery cards, pedigree, profile data and Overview cards intentionally remain in `content.js` until fixture-backed DOM contracts are ready.

## Verification

- JavaScript syntax: PASS
- Node test files: 31/31 PASS
- manifest dependency-order test: PASS
- Phase 1 worker regression tests: PASS
- no storage schema change
- no page-bridge protocol change
- no live DOM selector change

## Next

1. route-aware refresh scheduling;
2. DOM readers one route at a time with sanitized fixtures;
3. shrink the broad legacy job dependency bag;
4. leave feature state machines in place until adapters are proven.
