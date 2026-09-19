# Live OviPets QA Checklist

Record date, Edge version, extension version and non-sensitive evidence.

## Edge load/UI
- [x] unpacked extension loads in Microsoft Edge
- [x] content script/panel initializes after the `copyBlacklistCsv` wiring fix
- [x] Ninja Please observed working
- [x] Start database observed scanning/indexing/breeding
- [x] Full Sweep observed scanning friends and detecting turnable eggs

## v5.3.2: Name the Species wrong-answer lifecycle
- [x] prompt observed from a real UI-click Turn Egg tab
- [x] wrong answer produces separate Error dialog
- [x] latest live rule confirmed: Error makes that egg non-turnable in that tab
- [ ] v5.3.2 records the wrong answer then closes the owned tab without retrying
- [ ] batch continues with other eggs and does not reopen the exhausted egg during the same visit
- [ ] export Species Inspector JSON after collecting several quiz sessions

## v5.3.2: Friend egg dedicated tab
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
- [ ] v5.3.2 final status visibly says `saved X pet(s) to database`
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
- [x] automated focused Egg/Species soak: 20 rounds × 8 files = 160 test-file executions, 0 failures
- [ ] multi-hour live OviPets soak

See `docs/LIVE_QA_REPORT_2026-09-19.md` for the detailed findings that produced v5.3.2.
