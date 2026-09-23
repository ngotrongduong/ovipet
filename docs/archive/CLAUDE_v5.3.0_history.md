# OviPets Hatchery & Breeding Helper

A single Chrome Manifest V3 extension (no build step, no framework) that adds a helper
panel to the OviPets browser game at https://ovipets.com/. See [README.md](README.md) for
the full feature list.

## Files

- `manifest.json` — MV3 config, permissions (`storage`, `tabs`), content script registration.
- `content.js` — all logic: the injected panel, egg-turning automation, friend sweep,
  Ninja Please friend requests, breeding-partner ranking. One IIFE, no modules, no build.
- `content.css` — styling for the injected `#ovipets-hatchery-helper` panel.
- `background.js` — service worker. Hosts the transactional IndexedDB core (pet records,
  command journal, task leases) and, as of v5.0.0, the single shared worker-tab claim
  (`claimWorker`/`releaseWorker`/`getWorkerStatus`) that every long-running feature
  (friend sweep, Daily Maintenance, breed campaign, standalone pet indexing, hatchling
  processing) uses instead of each spawning its own dedicated tab.
- `jobs/*.js` — one module per job, loaded by the manifest **before** `content.js` and
  sharing its isolated world through the global `OWEH` registry (`jobs/core.js`:
  `register/boot/runHook/get/collect`). `runner.js` is the shared plumbing (`createJob`:
  claim the shared tab, `waitForGameReady`, cancellation, error reporting, release). Job
  files: `catalog`, `profiles`, `sort`, `feed`, `ninja`, `requests` (the six one-button jobs
  that replaced Daily Maintenance in v5.2.0) and `species-answer` (the always-on Name the
  Species answerer). A module reaches legacy content.js code only through the `legacy`
  object passed to `OWEH.boot` — that list is the whole contract. **Rules:** every button =
  one job; no job starts another; one-button jobs keep no storage flag (the shared-worker
  lease says whether they run); call `waitForGameReady` before reading/sending. Legacy code
  migrates out of content.js one job at a time.
