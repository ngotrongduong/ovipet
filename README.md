# OviPets Hatchery Helper

Chromium Manifest V3 extension for OviPets automation and breeding workflows, with Microsoft Edge as the primary Windows target.

Current release: **v5.3.14**

## Engineering objective

The project prioritizes long-running stability/recoverability, then incremental modularization and measured efficiency improvements.

## v5.3.14 Breeding male diversity

Breeding Campaign now treats very similar Body 1 males as an eligible pool instead of letting a tiny Body 1 edge repeatedly collapse the program onto one ancestor line.

- Two males are Body-1 near-equivalent when they have the same exact target-endpoint mask (`FF`/`00`) and every remaining non-exact Body 1 RGB channel differs by at most **15 points**.
- Example: `FF FF FA` and `FF FF FC` stay eligible together instead of always letting `FC` win before other traits are considered.
- Inside that pool, Body 2, Scales, Extra 1 and Extra 2 are measured separately against target. Each male's secondary score is the **single lowest slot distance**, not a sum or average.
- Therefore `[20, 14, 40, 25]` scores **14**; an equivalent male whose best secondary slot is **12** wins.
- Equal secondary scores fall back to the existing recent-male-use and lineage-use tie-breaks, then the normal pair-purity comparator.
- Different endpoint masks or >15-point remaining Body 1 differences keep the strict legacy Body 1 ranking.
- Near-equivalent alternatives are retained even if the normal shortlist cut would otherwise drop one.

Verification: full suite **59/59 PASS**; focused breeding/planner soak **20 rounds × 6 files = 120 executions, 0 failures**; clean-extracted final ZIP **59/59 PASS**. SHA-256: `a124923cddfdac4e2dbef7c575dc4fb6bfb6213a1093bda2d88894869c44b863`.

## v5.3.13 Own Hatchery Turn + Hatch

**Turn / Hatch available eggs** now handles both actionable egg states in the user's own Hatchery while keeping friend-egg safety unchanged.

- Hatchery cards with the green **Hatch Egg** action are detected separately from normal **Turn Egg** cards.
- Hatch-ready own eggs use the exact OviPets UI dispatcher command `pet_turn_egg` with `PetID=<id>` directly from Hatchery, avoiding a profile-tab round trip.
- This direct path is deliberately narrow: the MAIN-world bridge accepts it only when the current page is the user's own Hatchery, the request purpose is `own-hatch`, and the exact PetID currently has a visible `Hatch Egg` icon.
- Generic `pet_turn_egg` bridge calls remain blocked. Normal Turn Egg still opens extension-owned profile tabs so Name the Species can be observed and resolved before the tab closes.
- Friend Hatcheries never use the direct hatch path.
- Hatch commands are paced at 100 ms in bounded batches, followed by one Hatchery reload/recheck.

Verification: full suite **59/59 PASS**; focused own-Hatchery/bridge soak **20 rounds × 7 files = 140 executions, 0 failures**; clean-extracted final ZIP **59/59 PASS**. SHA-256: `c34b741e5f9880c2e25c45975a7f574b89d66051d8952ce5d38e300142435dd4`.

## v5.3.12 Ninja + Ads friend discovery

The standalone Ninja friend-discovery scan now reads both OviPets profile posts on `#!/OviPets`: **Ninja please** and **Ads post**.

- Both posts are scanned independently over the rolling last 24 hours.
- Candidates are merged globally by stable OviPets User ID.
- Duplicate IDs across/repeated within either post are queued once, keeping the newest qualifying comment.
- Existing `owehFriendRequestHistory` remains the single global do-not-resend history for both sources.
- Existing self/no-request/history filters remain in place.
- A missing source is fail-soft; the other source is still scanned.
- Scan remains separate from **Send friend requests** and performs no friend-request mutation itself.

Validated v5.3.12 artifact: full suite **59/59 PASS**, focused Ninja/chat soak **40/40 PASS**, clean-extracted ZIP **59/59 PASS**. SHA-256: `69e474dc38260991df3d833ca2c41d6d25046b18e8fc356c128e73762ed252d7`.

## v5.3.11 Fast Sweep + Lightweight Tabs

Full Sweep now prioritizes throughput without weakening watchdog/recovery safety.

- Snapshot a friend's turnable egg queue once, then drain consecutive batches without reloading the Hatchery after every 10 eggs.
- Adaptive egg concurrency starts at 10, promotes to 12 and then 15 after clean batches, and steps down on timeout/system failure.
- Adaptive speed now also reacts to latency: repeated batches around 35s back off a level, and a 50s+ batch backs off immediately even before watchdog timeout.
- Egg-tab stagger is 175ms; successful child tabs close after 250ms.
- Batch completion is event-driven from background to coordinator, with a 2s polling fallback.
- One final Hatchery reload/verification occurs after the captured queue is drained.
- Name-the-Species waits for the real OK button to become usable instead of a fixed page-load delay; retry delay is reduced while explicit server outcome rules remain unchanged.
- 60s per-tab and 120s per-batch watchdogs, protected/self-healing coordinator, 10-minute friend cooldown, Species DB and Diagnostic Logbook remain intact.

**Lightweight owned tabs:** the Full Sweep coordinator and sweep-created egg tabs use a tab-scoped Declarative Net Request session rule that blocks only `image`, `media` and `font` resources. HTML, JavaScript, CSS, forms and XHR/fetch continue loading. The Name-the-Species challenge image is still fetched through the guarded background species-image service for fingerprinting, so the solver does not depend on page image rendering.

**Long-run I/O fix:** the Diagnostic Logbook no longer rewrites the entire retained 5,000-event timeline on every event. New events are stored in a fixed ring of 200-entry chunks while legacy log data remains readable/exportable.

