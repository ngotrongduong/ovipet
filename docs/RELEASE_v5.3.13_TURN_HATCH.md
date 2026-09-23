# v5.3.13 — Own Hatchery Turn + Hatch

Date: 2026-09-21

Source baseline: v5.3.12 Ninja + Ads dual-scan release.

## Live DOM evidence

The supplied OviPets profile HTML shows the ready-state button executing:

```text
ui_action_cmdExec('pet_turn_egg','PetID=<id>', ...)
```

with visible label `Hatch Egg`. The own Hatchery screenshot also shows the green ready-action icon/tooltip `Hatch Egg`.

## Behavior

- `Turn / Hatch available eggs` applies only to the user's own Hatchery.
- Normal `Turn Egg` behavior is unchanged: extension-owned profile tabs click the real button and handle Name the Species before reporting success.
- Hatch-ready eggs are detected through `img[title="Hatch Egg"]` on the own Hatchery.
- Hatch-ready eggs use a dedicated direct UI-dispatch path for `pet_turn_egg` + `PetID`, avoiding one profile-tab round trip per hatch.
- Generic `pet_turn_egg` bridge use remains blocked.
- The direct hatch path requires all of:
  - request purpose `own-hatch`;
  - current route is own Hatchery, not `usr=<friend>`;
  - the exact PetID has a currently visible Hatch Egg icon in the Hatchery DOM.
- Friend eggs and Full Sweep never use this path.
- Hatch commands are dispatched in bounded batches of up to 50, paced 100 ms apart, then the Hatchery reloads/rechecks.
- Existing own-egg run state remains backward compatible and now tracks `hatched`, `hatchAttempts` and `hatchDispatched`.

## Files changed

- `dom/hatchery.js`
- `core/game-bridge.js`
- `core/game-actions.js`
- `page-bridge.js`
- `features/own-eggs.js`
- `content.js`
- `ui/panel.js`
- `manifest.json`
- `scripts/publish-github.ps1`
- `tests/hatchery-dom.test.js`
- `tests/game-actions.test.js`
- `tests/game-bridge.test.js`
- `tests/page-bridge.test.js`
- `tests/own-eggs-feature.test.js`
- `tests/same-tab-species-handoff.test.js`
- `tests/control-wiring.test.js`

## Automated verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: 59/59 PASS
- Focused own-Hatchery/bridge soak: 20 rounds × 7 files = 140 executions, 0 failures

## Live gate

On the user's own Hatchery, verify at least one `Hatch Egg` icon disappears/turns into a newly hatched pet after `Turn / Hatch available eggs`, while normal `Turn Egg` eggs continue to open real profile tabs and friend Hatcheries never dispatch direct hatches.
