# Phase 6 Automated Release Hardening — Checkpoint

Date: 2026-09-19
Release baseline: v5.3.0
Status: automated/local-package gates PASS; authenticated live/manual and GitHub clean-checkout gates remain open.

## Automated release contract

The managed runtime verifies Manifest V3, semantic version agreement, manifest-referenced files, background service imports, offscreen script references, local-only file protection and release-source consistency.

Canonical release-version locations are manifest.json, ui/panel.js, README.md and docs/WORKING_STATE.md.

## Clean-package verification

A sanitized release-candidate ZIP was created outside the source tree, extracted into a clean directory and verified there:

- JavaScript syntax: PASS
- release consistency: PASS
- Node test files: 51/51 PASS

The package is rebuilt after code/doc changes and the checksum is recorded externally in the release handoff/Issue #7 so the archive does not contain a self-referential checksum.

## Automated regression soak

The complete 50-file suite was run 20 consecutive rounds:

- total test-file executions: 1,000
- failures: 0
- typical suite duration in the current environment: about 3.64 seconds

See docs/AUTOMATED_SOAK_REPORT_2026-09-19.md.

## Final safety review

A worker-tab ownership gap was found and fixed: Stop/health cleanup still clears the durable lease, but automatic tab close now verifies the target tab is still on OviPets. If the user navigates the extension-created worker tab to another site, it is left open. Regression coverage locks this invariant.

## Edge live-load finding

Real Microsoft Edge QA exposed a startup `ReferenceError` because `copyBlacklistCsv` remained in `uiPanelActions` after its function had been removed during refactoring. The function was restored and a new `content-ui-action-wiring` regression test now fails if a shorthand panel action is undefined.

The Edge-ready RC passes 51/51 tests and a fresh 20-round soak (1,020 test-file executions, 0 failures).

## Browser smoke attempts

Linux Chromium/headless and Xvfb launch attempts did not expose a reliable extension service-worker DevTools target. These attempts are recorded as inconclusive, not PASS or FAIL.

Windows Edge unpacked-extension smoke therefore remains a manual gate. The RC includes scripts/windows-release-smoke.ps1 and docs/WINDOWS_QA.md.

## Remaining release gates

- Name the Species wrong-answer lifecycle on current authenticated OviPets;
- friend egg dedicated-tab Turn Egg lifecycle on current authenticated OviPets;
- Windows Chrome unpacked-extension load/UI smoke;
- manual Start/Stop/reload recovery check;
- multi-hour live-game soak;
- complete runtime/test source imported to GitHub and clean-checkout CI green;
- no unresolved P0/P1 issue.

Do not label this RC production-ready until the required live/manual/repository gates are complete.
