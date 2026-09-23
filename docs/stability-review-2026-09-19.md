# Stability review — 2026-09-19

## Scope

- Reviewed the Manifest V3 extension source and all existing automated tests.
- Logged in to the live OviPets web app and inspected the current Hatchery and pet-profile
  DOM without performing any game mutation.
- Confirmed the core live selectors used for Hatchery pet cards, pet IDs, profile tabs,
  and Overview species data.

## Fixed in v5.0.3

1. **Shared-worker lease mirror expired during healthy runs.** The 15-second heartbeat
   renewed the IndexedDB task lease but not `chrome.storage.local.owehWorker`, while
   `isWorkerOwner()` trusted that mirror. A workflow could therefore stop advancing after
   about 45 seconds even though its worker tab was alive. Heartbeats now update both.
2. **Stale completion could hide a newer worker.** `releaseSharedWorker(oldGeneration)`
   correctly left the new IndexedDB row untouched but still cleared its storage mirror.
   It now clears only a row it actually released and otherwise re-mirrors the current row.
3. **Superseded tabs could receive a late start.** The async tab-attach result is now
   checked before `startSharedWorker` is sent. A tab whose generation lost the claim is
   closed instead of starting stale work.
4. **DOM mutation bursts repeated the full refresh pipeline.** OviPets renders large
   Hatchery/Overview lists incrementally. Mutation callbacks are now coalesced into one
   refresh per 50 ms window, reducing repeated selector scans and storage requests.
5. **Minor lifecycle cleanup.** Removed an unused IndexedDB connection, refreshed stale
   worker mirrors during status checks, contained health-alarm promise failures, and
   clears pending timers when the page unloads.

## Verification

- JavaScript syntax checks pass for all four runtime scripts.
- All 15 test files pass, including new regression coverage for heartbeat mirror renewal,
  stale-generation completion, and DOM refresh throttling.
- Live OviPets checks confirmed the current SPA routes and these selectors:
  `main a.pet[href*="pet="]`, `a.pet img[src*="/img/pet/"]`,
  `ul[role="tablist"] > li[role="tab"]`, and
  `section#overview fieldset.overview li`.

## Safe live-test boundary

No egg turn, feeding, breeding, renaming, enclosure move, friend request, or friend
removal was executed during the review. Those actions modify the game account and should
be exercised manually after loading v5.0.3 unpacked, starting with a small controlled run.
