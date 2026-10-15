# Release checklist — 2026-10-15

Applies to **Full v5.12.0** on `main`. Friend Sweep Lite **v0.4.0** remains a separate draft PR #37, with independent sign-off.

## Verified — source and automated checks

- [x] Full source `manifest.json` version is `5.12.0` and PR #36 is merged into `main` (merge `e5c751d`).
- [x] GitHub Actions Full `Extension CI` passed on `main`: [run 38734274370](https://github.com/ngotrongduong/ovipet/actions/runs/38734274370).
- [x] CI includes JS syntax, release consistency, and Node test suite.
- [x] Runtime and tests exist in GitHub; historical Phase 0 issue #2 was closed.

## Owner-reported live OviPets checks (2026-10-15)

- [x] **Discard surplus** performs as expected in real use — owner confirmation; no detailed logs attached.
- [x] **Shared Species DB** is working efficiently — owner confirmation; no per-install sync trace attached.
- [x] **Full Sweep** has run successfully for multiple hours — owner confirmation; no test hardware/log artifact attached.

These checkmarks record the owner's live sign-off for the named features, **not** an independently reproduced test.

## Remaining separate verification

- [ ] Friend Sweep **Lite-specific** long-running low-resource run, including Stop/recovery, adaptive tabs, wrong-case review and stable memory behavior ([PR #37](https://github.com/ngotrongduong/ovipet/pull/37)).
- [ ] Breeding campaign success/alternate-male fallback and pedigree guards live checks ([#13](https://github.com/ngotrongduong/ovipet/issues/13), [#14](https://github.com/ngotrongduong/ovipet/issues/14)).
- [ ] Own Hatchery direct Hatch Egg flow and no direct friend-hatch dispatch ([#10](https://github.com/ngotrongduong/ovipet/issues/10)).
- [ ] Ninja + Ads two-conversation live DOM verification ([#8](https://github.com/ngotrongduong/ovipet/issues/8)).
- [ ] Complete the broader manual QA matrix and Phase 6 criteria ([#7](https://github.com/ngotrongduong/ovipet/issues/7)).

## Repository publication

- [ ] Enable branch protection/ruleset on `main`, requiring green `Extension CI` and PR review as appropriate.
- [ ] Decide formal Full release asset/tag and publish GitHub Release; manifest version alone does not create a Release.
- [ ] Merge/publish Lite independently only after its remaining gate is accepted.
- [ ] After a future code change, update regression coverage and affected live QA evidence.

**Do not collapse individual feature validation into a claim that all Phase 6 gates have passed.**

Older v5.3-era checklist: [archive/RELEASE_CHECKLIST_v5.3.12.md](archive/RELEASE_CHECKLIST_v5.3.12.md).
