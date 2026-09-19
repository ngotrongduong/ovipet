# CLAUDE.md

## Project

OviPets Hatchery Helper is a Chrome Manifest V3 automation extension. The primary engineering goals are stability, recoverability, conservative game interaction and maintainable modular code.

## Start every task here

Read in this order:

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
- Refactors preserve behavior unless explicitly labeled as behavior changes.

## Current priority

Complete Phase 1 from docs/ROADMAP.md before broad modularization:

- worker start ACK/deadline;
- generation-safe release;
- dispatched vs confirmed mutation state;
- observer filtering;
- regression tests;
- remaining live DOM verification.

## Refactor discipline

content.js is intentionally being reduced incrementally.

Extraction order:

1. pure domain;
2. core adapters;
3. DOM adapters;
4. feature state machines;
5. UI;
6. background services.

Never perform a big-bang rewrite.

## Verification

Run:

- node scripts/verify-js.js
- every tests/*.test.js file with Node

Do not claim a runtime change is safe only because syntax passes.

## Agent routing

See AGENTS.md and .claude/agents/.

Use specialists for lifecycle, DOM contracts, regression testing, refactor boundaries and performance. Use oweh-regression-reviewer as the final cross-cutting review.

## Documentation hygiene

WORKING_STATE.md is living state.
ROADMAP.md is future work.
ARCHITECTURE.md is durable architecture.
Historical release notes should not be used as current instructions.

Update WORKING_STATE.md in any PR that changes architecture, durable state, lifecycle semantics, or the active phase.
