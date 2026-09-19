# Live Microsoft Edge QA Report — 2026-09-19

Environment: Microsoft Edge on Windows, authenticated OviPets session.

## Confirmed working before v5.3.2 Turn Egg redesign

- Extension loads as an unpacked Edge extension after the panel wiring fix.
- Ninja Please: PASS.
- Update pet catalog: navigation/enclosure scan runs. Persistence was not obvious from the old UI, so v5.3.2 now explicitly reports `saved X pet(s) to database ...` after the write completes.
- Turn available eggs: the older implementation turned available own eggs, but it used the hidden `pet_turn_egg` UI-command bridge and is superseded by the v5.3.2 real-tab UI flow.
- Start database: PASS through the observed end-to-end sequence — scan all enclosures, open/index pets, then breed eligible females against the selected best male.
- Full sweep: friend-list scan and friend-by-friend Hatchery traversal work; turnable eggs are detected and batches of tabs open.

## Live failures/findings that triggered v5.3.2

### Friend egg tabs opened but did not turn the egg

Full Sweep opened multiple egg profile tabs, retried, then stopped because the new tabs did not successfully perform Turn Egg.

v5.3.2 decision: Turn Egg is no longer allowed through the hidden `pet_turn_egg` bridge at all. The extension detects turnable eggs, opens at most 10 owned profile tabs, clicks the real Turn Egg button in each, resolves Name the Species if present, confirms the button is gone, and only then closes a confirmed owned tab.

### Merely visiting a friend's Hatchery auto-turned eggs

Browsing directly to a friend with turnable eggs caused background egg turning. v5.3.2 restricts Own Egg auto-start to the user's own Hatchery. A friend Hatchery can only enter the egg-turn flow through explicit `Start full sweep`.

## Not yet live-tested on v5.3.2

- Process hatchlings: no suitable newly hatched target was available.
- Name the Species wrong-answer lifecycle on a real egg tab.
- Friend Sweep real-button egg turn after the redesign.
- Start/Stop/reload recovery during a live long-running run.
- Multi-hour live-game soak.

## Automated regression after redesign

- JavaScript syntax: PASS.
- Release consistency: PASS.
- 51/51 test files: PASS.
- 20 completed regression rounds: 1,020 test-file executions, 0 failures.
- page bridge and game-bridge client both refuse hidden `pet_turn_egg` dispatch.
- own/friend egg flows both use the extension-owned tab engine.
- manual friend-Hatchery browsing is regression-tested not to auto-start egg turning.


## Terminal Error clarification — later live finding

The separate `Error — The answer is incorrect, please try again.` dialog is terminal for that egg in the current tab: after it appears, Turn Egg cannot be performed again there. v5.3.2 therefore records the wrong answer, marks the egg `exhausted`, closes only that extension-owned tab, prevents the coordinator from reopening that egg during the same visit, and continues the batch. It no longer dismisses the Error in order to retry the same egg.

v5.3.2 also adds Species Inspector export so browser-visible DOM/image/options, client-side source hints and narrowly filtered same-origin network evidence can be collected for offline analysis. This can reveal data delivered to the browser, but not private server-side source code.
