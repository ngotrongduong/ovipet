# Phase 6 Automated Release Hardening — Checkpoint

Date: 2026-09-19
Release baseline: v5.3.11
Status: automated/local package gates PASS; live/manual and GitHub clean-checkout gates remain open.

## Automated release contract

Added `scripts/verify-release.js` and a regression test for it.

The gate verifies:

- Manifest V3 and semantic release version;
- version agreement across manifest.json, ui/panel.js, README.md and docs/WORKING_STATE.md;
- every manifest-referenced JS/CSS/background file exists;
- every background `importScripts(...)` service exists;
- offscreen HTML script references exist;
- local-only `.claude/settings.local.json` and `.claude/scheduled_tasks.lock` are absent and protected by `.gitignore`.

The CI workflow now runs this release-consistency gate between syntax verification and the full test suite.

The bump-version skill was updated to the new canonical version contract. Historical/archive docs are intentionally excluded from blind version replacement.

## Clean-package verification

A sanitized release-candidate ZIP was created outside the source tree, then extracted into a clean directory.

On the extracted package:

- `node scripts/verify-js.js`: PASS
- `node scripts/verify-release.js`: PASS
- `node --test tests/*.test.js`: 59/59 PASS

This proves the packaged files—not only the mutable working directory—contain the complete tested dependency graph.

## Final regression review finding

The final audit found one additional tab-ownership gap: shared worker cleanup closed the stored worker tab ID without re-checking that the tab still belonged to an OviPets worker surface. Worker-tab closes now verify the tab still resolves to the OviPets domain before closing. If the user navigates that tab away, Stop still clears durable worker state but leaves the user-navigated tab open. A regression test covers this behavior.

## Browser smoke attempt

A local Chromium headless `--load-extension` smoke was attempted. Chromium launched, but its remote-debugging target list exposed only `about:blank` and did not expose an extension service-worker target. This result is treated as inconclusive, not PASS or FAIL.

Microsoft Edge unpacked-extension load/UI smoke has now passed on the real Windows machine. The remaining Edge gates are the v5.3.5 retryable incorrect-answer/terminal exhaustion lifecycle, worker recovery, and live soak.

## Remaining release blockers/gates

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- manual Start/Stop/reload recovery check;
- multi-hour soak test;
- complete runtime/test tree imported to GitHub and clean-checkout CI green;
- no unresolved P0/P1 issue.

Do not label the RC production-ready until the required live/manual/repository gates are complete.


## v5.3.5 Continuous Full Sweep

The friend-sweep worker now remains active after the final queued friend and begins the next pass automatically. The 10-minute per-friend cooldown is retained; when every candidate is still cooling down, the worker waits until the earliest eligible time and then resumes. Durable `cycle`/`waitingUntil` fields make the state visible in the dashboard, and Stop prevents a waiting pass from reopening a friend.

Focused v5.3.5 sweep/egg/worker soak: 20 rounds × 6 files = 120 test-file executions, 0 failures.


## v5.3.5 Species Learning + Portable Database

Live Inspector data established that `The answer is incorrect, please try again.` is retryable, while `The egg can no longer be turned.` is terminal. The solver now dismisses only the retryable Error, turns the same egg again, and excludes the rejected species. It closes the owned tab only for terminal exhaustion.

The Inspector learns from real `pet_turn_egg` network outcomes and Answer IDs, and a guarded background image service fetches only OviPets credit-challenge images so the content script can compute a perceptual visual fingerprint. The solver consumes the same Inspector identity, allowing learned knowledge to transfer across matching challenge images on different eggs.

Species learning can be backed up/restored with Export/Import Species DB. Import is idempotent and can mine old Inspector trace sessions to recover outcomes/Answer IDs when historical exports have empty learned-memory fields.

Verification: 56/56 full tests PASS in three consecutive full-suite rounds; focused Egg/Species/DB soak 20 rounds × 8 files = 160 test-file executions, 0 failures.


## v5.3.6 Fail-open watchdog policy

