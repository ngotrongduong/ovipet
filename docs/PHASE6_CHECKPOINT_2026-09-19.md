# Phase 6 Automated Release Hardening — Checkpoint

Date: 2026-09-19
Release baseline: v5.3.0
Status: automated/local package gates PASS; live/manual and GitHub clean-checkout gates remain open.

## Automated release contract

The managed runtime now includes a release consistency gate that verifies Manifest V3, semantic version agreement, manifest-referenced files, background service imports, offscreen script references and absence/protection of local-only Claude/session files.

The canonical release-version locations are manifest.json, ui/panel.js, README.md and docs/WORKING_STATE.md. Historical/archive docs are not blind-replaced.

## Clean-package verification

A sanitized release-candidate ZIP was created outside the source tree, extracted into a clean directory and verified there:

- JavaScript syntax: PASS
- release consistency: PASS
- Node test files: 50/50 PASS

Final RC ZIP SHA-256:
`9c8cca14aed93f1303fdb04293e39cd97e7676b8ed826674cb763fb741054a82`

## Browser smoke attempt

Local Chromium headless was started with --load-extension. Chromium launched, but the remote-debugging target list exposed only about:blank and no extension service-worker target. This is recorded as inconclusive, not PASS or FAIL.

Windows Chrome unpacked-extension smoke therefore remains a manual release gate.

## Remaining release gates

- live Name the Species wrong-answer lifecycle;
- live friend egg dedicated-tab Turn Egg lifecycle;
- Windows Chrome unpacked-extension load/UI smoke;
- manual Start/Stop/reload recovery check;
- multi-hour soak test;
- complete runtime/test source imported to GitHub and clean-checkout CI green;
- no unresolved P0/P1 issue.

Do not label this RC production-ready until the required live/manual/repository gates are complete.
