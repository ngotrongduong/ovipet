# OviPets Extension Architecture

This is the durable target architecture for the v5.3.0+ stability/modularization program. docs/WORKING_STATE.md describes what is implemented today.

## Core invariants

- Game mutations use the OviPets UI/dispatcher bridge, not invented direct private API calls.
- One user button starts one independently observable job.
- Only one shared worker lease may be live.
- Every worker lifecycle operation is owner + generation scoped.
- Stale generations are no-ops.
- Start is not considered running until an explicit ACK is received.
- Only tabs created and still owned by the extension may be closed automatically.
- MV3 service-worker memory is disposable; durable state is authoritative.
- Feature cancellation/state is isolated unless coupling is documented.
- Dispatched commands are not confirmed mutations.

## Dependency direction

UI / Jobs -> Features -> Core services + DOM adapters + Domain -> Chrome APIs / page bridge / persisted state.

### domain/
Pure deterministic calculations: colors.js, pedigree.js, breeding-score.js, breeding-plan.js. No document/window/chrome/timers/storage/game commands.

### dom/
Route-specific OviPets readers: routes.js, hatchery.js, profile.js, overview.js, friends.js, chat.js. DOM modules own selectors/interpretation, not automation policy.

### core/
config.js, storage-client.js, game-bridge.js, worker-client.js, scheduler.js.

### features/
own-eggs.js, friend-sweep.js, hatchlings.js, pet-index.js, breeding-campaign.js.

### jobs/
One-button tasks. Replace the broad legacy dependency bag with explicit services over time.

### services/
Content-side orchestration composed by content.js: diagnostics.js, overview-catalog.js, pet-edit.js, friend-directory.js, retention.js, status.js, partner-ranking.js, worker-control.js. Each exports `OWEH.services.<name>.createX(deps)` with explicit dependencies (no content.js closure state, no shared bag). Loaded after ui/ and before content.js.

### ui/
panel.js, dashboard.js. UI renders/dispatches intent; it is not authoritative automation state.

### background/
state-db.js, command-journal.js, worker-manager.js, egg-tabs.js, species-alert.js. background.js eventually becomes event/message routing only.

## Shared worker state machine

idle -> claimed -> starting -> running -> stopping/completed/failed -> idle

Claim is atomic; state records owner+generation; start has a deadline; running requires ACK; heartbeat/Stop/release/complete validate generation; stale messages are harmless; restart can rehydrate; dead tabs can be cleaned from durable state.

## DOM scheduling model

Mutation/navigation -> ignore extension-owned mutations -> classify route + dirty reason -> coalesce -> invoke only relevant modules.

## Refactor policy

Move behavior before redesigning it. Preserve storage/DOM/lifecycle contracts, keep tests green, and do not mix large behavior redesigns with large file moves.
