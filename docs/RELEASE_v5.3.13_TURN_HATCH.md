# v5.3.13 — Own Hatchery Turn + Hatch

Date: 2026-09-21

Source baseline: v5.3.12 Ninja + Ads dual-scan release.

## Live DOM evidence

The supplied OviPets profile HTML shows the ready-state button executing:

`ui_action_cmdExec('pet_turn_egg','PetID=<id>', ...)`

with visible label `Hatch Egg`. The own Hatchery screenshot also shows the green ready-action icon/tooltip `Hatch Egg`.

## Behavior

- `Turn / Hatch available eggs` applies only to the user's own Hatchery.
- Normal `Turn Egg` behavior is unchanged: extension-owned profile tabs click the real button and handle Name the Species before reporting success.
- Hatch-ready eggs are detected through `img[title="Hatch Egg"]` on the own Hatchery.
- Hatch-ready eggs use a dedicated direct UI-dispatch path for `pet_turn_egg` + `PetID`, avoiding one profile-tab round trip per hatch.
- Generic `pet_turn_egg` bridge use remains blocked.
- The direct hatch path requires all of: request purpose `own-hatch`; current route is own Hatchery, not `usr=<friend>`; and the exact PetID has a currently visible Hatch Egg icon in the Hatchery DOM.
- Friend eggs and Full Sweep never use this path.
- Hatch commands are dispatched in bounded batches of up to 50, paced 100 ms apart, then the Hatchery reloads/rechecks.

## Automated verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: 59/59 PASS
- Focused own-Hatchery/bridge soak: 20 rounds × 7 files = 140 executions, 0 failures
- Clean-extracted final ZIP: 59/59 PASS
- Final ZIP SHA-256: `c34b741e5f9880c2e25c45975a7f574b89d66051d8952ce5d38e300142435dd4`

## Remaining live gate

Load v5.3.13 in Edge and confirm a real own-Hatchery `Hatch Egg` target is dispatched and disappears/turns into a newly hatched pet after the Hatchery recheck. Also confirm normal Turn Egg eggs still open real profile tabs and friend Hatcheries never direct-dispatch hatches.
