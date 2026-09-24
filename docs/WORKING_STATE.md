# OviPets Extension — Working State

Last updated: 2026-09-24
Current release baseline: v5.4.4
Current repository phase: Phase 0 — baseline import/CI bootstrap
Current local implementation status: Phases 1–5 and Phase 6 automated gates validated locally; v5.4.0 adds the silhouette Name-the-Species solver and the rolling-window Full Sweep; v5.3.17 fixed the real content-script dependency wiring for the v5.3.16 pedigree guard and adds integration regression coverage so breeding can proceed immediately after indexing completes. Manual/live release gates remain.

## Goal

Build an OviPets Chrome Manifest V3 extension that can run long automation sessions reliably, recover safely from MV3 service-worker suspension/reloads, avoid duplicate or destructive actions, and remain easy to extend through small modules with strong regression coverage.

## Current verification

Original supplied v5.3.0 snapshot:

- JavaScript syntax: PASS;
- Node test files: 23/23 PASS;
- content.js was approximately 3,360 lines.

Current managed release-candidate baseline:

- JavaScript syntax: PASS;
- Node test files: 64/64 PASS;
- content.js: 464 lines (composition/wiring + a few live helpers; see "content.js service split");
- background.js: 205 lines;
- Phase 1 lifecycle/mutation hardening remains covered;
- deterministic domain modules own breeding/pet-record rules;
- named core/DOM adapters replace broad platform coupling;
- jobs no longer depend on a broad legacy helper bag;
- all five major long-running feature state machines live under features/;
- panel/dashboard presentation lives under ui/;
- content-side orchestration moved out of content.js lives under services/ as explicit-dependency factories;
- background state/database/worker/journal/alert/health responsibilities live under bg/.

Issue #2 remains the repository gate: the complete runtime/test tree is not yet mirrored into GitHub, so GitHub is not yet the authoritative runtime source.

## Local implementation already validated

### Phase 1 — stability

- explicit workerStarted ACK scoped by owner + generation + owning worker tab;
- bounded start deadline with exact-generation cleanup;
- generation-safe Stop/release/completion;
- feed dispatch is not persisted as confirmed full food state;
- bridge-owned temporary DOM is filtered from refresh scheduling.

### Phase 2 — domain

Extracted domain/colors.js, domain/pet-record.js, domain/pedigree.js, domain/breeding-score.js and domain/breeding-plan.js.

### Phase 3 — adapters and dependency direction

Extracted core storage/game/worker/scheduler/game-action adapters and route/profile/hatchery/tabs/overview/friends/chat DOM readers. Jobs receive explicit adapters/domain objects and narrow feature services.

### Phase 4 — feature state machines and UI

Extracted features/own-eggs.js, features/pet-index.js, features/friend-sweep.js, features/hatchlings.js, features/breeding.js, ui/dashboard.js and ui/panel.js.

content.js is now a small composition/wiring layer plus a limited set of live Edit/profile mutation helpers.

### Phase 5 — background services and data efficiency

Extracted bg/state-db.js, bg/command-journal.js, bg/worker-manager.js, bg/species-alert.js and bg/state-health.js; bg/egg-tabs.js is the shared extension-owned egg-tab service for both own-Hatchery and Friend Sweep turning.

Efficiency/reliability changes:

- one-time legacy migration cached for service-worker lifetime;
- petDbGetMany/getPetsByIds avoids whole-DB reads in per-pet Pet Index and Breeding execution;
- command journal has status-aware bounded retention, rate-limited to once per day;
- task rows are bounded by design because only shared-worker and egg-run fixed IDs are used;
- fake IndexedDB covers keyPath/delete behavior for migration/retention tests.

A real Edge live-load regression (`copyBlacklistCsv` undefined during panel wiring) was found, fixed, and covered by a new wiring regression test.

Live QA then found that friend egg tabs opened but hidden `pet_turn_egg` dispatch did not complete reliably, and that simply browsing a friend Hatchery could auto-turn eggs. v5.3.1 removes `pet_turn_egg` from the page bridge entirely: all Turn Egg work now uses extension-owned profile tabs that click the real button, resolve Name the Species, and close only after confirmation. Own-egg auto-start is restricted to the user's own Hatchery.

### v5.3.5 Species learning + continuous Full Sweep

Species/Egg focused soak: 20 rounds × 8 files = 160 test-file executions, 0 failures. Three consecutive full-suite rounds also passed 56/56.

Name the Species now distinguishes retryable incorrect answers from terminal exhausted eggs, learns success/failure from the network response, shares the Inspector visual fingerprint with the solver, and supports portable Export/Import Species DB. Old Inspector exports can be mined during import to recover trace-based outcomes/Answer IDs.

Full Sweep no longer completes after one pass. It keeps the shared worker lease, wraps to the start of the friend queue, increments `owehSweep.cycle`, honors the existing 10-minute per-friend cooldown, and waits durably when the next pass is not yet eligible. Stop clears the durable active state and prevents any waiting cycle from reopening a friend.

### v5.3.5 leftover-tab recovery

Live Full Sweep exposed `too-many-leftover-tabs`, mainly from Name-the-Species tabs that reached the old 3-attempt limit or remained under a blocking Error overlay. v5.3.5 removes that permanent admission lock: species retries continue through untried choices up to a bounded answer-space cap, stuck Error overlays report `abandoned` and close the owned tab, and the next batch reconciles any older leftovers. Exact owned egg tabs are closed; navigated-away tabs are only removed from ownership state. Focused regression: 20 rounds × 6 files = 120 executions, 0 failures.

### v5.3.6 fail-open watchdogs

- Per egg tab deadline: 60 seconds. Missing terminal result => `timeout` + force-close the extension-owned tab.
- Per batch deadline: 120 seconds. All unresolved child tabs are force-closed and missing results are marked timeout.
- Background persists `openedAt` / `startedAt`, schedules Chrome Alarms, and enforces deadlines again on every `eggBatchStatus` poll.
- Full Sweep egg-step errors are fail-open: cleanup + diagnostic notice + `skipRemoval` + advance to the next friend, rather than stopping the sweep.
- Explicit `failed` egg-tab results are closed immediately instead of becoming new leftovers. `leftover` remains migration/recovery state only.
- User-opened tabs are never eligible because watchdog actions require an extension ownership registry record.

### v5.3.7 Diagnostic Logbook

A durable diagnostic ring buffer records up to 5,000 events / 14 days. High-value events include service-worker/content load, module/runtime exceptions, worker claim/start/phase/stop/release/lease expiry, sweep pass/wait/advance, egg batch open/result/timeout, tab watchdogs, forced fail-open recovery and critical status alerts. Export includes a sanitized state snapshot.

The Logbook is stored in `chrome.storage.local`, survives normal extension reload/update with the same extension identity, and can be exported as JSON before reinstall/machine moves. Focused diagnostic/worker/sweep soak: 20 rounds × 7 files = 140 test-file executions, 0 failures.

### v5.3.8 protected coordinator recovery

Live QA found the Full Sweep coordinator could disappear when its 45-second shared-worker heartbeat lease expired during a stall. The old health path explicitly closed `ownerTabId`. v5.3.8 makes `sweep` a protected worker owner: lease expiry revives the durable lease, logs recovery, and asks the same tab to resume. If the content script does not acknowledge, the same tab is reloaded rather than removed. Recovery preserves `owehSweep.cycle` and `owehSweep.index`.

Egg cleanup additionally refuses any close whose tab id equals the stored `coordinatorTabId`, even if registry state is corrupted.

Focused recovery soak: 20 rounds × 7 files = 140 executions, 0 failures. Full suite 57/57 PASS.

### v5.3.9 extension-context reload hardening

Edge live console showed `Extension context invalidated` after reloading the unpacked extension while an OviPets tab remained open. The old isolated-world content script could synchronously throw before `chrome.runtime.lastError` was reachable. v5.3.9 centralizes soft shutdown in `core/storage-client.js`: runtime/storage calls catch invalidation, mark the old context dead, stop future API calls, return safe fallbacks/no-op writes, and stop the old heartbeat loop. Worker/species/relay sends now use the same guarded runtime client.

Focused invalidation/worker/diagnostic soak: 20 rounds × 6 files = 120 executions, 0 failures. Full clean suite: 57/57 PASS.

### v5.3.10 orphaned-sweep auto-recovery

Live Diagnostic Logbook data showed the exact stall shape: `owehSweep.active=true`, cursor preserved at 29/213, but `owehWorker=null` after the protected coordinator tab disappeared and the worker row was released. v5.3.10 makes that state self-healing. Worker health checks now reclaim a replacement sweep coordinator automatically, send `recoverSharedWorker`, preserve `cycle/index`, and restore the reactive worker mirror. Missing protected tabs are replaced immediately when possible instead of merely releasing the lease.

The dashboard labels an active sweep without a live worker as `recovering`, and stale sweep notices expire after 15 seconds. New regression coverage reproduces the orphaned state and proves automatic replacement without resetting pass/index.

Focused self-healing soak: 20 rounds × 7 files = 140 executions, 0 failures. Full suite: 57/57 PASS.

### v5.3.12 Ninja + Ads friend discovery

- Ninja friend discovery scans both `Ninja please` and `Ads post` on `#!/OviPets`; target lookup is independent of vertical order.
- Each post expands its own previous comments back to the rolling 24-hour boundary.
- Candidate union is deduplicated globally by stable User ID and keeps the newest qualifying comment for duplicate IDs.
- Existing `owehFriendRequestHistory` is reused unchanged as the global do-not-resend set for both post sources.
- Missing/disappearing source posts are fail-soft; the available source still contributes candidates.
- Scan remains non-mutating: it only writes `owehChatQueue`; the request-sending job remains separate.
- Automated verification: full suite **59/59 PASS**; focused Ninja/chat soak **20 × 2 = 40/40 PASS**.

### v5.3.13 own-Hatchery Turn + Hatch

- `Turn / Hatch available eggs` detects both `Turn Egg` and `Hatch Egg` states in the user's own Hatchery.
- Hatch-ready own eggs dispatch the exact OviPets UI command `pet_turn_egg` directly from Hatchery, avoiding a profile-tab round trip.
- The direct path is guarded twice: isolated-world code exposes only `sendOwnHatchCommand()`, while the MAIN-world bridge requires `purpose=own-hatch`, an own-Hatchery route, and a visible matching `img[title="Hatch Egg"]` PetID.
- Generic/hidden Turn Egg remains blocked. Turnable eggs still use extension-owned profile tabs and the real button so Name the Species remains observable and safe.
- Friend Hatcheries cannot use the direct hatch route.
- Hatch dispatch is bounded/paced (up to 50 per pass, 100 ms apart), then the Hatchery reloads once to verify current state.
- Automated verification: JavaScript syntax PASS, release consistency PASS, full suite **59/59 PASS**, focused own-Hatchery/bridge soak **20 × 7 = 140 executions, 0 failures**.

### v5.3.11 Fast Sweep throughput

Fast Sweep removes the largest remaining friend-egg bottleneck: repeated Hatchery reloads between every 10 eggs. The coordinator snapshots the current friend's turnable egg queue once, drains it through back-to-back batches, then performs one final reload/verification. The queue is persisted in `owehFriendEggState` so coordinator/content recovery can resume without rebuilding already-drained work.

Adaptive concurrency uses persisted `owehEggSpeedProfile`: 10 tabs initially, 12 after five clean full batches, then 15 after five clean full 12-tab batches. Timeout or system-failure evidence lowers concurrency one level. Background hard-cap is 15. Child tabs stagger at 175 ms, close 250 ms after reporting, and background pushes batch progress/completion to the coordinator immediately; 2-second polling remains fallback only.

Friend Hatchery readiness is condition-based: Fast Sweep uses a shorter 450 ms game-ready delay and a 750 ms stable egg-list snapshot instead of a fixed 4-second empty-Hatchery wait. Name-the-Species confirmation/retry delays are also condition-based/shortened. Watchdog deadlines and self-healing coordinator semantics are unchanged.

Fast Sweep regression plus Lightweight Tabs brings the full suite to **59/59 PASS**. A 130-egg behavioral test proves adaptive `10×5 → 12×5 → 15 → 5` batching with one final Hatchery reload.

Full Sweep coordinator/egg tabs now use tab-scoped DNR session rules to block only image/media/font resources; scripts, DOM, CSS and network APIs needed by automation remain loaded. Species fingerprinting bypasses page image rendering through the guarded background challenge-image fetcher. The rule is removed when the owned tab closes.

Adaptive speed now includes latency pressure: repeated batches ≥35s back off one concurrency level, and any batch ≥50s backs off immediately even if no watchdog timeout fired. This prevents a slowing Edge/network session from remaining pinned at 15 tabs.

Diagnostic Logbook persistence changed from one monolithic 5,000-event value rewritten on every event to a fixed ring of 200-entry chunks. Existing v1 log data remains readable/exportable. This removes a real long-run I/O overhead discovered during the memory audit.

### v5.3.14 breeding male diversity

- Breeding Campaign first computes the normal best male, then opens a near-equivalent Body 1 pool around that baseline.
- Equivalent males must have the same exact endpoint mask on Body 1 and every remaining non-exact Body 1 channel must be within 15 RGB points.
- Within that pool, each male gets four independent target distances: Body 2, Scales, Extra 1 and Extra 2. The planner uses the **minimum** of those four values; e.g. `20 / 14 / 40 / 25` becomes 14.
- Lower best-secondary distance wins; equal scores fall back to recent male usage, lineage usage, then the existing pair-purity comparator.
- Near-equivalent alternatives are preserved beyond the ordinary shortlist cut so a large male population does not erase the diversity option.
- Planner queue rows record `maleSecondaryBestDistance`, `maleSecondaryBestKey` and `maleBody1EquivalentPoolSize` for diagnostics.
- Existing species, cooldown, pedigree/ancestor-overlap and ownership filters are unchanged.
- Automated verification: JavaScript syntax PASS, release consistency PASS, full suite **59/59 PASS**, focused breeding/planner soak **20 × 6 = 120 executions, 0 failures** before packaging.

### v5.3.15 Same-FF target-improvement breeding

- Breeding UI now exposes two explicit starts: **Pure-line campaign** and **Same-FF target campaign**.
- Same-FF strategy scans the full enclosure snapshot and considers every complete, owned, present, off-cooldown female regardless of enclosure.
- For each female, all complete, owned, present, off-cooldown males of the same species are considered across all enclosures.
- Candidate male must have the exact same Body 1 target-endpoint mask as the female; for the current white Body 1 target this means the same FF pair/set.
- Ancestor overlap remains a hard exclusion.
- Male selection is not pure-line driven: Body 2 / Scales / Extra 1 / Extra 2 are scored separately and the lowest slot distance is the primary selector.
- Equal primary scores prefer lower recent male use, then lower lineage use, then lower total secondary distance.
- Females with no exact Body 1 FF mask remain unpaired rather than being diverted to a different line.
- Strategy is persisted in campaign/start/index-resume state so a long profile-index handoff cannot silently switch strategy.
- Breed history records the strategy used for each confirmed pair.
- Automated regression before packaging: syntax PASS; full suite 59/59 PASS.

### content.js service split (2026-09-24, unreleased, behavior-preserving)

- New `services/` layer, loaded after ui/panel.js and before content.js. Each file exports `OWEH.services.<name>.createX(deps)`; every dependency is passed explicitly and no service reads content.js closure state (`getPageLoadDelayMs()`, `getOwnUserId()` and `getBlacklist()` are read live per call).
  - `services/diagnostics.js`: Diagnostic Logbook client (append/export/clear/summary).
  - `services/overview-catalog.js`: Overview shell/cards waits, `waitForStableValue`, `collectAllOverviewPets` (partial-scan merge and empty-scan guard unchanged).
  - `services/pet-edit.js`: profile tabs, rename, suggested name, save current pet, gender wait, move to enclosure.
  - `services/friend-directory.js`: friends-list scan, blacklist CSV, Ninja please / Ads commenter scan.
  - `services/retention.js`: review-only retention ranking and CSV.
- content.js 1,182 -> 652 lines. Dead code removed: `compareHatchMales`, `waitForBreedingCandidates`, unused DOM imports and delay clamps. Selectors, storage keys and messages unchanged.
- New runtime wiring gate `tests/content-boot-wiring.test.js`: loads every isolated content script in manifest order in a vm, runs content.js and fails if any helper handed to `OWEH.boot` (including `uiPanelActions`) is `undefined` or any module fails to start. This is the class of bug behind v5.3.17 and the panel display breakages; source-text tests could not see it.
- New behavior tests: `tests/overview-catalog-service.test.js` (full / stuck-tab partial / fewer-tabs partial / empty / snapshot reuse) and `tests/friend-retention-services.test.js`.
- Verification: syntax PASS, release consistency PASS, full suite **64/64 PASS**.
- Second pass (2026-09-24): `services/status.js` (status line + worker-done notice), `services/partner-ranking.js` (Rank partners, breeding-candidate parsing, hatchling male metrics) and `services/worker-control.js` (Stop All, task heartbeat, shared-worker message routing, reload recovery of orphaned one-button jobs). content.js 652 -> 464 lines; new `tests/content-services.test.js`; full suite **65/65 PASS**. Not yet re-smoked live.
- Live smoke (2026-09-24, reloaded extension, real account): panel renders "Ready · controls connected"; Diagnostics summary loads; Copy blacklist CSV (3); Copy retention CSV (25, nothing removed); profile suggested name + Save current pet (325 indexed); Update pet catalog via shared background tab saved 325 pets from 9 enclosures; no console errors. Not re-run live: Apply/rename, move to enclosure, Ninja chat scan, Scan friend list.

