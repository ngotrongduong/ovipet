# OviPets Hatchery Helper — Stability & Architecture Review

Date: 2026-09-19
Reviewed version: 5.3.0

## Verification baseline

- All JavaScript runtime/test files pass `node --check`.
- All 23 existing Node test files pass.
- Existing v5 architecture already has useful separation through `jobs/`, `bg/egg-tabs.js`, a shared worker lease, IndexedDB pet state, and a restricted MAIN-world game bridge.
- This review intentionally does not change runtime behavior.

## Highest-priority stability work

### P1 — shared worker start must be acknowledged

`claimWorker()` reports success before tab attachment/start completion, while `sendWorkerStart()` has retries but no explicit start ACK. Add owner+generation ACK, a start deadline, and release the exact generation if startup never completes.

### P1 — stop/release must be generation-safe

`releaseSharedWorker(expectGeneration)` supports generation checks, but `releaseWorker()` calls it without the generation it just read. Release only the authoritative owner/generation snapshot.

### P1 — distinguish command dispatch from confirmed mutation

`pet_feed` and `friend_request` may return `ok: true, reason: "dispatched"` before the game callback confirms the mutation. Do not treat a dispatched feed as confirmed 100% food. Store dispatched/pending state separately and reconcile it later.

### P1 — complete remaining live DOM verification

Manually validate the wrong-answer lifecycle for Name the Species and the friend-egg own-tab Turn Egg lifecycle against the live site.

## Performance / efficiency work

- Replace the global refresh pipeline with route-aware scheduling and dirty flags.
- Mark/ignore extension-owned bridge DOM mutations.
- Stop materializing the full pet DB for every job; add focused DB APIs or at least one snapshot per job.
- Cache one-time legacy-migration status for each service-worker lifetime.
- Add retention/pruning for old command-journal data.
- Prefer callback-aware limited concurrency and backoff over fixed 100 ms mutation queues.

## Modularization assessment

`content.js` is approximately 3,360 lines and still acts as the application core. The existing `jobs/` split is useful but depends on a broad `legacy` contract from `content.js`. `background.js` is also becoming a second concentration point.

Do not perform a big-bang rewrite. Extract one boundary at a time and keep all tests green.

## Recommended target structure

```text
manifest.json
content-entry.js
core/
  config.js
  storage-client.js
  game-bridge.js
  worker-client.js
  scheduler.js
dom/
  routes.js
  hatchery.js
  profile.js
  overview.js
  friends.js
  chat.js
domain/
  colors.js
  pedigree.js
  breeding-score.js
  breeding-plan.js
features/
  own-eggs.js
  friend-sweep.js
  hatchlings.js
  pet-index.js
  breeding-campaign.js
jobs/
ui/
  panel.js
  dashboard.js
bg/
  state-db.js
  command-journal.js
  worker-manager.js
  egg-tabs.js
  species-alert.js
background.js
page-bridge.js
tests/
docs/
```

## Recommended sequence

1. Baseline + CI + architecture contracts.
2. Worker/mutation stability hardening.
3. Pure breeding-domain extraction.
4. Core platform/DOM adapters.
5. Feature state machines and UI extraction.
6. Background split and DB query improvements.
7. Browser/fixture integration tests and live verification.

Target end state: `content-entry.js` should mainly bootstrap modules and route events, ideally a few hundred lines rather than thousands.
