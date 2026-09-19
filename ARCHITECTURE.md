# OviPets Extension Architecture

This file describes the intended architecture after the v5.3.0 stability review. It is a migration target, not a statement that every module already exists.

## Core invariants

- UI-driven game interaction only.
- One user button = one independently startable job.
- One shared worker lease at a time.
- Every worker lifecycle transition is owner + generation scoped.
- Only extension-owned tabs may be closed.
- Persistent state must survive MV3 service-worker suspension.
- DOM readers and domain logic should be deterministic wherever possible.
- Feature cancellation/state must not be shared accidentally across unrelated jobs.

## Layering

### Domain

Pure calculations only. No `document`, `window`, `chrome`, timers, storage or network/game commands.

Examples: breeding target math, color distance, pedigree safety, candidate scoring.

### DOM adapters

Read OviPets pages and convert live DOM into stable data structures. Route-specific selectors live here instead of in feature orchestration.

### Core services

Small wrappers around Chrome storage/IndexedDB RPC, the game command bridge, worker lifecycle and scheduling.

### Features

State machines for multi-step behavior: egg processing, friend sweep, pet indexing, hatchlings and breeding campaigns.

### Jobs

One-button jobs. Jobs compose core/domain/DOM services and do not reach back into a giant legacy object.

### UI

Panel rendering, status/dashboard rendering and event binding. UI calls feature/job APIs; it does not own automation state machines.

### Background

IndexedDB, command journal, worker manager, owned-tab registry and alert/offscreen services. `background.js` should eventually become mostly message routing/event registration.

## Refactor rule

Move behavior without redesigning it first. Every extraction should:

1. add/retain regression coverage;
2. preserve storage keys and data schema unless a migration is included;
3. preserve worker owner/generation semantics;
4. pass syntax + full tests before the next extraction.

Large behavior changes and large file moves should not be mixed in the same commit.
