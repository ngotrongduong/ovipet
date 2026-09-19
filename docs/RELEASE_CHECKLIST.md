# Release Checklist

## Automated gate

- [x] `node scripts/verify-js.js` passes.
- [x] `node scripts/verify-release.js` passes.
- [x] `node --test tests/*.test.js` passes (52/52).
- [x] Manifest-referenced files exist and load order is valid.
- [x] Manifest/UI/README/WORKING_STATE release versions agree at v5.3.3.
- [x] Background `importScripts(...)` targets all exist.
- [x] Local-only Claude/session files are absent.
- [x] No unresolved regression-test failure.

## Architecture/safety review

- [ ] Relevant specialist review completed.
- [ ] `oweh-regression-reviewer` completed.
- [ ] Shared worker Start/Stop/recovery invariants unchanged or explicitly reviewed.
- [ ] Extension-owned-tab-only close invariant preserved.
- [ ] Fire-and-forget dispatch is not presented as confirmed game success.
- [ ] No broad legacy/God dependency bag was reintroduced.

- [x] Continuous Full Sweep wraps to the next pass in automated regression while preserving cooldown and Stop semantics.

## Live/manual gate

- [x] Wrong-answer Error terminal behavior confirmed on current OviPets; v5.3.3 still needs live verification that the new close/exhausted flow continues the batch cleanly.
- [ ] Friend egg dedicated-tab Turn Egg lifecycle verified on current OviPets.
- [x] Windows Edge unpacked-extension smoke test completed; live workflows are being re-tested on v5.3.3.
- [ ] Start/Stop/reload worker recovery manually checked.
- [ ] Multi-hour soak test recorded in `docs/LIVE_QA_CHECKLIST.md`.

- [ ] Species Inspector export JSON collected from real quizzes and reviewed for useful client-side answer identifiers.

## Repository gate

- [ ] Complete runtime/test source is present in GitHub.
- [ ] Clean checkout CI reproduces syntax + release checks + full tests.
- [ ] No unresolved P0/P1 issue.

Do not call a release production-ready while any required live/repository gate above remains open.
