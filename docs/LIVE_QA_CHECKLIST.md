# Live OviPets QA Checklist

Record date, Edge version, extension version and non-sensitive evidence.

## Edge load/UI
- [x] unpacked extension loads in Microsoft Edge
- [x] content script/panel initializes after the `copyBlacklistCsv` wiring fix
- [x] Ninja Please observed working
- [x] Start database observed scanning/indexing/breeding
- [x] Full Sweep observed scanning friends and detecting turnable eggs

## v5.3.1: Name the Species wrong-answer lifecycle
- [ ] prompt detected from a real UI-click Turn Egg tab
- [ ] wrong option observable/rejected
- [ ] wrong option remembered/excluded
- [ ] another option is attempted on the reused dialog
- [ ] correct completion observable
- [ ] no duplicate submission

## v5.3.1: Friend egg dedicated tab
- [ ] extension-created tab opens intended egg
- [ ] real Turn Egg control present
- [ ] extension clicks the real Turn Egg button
- [ ] species prompt handled if present
- [ ] tab remains open until Turn Egg is confirmed complete
- [ ] extension verifies ownership before closing
- [ ] user-opened tabs never close

## Own Hatchery egg flow
- [ ] own Hatchery opens max 10 egg profile tabs per batch
- [ ] no hidden `pet_turn_egg` command is used
- [ ] each owned tab closes only after confirmation
- [ ] merely browsing a friend's Hatchery does not auto-turn eggs

## Pet catalog/database
- [x] Update pet catalog navigates/scans all visible enclosures
- [ ] v5.3.1 final status visibly says `saved X pet(s) to database`
- [ ] Refresh database health shows non-zero present/catalog counts after the scan

## Hatchlings
- [ ] suitable newly hatched pet available
- [ ] Process hatchlings tested end-to-end

## Worker recovery
- [ ] reload/close worker tab during run
- [ ] Stop clears durable state
- [ ] no stuck busy state
- [ ] no duplicate job

## Soak
- [x] automated regression soak: 20 rounds × 51 files = 1,020 executions, 0 failures
- [ ] multi-hour live OviPets soak

See `docs/LIVE_QA_REPORT_2026-09-19.md` for the detailed findings that produced v5.3.1.
