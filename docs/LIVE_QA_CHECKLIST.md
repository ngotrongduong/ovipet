# Live OviPets QA Checklist

Use this only for manual verification against the live site. Never put account secrets, session cookies or private identifiers in this file.

## Environment

- Date:
- Chrome version:
- Extension version/commit:
- OviPets UI variant/notes:

## P1 contracts

### Name the Species — wrong answer

- [ ] Prompt detected.
- [ ] Candidate option submitted.
- [ ] Wrong-answer state is observable and documented.
- [ ] Incorrect option is remembered/excluded.
- [ ] Retry does not loop the same option.
- [ ] Correct answer completion is observable.
- [ ] No duplicate submission after completion.

Evidence/notes:

### Friend egg — dedicated tab

- [ ] Extension-created tab opens the intended egg.
- [ ] Turn Egg control is present in the expected page state.
- [ ] Turn Egg dispatch succeeds.
- [ ] Completion is observable (button/state changes).
- [ ] Name the Species is handled if present.
- [ ] Tab closes only after extension verifies it still owns the same egg tab.
- [ ] User-opened tabs are never closed.

Evidence/notes:

## Worker recovery

- [ ] Start a long-running job.
- [ ] Reload worker tab during start/running.
- [ ] Close worker tab unexpectedly.
- [ ] Stop from UI.
- [ ] Restart/reload extension where safe.
- [ ] No stuck busy state remains.
- [ ] No duplicate job continues in another tab.

## Feed/request confirmation

- [ ] Simulate/observe a dispatch that does not complete where possible.
- [ ] Extension does not persist false confirmed success.
- [ ] Confirmed DOM/profile refresh updates final state.

## Soak test

- Duration:
- Pet DB size:
- Friend count:
- Egg tab concurrency:
- Errors/timeouts:
- Stuck jobs:
- Memory/CPU observations:
- Final result:
