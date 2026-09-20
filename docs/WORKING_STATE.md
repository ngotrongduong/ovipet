# OviPets Extension — Working State

Last updated: 2026-09-20
Current release baseline: v5.3.11
Current repository phase: Phase 0 — runtime import/CI bootstrap remains open
Current local implementation status: Phases 1–5 plus current Phase 6 automated gates validated; live/manual gates remain.

## Current verification

- JavaScript syntax: PASS
- release consistency: PASS
- Node tests: **59/59 PASS**
- clean-extracted ZIP reproduces 59/59
- current full-suite release gate: 59/59 PASS
- focused Egg/Species/DB soak: **20 rounds × 8 files = 160 test-file executions, 0 failures**
- local-only Claude/session files absent from release package

## Validated architecture

Phases 1–5 remain validated: hardened worker lifecycle, deterministic domain modules, explicit core/DOM adapters, extracted feature/UI state machines, split background services and targeted database reads.

### v5.3.5 live-driven behavior

- Turn Egg is UI-only through extension-owned profile tabs.
- Continuous Full Sweep loops until Stop and honors friend cooldown.
- `The answer is incorrect, please try again.` is retryable: explicit negative evidence is stored, Error is dismissed, the same egg is retried, and that species is excluded.
- `The egg can no longer be turned.` is terminal: only then does the owned tab close as exhausted.
- Timeout, silence, navigation and selecting another option are **not** evidence of a wrong species.
- Species Inspector learns from real network outcomes and Answer IDs.
- A guarded background fetcher retrieves only OviPets credit-challenge images so the Inspector can compute a perceptual fingerprint; Species Answer uses the same identity.
- **Export Species DB / Import Species DB** provides portable learning persistence across reinstall/machines.
- Import is idempotent and merges with existing knowledge.
- Old full Inspector exports can be mined during import to recover trace-based outcomes/Answer IDs when old learned-memory fields were empty.

### v5.3.5 leftover-tab recovery

Live QA found `too-many-leftover-tabs` after Name-the-Species failures accumulated as kept-open leftovers. v5.3.5 removes the fixed 3-attempt stranding path, closes bounded species-UI failures as extension-owned `abandoned` results, and reconciles all older leftover registry entries before admitting a new batch. The safety rule remains: only a tab still on the exact owned OviPets egg page may be auto-closed; navigated-away tabs are only removed from ownership state.

Focused regression: 20 rounds × 6 egg/sweep/species files = 120 test-file executions, 0 failures. Clean ZIP still passes 57/57.

### v5.3.6 fail-open watchdogs

- Per owned egg tab: 60s deadline => timeout + force-close if no terminal report.
- Per batch: 120s deadline => unresolved owned tabs force-close and missing results become timeout.
- Chrome Alarms back the persisted openedAt/startedAt deadlines; eggBatchStatus also enforces them.
- Full Sweep egg-step errors are fail-open: cleanup + notice + skipRemoval + advance, not Stop.
- Explicit failed egg results close immediately instead of creating new leftovers.
- Focused watchdog/sweep soak: 20 rounds × 6 files = 120 executions, 0 failures.
- Clean ZIP still passes 57/57.

### v5.3.7 Diagnostic Logbook

A durable ring buffer records the newest **5,000 events / 14 days** in `chrome.storage.local`. High-value events include module/runtime exceptions, worker claim/start/phase/stop/release/lease expiry, sweep pass/wait/advance, egg batch/tab result and watchdog timeout, forced fail-open recovery, and critical status alerts. Export includes a sanitized worker/sweep/egg/job snapshot.

Focused diagnostic/worker/sweep soak: 20 rounds × 7 files = 140 test-file executions, 0 failures. Clean ZIP full suite: 57/57 PASS.

### v5.3.8 protected coordinator recovery

Live QA found that a stalled Full Sweep could lose its coordinator because the old health path closed `ownerTabId` after the 45-second shared-worker lease expired. For owner `sweep`, lease expiry is now recoverable: revive the lease, send a recovery command, and reload the same tab in place if its content script does not respond. Recovery keeps the durable pass/cursor. Egg cleanup also refuses to close any tab whose id equals `coordinatorTabId`.

