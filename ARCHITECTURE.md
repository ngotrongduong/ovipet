# OviPets Extension Architecture

This is the durable target architecture for the v5.3.0+ stability/modularization program. It describes dependency direction and invariants; docs/WORKING_STATE.md describes what is actually implemented today.

## Core invariants

- Game mutations use the OviPets UI/dispatcher bridge, not invented direct private API calls.
- One user button starts one independently observable job.
- Only one shared worker lease may be live.
- Every worker lifecycle operation is owner + generation scoped.
- Stale generations are no-ops.
- Start is not considered running until an explicit ACK is received.
- Only tabs created and still owned by the extension may be closed automatically.
- MV3 service-worker memory is disposable; durable state is authoritative.
- Feature cancellation/state is isolated unless coupling is explicitly documented.
- A command being dispatched is not the same as a game mutation being confirmed.

## Dependency direction

UI / Jobs
  -> Features
  -> Core services + DOM adapters + Domain
  -> Chrome APIs / page bridge / persisted state

Dependencies should point downward. Domain code must not import browser/platform behavior.

## Layers

### domain/

Pure deterministic calculations only.

Target modules:

- colors.js
- pedigree.js
- breeding-score.js
- breeding-plan.js

Forbidden here: document, window, chrome, timers, storage and game commands.

### dom/

Read external OviPets pages and return stable data.

Target modules:

- routes.js
- hatchery.js
- profile.js
- overview.js
- friends.js
- chat.js

DOM modules own selectors and interpretation, not automation policy.

### core/

Platform-facing reusable services:

- config.js
- storage-client.js
- game-bridge.js
- worker-client.js
- scheduler.js

These normalize Chrome/message behavior so feature modules do not depend on ad-hoc globals.

### features/

Longer state machines:

- own-eggs.js
- friend-sweep.js
- hatchlings.js
- pet-index.js
- breeding-campaign.js

Features own their state/cancellation and compose domain + DOM + core services.

### jobs/

One-button tasks. Existing jobs are already the first modularization boundary.

Jobs should depend on explicit services. The temporary broad legacy dependency bag should shrink and disappear rather than simply move to another file.

### ui/

- panel.js
- dashboard.js

UI renders/dispatches intent. It must not become the authoritative automation state machine.

### background/

Target modules:

- state-db.js
- command-journal.js
- worker-manager.js
- egg-tabs.js
- species-alert.js

background.js should eventually contain top-level Chrome event registration and message routing only.

## Shared worker state machine

Expected durable states:

idle
  -> claimed
  -> starting
  -> running
  -> stopping / completed / failed
  -> idle

Required properties:

- claim is atomic;
- state records owner + generation;
- start has a bounded deadline;
- running requires start ACK;
- heartbeat validates generation;
- Stop/release/complete validate generation;
- duplicate and stale messages are harmless;
- service-worker restart can rehydrate from durable state;
- dead worker tabs can be cleaned without relying on their content script.

See the worker-state-machine skill and docs/TEST_STRATEGY.md.

## DOM scheduling model

The current global refresh model should evolve toward route-aware scheduling:

MutationObserver / navigation
  -> ignore extension-owned mutations
  -> classify route + dirty reason
  -> coalesce
  -> invoke only relevant modules

Examples:

- Hatchery changes -> egg/hatchling modules.
- Profile changes -> species/profile modules.
- Overview changes -> catalog/feed/index modules.
- Friends/chat changes -> friend/Ninja modules.

## Data model direction

IndexedDB remains the durable pet/task/command source of truth.

Avoid repeatedly materializing the entire pet DB when a job needs only a subset. First optimize by reusing one snapshot per job; add focused query APIs/indexes only after measurement.

Durable command/task history must have bounded retention where recovery no longer needs old rows.

## Refactor policy

Move behavior before redesigning it.

Every extraction must:

1. retain/add regression coverage;
2. preserve storage keys/schema unless migration is included;
3. preserve DOM contracts unless separately audited;
4. preserve owner/generation semantics;
5. pass syntax + full tests;
6. receive relevant specialist + regression review.

Do not mix a large behavior redesign with a large file move in the same PR.
