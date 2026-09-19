# Refactor Map

Purpose: provide a concrete extraction map for the current large content/background files.

## content.js target split

### core/

- config.js — constants and stable configuration.
- storage-client.js — chrome.runtime message wrappers and persistence API.
- game-bridge.js — page-bridge command client and result normalization.
- worker-client.js — claim/start/heartbeat/release client contract.
- scheduler.js — refresh coalescing, dirty flags and route-aware dispatch.

### dom/

- routes.js — route classification.
- hatchery.js — egg/hatchling discovery and status reads.
- profile.js — pet profile/species/pedigree readers.
- overview.js — catalog/overview readers.
- friends.js — friend/hatchery readers.
- chat.js — Ninja Please comment readers.

DOM modules read pages and return data. They should not decide breeding strategy or mutate persistent state.

### domain/

- colors.js — normalization, distance, target/bracket helpers.
- pedigree.js — relation extraction and safety checks.
- breeding-score.js — scoring/ranking primitives.
- breeding-plan.js — deterministic candidate/partner planning.

Domain modules must be pure and easiest to test.

### features/

- own-eggs.js — own Hatchery egg automation state.
- friend-sweep.js — friend iteration and sweep state machine.
- hatchlings.js — rename/sort newborn processing.
- pet-index.js — database refresh/index orchestration.
- breeding-campaign.js — breeding execution and progress state.

### ui/

- panel.js — controls and event wiring.
- dashboard.js — metrics/status rendering.

### content-entry.js

Eventually contains only:

- service construction;
- job/feature registration;
- route scheduler bootstrap;
- top-level listeners.

Target: a few hundred lines, not thousands.

## background.js target split

- bg/state-db.js — IndexedDB schema, migrations and CRUD.
- bg/worker-manager.js — owner/generation lease state machine.
- bg/command-journal.js — durable command transitions/recovery.
- bg/egg-tabs.js — existing owned egg-tab registry.
- bg/species-alert.js — offscreen/audio/focus notifications.
- background.js — top-level Chrome event and message routing.

## Extraction order

1. Pure domain functions.
2. Storage/game/worker clients.
3. Route/DOM readers.
4. Feature state machines.
5. UI.
6. Background services.

## Definition of a safe extraction

A refactor PR is considered behavior-preserving only when:

- existing tests pass before and after;
- moved functions receive identical inputs and produce identical outputs;
- storage keys/schema stay unchanged;
- selector behavior stays unchanged unless separately documented;
- worker owner/generation semantics stay unchanged;
- no retired workflow is reintroduced;
- diff can be reverted without data migration.
