# Release Checklist

## Automated

- [x] JavaScript syntax PASS.
- [x] Release consistency PASS.
- [x] Full Node suite **53/53 PASS**.
- [x] Clean-extracted ZIP reproduces 53/53.
- [x] Three consecutive full-suite rounds pass 53/53.
- [x] Focused Egg/Species/DB soak: 20 × 8 = 160 test-file executions, 0 failures.
- [x] Continuous Full Sweep wrap/cooldown/Stop semantics covered.
- [x] Species DB export/import, idempotent merge and old Inspector trace recovery covered.
- [x] No local-only Claude/session files in package.
- [x] Explicit incorrect evidence is required for negative species learning.

## Live/manual

- [x] Microsoft Edge unpacked extension loads and panel works.
- [x] Ninja Please, database indexing/breeding and friend scanning observed working.
- [ ] v5.3.4 retryable incorrect → same egg retries with a different species.
- [ ] terminal `The egg can no longer be turned` → only owned tab closes and batch continues.
- [ ] Friend egg dedicated-tab lifecycle rechecked on v5.3.4.
- [ ] Export Species DB → clean/new Edge profile → Import restores learned knowledge.
- [ ] Start/Stop/reload worker recovery.
- [ ] Multi-hour live OviPets soak.

## Repository

- [ ] Complete runtime/test source present in GitHub.
- [ ] Clean-checkout CI reproduces syntax + release + full tests.
- [ ] No unresolved P0/P1 issue.

Do not call production-ready while required live/repository gates remain open.
