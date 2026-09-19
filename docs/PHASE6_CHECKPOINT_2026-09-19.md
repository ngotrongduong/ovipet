# Phase 6 Automated Release Hardening — Current Checkpoint

Date: 2026-09-20
Release baseline: v5.3.4
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

## v5.3.4 Species Learning

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
