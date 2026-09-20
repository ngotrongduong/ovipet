# Release Checklist

## Automated

- [x] JavaScript syntax PASS.
- [x] Release consistency PASS.
- [x] Full Node suite **58/58 PASS**.
- [x] Clean-extracted ZIP reproduces 58/58.
- [x] Current v5.3.11 full-suite gate passes 58/58.
- [x] Focused Egg/Species/DB soak: 20 × 8 = 160 test-file executions, 0 failures.
- [x] Continuous Full Sweep wrap/cooldown/Stop semantics covered.
- [x] Species DB export/import, idempotent merge and old Inspector trace recovery covered.
- [x] No local-only Claude/session files in package.
- [x] Explicit incorrect evidence is required for negative species learning.

- [x] Leftover-tab reconciliation regression covered; 10 stale Name-the-Species leftovers no longer block a new batch.
- [x] Focused v5.3.10 egg/sweep/species soak: 20 × 6 = 120 executions, 0 failures.

- [x] 60-second per-tab watchdog regression covered.
- [x] 120-second batch watchdog regression covered.
- [x] Random egg-step failures are fail-open and do not stop Continuous Full Sweep.
- [x] Focused watchdog/sweep soak: 120/120 file executions PASS.

- [x] Diagnostic Logbook persistence, redaction, export, clear and state snapshot covered.
- [x] Runtime/module exception capture and worker/sweep/egg lifecycle event wiring covered.
- [x] Diagnostic retention bounded to 5,000 events / 14 days.
- [x] Focused diagnostic/worker/sweep soak: 20 × 7 = 140 executions, 0 failures.

- [x] Protected Full Sweep coordinator: expired heartbeat lease cannot auto-close the worker tab.
- [x] Recovery preserves durable pass/index and reloads in place if content is unresponsive.
- [x] Egg cleanup refuses coordinator-tab closure even with corrupted registry state.
- [x] Focused coordinator/sweep/egg/diagnostic soak: 140/140 executions PASS.

- [x] Extension-context invalidation soft-shutdown regression covered.
- [x] Old content scripts stop runtime/storage calls after Edge extension Reload.
- [x] Worker/species/relay messages use guarded runtimeRequest.
- [x] Focused invalidation/worker/diagnostic soak: 120/120 executions PASS.

- [x] Fast Sweep snapshot queue drains multiple batches with one final Hatchery reload.
- [x] Adaptive concurrency 10 → 12 → 15 promotion and timeout/system-failure demotion covered.
- [x] Event-driven egg-batch progress/completion with 2s polling fallback covered.
- [x] 175ms egg-tab stagger and reduced condition-based species waits covered.
- [x] 130-egg adaptive regression covered.
- [x] Focused Fast Sweep soak: 20 × 8 = 160 executions, 0 failures.

## Live/manual

- [x] Microsoft Edge unpacked extension loads and panel works.
- [x] Ninja Please, database indexing/breeding and friend scanning observed working.
- [ ] v5.3.11 retryable incorrect → same egg retries with a different species.
- [ ] terminal `The egg can no longer be turned` → only owned tab closes and batch continues.
- [ ] Friend egg dedicated-tab lifecycle rechecked on v5.3.11.
- [ ] Export Species DB → clean/new Edge profile → Import restores learned knowledge.
- [ ] Export a real Diagnostic Log after an extended Full Sweep and inspect the timeline.
- [ ] Start/Stop/reload worker recovery.
- [ ] Multi-hour live OviPets soak.

## Repository

- [ ] Complete runtime/test source present in GitHub.
- [ ] Clean-checkout CI reproduces syntax + release + full tests.
- [ ] No unresolved P0/P1 issue.

Do not call production-ready while required live/repository gates remain open.
