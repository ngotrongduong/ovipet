# OviPets Hatchery Helper

Chrome Manifest V3 extension for OviPets automation and breeding workflows.

## Engineering objective

The project is being hardened for long-running reliability first, then incrementally modularized. Current baseline is v5.3.0.

Key goals:

- safe/recoverable background automation;
- no duplicate or stale worker actions;
- conservative confirmation of game mutations;
- efficient handling of large pet/friend sets;
- small modules with regression coverage;
- explicit live-DOM contracts.

## Current status

See [docs/WORKING_STATE.md](docs/WORKING_STATE.md) for the current phase and active risks.

The immediate priority is Phase 1 worker/state hardening before large-scale content.js extraction.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Refactor map](docs/REFACTOR_MAP.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Project review](docs/PROJECT_REVIEW_2026-09-19.md)
- [Agent/skill research](docs/AGENT_SKILL_RESEARCH.md)

## Development rules

Read [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before runtime changes.

The project follows stability-first incremental refactoring: small PRs, behavior-preserving extraction, tests at every boundary, and live QA where OviPets DOM behavior cannot be reproduced in CI.
