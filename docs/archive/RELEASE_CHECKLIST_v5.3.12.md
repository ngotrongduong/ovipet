# Release Checklist

Current release candidate: **v5.3.12**

## Automated gate

- [x] `node scripts/verify-js.js` passes.
- [x] `node scripts/verify-release.js` passes.
- [x] Full Node suite passes **59/59** test files.
- [x] Manifest/UI/README/WORKING_STATE versions agree at v5.3.17.
- [x] All manifest/background imports exist.
- [x] No local-only Claude/session files are packaged.
- [x] Continuous Full Sweep wrap/cooldown/Stop semantics remain covered.
- [x] 60-second egg-tab and 120-second batch watchdogs remain covered.
- [x] Friend egg errors remain fail-open and cannot permanently stop Full Sweep.
- [x] Species DB export/import and Inspector learning regressions remain covered.
- [x] Diagnostic Logbook persistence, redaction, export, clear and state snapshot are covered.
- [x] Focused diagnostic/worker/sweep soak: 20 rounds × 7 files = 140 test-file executions, 0 failures.

## v5.3.7 Diagnostic Logbook gate

- [x] Runtime/module exceptions can be recorded.
- [x] Worker claim/start/phase/stop/release/lease-expiry events are instrumented.
- [x] Sweep pass/wait/advance and friend-removal failures are instrumented.
- [x] Egg batch/tab open/result/timeout/forced-recovery events are instrumented.
- [x] Important failure/stopped status messages are captured with dedupe.
- [x] Retention is bounded to 5,000 events / 14 days.
- [x] Export contains a sanitized worker/sweep/egg/job state snapshot.
- [x] Clearing the Diagnostic Log does not change automation/database state.

- [x] Protected Full Sweep coordinator: expired heartbeat lease cannot auto-close worker tab.
- [x] Recovery preserves durable pass/index and reloads in place when content is unresponsive.
- [x] Egg cleanup refuses coordinator-tab closure even under corrupted registry state.
- [x] Focused coordinator/sweep/egg/diagnostic soak: 140/140 file executions PASS.

- [x] Extension-context invalidation soft-shutdown regression covered.
- [x] Old content scripts stop runtime/storage calls after Edge extension Reload.
- [x] Worker/species/relay messages use guarded runtimeRequest.
- [x] Focused invalidation/worker/diagnostic soak: 120/120 executions PASS.

- [x] Orphaned active Full Sweep (`owehSweep.active=true` with no live worker) automatically creates a replacement coordinator.
- [x] Replacement recovery preserves pass/index and does not reset to pass 1.
- [x] Missing protected coordinator tab is replaced rather than leaving a released orphan.
- [x] Dashboard reports `recovering` instead of misleading `this tab` when worker is absent.

- [x] Focused orphan/self-healing soak: 20 rounds × 7 files = 140 executions, 0 failures.


## v5.3.12 Ninja + Ads gate

- [x] `Ninja please` remains discoverable through the audited Ninja image contract/fallback.
- [x] `Ads post` is discovered by post identity/title rather than vertical position.
- [x] Both post comment sets use the same rolling 24-hour cutoff.
- [x] Candidate union deduplicates by stable User ID and retains the newest duplicate.
- [x] Existing `owehFriendRequestHistory` excludes previously attempted/sent IDs across both post sources.
- [x] One missing target is fail-soft; neither target found returns no queue.
- [x] Scan remains separate from friend-request mutation.
- [x] Focused Ninja/chat soak: 20 rounds × 2 files = 40/40 executions PASS.
- [ ] Live Edge check confirms the real Ads post DOM is matched and both sources contribute expected IDs.

## v5.3.11 Fast Sweep gate

- [x] Snapshot queue drains multiple batches without per-batch Hatchery reloads.
- [x] One final Hatchery verification reload remains.
- [x] Adaptive concurrency promotes 10 → 12 → 15 only after five clean full batches per level.
- [x] Timeout/system failures lower adaptive concurrency.
- [x] Background hard-cap is 15 tabs with 175 ms stagger.
- [x] Batch progress/completion is event-driven with 2-second polling fallback.
- [x] Empty Hatchery decision uses 750 ms stable-DOM detection instead of fixed 4 seconds.
- [x] Species confirmation/retry fast-path remains bounded and UI-only.
- [x] 60s per-tab / 120s batch watchdogs and self-healing coordinator remain unchanged.
- [x] Diagnostic export includes current concurrency/speed profile.
- [x] Sweep-created coordinator/egg tabs use tab-scoped resource blocking for image/media/font only.
- [x] Species challenge fingerprinting still works through guarded background image fetch.
- [x] Lightweight rules are removed with owned-tab lifecycle cleanup.
- [x] Adaptive speed backs off on sustained slow batch latency, not only explicit failures/timeouts.
- [x] Diagnostic Logbook uses segmented 200-entry ring chunks instead of rewriting the entire retained log on every event.
- [x] Focused Fast Sweep/lightweight/recovery soak: 20 × 8 = 160 executions, 0 failures.

## Live/manual gate

- [x] Microsoft Edge unpacked-extension load/UI smoke completed on earlier RCs.
- [ ] Load v5.3.11 and confirm the Diagnostics module renders.
- [ ] Run Full Sweep long enough to generate worker/sweep/egg events, then export the log.
- [ ] Observe one timeout/fail-open event and verify it appears in exported JSON.
- [ ] Stop Full Sweep manually and verify stop/release events are present.
- [ ] Clear Diagnostic Log and verify automation/database state remains unchanged.
- [ ] Complete Start/Stop/reload worker recovery check.
- [ ] Complete multi-hour live OviPets soak.

## Repository gate

- [ ] Complete runtime/test source is present in GitHub.
- [ ] Clean checkout CI reproduces syntax + release checks + full tests.
- [ ] No unresolved P0/P1 issue.

Do not call the release production-ready while a required live/repository gate remains open.
