# Daily Maintenance fix — v5.0.4

## Root cause

`requestDailyMaintenance()` correctly requested the shared worker with `{ force: true }`.
The background worker spread that option onto the outer `startSharedWorker` message, but
the content-script dispatcher reads feature options exclusively from `message.extra`.
Consequently `startDailyMaintenance()` always received `force = false`. If the stored
last-run timestamp was less than 24 hours old, the worker immediately released itself
without starting the workflow.

## Additional recovery fixes

- Wait for the asynchronously rendered Overview enclosure tabs before taking the tab
  snapshot used by `collectAllOverviewPets()`.
- A second click on Run Daily Maintenance safely pokes the existing Daily worker.
- Resume a recent active run from its saved `index`, `sort`, `ninja`, or
  `waiting-direct-lanes` phase.
- Clear stale Daily-owned Feed and friend-request flags before a fresh run.

## Regression coverage

- Manual Daily options must arrive at the content script under `message.extra`.
- Repeated Daily claims must send a resume signal to the existing worker tab.
- The Overview shell must be awaited before enclosure tabs are snapshotted.
- All existing extension tests must continue to pass.
