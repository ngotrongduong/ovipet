# Diagnostic Logbook / Black Box Recorder

Release: v5.3.7

The Diagnostic Logbook is a persistent structured event timeline for explaining why long-running automation stopped, stalled, timed out, restarted or skipped work.

Retention: newest **5,000 events / 14 days**, stored in `chrome.storage.local`.

Each event contains timestamp, severity, subsystem, stable event code, service-worker session, extension version and sanitized context. High-value events include worker claim/start/phase/stop/release/lease expiry, Full Sweep pass/wait/advance, friend-removal failures, egg batch/tab lifecycle, watchdog timeouts, runtime/module exceptions and critical status alerts.

**Export Diagnostic Log** downloads the timeline plus a sanitized snapshot of current shared worker, sweep cursor/pass, egg-tab registry/batch, friend egg state and other active job states. **Clear Diagnostic Log** clears only diagnostic history.

Sensitive-looking keys such as cookies, authorization, passwords, secrets, tokens, HTML, and raw request/response bodies are redacted.

When reporting an unexplained stop, export the Diagnostic Log before clearing/restarting if possible and provide the JSON for analysis.