Live QA established a stronger requirement: Full Sweep must keep running even when a child egg tab never reports because of slow/broken network, page load failures, UI errors or missing status messages. v5.3.6 adds two durable watchdogs: 60 seconds per owned egg tab and 120 seconds per batch. Deadline enforcement is backed by Chrome Alarms and rechecked on every parent status poll. Timeout closes the owned automation tab, marks the missing result, and the parent advances. Random egg-step errors now skip the current friend safely instead of stopping Continuous Full Sweep.


## v5.3.7 Diagnostic Logbook

Long-running automation now has a persistent black-box recorder. The newest 5,000 events / 14 days are stored with severity, subsystem, stable event code, timestamp/session/version and sanitized context. Export includes current worker/sweep/egg/job state. Runtime exceptions, worker lease/start failures, sweep transitions, egg-tab/batch watchdogs and fail-open recovery are explicitly instrumented.

Focused v5.3.9 diagnostic/worker/sweep soak: 20 rounds × 7 files = 140 test-file executions, 0 failures.


## v5.3.8 Protected Full Sweep coordinator

Live QA identified a coordinator-lifecycle bug: when the shared-worker heartbeat lease expired, the health watchdog treated the worker as dead and closed the Full Sweep tab. v5.3.9 changes this for owner `sweep`: revive the matching generation/tab lease, send a recovery command, and reload the same coordinator tab in place if the content script does not acknowledge. The durable sweep pass/index is preserved. Egg-tab cleanup also hard-blocks any attempt to close `coordinatorTabId`.

Verification: full suite 58/58 PASS; focused worker/sweep/egg/diagnostic soak 20 × 7 = 140 executions with 0 failures.


## v5.3.9 Extension-context invalidation recovery

Reloading an unpacked Edge extension invalidates already-injected content-script contexts. A direct `chrome.runtime.sendMessage` may throw synchronously with `Extension context invalidated`, bypassing the old callback-only error handling and creating repeated unhandled Promise errors through Diagnostic Log calls.

v5.3.9 catches that condition at the shared storage/runtime client, marks the old context as dead, returns safe fallbacks/no-op writes, stops its heartbeat loop, and routes worker/species/relay messages through the same guarded request path.

Verification: syntax PASS, release consistency PASS, full suite 58/58 PASS, focused 20 × 6 = 120 executions with 0 failures.

## v5.3.10 Orphaned Full Sweep auto-recovery

A live v5.3.9 diagnostic export captured the real stop condition: after two egg-tab watchdog timeouts, the coordinator later lost its lease; protected recovery could not message/reload it; the next health check found the coordinator tab missing and released the worker row. `owehSweep.active` stayed true, so the UI appeared active even though no worker remained.

v5.3.10 treats this as recoverable infrastructure failure. Health checks automatically create/rebind a replacement coordinator when the protected tab disappears, and also reclaim any persisted orphaned sweep state on later health alarms. Recovery reuses durable `cycle/index` and resumes from the same friend.


Focused self-healing verification: 20 rounds × 7 files = 140 executions, 0 failures; clean full suite target 58/58.


## v5.3.11 Fast Sweep throughput

Fast Sweep snapshots one friend Hatchery once, drains its queue through consecutive adaptive batches and performs one final verification reload. Adaptive concurrency is 10 → 12 → 15 after clean full-batch streaks and backs off on timeout/system-failure evidence. Background pushes egg-batch result progress to the coordinator immediately; 2-second polling remains recovery fallback. Tab stagger is 175 ms, result-close delay 250 ms, stable empty-Hatchery detection 750 ms, and Name-the-Species retryable-answer handoff is shortened while remaining UI-only.

The 60s egg-tab watchdog, 120s batch watchdog, protected coordinator, orphan self-healing and 10-minute friend cooldown are unchanged.

Long-run memory audit added tab-scoped lightweight resource rules (block image/media/font only on extension-owned sweep tabs), latency-aware adaptive backoff, and segmented Diagnostic Logbook storage (200-entry chunks instead of whole-log rewrites). Species visual fingerprinting continues through the guarded background fetcher even when page images are blocked.

Full suite: 59/59 PASS. Focused Fast Sweep/lightweight/recovery soak: 20 × 8 = 160 executions, 0 failures.
