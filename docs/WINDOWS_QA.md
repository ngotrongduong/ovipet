# Windows Edge Manual QA

Use this checklist on the final RC after the automated suite is green. Use Microsoft Edge for this project. The helper script prefers Edge and uses an isolated temporary profile.

## 1. Automated + isolated Edge launch

From PowerShell in the extracted RC folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-smoke.ps1
```

The script:

1. runs JavaScript syntax verification;
2. runs release consistency verification;
3. runs the full Node regression suite;
4. finds Microsoft Edge in standard Windows locations (with Chrome as fallback);
5. opens an isolated temporary Edge profile with only this unpacked extension loaded;
6. opens OviPets.

It does not log in, press extension buttons, or mutate the game automatically.

## 2. Extension/UI smoke

In the temporary Edge profile:

- [ ] Log in to OviPets if required.
- [ ] Helper panel appears exactly once.
- [ ] Panel shows release `v5.3.1`.
- [ ] Collapse/expand and tooltips work.
- [ ] Activity card is initially idle when no durable job is active.
- [ ] Refreshing the OviPets tab does not create a duplicate panel.
- [ ] Browser console shows no uncaught OviPets Helper exception during idle navigation.

## 3. Safe worker lifecycle smoke

Use a read-oriented job such as **Update pet catalog** for the first worker test.

- [ ] Start creates one inactive worker tab.
- [ ] A second Start does not create a duplicate worker.
- [ ] Another job reports busy while the first owns the shared worker.
- [ ] Stop clears the activity state and closes the worker tab if it is still an OviPets worker tab.
- [ ] Start again works after Stop.

### User-navigation ownership guard

- [ ] Start a safe worker job.
- [ ] Manually navigate the extension-created worker tab to a non-OviPets page.
- [ ] Press Stop from the main OviPets tab.
- [ ] Job/lease becomes idle, but the user-navigated non-OviPets tab remains open.

## 4. Crash/recovery smoke

- [ ] Start a safe worker job.
- [ ] Close its worker tab manually without pressing Stop.
- [ ] Within the worker-health window, the UI returns to idle rather than staying stuck busy.
- [ ] The feature's durable `active` state is cleared.
- [ ] A fresh Start works afterward.

Optionally reload the extension from `edge://extensions` between runs and confirm an interrupted one-button job does not silently resume itself.

## 5. Live OviPets contracts still requiring evidence

These should be performed only when you deliberately choose to exercise the corresponding game action.

### Name the Species wrong-answer lifecycle

- [ ] Verification dialog is detected.
- [ ] Submitted choice is tracked.
- [ ] If a wrong answer is observed, that species is excluded for the same verification image.
- [ ] The dialog/retry flow re-arms rather than stalling.
- [ ] Correct completion ends the verification flow without duplicate submission.

Record exact observed DOM/behavior in `docs/LIVE_QA_CHECKLIST.md` / the current DOM audit.

### Friend egg dedicated-tab Turn Egg lifecycle

- [ ] Full Sweep identifies a genuinely turnable friend egg.
- [ ] At most 10 extension-created egg tabs open in one batch.
- [ ] Each tab opens the intended pet profile.
- [ ] The real visible Turn Egg control is present and is clicked.
- [ ] No hidden `pet_turn_egg` bridge command is used.
- [ ] Name the Species handling works if prompted.
- [ ] If an answer is rejected, the same answer is excluded and another is tried.
- [ ] Successful turn is confirmed by the Turn Egg button disappearing.
- [ ] Successful owned egg tab closes only after confirmation.
- [ ] Failed/unconfirmed tab remains available for inspection.
- [ ] User-created/unowned tabs are never closed.
- [ ] Merely browsing a friend's Hatchery does not auto-turn eggs.

## 6. Soak test

Run normal intended workflows for multiple hours and record:

- duration;
- approximate pet/friend counts;
- jobs exercised;
- worker crashes/reloads;
- stuck busy states;
- duplicate actions;
- unexpected tab closures;
- console errors;
- CPU/memory observations if notable.

Put the result in `docs/LIVE_QA_CHECKLIST.md`.

## Release decision

A green Node suite and successful Windows UI smoke are not substitutes for the two live OviPets contracts above. Do not mark the RC production-ready until the repository, manual/live and soak gates in `docs/RELEASE_CHECKLIST.md` are complete.

## 7. Publish the validated runtime to GitHub

After the RC and live checks are satisfactory, publish the complete runtime/test tree without overwriting the GitHub control-plane docs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github.ps1
```

The script clones the current `main`, overlays only the validated runtime/tests/tooling and historical evidence, reruns syntax + release + full tests in that clean clone, commits to a release branch and pushes it. If the default branch name already exists remotely it creates a timestamped branch rather than force-pushing.

Open the PR URL printed by the script and require GitHub Actions to pass before merge.
