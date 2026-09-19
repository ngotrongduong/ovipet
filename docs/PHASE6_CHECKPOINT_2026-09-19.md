# Phase 6 Automated Release Hardening — Checkpoint

Date: 2026-09-19
Release baseline: v5.3.1
Status: automated/local package gates PASS; live/manual and GitHub clean-checkout gates remain open.

## Automated release contract

Added `scripts/verify-release.js` and a regression test for it.

The gate verifies Manifest V3, release-version agreement, manifest/background/offscreen file integrity and absence of local-only Claude/session files. The CI workflow runs syntax, release consistency and the full suite.

## Clean-package verification

A sanitized v5.3.1 ZIP was extracted into a clean directory and reproduced:

- JavaScript syntax: PASS
- release consistency: PASS
- Node tests: 51/51 PASS

## Edge live QA findings

Microsoft Edge live testing confirmed Ninja Please, pet-catalog navigation, Start database indexing/breeding, friend scanning and detection of turnable friend eggs.

It also exposed two Turn Egg defects in the previous build: friend egg tabs opened but hidden `pet_turn_egg` dispatch did not complete reliably, and merely browsing a friend's Hatchery could trigger background egg turning.

v5.3.1 removes `pet_turn_egg` from both the page-bridge whitelist and game-bridge client. Own and friend Turn Egg flows now use batches of at most 10 extension-owned profile tabs; each tab clicks the real visible button, resolves Name the Species if present, confirms the button is gone, and only then reports success/permits close. Own-egg auto-start is restricted to the user's own Hatchery.

The Name the Species module also handles rejection when OviPets reuses the same dialog node: after the rejection settle window it records the answer as wrong, re-arms the watcher and tries another eligible answer.

## Automated soak

After the redesign: 20 completed rounds × 51 test files = 1,020 test-file executions, 0 failures.

## Browser/manual status

Microsoft Edge unpacked-extension load/UI smoke has passed on the real Windows machine. Remaining live gates are the v5.3.1 real-button friend egg flow, Name the Species wrong-answer lifecycle, worker recovery and multi-hour live-game soak.

## Remaining release blockers/gates

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- manual Start/Stop/reload recovery check;
- multi-hour soak test;
- complete runtime/test tree imported to GitHub and clean-checkout CI green;
- no unresolved P0/P1 issue.

Do not label the RC production-ready until the required live/manual/repository gates are complete.
