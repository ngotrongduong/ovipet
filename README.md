# OviPets Hatchery Helper

Chrome Manifest V3 extension for OviPets automation and breeding workflows.

Current release: **v5.3.3**

## Engineering objective

The project prioritizes long-running stability and recoverability, then incremental modularization and measured efficiency improvements.

Key goals:

- safe/recoverable background automation;
- no duplicate, stale or cross-tab worker actions;
- conservative confirmation of game mutations;
- efficient handling of large pet/friend sets;
- small modules with regression coverage;
- explicit live-DOM contracts.

## v5.3.3 continuous Full Sweep

`Start full sweep` now loops continuously until **Stop**. After the final queued friend, the worker wraps to the first eligible friend and increments a durable pass counter. The existing 10-minute per-friend cooldown is preserved; if every friend is still cooling down, the worker remains active and waits for the earliest eligible friend instead of reporting completion.

The dashboard shows `pass N`, and Stop during a cooldown wait prevents the next pass from opening.

## v5.3.2 species verification

A wrong Name-the-Species Error is terminal for that egg: record the negative answer, close only the extension-owned tab, mark that egg exhausted for the current visit, and continue the batch. The extension must not retry Turn Egg in the same tab after the Error appears.

v5.3.2 also adds a privacy-scoped **Species Inspector**. It can record the verification DOM/image/options, answer outcomes, relevant client-side source hints and narrowly filtered same-origin request/response evidence while the quiz is active. It cannot access private server-side source code. Export the dataset from **Hatchery & Eggs → Export Species JSON** for later analysis.

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
