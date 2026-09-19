# OviPets Hatchery Helper

Chrome Manifest V3 extension for OviPets automation and breeding workflows.

Current release: **v5.3.1**

## Engineering objective

The project prioritizes long-running stability and recoverability, then incremental modularization and measured efficiency improvements.

Key goals:

- safe/recoverable background automation;
- no duplicate, stale or cross-tab worker actions;
- conservative confirmation of game mutations;
- efficient handling of large pet/friend sets;
- small modules with regression coverage;
- explicit live-DOM contracts.

## Current status

See [docs/WORKING_STATE.md](docs/WORKING_STATE.md) for the authoritative current engineering state.

Phases 1–5 and Phase 6 automated gates are validated on the managed runtime. Edge live QA produced v5.3.1: Turn Egg is now real-button/UI-only in owned profile tabs; remaining live gates are documented in LIVE_QA_CHECKLIST.md.

The GitHub repository is not yet the authoritative runtime source: Issue #2 remains open until the complete source/test tree is imported and CI reproduces the same results from a clean checkout.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Refactor map](docs/REFACTOR_MAP.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Agent workflow](docs/AGENT_WORKFLOW.md)
- [Agent/skill research](docs/AGENT_SKILL_RESEARCH.md)

Historical v5.3.0 README/CLAUDE material is retained under docs/archive/ for reference only.
