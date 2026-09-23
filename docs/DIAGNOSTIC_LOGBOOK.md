# Diagnostic Logbook / Black Box Recorder

Current release compatibility: v5.3.11

## Purpose

The Diagnostic Logbook exists to answer questions such as:

- Why did Full Sweep stop?
- Which friend/egg/batch was active when it stalled?
- Did a worker lease expire or fail to start?
- Did an egg tab hit the 60-second watchdog?
- Did the 120-second batch watchdog force progress?
- Was a failure caused by a runtime exception, page reload, missing status, UI/network failure or explicit Stop?

It is a persistent structured event timeline, not just browser console text.

## Retention

The extension keeps the newest **5,000 events** and automatically drops entries older than **14 days**. The ring buffer lives in `chrome.storage.local`, so normal Reload/update of the same extension identity keeps the history.

For reinstall or another computer, use **Diagnostics → Export Diagnostic Log** before removing the extension. The exported JSON can be archived or sent back for analysis.

## Event shape

Each event contains:

- `at` / `iso` — timestamp;
- `level` — `debug`, `info`, `warning`, or `error`;
- `source` — subsystem such as `worker`, `friend-sweep`, `friend-eggs`, `egg-tabs`, `runtime`, `module`, or `status`;
- `event` — stable event code such as `worker.lease-expired`, `tab.timeout`, `batch.timeout`, `sweep.pass-started`;
- `sessionId` — background-service-worker session identifier;
- `version` — extension version;
- `data` — sanitized context such as generation, pass, friend/egg/tab IDs, reason and duration.

## Important recorded events

Typical high-value events include:

- `service-worker.loaded`
- `worker.claimed`
- `worker.start-failed`
- `worker.started`
- `worker.phase`
- `worker.stop-requested`
- `worker.released`
- `worker.lease-expired`
- `sweep.start-requested`
- `sweep.pass-started`
- `sweep.waiting`
- `sweep.pass-resumed`
- `sweep.friend-advance`
- `friend-removal.timeout`
- `friend-removal.failed`
- `batch.requested`
- `batch.opened`
- `batch.open-failed`
- `batch.completed`
- `batch.coordinator-timeout`
- `tab.opened`
- `tab.result`
- `tab.timeout`
- `batch.timeout`
- `tab.closed-early`
- `runtime.window-error`
- `runtime.unhandled-rejection`
- `module.start.failed` / hook failures
- `status.alert`

## Export snapshot

The export includes both the timeline and a sanitized snapshot of current durable state:

- shared worker;
- friend sweep cursor/pass;
- egg-tab registry and current batch;
- friend egg state;
- own egg run;
- breeding/index/hatchling run state;
- latest sweep notice.

This is useful when the last event alone does not explain a stall.

## Privacy / redaction

The Logbook is intentionally diagnostic-only. Keys resembling cookies, authorization, passwords, secrets, tokens, HTML, and request/response bodies are redacted. It does not intentionally collect chat content or general browsing history.

## UI

Open the **Diagnostics** section in the OviPets Helper panel:

- **Export Diagnostic Log** — downloads the current JSON timeline + state snapshot.
- **Clear Diagnostic Log** — clears only diagnostic history. It does not clear pets, Species learning, sweep state or other databases.

When reporting a future unexplained stop, export the Diagnostic Log before restarting/clearing if possible and provide that JSON for analysis.


## Fast Sweep speed state

v5.3.11 diagnostic exports include `owehEggTabConcurrency` and `owehEggSpeedProfile`, allowing timeout/stall analysis to correlate failures with the adaptive 10/12/15-tab level active at the time.


## v5.3.11 segmented storage

New diagnostic events are stored in a fixed ring of 200-entry chunks rather than rewriting the whole retained timeline on every event. Existing v1 log data remains readable/exportable and the public JSON format/5,000-event/14-day retention contract is unchanged. This reduces long-run storage I/O and service-worker pressure during fast sweeps.
