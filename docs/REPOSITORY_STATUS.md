# Repository status — 2026-10-15

This is the current repository-level status document. Historical files under `docs/` record earlier milestones and are **not** necessarily up-to-date release gates.

## Source of truth

| Component | Source | Version | Status |
| --- | --- | --- | --- |
| Full OviPets Hatchery Helper | `main` | `5.12.0` | Merged from [PR #36](https://github.com/ngotrongduong/ovipet/pull/36) on 2026-10-15 (merge `e5c751d`) |
| Friend Sweep Lite | `feat/friend-sweep-lite` | `0.4.0` | [PR #37](https://github.com/ngotrongduong/ovipet/pull/37) — separate draft; **not** part of `main` yet |
| Historical refactor | `main` | Phases 1–5 | Implemented and covered by regression/CI; retrospective issue cleanup in progress |

There is no published GitHub **Release** object as of this status update. A version in `manifest.json` or an Actions artifact is not the same as a formally published Release.

## Confirmed evidence

- GitHub Actions `Extension CI` passed for Full v5.12.0 merge `e5c751d` on 2026-10-15: [workflow run](https://github.com/ngotrongduong/ovipet/actions/runs/38734274370). The pipeline checks JS syntax, release consistency and the Node test suite.
- On **2026-10-15**, the owner reports the following **live** OviPets outcomes: **Discard surplus works**, **shared Species database works efficiently**, and **Full Sweep works over multi-hour runs** with no reported problems.
- These live outcomes are **owner-reported**; detailed logs, environment and run measurements were not attached in GitHub as of this update.
- The **Lite-specific** low-resource live/soak test has **not** been separately confirmed. Do not infer its sign-off from Full Extension Full Sweep validation.

## Remaining independent gates

- [ ] Complete and document Lite-specific live testing before marking [PR #37](https://github.com/ngotrongduong/ovipet/pull/37) ready/merged.
- [ ] Resolve or explicitly accept remaining feature-specific live gates in [open issues](https://github.com/ngotrongduong/ovipet/issues), particularly breeding, own-Hatchery hatch and Ninja/Ads where applicable.
- [ ] Publish a GitHub Release/tag when the intended release scope and assets are reviewed.
- [ ] Configure `main` branch protection/rulesets, including required `Extension CI` checks, in GitHub repository Settings (requires admin UI; not done by this documentation change).

## Repository rules

1. `main` is the stable source branch. Use task branches and PRs for changes; never force-push `main`.
2. Keep separate manifest versions for Full (`manifest.json`) and Lite (`friend-sweep-lite/manifest.json`).
3. Do not call Node tests a substitute for live QA, nor treat owner-reported success as an independently archived test log.
4. The Lite scheduled updater must obtain stable code from `main`, not from feature branches, **once PR #37 is published**.
5. Discard actions are permanent. Preserve the existing preview and live recheck contracts; changes require focused tests and supervised live confirmation.
6. Store no GitHub tokens, credentials, real user identifiers or exported account datasets in this public repository.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for current gates and [RELEASE_PROCESS.md](RELEASE_PROCESS.md) for release steps.
