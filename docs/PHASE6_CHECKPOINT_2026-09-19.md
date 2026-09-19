# Phase 6 Automated Release Hardening — Current Checkpoint

Date: 2026-09-20
Release baseline: v5.3.6
Status: automated/local package gates PASS; live/manual and GitHub clean-checkout gates remain open.

## Automated release gate

- syntax PASS
- release consistency PASS
- clean ZIP: 53/53 tests PASS
- three consecutive full-suite rounds: 53/53 each
- focused Egg/Species/DB soak: 20 rounds × 8 files = 160 test-file executions, 0 failures

## Live-driven fixes retained

- Microsoft Edge is the primary Windows test browser.
- Turn Egg uses real UI tabs rather than the hidden extension command bridge.
- Full Sweep is continuous until Stop.
- Extension-owned tab safety is enforced.

## v5.3.5 Species Learning

Live Inspector data corrected the previous assumption that all wrong-answer Errors were terminal.

- `The answer is incorrect, please try again.` is retryable.
- `The egg can no longer be turned.` is terminal.
- Negative learning comes only from explicit incorrect evidence.
- Inspector learns from network success/failed results and Answer IDs.
- Guarded challenge-image fetching provides a perceptual fingerprint that the solver reuses.
- Export/Import Species DB makes learned data portable.
- Old Inspector exports can be mined during import to recover trace outcomes/Answer IDs.
- Import is idempotent.

## Remaining gates

- live retryable incorrect → different second guess;
- live terminal exhaustion → owned tab closes/batch continues;
- DB export/import restore in a clean profile;
- worker reload/Stop recovery;
- multi-hour live soak;
- runtime source import + clean-checkout GitHub CI;
- no unresolved P0/P1 issue.

Do not label production-ready until these required gates complete.


## v5.3.5 Leftover-tab recovery

Real Full Sweep QA produced `Friend eggs: could not open egg tabs (too-many-leftover-tabs)`. Inspection showed the old manager deliberately kept unconfirmed/failed egg tabs open and refused a new batch after 10 leftovers; Name-the-Species failures were a common source.

v5.3.5:
- no longer strands species flow at the old 3-answer cap;
- retries explicit incorrect answers through untried choices with a bounded answer-space safety cap;
- treats a species Error overlay that cannot be dismissed as `abandoned` and closes that extension-owned tab;
- reconciles old leftover registry entries before every new batch;
- closes only entries still on the exact owned OviPets egg page; navigated-away tabs are never auto-closed.

Verification: 53/53 full tests PASS, focused 20 × 6 = 120 executions with 0 failures, clean ZIP PASS.


## v5.3.6 Fail-open watchdog policy

Full Sweep must continue even when an owned egg tab never reports because of slow/broken network, page-load failures, UI errors or missing status messages.

v5.3.6 adds:
- 60-second per-tab watchdog;
- 120-second batch watchdog;
- persisted deadlines + Chrome Alarms + status-poll enforcement;
- force-close only for extension-owned egg registry entries;
- fail-open friend egg errors: cleanup, skipRemoval, advance instead of stopping the sweep.

Verification: 53/53 full suite PASS; focused 20 × 6 = 120 executions with 0 failures; clean extracted ZIP 53/53 PASS.
