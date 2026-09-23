# OviPets Stability-First Roadmap

Repository gate and implementation phase are tracked separately because the complete runtime source is not yet mirrored into GitHub.

## Phase 0 — Baseline and repository reproducibility

**Repository status: OPEN — Issue #2.**

Goal: complete sanitized runtime/test source in GitHub and make clean-checkout CI reproduce syntax, release consistency and the full test suite.

## Phase 1 — Worker and mutation-state hardening

**Local implementation: VALIDATED.**

Explicit worker ACK/deadline; generation/tab-safe Stop/release/complete; dispatched-vs-confirmed mutation truth; observer filtering; lifecycle regression coverage. Two live OviPets contracts remain manual gates.

## Phase 2 — Pure domain extraction

**Local implementation: VALIDATED.**

Color/pedigree/scoring/planning/pet-record behavior is in deterministic domain modules with direct tests.

## Phase 3 — Platform adapters and dependency direction

**Local implementation: VALIDATED.**

Storage/game/worker/scheduler/game-action adapters and route-specific DOM readers extracted; broad legacy job dependency bag removed.

## Phase 4 — Feature state machines and UI

**Local implementation: VALIDATED.**

Own Eggs, Pet Index, Friend Sweep, Hatchlings and Breeding state machines plus panel/dashboard UI extracted. content.js reduced to 998 lines.

## Phase 5 — Background and data efficiency

**Local implementation: VALIDATED.**

DB/journal/worker/species/health services split; targeted pet reads added; migration cached; command history bounded; background.js reduced to 165 lines.

## Phase 6 — Release hardening

**Automated local/package gates: VALIDATED. Manual/live/repository gates: OPEN.**

Completed: syntax, manifest/load-order, release-version consistency, clean-package regression suite.

Still required: Windows Edge unpacked smoke, worker recovery/manual QA, two live OviPets DOM contracts, multi-hour soak, and GitHub clean-checkout CI after Phase 0 repository import.

## Change-size policy

Prefer one behavior change or one extraction boundary per PR. Do not combine a broad behavior redesign with a broad file move. Keep every step bisectable and regression-tested.
