# OviPets Hatchery Helper

Chrome Manifest V3 extension for OviPets automation and breeding workflows.

## Engineering objective

The project is being hardened for long-running reliability first, then incrementally modularized. Current release baseline is v5.3.0.

Key goals:

- safe/recoverable background automation;
- no duplicate, stale, or cross-tab worker actions;
- conservative confirmation of game mutations;
- efficient handling of large pet/friend sets;
- small modules with regression coverage;
- explicit live-DOM contracts.

## Current status

Start with [docs/WORKING_STATE.md](docs/WORKING_STATE.md).

Repository gate: Phase 0 is still open until the complete runtime/test baseline is imported and CI reproduces the clean suite from GitHub.

Runtime hardening: Phase 1 changes have been validated on the managed working baseline with JavaScript syntax PASS and 25/25 Node test files PASS. See [the Phase 1 checkpoint](docs/PHASE1_CHECKPOINT_2026-09-19.md). Broad content.js modularization does not start before the repository baseline and lifecycle gates are closed.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Refactor map](docs/REFACTOR_MAP.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Phase 1 implementation checkpoint](docs/PHASE1_CHECKPOINT_2026-09-19.md)
- [Project review](docs/PROJECT_REVIEW_2026-09-19.md)
- [Agent/skill research](docs/AGENT_SKILL_RESEARCH.md)
- [Agent workflow](docs/AGENT_WORKFLOW.md)

## Development rules

Read [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before runtime changes.

The project follows stability-first incremental refactoring: small PRs, behavior-preserving extraction, tests at every boundary, independent high-signal review, and live QA where OviPets DOM behavior cannot be reproduced in CI.
