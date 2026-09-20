# Diagnostic Logbook / Black Box Recorder

Current release compatibility: v5.3.11

The Diagnostic Logbook is a persistent structured event timeline for explaining why long-running automation stopped, stalled, timed out, restarted or skipped work.

Retention: newest **5,000 events / 14 days**, stored in `chrome.storage.local`.

Each event contains timestamp, severity, subsystem, stable event code, service-worker session, extension version and sanitized context. High-value events include worker claim/start/phase/stop/release/lease expiry, Full Sweep pass/wait/advance, friend-removal failures, egg batch/tab lifecycle, watchdog timeouts, runtime/module exceptions and critical status alerts.

**Export Diagnostic Log** downloads the timeline plus a sanitized snapshot of current shared worker, sweep cursor/pass, egg-tab registry/batch, friend egg state and other active job states. **Clear Diagnostic Log** clears only diagnostic history.

Sensitive-looking keys such as cookies, authorization, passwords, secrets, tokens, HTML, and raw request/response bodies are redacted.

When reporting an unexplained stop, export the Diagnostic Log before clearing/restarting if possible and provide the JSON for analysis.


## v5.3.10 recovery events

Current Full Sweep diagnostics also cover protected/self-healing coordinator recovery. Important events to look for include lease expiry, protected recovery/reload/replacement attempts, orphaned-sweep reclaim, egg-tab watchdog timeout, batch forced-continue, worker release, and resumed sweep cursor state.

If the dashboard shows an automation as running but no work advances, export the Diagnostic Log before manually restarting when possible. The v5.3.11 snapshot includes enough worker/sweep/egg state to distinguish a live worker from an orphaned persisted sweep.


## v5.3.11 Fast Sweep speed state

Diagnostic exports include `owehEggTabConcurrency` and `owehEggSpeedProfile` so throughput incidents can be correlated with the current adaptive level/clean-batch streak. Fast Sweep also avoids classifying ordinary progress text containing `0 timeout` / `0 failed` as warning events, reducing log/storage noise.


## v5.3.11 segmented storage

New diagnostic events are stored in a fixed ring of 200-entry chunks rather than rewriting the whole retained timeline on every event. Existing v1 log data remains readable/exportable and the public JSON format/5,000-event/14-day retention contract is unchanged. This reduces long-run storage I/O and service-worker pressure during fast sweeps.
