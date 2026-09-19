# OviPets Hatchery Helper

Chromium Manifest V3 extension for OviPets automation and breeding workflows, with Microsoft Edge as the primary Windows target.

Current release: **v5.3.4**

## Engineering objective

The project prioritizes long-running stability/recoverability, then incremental modularization and measured efficiency improvements.

## v5.3.4

**Continuous Full Sweep** runs friend passes repeatedly until Stop while preserving the 10-minute per-friend cooldown.

**Name the Species** now follows the live server behavior captured by Species Inspector:

- `The answer is incorrect, please try again.` is retryable. Learn the wrong species, dismiss Error, Turn Egg again on the same egg, and exclude that species.
- `The egg can no longer be turned.` is terminal. Only then is the extension-owned egg tab closed as exhausted.

The Inspector learns from real `pet_turn_egg` success/failed responses and Answer IDs. A strict background image fetcher allows a perceptual challenge-image fingerprint that the solver also consumes, so learned knowledge can transfer across matching visual challenges.

The panel includes **Export Species DB** and **Import Species DB**. Backups merge idempotently and can restore knowledge on another computer or after reinstall. Previous full Inspector JSON exports are also accepted; v5.3.4 can mine their trace/network sessions to recover outcomes and Answer IDs even when historical learned-memory fields were empty.

## Current status

See [docs/WORKING_STATE.md](docs/WORKING_STATE.md) for the authoritative state. GitHub is not yet the runtime source-of-truth until Issue #2 imports the complete runtime/test tree and clean-checkout CI is green.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Species Inspector](docs/SPECIES_INSPECTOR.md)
- [Agent workflow](docs/AGENT_WORKFLOW.md)
