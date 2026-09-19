# Phase 1 Stability Hardening — Implementation Checkpoint

Date: 2026-09-19
Baseline: v5.3.0
Status: validated on managed local baseline; runtime source import to GitHub still gated by Issue #2.

## Verification

Current managed working tree:

- JavaScript syntax: PASS
- Node test files: 25/25 PASS
- working ZIP SHA-256: 0776841c7603e176d986b60559701dd5708ddd2b65ea9f8f8e3b09dd6800317c
- focused runtime patch SHA-256: 607b6ccf964627975c69105e134ced26b04b03e4e0d1ac206d35b387ea5ef8f9

## Worker lifecycle changes validated

- claim starts in durable `starting` state rather than pretending to be running;
- background waits for explicit `workerStarted` ACK before Start reports success;
- ACK is scoped to exact owner + generation + worker tab;
- Start has a 15-second deadline and retries the start message while the tab initializes;
- timeout cleans the exact generation and extension-owned worker tab;
- Stop atomically reserves the generation as `stopping` before asynchronous cleanup;
- a new Start cannot claim the worker inside that cleanup window;
- same-owner Start during stopping is reported busy/stopping rather than falsely “already running”;
- phase and natural-completion messages are scoped to generation + owning worker tab;
- stale completion from an older generation cannot release the newer generation.

## Mutation-state changes validated

### Feed

`pet_feed` is fire-and-forget at the page bridge. The feed job no longer writes:

- `foodPercent = 100`
- `foodCheckedAt = now`
- a new `lastFedAt` as if full food state were confirmed

Instead it records `feedDispatchedAt`. A 10-minute dispatch retry guard prevents immediate duplicates while allowing later retry if no observed full state appears. Live catalog/profile observations remain authoritative for food percentage.

Legacy `lastFedAt` values are still honored for compatibility but are no longer manufactured by new fire-and-forget dispatches.

### Friend requests

History already stores `status: "dispatched"`, not “confirmed”. It remains a terminal dedupe guard because avoiding duplicate friend requests is safer than retrying an unconfirmed dispatch. Upgrade this only if live OviPets exposes a reliable confirmation/rejection signal.

## MutationObserver churn

Page-bridge temporary forms are marked with `data-oweh-bridge-owned`.

The content MutationObserver ignores a mutation batch only when every added/removed node belongs to that bridge-owned subtree. Mixed batches still schedule a normal refresh, so real game DOM updates cannot be hidden by the optimization.

## New/updated regression coverage

New:

- `tests/worker-start-ack.test.js`
- `tests/worker-generation-stop.test.js`

Updated coverage:

- feed dispatch vs confirmed state;
- page-bridge DOM ownership marker;
- MutationObserver bridge-only filtering;
- existing background job/sweep/egg-tab harnesses now ACK shared-worker start.

Important lifecycle cases now directly exercised:

- claim does not resolve before ACK;
- missing ACK fails closed;
- half-started tab/lease cleanup;
- Start during Stop cleanup;
- same-owner Start during stopping;
- generation rollover;
- stale completion;
- non-owner tab phase spoofing;
- non-owner tab completion spoofing.

## Remaining Phase 1 live work

- verify Name the Species wrong-answer lifecycle on current OviPets;
- verify dedicated friend egg tab exposes and completes `pet_turn_egg` as assumed;
- record evidence in LIVE_QA_CHECKLIST.md.

## Repository gate

Do not call this merged runtime work until Issue #2 imports the complete baseline/runtime/tests and CI reproduces the suite from a clean GitHub checkout. The GitHub documentation records this checkpoint so future agents do not redo or misrepresent the work.
