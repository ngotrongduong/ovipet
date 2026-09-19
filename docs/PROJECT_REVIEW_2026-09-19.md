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

`claimWorker()` currently responds success immediately after creating the worker tab, while `attachSharedWorkerTab()` and `sendWorkerStart()` complete asynchronously. `sendWorkerStart()` retries eight times, but there is no explicit start ACK.

Failure mode: if the content script never receives the start message, the task can remain in a `starting` state. The worker tab reload-resync path can then recover owner/generation and heartbeat the lease even though the feature never actually started.

Recommended change:

1. Add a `workerStarted` ACK containing owner + generation.
2. Keep a short start deadline (for example 15–20 seconds).
3. Only report the Start operation as successful after the tab is attached and the start ACK is received.
4. If the deadline expires, close the owned worker tab and release that exact generation.

### P1 — stop/release must be generation-safe

`releaseSharedWorker(expectGeneration)` already supports generation checks, but `releaseWorker()` calls `releaseSharedWorker()` without the generation it just read.

Recommended change: release only the owner/generation from the authoritative snapshot. A stale Stop operation must never be able to release a newer worker claim.

### P1 — distinguish command dispatch from confirmed mutation

`page-bridge.js` deliberately treats `pet_feed` and `friend_request` as fire-and-forget. The bridge returns `ok: true, reason: "dispatched"` before the game callback confirms the mutation.

For feeding, `jobs/feed.js` then records:

- `lastFedAt = now`
- `foodPercent = 100`
- `foodCheckedAt = now`

This turns "dispatcher accepted the command" into "server confirmed the pet is full" and may suppress retry for many hours after a transient failure.

Recommended change:

- Store `feedDispatchedAt` separately from confirmed food state.
- Do not write `foodPercent = 100` until a later profile/catalog observation confirms it.
- Prefer small callback-aware concurrency over 100 ms fire-and-forget throughput.
- Apply the same status distinction to friend-request history: `pending/dispatched/confirmed/rejected`.

### P1 — complete the remaining live DOM verification

Two assumptions are still important enough to validate manually on OviPets:

1. Wrong-answer lifecycle for "Name the Species".
2. Friend egg opened in its own pet tab: whether the expected `pet_turn_egg` control appears and whether successful completion is reliably observable.

The automated tests protect the assumed contracts, but they cannot prove the live game still implements those contracts.

## Performance / efficiency work

### P2 — replace global refresh with route-aware scheduling

The extension observes the entire document subtree. A 50 ms coalescing timer is a good regression fix, but every refresh still invokes many unrelated pipelines.

Current refresh includes panel work, job hooks, egg run, sweep, pet indexing, breeding, hatchlings, naming, blacklist count, and dashboard scheduling.

Recommended architecture:

- classify the current route;
- filter extension-owned/bridge-only DOM mutations;
- maintain dirty flags;
- notify only modules relevant to the changed route/state;
- use explicit events such as `routeChanged`, `hatcheryChanged`, `profileChanged`, and `storageChanged`.

### P2 — ignore bridge-owned temporary forms

Fire-and-forget bridge calls temporarily append hidden forms to the page for up to five seconds. Those forms also feed the global MutationObserver.

Mark bridge-created nodes (for example `data-oweh-bridge`) and ignore mutation records that consist only of extension-owned nodes.

### P2 — stop materializing the full pet DB for every operation

`storageGet("owehPets")` maps to IndexedDB `getAll()`. This is convenient compatibility behavior, but jobs repeatedly materialize the full database.

Add focused background APIs such as:

- `petDbGet(ids)`
- `petDbQuery({ owned, present, enclosureId, gender, staleBefore })`
- `petDbMerge(records)`

As a lower-risk first step, cache one pet snapshot for the lifetime of a job.

### P2 — cache one-time migration status

`migrateLegacyPetsOnce()` checks IndexedDB metadata repeatedly. Keep a service-worker-lifetime promise/cache after the first successful check.

### P2 — prune durable state

Add retention for old command-journal rows and any historical task data that no longer participates in recovery. The pet database should remain durable; command history does not need to grow forever.

### P2 — adaptive pacing

Mutation queues currently use fixed delays, including 100 ms lanes. Prefer per-command pacing:

- await callback where practical;
- cap concurrency;
- back off on timeouts/rejections;
- use a conservative default;
- keep throughput configuration separate from correctness.

## Modularization assessment

`content.js` is approximately 3,360 lines and currently owns too many concerns. The existing `jobs/` split is useful, but jobs still depend on a broad `legacy` contract exported from `content.js`, so the main file remains the real application core.

`background.js` at roughly 730 lines is starting to become the same kind of concentration point.

Do not perform a big-bang rewrite. Move one boundary at a time and keep the existing tests green after every extraction.

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
  core.js
  runner.js
  catalog.js
  profiles.js
  sort.js
  feed.js
  ninja.js
  requests.js
  friend-eggs.js
  egg-turn-tab.js
  species-answer.js

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

No bundler is required for this refactor. Manifest script order can continue to provide dependencies while the codebase is being split. If ES-module tooling is desired later, that should be a separate change after behavior is stable.

## Extraction order

### Phase 0 — baseline and guardrails

- Put the exact v5.3.0 snapshot under version control.
- Ignore local-only Claude/session files.
- Add CI for JS syntax + Node tests.
- Document architecture invariants and storage/worker contracts.
- Move historical release notes out of README into CHANGELOG when convenient.

### Phase 1 — stability hardening

- worker start ACK + deadline;
- generation-safe stop;
- dispatched vs confirmed mutation state;
- mutation-observer filtering;
- live verification checklist for species and friend-egg flows.

### Phase 2 — pure domain extraction

Move functions with no DOM/Chrome dependency first:

- color distance / target helpers;
- pedigree rules;
- partner scoring;
- breeding-plan calculations.

Pure modules are the safest extraction and will gain the strongest unit tests.

### Phase 3 — platform adapters

Extract storage RPC, game bridge, worker client, route detection, and DOM readers. Replace the broad `legacy` bag with explicit services.

### Phase 4 — feature state machines and UI

Move egg/sweep/index/hatchling/breeding orchestration into feature modules. Move panel/dashboard rendering and handlers into `ui/`.

Target: `content-entry.js` should become a small bootstrap/orchestration file (roughly a few hundred lines rather than thousands).

### Phase 5 — background split and database efficiency

Split IndexedDB, command journal, worker manager, species alert and message routing. Add query APIs/indexes only where measurements justify them.

## Testing upgrades

Keep all current tests. Add:

- worker state-machine tests: delayed start, missing ACK, reload during start, stale Stop, generation rollover;
- mutation protocol tests: dispatched vs confirmed;
- manifest integrity test: every referenced file exists and dependency order is valid;
- fixture-based DOM tests using saved sanitized HTML structures;
- storage migration/schema tests;
- regression tests for each module extraction.

## Important invariants to preserve

1. OviPets mutations go through the game's own UI dispatcher; do not invent direct private API calls.
2. One button starts one job; do not silently chain unrelated jobs.
3. Only one shared background worker claim may be live.
4. A stale generation must never stop or complete a newer generation.
5. The extension may close only tabs that it created and still owns.
6. Stop must clear durable active state even when a worker tab is dead.
7. Consequential automation remains explicit and observable.
8. Never restore retired legacy workflows merely because old README/CLAUDE history still mentions them.

## Recommended immediate next change

Implement Phase 1 as a dedicated branch/PR before large file movement. Once the worker protocol and command-result semantics are hardened, begin modularization with the pure breeding-domain functions. This gives the highest stability improvement with the lowest refactor risk.
