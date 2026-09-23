# Live Microsoft Edge QA Report — 2026-09-19

Environment: Microsoft Edge on Windows, authenticated OviPets session.

## Confirmed working before v5.3.1 Turn Egg redesign

- Extension loads as an unpacked Edge extension after the panel wiring fix.
- Ninja Please: PASS.
- Update pet catalog: navigation/enclosure scan runs. Persistence was not obvious from the old UI, so v5.3.1 now explicitly reports `saved X pet(s) to database ...` after the write completes.
- Turn available eggs: the older implementation turned available own eggs, but it used the hidden `pet_turn_egg` UI-command bridge and is superseded by the v5.3.1 real-tab UI flow.
- Start database: PASS through the observed end-to-end sequence — scan all enclosures, open/index pets, then breed eligible females against the selected best male.
- Full sweep: friend-list scan and friend-by-friend Hatchery traversal work; turnable eggs are detected and batches of tabs open.

## Live failures/findings that triggered v5.3.1

### 1. Friend egg tabs opened but did not turn the egg

Observed: Full Sweep opened multiple egg profile tabs, retried, then stopped because the new tabs did not successfully perform Turn Egg.

Decision: Turn Egg is no longer allowed through the hidden `pet_turn_egg` bridge at all.

v5.3.1 behavior:

1. detect turnable eggs;
2. open at most 10 extension-owned egg profile tabs per batch;
3. each tab waits for OviPets to load;
4. each tab clicks the real visible `Turn Egg` button;
5. if `Name the Species` appears, answer and press `OK` before proceeding;
6. if an answer is rejected and the same dialog node remains open, remember that choice as wrong and try another;
7. report success only after the Turn Egg button is no longer present;
8. only then may the extension close that owned egg tab.

### 2. Merely visiting a friend's Hatchery auto-turned eggs

Observed: browsing directly to a friend with turnable eggs caused the extension to turn them automatically in the background.

v5.3.1 fix: Own Egg auto-start is restricted to the user's own Hatchery. A friend Hatchery can only enter the egg-turn flow through the explicit `Start full sweep` workflow.

## Not yet live-tested

- Process hatchlings: no suitable newly hatched target was available.
- Name the Species wrong-answer lifecycle on v5.3.1 real egg tabs.
- v5.3.1 Friend Sweep real-button egg turn after the redesign.
- Start/Stop/reload recovery during a live long-running run.
- Multi-hour live-game soak.

## Automated regression after redesign

v5.3.1:

- JavaScript syntax: PASS.
- Release consistency: PASS.
- 51/51 test files: PASS.
- 20 completed regression rounds: 1,020 test-file executions, 0 failures.
- page bridge explicitly rejects `pet_turn_egg`.
- own/friend egg flows both use the extension-owned tab engine.
- manual friend-Hatchery browsing is regression-tested not to auto-start egg turning.
