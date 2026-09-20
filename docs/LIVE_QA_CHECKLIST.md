# Live OviPets QA Checklist

## Edge load/UI
- [x] unpacked extension loads in Microsoft Edge
- [x] panel initializes
- [x] Ninja Please observed working
- [x] Start database observed scanning/indexing/breeding
- [x] Full Sweep scans friends and detects turnable eggs

## v5.3.4 Name the Species
- [x] prompt observed from real UI-click Turn Egg tabs
- [x] explicit incorrect Error/network response captured
- [ ] wrong species excluded; Error dismissed; same egg retried; different species selected
- [ ] later success stored as positive visual mapping
- [ ] terminal `The egg can no longer be turned` closes only owned tab
- [ ] batch continues after terminal egg
- [ ] Export Species DB → clean/new Edge profile → Import restores learned mapping/Answer IDs

## Friend egg dedicated tab
- [ ] intended egg opens in extension-owned tab
- [ ] real Turn Egg control clicked
- [ ] retryable incorrect attempts remain in the same tab
- [ ] tab closes only after success or terminal exhaustion
- [ ] user-opened tabs never close

## Continuous Full Sweep
- [ ] pass 1 automatically starts/waits for pass 2
- [ ] cooldown wait resumes automatically
- [ ] Stop during cooldown opens no next friend
- [ ] Stop during active batch starts no new pass

## Pet catalog/database
- [x] enclosure scan observed
- [ ] final saved-record status observed
- [ ] database health shows non-zero present/catalog counts

## Hatchlings
- [ ] suitable target available
- [ ] Process Hatchlings tested end-to-end

## Worker recovery
- [ ] reload/close worker tab during run
- [ ] Stop clears durable state
- [ ] no stuck busy state / duplicate job

## Soak
- [x] focused Egg/Species/DB soak: 160/160 file executions PASS
- [x] full suite 56/56 passed three consecutive rounds
- [ ] multi-hour live OviPets soak


## v5.3.6 Watchdog / fail-open
- [ ] leave one owned egg tab unresolved >60s: it closes and records timeout
- [ ] leave a batch incomplete >120s: unresolved tabs close and Full Sweep advances
- [ ] observe a random egg-page/network failure: current friend is skipped safely, worker remains Running
- [ ] press Stop and confirm no watchdog restarts work


## v5.3.8 Diagnostic Logbook
- [ ] Run Full Sweep for an extended period, then Export Diagnostic Log.
- [ ] Confirm chronological worker/sweep/egg events are present.
- [ ] Observe a watchdog/fail-open event and confirm the reason is recorded.
- [ ] Stop Full Sweep manually and confirm stop/release events are present.
- [ ] Clear Diagnostic Log and confirm automation/database state is unchanged.


## v5.3.8 Protected coordinator
- [ ] Let Full Sweep hit a slow/stuck friend/egg batch and confirm the coordinator tab remains open.
- [ ] If recovery occurs, confirm Diagnostic Log contains `worker.lease-expired` then `worker.protected-recovery` and/or `worker.protected-reload`.
- [ ] Confirm recovery resumes the same pass/friend cursor, not pass 1.
- [ ] Press Stop and confirm the coordinator tab then closes normally.


## v5.3.9 Extension reload
- [ ] Reload extension from `edge://extensions` while an OviPets tab is open; console must not spam `Extension context invalidated`.
- [ ] Refresh the OviPets page once and confirm panel reports v5.3.9 and functions normally.
- [ ] Confirm Diagnostic Log contains no self-generated invalidation/rejection loop.


## v5.3.10 Orphan auto-recovery
- [ ] Observe/force a coordinator disappearance during Full Sweep; replacement coordinator appears automatically.
- [ ] Dashboard briefly shows `recovering`, then returns to `background`.
- [ ] Recovery resumes the same pass/friend cursor, not pass 1.
- [ ] Diagnostic Log contains `worker.protected-replacement-*` or `worker.orphan-recovery-*`.
- [ ] Old batch-timeout notice disappears after about 15 seconds.
