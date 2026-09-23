# Live OviPets QA Checklist

Current release: **v5.3.12**

Record date, Edge version, extension version and non-sensitive evidence.

## Edge load/UI
- [x] unpacked extension loads in Microsoft Edge
- [x] content script/panel initializes after the `copyBlacklistCsv` wiring fix
- [x] Ninja Please observed working
- [x] Start database observed scanning/indexing/breeding
- [x] Full Sweep observed scanning friends and detecting turnable eggs

## v5.3.9: Name the Species learning / retry lifecycle
- [x] prompt detected from a real UI-click Turn Egg tab
- [x] explicit incorrect response observed in Inspector network trace
- [ ] wrong species is stored/excluded, Error dismissed, same egg is Turned again and a different answer selected
- [ ] success on a later guess is stored as positive visual mapping
- [ ] `The egg can no longer be turned` closes only the extension-owned tab as terminal
- [ ] Export Species DB then Import it into a clean profile and confirm learned mappings/Answer IDs restore

## v5.3.9: Friend egg dedicated tab
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
- [ ] v5.3.9 final status visibly says `saved X pet(s) to database`
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
- [x] focused Egg/Species/DB soak: 20 rounds × 8 files = 160 executions, 0 failures; full suite 59/59 passed current automated gate
- [ ] multi-hour live OviPets soak

See `docs/LIVE_QA_REPORT_2026-09-19.md` for the detailed findings that produced the current v5.3.9 learning flow.


## v5.3.3 Continuous Full Sweep
- [ ] Complete one full friend-list pass and observe automatic start of pass 2.
- [ ] If pass 1 finishes inside the 10-minute friend cooldown, observe waiting/cooldown status then automatic resume.
- [ ] Press Stop during a cooldown wait and confirm no next friend opens.
- [ ] Press Stop during an active friend/egg batch and confirm no new pass begins.


## v5.3.9 Watchdog / fail-open
- [ ] Leave one extension-owned egg tab unresolved for >60 seconds: it force-closes and records timeout.
- [ ] Leave a batch incomplete for >120 seconds: every unresolved owned tab closes and Full Sweep advances.
- [ ] Simulate/observe random egg-page load/network failure: current friend is skipped safely; Full Sweep remains Running.
- [ ] Confirm pressing Stop still stops immediately and no later watchdog restarts work.


## v5.3.7 Diagnostic Logbook
- [ ] Run Full Sweep for an extended period, then Export Diagnostic Log and confirm chronological worker/sweep/egg events are present.
- [ ] Trigger/observe one egg watchdog timeout and confirm `egg-tabs/tab.timeout` or batch timeout is recorded.
- [ ] Stop Full Sweep manually and confirm stop/release reason is recorded.
- [ ] Clear Diagnostic Log and confirm automation/database state is unchanged.


## v5.3.8 Protected coordinator
- [ ] Let Full Sweep run through a slow/stuck friend/egg batch and confirm the coordinator tab remains open.
- [ ] If recovery occurs, confirm Diagnostic Log contains `worker.lease-expired` followed by `worker.protected-recovery` and/or `worker.protected-reload`.
- [ ] Confirm recovery resumes the same pass/friend cursor instead of resetting to pass 1.
- [ ] Press Stop and confirm the coordinator tab then closes normally.


## v5.3.9 Extension reload
- [ ] Reload extension from `edge://extensions` while an OviPets tab is open; console must not spam `Extension context invalidated`.
- [ ] Refresh the OviPets page once and confirm panel reports v5.3.11 and functions normally.
- [ ] Confirm Diagnostic Log contains no self-generated invalidation/rejection loop.

## v5.3.10 Orphan auto-recovery
- [ ] Force/observe one coordinator tab disappearance while Full Sweep remains active; a replacement coordinator should appear automatically.
- [ ] Confirm dashboard briefly shows `recovering`, then returns to `background`.
- [ ] Confirm pass/index resumes from the same friend rather than resetting to pass 1.
- [ ] Confirm Diagnostic Log contains `worker.protected-replacement-*` or `worker.orphan-recovery-*` events.
- [ ] Confirm a batch timeout notice disappears after roughly 15 seconds and does not imply the sweep itself stopped.


## v5.3.12 Ninja + Ads friend discovery

- [ ] On `#!/OviPets`, confirm **Scan Ninja + Ads** detects both `Ninja please` and `Ads post` regardless of which appears first.
- [ ] Confirm users commenting within the last 24 hours in either post enter one combined queue.
- [ ] Confirm the same User ID appearing in both posts is queued once.
- [ ] Confirm an ID already present in friend-request history is not queued from either post.
- [ ] Confirm a user older than 24 hours is not queued.
- [ ] Temporarily make one target unavailable and confirm the other still scans.
- [ ] Confirm scan sends no request until **Send friend requests** is pressed.

## v5.3.11 Fast Sweep
- [ ] On a friend with >30 turnable eggs, observe several batches without Hatchery reload between them.
- [ ] Confirm exactly one final Hatchery reload/verification after the snapshot queue drains.
- [ ] Observe adaptive concurrency begin at 10 and promote toward 12/15 after clean full batches.
- [ ] If a tab timeout occurs, confirm remaining queued eggs at that friend continue processing and concurrency backs off.
- [ ] Export Diagnostic Log and confirm `owehEggTabConcurrency` / `owehEggSpeedProfile` are present.
- [ ] Compare elapsed time for a high-egg friend with the previous build.
- [ ] In DevTools Network on a sweep-owned egg tab, confirm normal pet images/fonts/media are blocked while HTML/JS/XHR continue.
- [ ] Confirm Name-the-Species still learns/fingerprints when the page challenge image itself is not rendered.
- [ ] Run a long sweep and compare Edge RAM growth against v5.3.10; confirm tabs stay responsive longer.
- [ ] If batch latency rises above ~35–50s, confirm adaptive concurrency backs off from 15 → 12 → 10 as needed.
