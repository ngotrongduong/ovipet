# Release Checklist

## Automated gate

- [x] JavaScript syntax gate passes on the current local RC.
- [x] Release consistency gate passes on the current local RC.
- [x] 50/50 Node test files pass on the current local RC.
- [x] The sanitized ZIP was extracted cleanly and reproduced all automated gates.
- [x] Manifest/background import/version/local-file consistency is checked automatically.
- [x] Automated regression soak completed: 20 consecutive full-suite rounds, 1,000 test-file executions, 0 failures.
- [x] Worker-tab cleanup regression proves a user-navigated non-OviPets tab is not auto-closed.

## Architecture/safety review

- [x] Shared-worker owner/generation/tab and owned-tab-only-close invariants are covered by regression tests.
- [x] Fire-and-forget dispatch is not treated as confirmed game success.
- [x] Broad legacy/God dependency bag is not present in jobs.
- [x] Feature state machines and background state services are separated from composition roots.

## Live/manual gate

- [ ] Name the Species wrong-answer lifecycle verified on current OviPets.
- [ ] Friend egg dedicated-tab Turn Egg lifecycle verified on current OviPets.
- [ ] Windows Chrome unpacked-extension load/UI smoke completed.
- [ ] Start/Stop/reload worker recovery manually checked.
- [ ] Multi-hour live OviPets soak recorded in LIVE_QA_CHECKLIST.md.

## Repository gate

- [ ] Complete runtime/test source is present in GitHub.
- [ ] Clean checkout CI reproduces syntax + release checks + full tests.
- [ ] No unresolved P0/P1 issue.

Do not call the RC production-ready while any required authenticated live/manual or repository gate remains open.