Regression includes a 130-egg scenario with adaptive batch sizes `10,10,10,10,10,12,12,12,12,12,15,5` and only one final Hatchery reload.

Verification: full suite **59/59 PASS**; focused Fast Sweep/lightweight/recovery soak **20 rounds × 8 files = 160 executions, 0 failures**; clean-extracted ZIP **59/59 PASS**.

## v5.3.10 Self-healing Full Sweep coordinator

Diagnostic Logbook live data captured an orphaned-sweep state: `owehSweep.active=true` remained persisted after the protected coordinator tab disappeared and the shared-worker row was released. The UI therefore looked active while no worker existed to advance the friend cursor.

v5.3.10 automatically replaces/reclaims the sweep coordinator. Missing protected tabs are replaced and sent `recoverSharedWorker`; if the worker row is already stopped while the sweep is still active, the next health check claims a fresh generation, creates a new coordinator, and resumes from the durable cycle/index. The dashboard shows `recovering` instead of `this tab` while no live worker exists, and stale sweep timeout notices expire after 15 seconds.

Verification: full suite 57/57 PASS; focused self-healing soak 20 rounds × 7 files = 140 executions, 0 failures.

## v5.3.9 Extension reload soft-shutdown

Reloading an unpacked Edge/Chromium extension invalidates the old content-script context still attached to already-open OviPets tabs. A direct `chrome.runtime.sendMessage(...)` can throw synchronously before the callback/lastError path runs.

v5.3.9 handles this as an expected shutdown condition:
- synchronous runtime-message throws are caught;
- once invalidated, the old content script stops calling runtime/storage APIs;
- storage reads return fallbacks/defaults and writes become no-ops;
- worker/species/relay sends use the same guarded runtime client;
- Diagnostic Log calls no longer create recursive `Uncaught (in promise)` noise;
- the stale heartbeat timer self-stops after invalidation is detected.

After pressing **Reload** in `edge://extensions`, refresh already-open OviPets pages once so Edge injects the new content scripts.

Verification: full suite **56/56 PASS**; focused invalidation/worker/diagnostic soak **20 × 6 = 120 executions, 0 failures**.

## v5.3.8 Protected Full Sweep Coordinator

Live QA found that the shared-worker health watchdog could close the Full Sweep coordinator tab when its 45-second heartbeat lease expired during a stall. v5.3.8 makes owner `sweep` a protected worker:

- heartbeat expiry revives the matching generation/tab lease instead of closing the tab;
- the same coordinator receives a recovery command;
- if the content script does not acknowledge, the same tab is reloaded in place, not removed;
- durable `owehSweep.cycle` and `owehSweep.index` are preserved;
- egg-tab cleanup hard-blocks any attempt to close `coordinatorTabId`, even under corrupted/stale registry state.

Only explicit Stop, a valid generation-scoped `workerDone`, or startup failure before the worker becomes live may close the Full Sweep coordinator.

Verification: full suite **55/55 PASS**; focused worker/sweep/egg/diagnostic soak **20 rounds × 7 files = 140 executions, 0 failures**.

## v5.3.7 Diagnostic Logbook

A persistent privacy-scoped black-box recorder now captures worker lifecycle, Full Sweep passes, egg batch/tab lifecycle, watchdog timeouts, fail-open recovery, runtime/module exceptions and important failure/stopped status messages.

Retention is bounded to the newest **5,000 events / 14 days**. The panel provides **Export Diagnostic Log** and **Clear Diagnostic Log**. Export includes a sanitized snapshot of current worker/sweep/egg/job state so later analysis can reconstruct why automation stopped or stalled.

Focused diagnostic/worker/sweep soak: **20 rounds × 7 files = 140 test-file executions, 0 failures**. Clean package full suite: **55/55 PASS**.

## v5.3.5

**Continuous Full Sweep** runs friend passes repeatedly until Stop while preserving the 10-minute per-friend cooldown.

**Name the Species** now follows the live server behavior captured by Species Inspector:

- `The answer is incorrect, please try again.` is retryable. Learn the wrong species, dismiss Error, Turn Egg again on the same egg, and exclude that species.
- `The egg can no longer be turned.` is terminal. Only then is the extension-owned egg tab closed as exhausted.

The Inspector learns from real `pet_turn_egg` success/failed responses and Answer IDs. A strict background image fetcher allows a perceptual challenge-image fingerprint that the solver also consumes, so learned knowledge can transfer across matching visual challenges.

The panel includes **Export Species DB** and **Import Species DB**. Backups merge idempotently and can restore knowledge on another computer or after reinstall. Previous full Inspector JSON exports are also accepted; v5.3.5 can mine their trace/network sessions to recover outcomes and Answer IDs even when historical learned-memory fields were empty.

## Leftover-tab recovery

Live Full Sweep exposed `too-many-leftover-tabs`, mainly from Name-the-Species tabs that reached the old retry cap or stayed blocked by an Error overlay. v5.3.5 removes this permanent admission lock: retryable species failures can continue through untried choices, a blocking species Error exits as a bounded `abandoned` owned-tab result, and each new batch reconciles old leftovers first. Exact owned egg tabs are closed; tabs the player navigated away are only forgotten from ownership state.

## Current status

See [docs/WORKING_STATE.md](docs/WORKING_STATE.md) for the authoritative state. GitHub is not yet the runtime source-of-truth until Issue #2 imports the complete runtime/test tree and clean-checkout CI is green.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Diagnostic Logbook](docs/DIAGNOSTIC_LOGBOOK.md)
- [Species Inspector](docs/SPECIES_INSPECTOR.md)
- [Agent workflow](docs/AGENT_WORKFLOW.md)
