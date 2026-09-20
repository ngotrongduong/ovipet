# OviPets Hatchery Helper

Chromium Manifest V3 extension for OviPets automation and breeding workflows, with Microsoft Edge as the primary Windows target.

Current release: **v5.3.8**

## Engineering objective

The project prioritizes long-running stability/recoverability, then incremental modularization and measured efficiency improvements.

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