- `bg/egg-tabs.js` — imported by background.js (`importScripts`). Opens/closes the browser
  tabs used to turn eggs during **Start full sweep** (v5.3.0): batches of up to 10, one tab per
  egg. **Rule: only tabs this file opened are ever closed** — every tab id lives in the
  `owehEggTabs` registry and `closeOwnedTab` refuses anything not in it (a tab the player
  opened must survive even if it is on ovipets.com). Only the sweep's worker tab may open a
  batch. `jobs/friend-eggs.js` is the per-friend batch loop in that worker tab and
  `jobs/egg-turn-tab.js` runs inside each egg tab (a tab not in the registry does nothing).
  The sweep never turns friend eggs from its own tab any more. Unverified live: friend egg
  page has a Turn Egg button (docs/eyes-ai-brief.md #8).
- `docs/pure-breeding-guide.md` — reference notes on OviPets' community pure-breeding
  mechanics (lock colors, lock groups, cross-breeding, pedigree/inbreeding checks, naming
  conventions). Read this before changing the breeding-rank algorithm.
- `.claude/agents/oweh-regression-reviewer.md` — read-only reviewer scoped to this
  project's actual recurring bug classes (see its own file for the checklist). Run it after
  any non-trivial content.js change.
- `.claude/skills/eyes-ai-brief/` — drafts new `docs/eyes-ai-brief.md` questions and
  integrates returned site-operator answers back into content.js + `docs/dom-audit-*.md`.
- `.claude/skills/bump-version/` — keeps the three version locations
  (`manifest.json`, content.js's panel title, README.md's H1) in sync.

## Conventions

- Reply to the user in Vietnamese (Tiếng Việt) by default in this repository.
- **UI-driven automation only.** Never call OviPets' APIs or send network requests
  directly — every action must go through the game's own visible buttons/links, the same
  way a human would click them. This is a hard constraint, not a style preference.
- **User-started, stoppable, rate-limited.** Every automation loop must have a visible
  Stop control and a conservative delay between actions — don't remove these to make
  something "faster." Any loop that performs a real, consequential, non-undoable action
  (friend removal + blacklisting, breeding) must additionally require an explicit button
  press to ever transition from inactive to active — auto-*resuming* an already-active run
  after a reload is fine, auto-*activating* a dormant one from a page load alone is not
  (see v4.3.0's `maybeAutoStartSweep` fix). Plain egg-turning is the one intentional
  exception: auto-starting on Hatchery open is this extension's core, documented, low-
  stakes purpose (turning your own eggs), not a gap to close.
- Data (saved pets, species-answer memory, friend cooldowns, target colors) lives in
  `chrome.storage.local` under `oweh*`-prefixed keys. Keep that prefix for new keys.
- This is a small, single-file project — prefer editing `content.js` in place over adding
  new files or a build pipeline.
- DOM selectors here are reverse-engineered from the live site and can drift if OviPets
  changes its markup. When a selector's correctness is uncertain, say so rather than
  asserting it will work, and prefer feature-detecting the actual button/text over
  hard-coding fragile structural selectors.
- **`runToken` is a shared cancellation counter for one specific, intentionally-coupled
  group**: egg turning (`processEggRun`) and friend sweep, where a Stop in one is meant to
  cancel the other too. This exact class of mistake — reusing one shared token/flag across
  two unrelated features and having either one's Stop silently cross-cancel the other's
  in-progress wait — shipped in v3.3.0 (fixed in v3.4.1 by giving the breed campaign its
  own `breedRunToken`). As of v5.0.0, the breed campaign, Daily Maintenance, standalone pet
  indexing, and hatchling processing no longer use a token at all for this purpose — they
  claim the shared worker tab (`claimWorker`/`isWorkerOwner`, see the Files section above)
  and derive cancellation from `currentWorkerOwner`/`currentWorkerGeneration` instead. A
  new long-running feature should join that shared-worker claim model rather than
  inventing its own token; `runToken` itself should stay scoped to the egg-turning/sweep
  pair it already coordinates.
- **Never guess a selector for a page/flow no one has actually inspected.** If a feature
  needs DOM from a page not yet confirmed, write the exact question into
  `docs/eyes-ai-brief.md` instead of shipping a guessed selector — the Game Owner relays
  that file to a separate site-operating AI that can log in and report back. This has
  already burned a session (see git history: the pedigree/pure-color selectors were
  guessed and flagged, not asserted).

## Strict female-first auto-breed campaign (v4.6.0)

`scanBreedableOverview` now scans every Overview enclosure and starts the storage-backed
`owehPetIndex` campaign. The index opens every profile and records ownership, cooldown,
gender, species, five color slots, and visible ancestors. When `owehAutoRename` is enabled,
it also applies the compact `BODY1-BODY2-SCALES` name through the inspected Edit → Rename
dialog. The 20-character three-code format fits the game's `maxlength="25"`.

`startBreedCampaign` selects breedable indexed females from the seven dedicated pure-line
enclosures and restricts the campaign to the dominant species in that cohort. For each
female, `collectBreedingCandidatesAcrossEnclosures` cycles every
`select[name="enclosure"]` option in the live Breeding section. Male order uses
`pairPureMetrics`: pairs that can reach all 15 fixed target channels this generation first,
then estimated interval probability, locked channels, reachable channels, exact target
copies, interval width, and finally `pairScore` distance. Related pairs are skipped using
direct-ancestor and shared-visible-ancestor checks. A successful breed advances to the
next female; a failed UI attempt leaves the female active so another male can be tried.
Progress is stored in
`owehBreedCampaign`; successful pairings are appended to `owehBreedHistory`.

Two live owner-authorized tests confirmed father `155631245` could breed consecutively:
mother `153899995` created egg `530113646`, then mother `156913384` created egg
`530114643`, both immediately at `pet=last`. Each mother received a two-day cooldown
heart; the father did not. Therefore each male can continue through all available females
before the campaign advances to the next-ranked male.

**Never auto-start breeding.** Every pairing is real and non-undoable, so only the explicit
Start button may activate `owehBreedCampaign`. Keep the Stop control and the separate
`breedRunToken` cancellation path.

Remaining known gap: the Unofficial pure-color list still requires joining forum group
8966. Do not claim that list has been captured.

## Full-repo cross-automation audit (v4.3.0)

Requested by the Game Owner after the v4.2.3 incident: "check the whole codebase for
places where features silently interfere with or break each other." Ran the
`oweh-regression-reviewer` charter as a full-file audit (not a diff) over both
content.js and background.js. Three real findings acted on:

1. **`maybeAutoClickProfileTurnButton` had the same reentrancy-guard-timing bug** as the
   already-fixed functions: `autoClickingTurn = true` was set *after*
   `await Promise.all([readEggRun(), readBreedCampaign(), storageGet("owehPetIndex", ...)])`
   instead of before it. Fixed to match the established pattern (flag set synchronously,
   before any await).
2. **`processEggRun`'s pet-profile branch had no cross-automation ownership check**,
   unlike its sibling `maybeAutoClickProfileTurnButton` (which already checks
   `breedCampaign.active`/`petIndex.active` before acting). If a user ran egg-turning
   concurrently with the pet-index scan or breed campaign, and one of those navigated to a
   pet profile that happened to have a live Turn Egg button, `processEggRun` would click it
   as an unintended side effect and then force-navigate back to `run.hatchery` — yanking
   the page out from under whichever campaign was mid-step there, stalling it silently.
   Fixed by adding the same `breedCampaign.active || petIndex.active` check before acting,
   pausing (not clicking, not navigating away) until the other automation releases the
   page.
3. **`maybeAutoStartSweep` could activate a full sweep — including real, permanent friend
   removal + blacklisting — from a page load alone**, with no "Start full sweep" press
   ever required: if `owehFriendQueue` existed from an earlier "Scan friend list" (Start
   never pressed), simply opening any friend's Hatchery for any unrelated reason would
   flip `owehSweep.active` to `true` and, if that friend's Hatchery was empty, remove and
   blacklist them. This was pre-existing, documented behavior (README: "opening any Friend
   Hatchery automatically restores the sweep"), not something introduced this session —
   but it violates this file's own "user-started, explicit button press" rule for real,
   non-undoable actions. Game Owner chose to fix it: `maybeAutoStartSweep` now only
   *resumes* an already-`active` sweep (e.g. after a reload mid-sweep); it never flips
   `active` from false to true itself. Only `startFriendSweep` (the Start button handler)
   may do that now. README's wording for this was corrected to match.

Checked and found clean: token isolation (`runToken`/`breedRunToken`, no cross-
contamination), refresh()-reachable DOM writes (all either conditional-branch-only or
compare-before-write), and the `owehFriendRemoval` shared-flag fix from v4.2.3 (still
correctly using `claimedByBackground`, no regression). `maybeAutoStartEggRun`'s
long-standing auto-start-on-Hatchery-open behavior was flagged but *not* changed — it's
this extension's core, documented, low-stakes purpose (turning your own eggs), unlike the
sweep's real-and-permanent friend removal; this file's "user-started" wording above refers
to genuinely consequential automation, not this baseline behavior.

## Auto-navigate to scan Ninja Please (v4.3.1)

Game Owner reported the Ninja Please post always lives at the fixed hash
`#!/OviPets`, so **Scan Ninja Please (24h)** no longer requires manually
browsing there first. `scanNinjaChat` now checks `isOviPetsChatPage()`: if
already there, it scans immediately (unchanged); otherwise it stashes the
current hash in `owehChatScanRequest` (`{ active, returnHash }`) and calls
`navigateTo("#!/OviPets")` — still a same-site hash change through the game's
own SPA router, not a direct API call, so this stays within the UI-driven-
automation constraint. `maybeContinueChatScan()` (wired into `refresh()`)
picks up once `isOviPetsChatPage()` becomes true, runs the actual scan
(factored out into `performNinjaChatScan`), and navigates back to
`returnHash` so the Game Owner ends up where they started.

Before navigating away, `scanNinjaChat` checks `owehSweep`, `owehBreedCampaign`,
`owehPetIndex`, and `owehRequestRun` for `active: true` and refuses (with a
status message) if any are running — otherwise this new auto-navigation would
yank the page out from under whatever multi-step campaign is mid-navigation
elsewhere, the same class of bug the v4.3.0 audit fixed for `processEggRun`.

For the standalone **Scan Ninja Please** control, this still automates only the scan step;
**Send queued requests** remains available separately. v4.9.0 additionally makes the
explicit **Run daily maintenance now** button perform both scan and send in one authorized
run. The retired recurring alarm is cleared, so this combined friend-request flow never
starts solely because the browser launched.

## Friend removal never actually ran, at all, since v4.1.0 (v4.2.3)

Worse than the v4.2.2 symptom: the v4.1.0 duplicate-tab guard in `background.js`'s
`openFriendRemovalTab` handler checked the bare `owehFriendRemoval.active` flag — but
`finishFriendSweepStep` (content.js) already writes `owehFriendRemoval: {active: true, ...}`
to storage *before* it sends that message, specifically so its own guard can see it.
Background.js's handler therefore always found `active: true` already set (by that very
request) and returned immediately without ever calling `chrome.tabs.create` — the worker
tab never opened, `processPendingFriendRemoval` never ran anywhere, no friend was ever
blacklisted, and the flag only ever cleared via the sweep-side staleness timeout (v4.2.2),
which is why the sweep looked "stuck" rather than obviously broken.

Fixed by giving background.js its own claim marker, `claimedByBackground: true`, set only
by background.js itself after it accepts a request — its dedup check now tests
`removal.active && removal.claimedByBackground` instead of bare `removal.active`, so
content.js's own pre-send flag no longer self-blocks it. **Lesson for next time**: when
two sides (content.js and background.js) both read/write the same storage flag for
different purposes (intent-to-act vs. dedup-check), give each side its own field rather
than overloading one shared boolean — this is worth adding as a fifth check to
`oweh-regression-reviewer` if this shape recurs elsewhere.

## Full sweep silently stopped advancing (v4.2.2)

Regression introduced by the v4.1.0 duplicate-tab fix: the `owehFriendRemoval.active`
check added to `finishFriendSweepStep` had no expiry. If that flag was ever left stuck at
`active: true` — e.g. the extension reloaded mid-removal, or the worker tab was closed
before finishing — every future call to `finishFriendSweepStep` would see "a removal is
pending" and return early forever, so `advanceFriendSweep()` never ran again and the sweep
silently stopped moving to the next friend. Fixed by stamping `startedAt: Date.now()`
whenever the flag is set (both in `finishFriendSweepStep` and in `background.js`'s
`openFriendRemovalTab` handler) and treating it as stale — safe to clear and proceed —
after `FRIEND_REMOVAL_TIMEOUT_MS` (45s). Also fixed the same reentrancy-guard-timing bug
in `finishFriendSweepStep` itself (`finishingFriend` was set after `await readSweep()`
instead of before it) while already in this function.

Immediate manual recovery if a sweep is stuck *right now*: press Stop sweep, then Start
full sweep again — `stopFriendSweep` already resets `owehFriendRemoval` unconditionally.

## Project tooling + a live bugfix (v4.2.1)

Added the three files listed at the top under "Files" (`oweh-regression-reviewer` agent,
`eyes-ai-brief` and `bump-version` skills) — a small, project-specific set the Game Owner
asked for, deliberately proportional to a single-file extension (compare: an unrelated,
oversized agent/rule/skill set from a different project was found dumped into `.claude/`
earlier this session and deleted).

While researching what the reviewer agent should check for, found and fixed a live
instance of the exact reentrancy-guard-timing bug it's designed to catch:
`processPendingFriendRemoval` set `processingFriendRemoval = true` *after*
`await storageGet(...)` instead of before it — the same class of bug `runToken`
cross-cancellation and the v3.1.0 freeze both belong to (a guard/state check separated
from its own write by an `await`, leaving a window for a second `refresh()` tick to slip
through). Fixed to set the flag synchronously right after the initial guard, matching
`processEggRun`'s existing correct pattern; no other logic in the function changed.

## Friend removal: single worker tab + permanent blacklist (v4.1.0)

Bug fixed: `finishFriendSweepStep` had no check for an already-in-flight removal, and
`refresh()` re-runs on every DOM mutation — so while the worker tab for one removal was
still loading, the Game Owner's Hatchery tab kept re-detecting "zero eggs, sweep active"
and sending a fresh `openFriendRemovalTab` message each time, and `background.js` opened a
new tab for every single one of them. Fixed at both layers: `finishFriendSweepStep` now
reads `owehFriendRemoval` and bails if a removal is already `active`, and
`background.js`'s handler independently checks the same flag before calling
`chrome.tabs.create` — either guard alone would have been enough, both stay for defense in
depth.

## Species-verification guessing (v4.2.0)

The "Name the Species" dialog previously only auto-answered from `readVisibleSpecies()`
(ground truth, when visible) or a confident memory match (`learnedSpecies`: 2+ prior hits,
≥75% agreement); otherwise it just waited for the Game Owner to click manually. It now
also actively guesses when neither is available: `pickUntestedSpeciesOption` picks randomly
among the dialog's options, excluding any species already recorded as *wrong* for this
exact image (matched by `speciesMemoryKeys` — source URLs plus a 16×16 perceptual
fingerprint, unchanged). `owehSpeciesMemory[key]` now tracks both `votes` (confirmed
right) and `wrong` (confirmed wrong) per key, plus a one-time 64×64 JPEG `image` thumbnail
saved the first time that key is ever seen — `recordSpeciesOutcome` is the single function
that updates all of this, replacing the old positive-only `rememberSpeciesAnswer`.

**Outcome detection is inferred, not confirmed live**: `waitForProfileTurnChange` treats a
guess as *wrong* if the exact same dialog DOM element is still present on a later loop
pass (assumes a wrong click leaves the same "Name the Species" dialog open rather than
closing it or swapping in an unrelated one), and as *correct* only at the same checkpoint
the pre-existing manual-choice path already used (the turn's own success signal — the Turn
Egg button actually gone), not the instant the dialog stops matching. If real usage shows a
wrong guess behaves differently (e.g. the dialog closes anyway, or a fresh challenge
replaces it), this detection needs revisiting — don't assume it's exactly right without a
live check.

Added `owehFriendBlacklist` (`chrome.storage.local`, `{ [userId]: { at, reason } }`,
permanent, no expiry unlike the 10-minute cooldown map): every friend removed for zero
eggs, and every queued friend found to already not be a friend anymore, is added.
`nextEligibleFriendIndex` and `scanFriends` both skip blacklisted ids, so a full sweep
never re-selects them. `copyBlacklistCsv` copies it to the clipboard for pasting elsewhere
(e.g. a spreadsheet) — deliberately not a live Google Sheets integration, since that would
need OAuth/API credentials this extension has no other reason to hold.

## Hatchery naming and seven-enclosure sorter (v4.6.0)

Live inspection on 2026-09-18 confirmed Hatchery eggs render with `size=80` while newly
hatched pets render with `size=120`. An unnamed hatchling exposes a top-level `Name`
button; its `section#edit select[name="Enclosure"]` is disabled until naming succeeds.
After naming, the same select becomes enabled and changing it calls `pets_enclosure`.
The supported exact option labels are `FF ** **`, `** FF **`, `** ** FF`, `FF FF **`,
`FF ** FF`, `** FF FF`, and `FF FF FF` (plus `Newborn`).

`processHatchlingRun` is a storage-backed two-phase state machine. Phase 1 names all
detected hatchlings and immediately moves matching females. It collects matching males;
phase 2 compares them with indexed males already in each enclosure, stores
`owehBestMales`, and moves only a winning newcomer. `classifyNewbornName` accepts one,
two, or three `FF` pairs from Body 1. `00` is not a match because this campaign's Body 1
target is fixed at `#FFFFFF`.

`startNewbornSort` still provides an Overview cleanup pass for females and now uses the
same seven-enclosure map. Retention scoring is review-only and must never delete pets.

`enclosureSelect` now starts with the confirmed selector
`section#edit select[name="Enclosure"]`, retaining the older feature-detection fallbacks
only for markup drift.

## Daily cached maintenance and UI-command bridge (v4.7.0)

Opening Overview must never auto-start or restore sorting. `owehNewbornSort.restoring`
is no longer used to reactivate the Newborn tab. In v4.9.0 the combined run starts only
from **Run daily maintenance now**, opens one inactive background-owned Overview tab,
scans every enclosure, and refreshes only pet profiles that are new, incomplete, or have
a changed Overview `modified=` marker. Upgrade startup clears the retired recurring alarm.

`page-bridge.js` runs in the page's MAIN world and accepts only explicitly observed
commands. The isolated content script communicates with JSON-only
custom events. Live HTML confirmed that the game itself invokes:

- `ui_action_cmdExec('pets_enclosure', 'PetID=<id>', form)` with `Enclosure=<id>`;
- `ui_action_cmdExec('pet_rename', 'PetID=<id>', form)` with `Name=<name>`;
- `ui_action_cmdExec('pet_turn_egg', 'PetID=<id>', form)`;
- `ui_action_cmdExec('pet_feed', 'PetID=<id>', form)`;
- `ui_action_cmdExec('friend_request', 'UserID=<id>', form)`;
- `ui_action_cmdExec('friend_remove', 'UserID=<id>', form)`;
- `ui_action_cmdExec('pet_breed', 'MotherID=<id>&FatherID=<id>', form)`.

The bridge validates numeric targets and command-specific parameter names. Never add a
generic arbitrary-command or arbitrary-parameter pass-through.

## Direct daily actions (v4.9.0)

The v4.8.0 Mass Feed implementation is retired because it spends scarce Credits. A live
owned-pet profile at 96% Food exposed the free action:

`ui_action_cmdExec('pet_feed', 'PetID=155811841', form, callback)`

The live test changed Food from 96% to 100%. Daily Maintenance now iterates cached owned
Pet IDs, sends `pet_feed` with a minimum 600ms delay, and never calls `pets_massfeed`.
It then scans Ninja Please, excludes duplicates/history/self/explicit no-request comments,
and sends `friend_request` directly with a 3-second delay. Request history is persistent.
Zero-egg friend removal uses the confirmed `friend_remove` action without worker tabs.

## Species-verification attention handoff (v4.10.0)

An unknown Name the Species dialog sends `speciesVerificationRequired` to the service
worker once per dialog. The worker activates the exact sender tab, focuses its window,
and asks `offscreen.html`/`offscreen.js` to play a short three-note Web Audio alert. The
offscreen document exists only for audio playback and receives no page data.

The content script records the selected species after `pet_turn_egg` reports success,
then resumes the pending queue. One confirmed hit at 100% confidence is sufficient for
future automatic reuse. Entries with a recorded wrong vote for their current species are
never auto-selected. `owehSpeciesAlertSound` controls audio only; tab activation remains
enabled so a background verification cannot stall invisibly.

(Note: intermediate versions through v4.21.0 changed this further — see README.md's
changelog for `docs/manual-species-handoff-v420.md` and `docs/same-tab-species-v421.md` —
this CLAUDE.md file wasn't kept in sync with every one of those; README.md is the more
current source for the exact current dialog-handling behavior as of any given version.)

## Auto-answered Name the Species; Next relayed to the sweep's real worker tab (v4.22.0)

Game Owner report: the friend sweep opens one friend's Hatchery, then just stops
advancing, and Stop sweep / Next / Start full sweep "sometimes don't really work."

Root cause of the stall: v4.21.0's Name-the-Species handling (`monitorSpeciesDialog`)
only activated the tab, played an alert, and then waited — via `waitForTurnCommand`'s
`speciesDialog()?.offsetParent !== null` loop condition — for a human to click an
option and press OK, with no timeout. **Start full sweep** always runs the sweep from a
separate, inactive background worker tab (see v4.16.0), so when this dialog appeared
there, nobody was watching it and the queue hung forever: `processEggRun` never finished,
so it never reached its `finishFriendSweepStep()` call, so `advanceFriendSweep()` never
ran. This is the same *shape* of bug as the v4.2.2/v4.2.3 "sweep stopped advancing"
incidents (a step that silently never calls the function that continues the chain), just
with a different concrete cause. Fixed: `monitorSpeciesDialog` now calls the new
`autoAnswerSpeciesDialog`, which reuses a known-correct `owehSpeciesMemory` answer when
one exists (never one recorded wrong for that exact image), otherwise clicks a random
untested option, then clicks OK itself — the same two real clicks a human would make, so
the existing document-level capture-phase click listener still records the outcome via
`pendingSpeciesChoice`/`recordSpeciesOutcome` unchanged. The old alert-and-wait path is
kept only as a fallback for the case OK isn't present yet when the watcher first fires.

Root cause of Next/Stop/Start "not working": **Next**'s handler (`goToNextFriend`) always
assumed it was running in the sweep's owner tab — reading and rewriting `owehSweep`
and calling `navigateTo()` locally — but the owner is always the separate worker tab
`startFriendSweep(true)` created, which is essentially never the tab the Game Owner is
actually looking at and clicking from. Pressing Next from any other tab silently did
nothing useful (or raced the worker's own storage writes). Fixed by adding
`requestGoToNextFriend`, now bound to the button: it checks `ownedByThisTab(sweep)` and,
if false, sends a `relaySweepSkip` message that background.js forwards to the real
worker tab as `goToNextFriendFromBackground` — mirroring the relay `stopFriendSweep`
already used for Stop. Both relays (`sendSweepSkip`, matching the existing
`sendSweepStart`) now retry for a few seconds instead of firing once, since the worker
tab navigates to a new friend Hatchery for every step and can briefly not have its
content script ready when a relay message arrives.

**Never reintroduce the old "wait forever for a human" species behavior inside a
worker/background tab context** — if a future change needs a human-reviewable species
answer again, gate it to tabs the Game Owner is actively viewing, or add an explicit
timeout that falls back to `autoAnswerSpeciesDialog`, so a background campaign can never
depend on someone noticing an alert in a tab they aren't looking at.

## Unified shared worker tab; retired Newborn Sort; auto-start scope cut (v5.0.0)

Full architectural redesign, requested after the Game Owner reported the friend sweep
still stopping after the first friend post-v4.22.0, and that Daily Maintenance's
background tab "just kept running" with no reliable way to stop it. A full-codebase audit
found both were symptoms of one structural gap, not separate bugs: two independent,
ad-hoc worker-tab subsystems (`owehSweepWorker` for the sweep, `owehDailyWorker` for
Daily Maintenance), each with its own launch function, its own non-atomic
`chrome.storage.local` check-then-set race, its own one-shot cleanup alarm (4h/1h), and
inconsistent ownership-guarding across the features that used worker tabs. **This
section supersedes the worker-tab mechanics described in v4.22.0 above** — `sendSweepSkip`,
`sendSweepStart`, `launchSweepWorker`, `startSweepWorker`, `SWEEP_WORKER_CLEANUP_ALARM`,
`launchDailyWorker`, `startDailyWorker`, `sendDailyStart`, `DAILY_WORKER_CLEANUP_ALARM`,
`owehSweepWorker`, and `owehDailyWorker` are all gone; `ownedByThisTab(sweep)`/
`ownedByThisTab(campaign)` were replaced by `isWorkerOwner(owner)` since those two
features' progress records no longer carry `ownerTabId`/`ownerInstance` fields. The
v4.22.0 section's *narrative* (why the sweep stalled, why Next needed a relay) is still
accurate; only the specific function/constant names it cites have moved.

**New shared worker-tab core** (background.js): one well-known row, `id: "shared-worker"`,
in the *existing* IndexedDB `tasks` store — reusing its already-atomic read-modify-write
transaction instead of the old non-atomic pattern. `claimSharedWorker`/
`attachSharedWorkerTab`/`updateSharedWorkerPhase`/`releaseSharedWorker` manage the lease;
`claimWorker`/`releaseWorker`/`getWorkerStatus`/`workerPhase`/`workerDone` are the message
handlers content.js talks to. A `chrome.storage.local` key, `owehWorker`, mirrors the
lease reactively (IndexedDB writes don't fire `chrome.storage.onChanged`, which the
activity dashboard depends on). One recurring `oweh-worker-health` alarm (1 minute)
replaces both old cleanup alarms — `checkWorkerHealth` releases a lease whose
`leaseUntil` lapsed with no heartbeat (tab closed, crashed, or silently discarded by
Chrome's own tab-lifecycle manager, which fires no `onRemoved` event for a discard) and
**must** also call `clearOwnerActiveFlag(current.owner)` when it does — a first version of
this fix that only released the lease without clearing the feature's own `active` flag
left e.g. `owehSweep.active` stuck `true` forever after a crash, reproducing the exact
v4.2.2 "silently stops advancing" shape through the new code path. `clearOwnerActiveFlag`
also has a `WORKER_OWNER_DEPENDENT_KEYS` map for owners whose claim covers sub-runs of
other storage keys (Daily Maintenance's `owehFeedRun`/`owehRequestRun`), so a crash
mid-sub-lane doesn't leave that sub-lane's own `active` flag orphaned either.

**Ownership model**: `isWorkerOwner(owner)` — `currentWorkerOwner === owner &&
Date.now() < owehWorker.leaseUntil` — replaces `ownedByThisTab()` for every feature that
moved onto the shared tab (sweep, daily, breed, index, hatchlings). `ownedByThisTab()`
itself is unchanged and still correct for the one feature that stays same-tab: egg
turning. `currentWorkerOwner`/`currentWorkerGeneration` are plain module-scope variables
set by the `startSharedWorker` message dispatch and cleared by `stopSharedWorker`/
`reportWorkerDone()` — **on content-script init, these must be resynced via a
`getWorkerStatus` call** if this exact tab is still the live lease's owner (e.g. the
worker tab reloaded from an extension update, not just a hash change), or `isWorkerOwner`
would wrongly read `false` forever after a reload despite background.js still correctly
listing this tab as the owner.

**Busy-worker UX**: `claimWorker` refuses a claim from a different owner while one is
live (`{ok:false, reason:"busy", owner, phase}`) rather than queueing it — queueing was
explicitly rejected because auto-activating the next feature the moment the first
finishes, with no fresh button press, would reintroduce auto-activation through the back
door. `releaseWorker` accepts an optional `owner` argument specifically so one feature's
Stop button can never accidentally release a *different* feature that happens to hold the
claim (e.g. pressing "Stop sweep" while Daily Maintenance is actually running) — a Stop-All
action omits `owner` to mean "release whatever is currently claimed."

**Auto-start scope cut**: per explicit decision, only egg-turning's Hatchery-open
auto-start remains. Removed: `maybeAutoClickProfileTurnButton` (used to auto-click any
visible profile Turn Egg button with zero active run required) and
`maybeAutoStartHatchlingProcessing` (a settle-timer auto-start after eggs ran out, plus
its `owehAutoProcessHatchlings` checkbox). Removing the latter without also fixing
hatchling processing's own "not ready yet" retry path would have silently broken the
*explicit* Process-hatchlings button too — its bail-out branches (eggs still turnable,
another automation busy) used to rely on the now-deleted auto-start function to ever
retry `startHatchlingProcessing` again; they now call a new `scheduleHatchlingRetry`,
which re-checks `currentWorkerOwner`/`currentWorkerGeneration` before retrying, so a Stop
during the wait is still honored.

**Newborn Sort retired outright** (button, `startNewbornSort`/`stopNewbornSort`/
`processNewbornSort`/`finishNewbornSort`, and the now-unreachable `activateOverviewEnclosure`
helper, all deleted) — confirmed redundant: `desiredProgramEnclosure` (used by both
Hatchling Processing and Daily Maintenance's sort phase) is a strict superset of
`classifyNewbornName`. Accepted gap: a one-time backlog of pre-existing pure-named pets of
a non-focus species that hatched before Hatchling Processing existed; Daily Maintenance's
focus-species rotation will eventually catch it.

**Dead friend-removal worker-tab path deleted**: `processPendingFriendRemoval` (content.js),
`openFriendRemovalTab`/`friendRemovalDone` (background.js), and the `continueAfterFriendRemoval`
message — all unreachable since the live removal path (`finishFriendSweepStep` →
`removeFriendDirect`) has used a direct `friend_remove` command with no worker tab since
v4.9.0. The live path's own `owehFriendRemoval` staleness check (`FRIEND_REMOVAL_TIMEOUT_MS`,
still in content.js) is unrelated and was not touched.

**UI**: new "Stop All" button next to the activity summary (`stopAllAutomation`: releases
whatever the shared worker holds, plus the two same-tab lanes — egg-turning and Ninja
Please sending). "Breeding Campaign" section renamed "Breeding & Pet Index". Fixed a
real, if minor, pre-existing bug while touching content.css: `.oweh-recommended`/
`.oweh-warning` (the breeding-candidate badges `rankPartners()` injects) were scoped under
`#ovipets-hatchery-helper`, but those badges render on the OviPets page's own
breeding-candidate cards, outside the panel — the rule could never match. Rescoped to
bare class selectors.

**Not yet migrated onto the shared worker tab**: Ninja Please's *send* lane (only
*scanning* needs the live chat page; sending itself needs no navigation, same as the
features that did move) — deferred rather than bundled into this already-large change.
`processFriendRequests`/`processFeedQueue` still only gate on `isWorkerOwner("daily")`
when `run.daily` is true; a standalone send/feed run remains same-tab and ungated, matching
pre-v5.0.0 behavior for that case.
