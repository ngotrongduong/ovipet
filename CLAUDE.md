# CLAUDE.md

## Project

OviPets Hatchery Helper is a Chrome Manifest V3 automation extension. Primary goals: stability, recoverability, conservative game interaction and maintainable modular code.

## Start every task here

1. docs/WORKING_STATE.md
2. docs/ROADMAP.md
3. ARCHITECTURE.md
4. docs/REFACTOR_MAP.md when moving code
5. docs/TEST_STRATEGY.md when changing behavior/tests
6. relevant current DOM/topic documentation

Older release documents are historical context, not authority.

## Non-negotiable invariants

- Mutations use the real OviPets UI/dispatcher bridge; do not invent direct private API calls.
- One user button starts one job.
- At most one shared worker lease is active.
- Worker transitions are owner + generation scoped.
- Stale generations cannot stop/complete newer work.
- Only extension-created, still-owned tabs may be closed automatically.
- MV3 background memory is disposable; durable state is authoritative.
- Stop must clean durable state even when the worker tab is dead.
- Do not share cancellation/state flags across unrelated features.
- Dispatched is not the same as confirmed success.
- Refactors preserve behavior unless explicitly labeled otherwise.

## Current runtime priority

Complete Phase 1 from docs/ROADMAP.md before broad modularization: worker start ACK/deadline, generation-safe release, dispatched-vs-confirmed state, observer filtering, tests and remaining live DOM verification.

## Refactor discipline

Extraction order: pure domain -> core adapters -> DOM adapters -> feature state machines -> UI -> background services. Never perform a big-bang rewrite.

## Verification

Run node scripts/verify-js.js and every tests/*.test.js file. Do not claim safety from syntax alone.

## Agent routing

See AGENTS.md and .claude/agents/. Use oweh-regression-reviewer as the final cross-cutting review.

## Documentation hygiene

WORKING_STATE.md is living state. ROADMAP.md is future work. ARCHITECTURE.md is durable architecture. Historical release notes are not current instructions.