Focused recovery soak: 20 rounds × 7 files = 140 executions, 0 failures. Full suite: 57/57 PASS.

### v5.3.9 extension-context reload hardening

Edge live console showed `Extension context invalidated` after reloading the unpacked extension while an OviPets tab remained open. The old isolated-world content script could synchronously throw before `chrome.runtime.lastError` was reachable. v5.3.9 centralizes soft shutdown in `core/storage-client.js`: runtime/storage calls catch invalidation, mark the old context dead, stop future API calls, return safe fallbacks/no-op writes, and stop the old heartbeat loop. Worker/species/relay sends now use the same guarded runtime client.

Focused invalidation/worker/diagnostic soak: 20 rounds × 6 files = 120 executions, 0 failures. Full clean suite: 57/57 PASS.

### v5.3.10 orphaned-sweep auto-recovery

Live diagnostics showed the real stop condition: the sweep cursor remained active at 29/213 while `owehWorker=null`. After two egg-tab timeouts, the coordinator later lost its lease; protected recovery could not communicate/reload it; the next health check found the tab missing and released the worker row. No replacement was created.

v5.3.10 makes that state self-healing: replace a missing protected coordinator immediately when possible, and reclaim any persisted active sweep with no live worker on subsequent health checks. Recovery preserves cycle/index. Dashboard reports `recovering` during the gap.

Focused self-healing soak: 20 × 7 = 140 executions, 0 failures. Full clean suite: 57/57 PASS.

### v5.3.11 Fast Sweep

Friend egg processing now captures a durable per-friend egg queue and drains it through consecutive adaptive batches instead of reloading/rescanning the Hatchery after every batch. Concurrency starts at 10, promotes to 12 then 15 after five clean full batches at each level, and steps down on timeout/system failure. Background pushes batch progress/completion events directly to the coordinator; a 2-second poll remains as recovery fallback.

Performance tuning also reduces egg-tab stagger to 175ms, successful child close delay to 250ms, stable empty-Hatchery detection to about 750ms, and Name-the-Species fixed waits to condition-based confirmation. Existing 60s/120s watchdogs, 10-minute friend cooldown and self-healing coordinator are unchanged.

Regression: 130 eggs drain as `10,10,10,10,10,12,12,12,12,12,15,5` with one final Hatchery reload. Focused soak: 20 × 8 = 160 executions, 0 failures. Full clean suite: 59/59 PASS.

Full Sweep coordinator/egg tabs now use tab-scoped DNR session rules to block only image/media/font resources; scripts, DOM, CSS and network APIs needed by automation remain loaded. Species fingerprinting bypasses page image rendering through the guarded background challenge-image fetcher. Lightweight rules are removed with owned-tab cleanup.

Adaptive speed now includes latency pressure: repeated batches >=35s back off one concurrency level, while any >=50s batch backs off immediately even without an explicit timeout. Diagnostic Logbook persistence is segmented into 200-entry ring chunks instead of whole-log rewrites on every event, preserving the 5,000-event/14-day export contract while reducing long-run storage/service-worker pressure.

## Still open

- live v5.3.11 incorrect → different second guess on the same egg;
- live terminal no-longer-turnable → owned tab closes and batch continues;
- Export Species DB → clean/new Edge profile → Import → learned mapping restored;
- worker Start/Stop/reload recovery;
- multi-hour live-game soak;
- complete runtime/test tree imported to GitHub and clean-checkout CI green;
- friend-request state remains intentionally `dispatched` unless a reliable confirmation signal is observed.

## Invariants

- OviPets mutations use the real UI/dispatcher bridge.
- Only one shared worker lease may be active.
- Worker transitions are owner + generation + owning-tab scoped where applicable.
- Only extension-created tabs that still belong to OviPets may be auto-closed.
- Command dispatch is not the same as confirmed game mutation.
- Turn Egg must not use the extension's hidden game-command bridge.
- Species negative learning requires explicit incorrect Error/network evidence.

Every merged architectural/behavioral change must update this file.