### v5.4.4 Species Review tab

- New extension page `review/species-review.html` (+ `.css`, `.js`; pure `buildModel` / `filterItems` exported as `OWEH_SPECIES_REVIEW`), opened by the `openSpeciesReview` message from the panel button `#oweh-species-review`.
- `speciesReviewLabel` message: `bg/species-memory.js` `label()` / `applyManualLabel()` (refuses `game-confirmed` / `game-rejected`, keeps `manual` through later `learn`); `bg/species-shapes.js` `remove()` drops the silhouette of a replaced label.
- Data check on the 2026-09-23 export: 514 detected challenges, 121 saved images (47 confirmed, 74 wrong-only), every answer from the same 10 species, no image repeated (each egg's challenge image is unique, the species pool is not).
- New `tests/species-review.test.js`; full suite 68/68 PASS.

### v5.4.3 MATCH_DISTANCE 250 + back-fill on import

- Evaluated in the live page against 47 real confirmed `credit-challenge` images (user's exported DB; the challenge pool looked limited to 10 species: Gekko, Mantis, Raptor, Equus, Feline, Slime, Canis, Vulpes, Draconis, Lupus) and 94 Adoption pets. Accuracy with 4 options — adoption-only library: T150 52%, T200 69%, T250 72%, pure nearest 74%; adoption + challenges: 84–87% at every threshold. `MATCH_DISTANCE` 150 → 250.
- `bg/species-shapes.js` `rescanMemory()` re-arms the one-time back-fill; `speciesShapeRescan` message; `importDatabase` fires it after merging memory. Imported DB thumbnails (`image` JPEG data URLs) have no alpha and are not usable as masks.

### v5.4.2 bigger, redundancy-evicting silhouette library

- `MAX_EXAMPLES` 40 → 150 (~38 KB per species). A full species drops the older example of its closest pair (`dropMostRedundant`, O(n²), ~16 ms per add at 150) instead of the oldest, so diverse mutation outlines are kept. `hamming` uses a charCode lookup table. The seeder no longer skips full species.
- 40 was not measured (live data had ~4 pets per species); re-measure accuracy vs. examples per species from an exported library later.

### v5.4.1 Learn Species Shapes + tuned threshold

- Live measurement (129 Adoption Center pets, 31 species, full-frame 32x32 alpha mask): nearest same-species p10/p50/p90 = 64/114/217, nearest other-species 135/175/216; LOO 1-NN with 4 options ≈ 87% (kNN3 84%, Bernoulli NB 82%, bbox-cropped 79%). `credit-challenge` renders a random species for any pet id, so the pet's own species is useless for the challenge.
- `domain/species-shape.js`: `MATCH_DISTANCE` 44 → 150 (simulated accuracy at 60% library coverage 36% → 72%), `MAX_EXAMPLES` 12 → 40.
- New `jobs/species-seed.js` (Learn Species Shapes / Stop): own `owehPets` + Adoption Center JSONP list → profile JSONP species → `/img/pet/<id>` mask → `speciesShapeLearn`. 150 ms throttle, seen ids in `owehSpeciesSeedSeen` (cap 5000), species at the cap skipped, Adoption Center only on ovipets.com.
- New `tests/species-seed.test.js`.

### v5.4.0 silhouette species solver + rolling Fast Sweep

- Root cause of flat species accuracy: `/img/pet/<id>/credit-challenge` renders a random species with random colors/genes, so the exact 16x16 luminance fingerprint never repeats (live stats 336 correct / 4,617 detected). The silhouette (alpha mask) is fixed per species.
- New pure `domain/species-shape.js` (content + service worker): 32x32 alpha mask as 256 hex chars, Hamming distance, `rankOptions` (≤44 → `shape-match`; else an unlearned option → `shape-unknown`; else `shape-nearest`), dedupe ≤6, max 12 examples per species.
- New `bg/species-shapes.js`: serialized writer for `owehSpeciesShapes` (`speciesShapeLearn`, `speciesShapeMerge`), plus a resumable one-time back-fill (`owehSpeciesShapesMigration`) that re-fetches confirmed credit-challenge URLs from `owehSpeciesMemory` (concurrency 3, retried up to 3 starts).
- `jobs/species-answer.js` order: confirmed exact memory → silhouette ranking → random guess. Stats gain `shapeAnswers` / `shapeCorrect`. Inspector import/export includes `shapes`.
- Full Sweep rolling window: new background `eggBatchExtend` tops up the running batch (room = limit − unresolved; refuses unknown/finished batches and non-coordinators); `extendedAt` restarts the batch watchdog; tab opens for one batch share one staggered queue. `jobs/friend-eggs.js` `topUpBatch` charges attempts before the request and un-charges refused eggs; the 2-minute coordinator timeout counts from the latest top-up; adaptive speed is normalized per window of `concurrency` eggs. Missing `eggBatchExtend` disables top-ups for that batch (plain batches).
- New `tests/species-shape.test.js`; rolling-window cases added to `egg-tabs.test.js` and `friend-eggs.test.js`. Full suite **66/66 PASS**. Live smoke pending an extension reload.

### v5.3.17 breeding dependency-wiring hotfix

- Live diagnostic reproduced a deterministic crash at the first breeding step after indexing: `Cannot read properties of undefined (reading 'pedigreeCompatibility')` from `features/breeding.js`.
- Root cause: `domain/pedigree.js` loaded correctly, but `content.js` omitted `pedigree` from the `domain` object passed into `OWEH.boot(...)`.
- Runtime now explicitly injects `pedigree: OWEH.domain.pedigree`.
- Breeding feature also falls back to the already-loaded global domain module and asserts the compatibility API before campaign execution.
- New integration regression verifies manifest dependency order plus real content boot wiring; database-breeding regression requires the exact injection contract.
- Verification before packaging: syntax PASS, release consistency PASS, full suite **60/60 PASS**, focused wiring/pedigree/breeding soak **160/160 PASS**.

### v5.3.16 Pedigree Guard + male fallback

- `dom/profile.js` records `pedigreeVerified=true` only when the lazy-loaded Pedigree ancestor fieldset exists.
- Pet indexing waits for Pedigree content and a stable ancestor-ID signature for 300 ms, retries the tab load once, and caches unresolved profiles as unverified instead of silently treating them as unrelated.
- `domain/pet-record.js` requires verified pedigree and bumps database metadata schema from 3 to 4, forcing legacy v5.3.15 records through a one-time safe refresh.
- `domain/pedigree.js` exposes `pedigreeCompatibility()` and fails closed on unverified ancestry; direct ancestors/shared ancestors remain hard exclusions.
- Both Pure-line and Same-FF planners consider only pedigree-verified females/males and persist an ordered `maleCandidates` fallback list for each female.
- Breeding runtime mode is `database-direct-v2` and revalidates pedigree immediately before every direct breed command.
- OviPets `Unable to breed pets.` dialogs are detected by the MAIN-world bridge and returned as `unable-to-breed-pets` instead of a 15-second `command-timeout`; the dialog is dismissed before continuing.
- Rejected male IDs are persisted on the current female queue row and the campaign tries the next safe male without advancing the female.
- If all candidates are exhausted, only then is that female marked unpaired and the campaign advances.
- Full pre-package suite: 59/59 PASS.

## Still open

- live v5.3.11 Fast Sweep/watchdog/orphan auto-resume plus retryable incorrect → second guess and terminal no-longer-turnable lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- friend-request state remains intentionally "dispatched" unless a reliable confirmation signal is observed;
- full runtime/test source must be imported into GitHub and CI must reproduce the suite;
- Phase 6 manual Windows/live/soak gates.
- clean GitHub checkout CI after Issue #2 is resolved.

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
- Stop must clear durable active state even if the worker tab is already dead.
- MV3 service-worker memory is disposable; authoritative long-lived state must be persisted.
- Feature cancellation/state must not be accidentally shared across unrelated jobs.
- Command dispatch is not the same as confirmed game mutation.
- Turn Egg is UI-only: `pet_turn_egg` must never be dispatched through the page bridge or game-bridge client.
- Refactors are behavior-preserving unless the PR explicitly says otherwise.

## Planned sequence

Phase 0: complete GitHub runtime baseline + reproducible CI.
Phase 1: stability hardening — validated locally.
Phase 2: domain extraction — validated locally.
Phase 3: adapters/DOM/dependency-contract extraction — validated locally.
Phase 4: feature/UI extraction — validated locally.
Phase 5: background/data-efficiency extraction — validated locally.
Phase 6: automated release hardening + required live/manual QA.

## Required update rule

Every merged PR that changes architecture, persistent state, worker lifecycle, automation semantics, repository phase, or runtime phase must update this file in the same PR.
