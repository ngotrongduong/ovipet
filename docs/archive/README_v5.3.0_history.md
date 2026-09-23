# OviPets Hatchery and Breeding Helper v5.3.0

## Start full sweep turns eggs in real tabs (v5.3.0)

The full sweep no longer turns friends' eggs silently from its background tab. For each friend
it now works like this:

1. The sweep tab opens the friend's Hatchery, waits until OviPets has really finished loading
   and lists the turnable eggs (say 25).
2. It takes up to 10 eggs and the extension opens **10 real browser tabs, one per egg** (opened
   in the background, 0.4 s apart, so your current tab keeps focus). Each tab waits for the
   game to load, presses the game's Turn Egg command for its own egg, lets the automatic
   Name the Species answerer handle the dialog if one appears, checks that the Turn Egg button
   is really gone, reports back, and only then is that tab closed.
3. After the batch the sweep waits a moment, reloads the friend's Hatchery and checks again.
   Eggs still turnable go into the next batch (10, 10, 5 ...). Each egg is tried at most twice,
   so a stubborn egg can never loop the sweep.
4. When no egg is left, the sweep continues as before: zero-egg friends are removed and
   blacklisted, the friend gets its cooldown, and the sweep moves to the next friend.

Safety: the extension only ever closes tabs it opened itself (an internal registry,
`bg/egg-tabs.js`). A tab you opened is never closed, even if it shows ovipets.com; only the
sweep's own worker tab may request egg tabs; a tab whose egg could not be confirmed is left
open (and counted) so you can see it; ten such leftover tabs stop the sweep with a message.
**Stop sweep** closes the egg tabs the sweep opened. If you close one of them yourself its egg
is simply re-checked at the next Hatchery read. `owehEggTabConcurrency` (default and maximum 10)
can lower the batch size if the game struggles with many tabs.

Status while it runs: `Friend eggs: 7/10 confirmed · 3 tab(s) open · 0 failed`.

Hardening from the review: a tab is closed only if it is still on its own egg's page (a tab you
navigated elsewhere, or whose id Chrome reused after a restart, is left alone; the registry is
forgotten on browser start); **Next** closes the current friend's egg tabs and the next
friend's step is never dropped; a friend that had eggs during the visit is never removed as
"empty"; an empty first read is re-checked after 4 s; the reason a sweep stopped is stored and
shown in your current tab (the worker tab closes itself); Stop All and a new sweep clear old
leftover egg tabs.

Files: `bg/egg-tabs.js` (tab registry, opening, closing), `jobs/friend-eggs.js` (per-friend
batch loop in the sweep tab), `jobs/egg-turn-tab.js` (what one egg tab does). Tests:
`egg-tabs`, `friend-eggs`, `egg-turn-tab`. Not yet verified live: that a friend's egg page shows
the Turn Egg button (question 8 in `docs/eyes-ai-brief.md`). Turning eggs on your **own** Hatchery
(and on a friend's Hatchery you open yourself, outside a sweep) still works as before.

## One button, one job — Daily Maintenance removed (v5.2.0) — step 2 of the v6 split

The chained Daily Maintenance run (catalog → index → sort → feed → Ninja → requests) is gone.
Every button now does exactly one thing, runs in the shared background tab (one job at a
time; pressing another while one runs is refused with the name of the busy job) and has its
own Stop button. Nothing starts another job.

| Button | What it does — and nothing else |
|---|---|
| Update pet catalog | Scans every Overview enclosure (after OviPets has mounted them) and writes the pet database. Opens no profile, renames nothing, moves nothing. Marks pets whose profile is out of date. |
| Refresh pet profiles | Opens the profile of every pet that is new, changed, incomplete or wrongly named and saves it (renames when "Rename while indexing" is on). Does not scan the Overview. |
| Sort pets into enclosures | From the database only, sends `pets_enclosure` for pets not in the enclosure the program wants. |
| Feed pets | From the database only, sends the free per-pet Feed command. Never Mass Feed. |
| Scan Ninja Please | Opens the Ninja Please post, reads the last 24 hours of comments, stores the commenters. Sends nothing. |
| Send friend requests | Sends `friend_request` to queued commenters not asked before. Scans nothing. |

- Each job is its own file under `jobs/` on top of `jobs/runner.js` (claim the tab, wait for
  the game to load, cancellation, error reporting, release the tab when done).
- The one-button jobs keep no storage flag; the shared-worker lease alone says whether one is
  running, so a stuck "active" flag cannot recur for them.
- Removed: Run/Stop Daily Maintenance, the once-a-day guard, `owehDailyMaintenance`,
  `owehLastDailyMaintenanceAt`, the Daily-only feed/request lanes and their storage flags.
- Review fixes: Stop pressed while a job is still starting can no longer leave a stale
  `owehPetIndex.active`; a reload of the background tab now releases the orphaned lease of a
  one-button job instead of showing "busy" forever; an empty or partial Overview scan no
  longer overwrites saved enclosure ids or marks pets in unscanned enclosures as missing;
  friend-request history is saved after every send so a closed tab cannot cause duplicates.
- Tests: `tests/jobs-behavior.test.js` (each job against stub helpers),
  `tests/job-runner.test.js`, `tests/background-job-claim.test.js`.

## Job modules, readiness ping (v5.1.0) — step 1 of the v6 split

First step of splitting the extension into one file per job so each area can be tested and
fixed on its own (see the v6 plan: every button does one job, no automatic chains; only
passive data collection and the Name the Species answerer stay automatic).

- New `jobs/` folder loaded by the manifest before `content.js`. `jobs/core.js` is a tiny
  registry (`OWEH.register` / `OWEH.boot`): a module that fails to start is logged and
  skipped, never taking the rest of the panel down.
- The Name the Species answerer moved, behavior unchanged, to `jobs/species-answer.js`. It
  still runs on its own in every tab (no Start/Stop) and now has a behavioral test with a fake
  DOM, including the re-arm case behind the v5.0.0 sweep stall.
- `waitForGameReady()` (content.js): waits until the page has loaded, `<main>` has content,
  OviPets' dispatcher is reachable and the content stopped changing before a job reads or
  sends anything. Backed by a readiness-only `oweh:game-ping` in `page-bridge.js` that
  executes nothing. Jobs added in the next steps call it first.

## Daily Maintenance launch and resume recovery (v5.0.4)

- Fixed the direct launch failure: worker options were sent as top-level message fields
  while the content script reads `message.extra`. The manual button's `force: true` was
  therefore lost, causing a run within the 24-hour window to exit immediately. Worker
  options are now delivered in the structure the dispatcher expects.
- Daily Maintenance now waits for OviPets to finish mounting the Overview enclosure tabs
  before it snapshots the tab list. On the live site the route can initially report zero
  tabs and add them later; the old code consequently scanned only the first enclosure.
- Pressing Run Daily Maintenance again now sends a safe resume signal to an existing Daily
  worker instead of merely reporting that it is already running while leaving it idle.
- A recent saved Daily run resumes from its durable phase (`index`, `sort`, `ninja`, or
  `waiting-direct-lanes`) instead of returning silently. Stale Daily-owned feed/request
  flags are cleared before a genuinely fresh run.

## Worker lease continuity and smoother page refreshes (v5.0.3)

- Shared-worker heartbeats now renew both the authoritative IndexedDB lease and the
  `owehWorker` storage mirror used by content scripts. Long-running sweep, maintenance,
  indexing, hatchling, and breeding jobs no longer lose their own ownership check after
  roughly 45 seconds of an otherwise healthy run.
- A delayed `workerDone` from an older worker generation can no longer clear the status
  mirror or start a stale tab after a newer run has already claimed the shared worker.
- OviPets DOM mutation bursts are coalesced into one refresh per short window instead of
  running the complete automation/UI scan once for every pet-card node added. This reduces
  repeated selector scans and storage traffic on large Hatchery and Overview pages.

Chrome Manifest V3 extension that adds a small helper panel to OviPets.

## Panel stays visible while background automation runs (v5.0.2)

The whole point of moving Daily Maintenance (and sweep, breeding, indexing, hatchling
processing) onto a shared background tab is that the Game Owner's own tab stays free to
browse anywhere else — but the panel (including the "Automation activity" card that shows
live progress) was only ever shown on a fixed set of page types (Hatchery, a pet profile,
Overview, the Friends list, Ninja Please). Browsing anywhere else while a background run
was in progress hid the panel entirely, with no way to tell whether it was still running
or had already stopped — reported as "I only see the one-time 'queued' message and then
nothing." The panel now also stays visible whenever any tracked job (background or
same-tab) is active, regardless of what page this tab itself is showing, and reacts within
about a tenth of a second of the shared worker's phase actually changing rather than
waiting for this tab's own page to trigger a refresh.

## Stop buttons now clear a stuck flag even with no live claim (v5.0.1)

Found immediately after shipping v5.0.0: every feature's Stop button (`Stop sweep`,
`Stop Daily Maintenance`, breed campaign's `Stop`, hatchling processing's `Stop`) had been
changed to only ask the shared worker tab to release its claim — which does nothing if
that feature's `active` flag was already stuck `true` with no live claim behind it (e.g.
left over from an earlier run). A stuck `owehHatchlingRun.active` specifically caused two
visible symptoms: Daily Maintenance deferred and quit within about a second every time
(its busy-check saw hatchling processing as still "active"), and the friend sweep opened
the first friend's Hatchery and then never advanced (egg-turning refuses to run on any
Hatchery that isn't your own while hatchling processing shows active — pre-existing logic,
just newly unable to be cleared). Every Stop button now clears its own flag directly and
unconditionally first, then releases the shared claim — restoring how Stop always worked
before v5.0.0. "Stop All" is now a true unconditional reset for exactly this situation:
press it once to clear every feature's flag regardless of what the shared worker tab
currently thinks is claimed.

## Unified shared worker tab; retired Newborn Sort (v5.0.0)

A full architectural redesign, requested after the friend sweep kept stopping after the
first friend and Daily Maintenance's background tab couldn't be reliably stopped.

- **One shared, atomically-claimed background tab** replaces the two separate, ad hoc
  worker-tab systems the sweep and Daily Maintenance used to run independently
  (`owehSweepWorker`/`owehDailyWorker`). Friend sweep, Daily Maintenance, the breed
  campaign, standalone pet indexing ("Refresh pet index"), and hatchling processing now
  all claim this one tab through the same `claimWorker`/`releaseWorker` protocol, backed
  by the existing IndexedDB task-lease store instead of a non-atomic
  `chrome.storage.local` check-then-set. Starting a second feature while one already
  holds the tab is refused with a clear status message rather than silently queued or
  failing.
- **Root cause of "sweep stops after the first friend" fixed**: the Name-the-Species
  auto-answer's dedup guard (`watchedSpeciesContainer`) was set once and never reset,
  permanently disabling it after its first correct answer since OviPets reuses the same
  dialog element across hash navigations. It now tracks the dialog's open→close
  transition instead of a one-time flag.
- **A real Stop now exists for Daily Maintenance** (`Stop Daily Maintenance`) — previously
  the only stop control was "Stop Feed lane," one of its sub-lanes. Every worker-tab
  feature's Stop button now reliably releases the shared tab within seconds, with no more
  "preparing · background" state that could get stuck indefinitely; a lapsed lease (the
  tab crashed, was closed, or was silently discarded by Chrome) self-heals within about a
  minute instead of the old 1–4 hour watchdog alarms.
- **Two auto-start behaviors removed**, per the decision that only plain egg-turning
  should ever auto-activate from a page load: the settle-timer that used to auto-start
  hatchling processing after eggs ran out (and its "Auto-process newly hatched pets"
  checkbox), and the generic auto-click of any visible profile Turn Egg button with no
  active run. Both now require pressing their own Start button every time.
- **"Sort Newborn females" retired outright** — confirmed redundant with Hatchling
  Processing and Daily Maintenance's own sort phase, which already cover the same
  female-routing logic as a strict superset.
- **New "Stop All"** button next to the activity summary stops every worker-tab feature
  plus the same-tab egg-turning/friend-request lanes in one press, alongside the existing
  per-feature Stop buttons.
- Smaller cleanups: dead friend-removal worker-tab code path removed (the live path has
  used a direct `friend_remove` command with no worker tab since v4.9.0); the
  `.oweh-recommended`/`.oweh-warning` breeding badges' CSS is no longer scoped under the
  panel's own id, since those badges render on the OviPets page itself; the two CSV export
  buttons now share one visual style and status-message phrasing.

## Auto-answered Name the Species and cross-tab sweep controls (v4.22.0)

- **Name the Species no longer waits for a manual click.** The dialog is answered
  automatically: a known-correct answer from `owehSpeciesMemory` is reused when one
  exists (and a previously wrong answer for that exact image is never reselected),
  otherwise one of the remaining untested options is picked at random and **OK** is
  pressed the same way a human would. This replaced the v4.21.0 "activate the tab, play
  an alert, wait for the user" behavior, which could stall the whole egg-turning/friend
  sweep queue indefinitely if the dialog appeared in an inactive background worker tab
  no one was watching — the exact symptom reported as "sweep opens one friend and then
  just stops." Answer history keeps being recorded exactly as before.
- **Next** now works correctly when clicked from a tab that isn't the sweep's actual
  worker tab. Since **Start full sweep** always drives the sweep from a separate,
  inactive worker tab, pressing Next from your normal Hatchery tab used to silently do
  nothing (or write a stray, unused `owehSweep.index`). It now detects that case and
  relays the skip to the real worker tab, the same way Stop sweep already does.
- The Stop/Next relay messages to the worker tab now retry for a few seconds if the
  worker tab's content script isn't ready yet (e.g. it's mid-navigation to the next
  friend), instead of silently failing on the first attempt.

## Same-tab Name the Species handoff (v4.21.0)

- A verification dialog remains in the exact worker tab and command session that created
  it; no duplicate profile tab is opened, so the game cannot discard the dialog state.
- The extension activates that worker tab, focuses its Chrome window, scrolls the dialog
  into view, and plays the configured alert.
- The current egg queue waits only in that worker tab while the user selects an answer and
  presses **OK**. Other OviPets tabs and their independent tasks continue normally.
- After the game's Turn Egg callback confirms completion, the same loop advances to the
  next egg automatically and ultimately continues the friend sweep.
- A page-wide watcher detects the dialog independently of the command callback, and a
  one-second post-callback observation window catches a modal rendered slightly late.
- Turn Egg allows up to ten minutes for manual input. The panel reports detected prompts,
  confirmed answers, and manual alerts. Existing answer history is still recorded, but
  this flow never auto-selects an answer.

## Scalable pure-line planning and health (v4.19.0)

- Each female now gets a complementary Body 1 shortlist of at most 40 males before the
  full five-color/pedigree score is calculated. This avoids evaluating every possible
  pair when the collection grows into the thousands.
- Strict FF progress remains the first priority. Male usage during the last 24 hours and
  repeated parent-line usage are later tie-breakers, reducing genetic concentration
  without choosing a visibly worse pure-line pair.
- Pedigree records now retain inferred generation and direct-parent IDs in addition to
  the compatibility ancestor list. The inference is explicitly marked for later DOM
  refinement.
- Every enclosure scan stores a fingerprint and card snapshot. Unchanged enclosures
  reuse their parsed records, while changed tabs rebuild only their own snapshot.
- Overview tab transitions wait for card signatures to become stable instead of relying
  only on fixed sleeps.
- Database Health reports complete/incomplete/stale profiles, active task leases, and
  mutation commands awaiting reconciliation.
- Live Overview scans reconcile uncertain breeding commands: a blue-heart mother confirms
  success; a still-breedable mother after five minutes makes that command retryable.

## Transactional database and task recovery (v4.18.0)

- Pet records are migrated once from the v4.17 `owehPets` snapshot into IndexedDB and
  are thereafter merged one Pet ID at a time. Separate tabs no longer replace the same
  giant pet object in `chrome.storage.local`.
- Navigation and mutation programs claim a background-managed task lease tied to the
  stable Chrome Tab ID. A content-script reload can resume work in the same tab, while
  another tab is prevented from accidentally owning the same task.
- Active tabs renew leases every 15 seconds. Abandoned leases expire after 45 seconds,
  so a crashed or closed worker cannot block the helper indefinitely.
- Breeding mutations are written to a durable command journal before dispatch. The
  journal blocks an identical pair command in the same campaign from being sent twice
  after a reload or crash.
- The legacy pet snapshot is retained read-only for rollback to v4.17; v4.18 uses it
  only as a one-time migration source.

## Database-first automation (v4.17.0)

- Breeding starts with one lightweight pass through every enclosure tab. Pet cards supply
  ID, name, enclosure name/ID, image modification marker, and the blue-heart cooldown flag.
- Females without a blue heart are stored as the current breedable snapshot. Profiles are
  opened only for new, changed, or incomplete records; complete cached profiles are reused.
- A complete cached record requires Pet ID, name, gender, species, all five requested color
  slots, pedigree array, enclosure, cooldown state, and observation timestamps.
- Pair planning happens locally against cached males in `Males`. It excludes visible shared
  ancestry and ranks Body 1 complementary FF coverage before whole-target quality.
- Planned pairs are executed with the observed `pet_breed` UI command. The campaign waits
  for each UI callback, updates the female cooldown in cache, records the pair, and proceeds
  without opening that female's profile or Breeding tab.
- The dashboard exposes database coverage as `complete profiles / catalog pets` and the
  number of known enclosures. See `docs/database-first-automation.md` for boundaries and
  refresh rules.

## Background sweep and Unnamed hatchlings (v4.16.0)

- **Start full sweep** creates one inactive worker tab. Only that tab owns the Friend
  Hatchery hash navigation and egg queue, so another OviPets tab remains free for pet
  indexing, sorting, breeding, or ordinary play.
- Shared state still reports the worker's progress on every helper panel as
  `Friend sweep · … · background`. Stop Sweep stops the shared queue and closes its worker.
- Hatchery detection treats a card named `Unnamed` as a confirmed hatchling even if its
  image-size marker is missing or late. Unnamed cards are processed before other cards.
- For an Unnamed pet, the extension waits for and clicks the visible **Name** button,
  fills the standard `BODY1-BODY2-SCALES` name, confirms it, and only then sorts the pet.
- That same pass stores Pet ID, colors, gender, species, pedigree, Food, modified marker,
  enclosure and timestamps in the main cache, so the next index refresh reuses the record.
- If naming fails, the pet stays in the Hatchery and is retried instead of being moved in
  an invalid Unnamed state.

## Efficient cache, feeding and complementary pairing (v4.15.0)

- A pet profile is reopened only when its ID is new, required fields are missing, its
  Overview `modified` marker changed, or its cached colors indicate that its name is wrong.
  A lightweight enclosure-card catalog still runs so removed, moved and cooldown pets are
  detected without reopening every profile.
- Sorting is a no-op when the cached enclosure already equals the calculated destination.
- Food percentage is read while a profile is legitimately refreshed. Pets known to be at
  100%, or fed by the extension within the last 20 hours, are omitted from the Feed queue.
- Body 1 pairing is now complementary. The campaign first asks whether the pair can reach
  `FF FF FF`, then rewards FF positions supplied by the male that the female does not
  already own. Whole-target quality is evaluated only after those Body 1 priorities.
- Consequently, `** FF ** × FF ** FF` ranks above `** FF ** × ** FF **`; the latter cannot
  create either missing Body 1 FF pair in that generation.

## Concurrent direct lanes and breeding program (v4.14.0)

- Free per-pet Feed and Ninja friend requests are independent direct-command lanes. They
  dispatch one observed OviPets UI action every 100 ms and can run alongside a navigation
  workflow. Their counters mean **dispatched**, not server-confirmed.
- The activity card lists every active lane at once, including Daily Maintenance, Feed,
  friend requests, Hatchery work, indexing, sweeps, and breeding.
- Every indexed male is routed to the enclosure named `Males`. For each breedable female,
  the campaign opens Breeding, selects only `Males`, ranks the compatible males against
  the fixed target, and breeds with the strongest unrelated candidate.
- Females matching a Body 1 FF mask still go to the seven pure-line enclosures. A female
  with no `FF` or `00` pair in any tracked color can instead go to `Breeding Stock` when
  its average target distance is within the configurable threshold (default `96`).
- Daily Maintenance now handles Males/Breeding Stock routing and launches Feed in parallel
  while it opens Ninja Please and builds the friend-request queue.

## Egg-first Hatchery scheduling (v4.13.0)

- Turnable eggs now always take priority over newly hatched-pet processing. The automatic
  hatchling scanner waits at least three seconds for the Hatchery DOM to settle, then
  rechecks both green turn icons and the managed egg queue before claiming the lock.
- If a hatchling scan started before late-rendering green icons appeared, starting the egg
  queue interrupts that scan automatically instead of showing a blocking Stop message.
- The dashboard now says `Hatchling processing · checking hatchlings 2/7` or `moving males
  1/2`, rather than the ambiguous `Hatchery · scan`.
- **Auto-process newly hatched pets** can be disabled in Hatchery & Eggs. Manual
  **Process hatchlings** remains available.

## Compact automation dashboard (v4.12.0)

- Replaces the long control list with six accordion sections. Chrome keeps only one
  section open at a time, so the panel stays short and easy to scan.
- A live activity card at the top reads shared extension state and shows every active
  workflow, including jobs running in another/background tab: Daily Maintenance, egg
  turning, friend sweep/removal, pet indexing, strict breeding, Hatchery processing,
  Newborn sorting and friend requests.
- The header always shows `Idle` or the number of active automations, even when the whole
  panel is collapsed. The collapsed preference is remembered.
- Long explanatory paragraphs were removed from the panel. Hover over any button,
  checkbox or setting to see its full explanation in an immediate tooltip.
- Start, result and error messages remain visible directly below the activity card.

## Control recovery and diagnostics (v4.11.0)

- Replaces a stale helper panel after an extension update/reload. OviPets is a long-lived
  single-page app, so the old DOM could remain visible after Chrome destroyed its event
  listeners; this made every button appear clickable while doing nothing.
- Every button is bound independently and reports its start, result, or JavaScript error
  in a sticky status line at the top of the panel. One missing/broken control can no longer
  prevent all later controls from being initialized.
- Daily Maintenance verifies that its remembered background tab still exists. If that tab
  was closed or crashed, the stale worker record is cleared and a fresh tab is created.

## Audible species-verification handoff (v4.10.0)

- When an unknown **Name the Species** dialog appears in an inactive worker tab, the
  extension activates that tab, focuses its Chrome window, scrolls the dialog into view,
  and plays a three-note alert from an extension offscreen audio document.
- **Sound alert and show the verification tab** is enabled by default. Turning it off
  mutes the sound; the verification tab is still brought forward so the queue cannot
  remain invisibly blocked.
- A manually selected answer is stored only after the Turn Egg command succeeds. The
  next occurrence of the same image can reuse that confirmed answer immediately.
- If a submitted answer is rejected and another option is selected in the same dialog,
  the rejected species is recorded as wrong and is not reused for that image.
- After a correct answer, the same direct egg queue continues automatically; no Start
  button needs to be pressed again.

## One-click Daily Maintenance (v4.9.0)

- Catalogs all enclosure pet IDs, refreshes only new or changed profiles, renames and
  sorts strict-line pets, then feeds every owned pet with the game's free `pet_feed`
  action. The Credit-priced `pets_massfeed` action is never used.
- Per-pet Feed runs directly by Pet ID with 100 ms between dispatched commands and
  records `lastFedAt`, so no pet profile needs to be opened merely to feed it.
- The same run opens the official Ninja Please post, expands comments back to 24 hours,
  queues unique commenters, and sends requests through the confirmed `friend_request`
  UI action with a 100 ms dispatch interval.
- `owehFriendRequestHistory` permanently remembers every attempted user ID. Repeated
  commenters are skipped, as are the owner and comments explicitly saying no friend
  requests.
- Feed, friendship, rename, enclosure, egg-turn and final breeding mutations use the
  game's own observed `ui_action_cmdExec` actions. Navigation remains only where live DOM
  data must first be discovered or a species-verification dialog must be shown.

## Daily cached maintenance (v4.7.0)

- Opening **Pets → Overview** no longer restarts or restores the Newborn sorter.
- **Run daily maintenance now** launches one inactive worker tab. v4.9.0 removes the old
  recurring alarm so friend requests are sent only after this explicit daily click.
- The worker scans all enclosure tabs and stores each pet ID, name, enclosure ID, image
  modification marker, cooldown, gender, species, colors, and pedigree in local storage.
- Only new pets, pets missing required data, or pets whose Overview modification marker
  changed are reopened. Unchanged profiles reuse the cache.
- Female pets whose six-character Body 1 prefix belongs in another strict enclosure are
  moved directly with the game's own rendered `pets_enclosure` UI action. No Edit tab is
  opened for these cached moves.
- Rename uses the game's rendered `pet_rename` UI action first and falls back to the
  inspected Edit → Rename dialog if that dispatcher is unavailable.
- **Run daily maintenance now** starts the same work immediately in an inactive worker tab.
- Fast commands are allow-listed and rate-limited. Daily Maintenance is the single entry
  point for cataloging, sorting, free per-pet Feed, Ninja scanning and new friend requests.

## Features

- Turns each green-marked egg directly from the current Hatchery with `pet_turn_egg`;
  no egg profile navigation is required.
- Also auto-clicks the real `Turn Egg` button the instant it's visible on any pet page you
  land on directly, even with no Start/queue run active — throttled to at most one click
  per second so it can't hammer the button while the page is still settling.
- Handles the game's visible "Name the Species" confirmation for changing
  species lists by reading the pet's own Species field and matching the exact
  answer label; it does not rely on a short hard-coded species list.
- Stores confirmed image-to-species choices locally and reuses them when the
  same verification image appears again. If automatic matching is unavailable,
  the user can choose the answer manually and the choice is learned.
- In the direct Hatchery queue, a confirmed learned species answer may be reused. If no
  confirmed match exists, the queue pauses for a manual answer, learns it, then resumes;
  it does not blindly submit random answers.
- Uses one active egg queue, returns to the saved Hatchery after every turn,
  and can resume when a new green turn icon appears.
- Optionally removes a friend only when their Hatchery contains zero eggs in
  total; friends with already-turned eggs are kept.
- Removes a confirmed zero-egg friend directly with the game's observed `friend_remove`
  action; no profile worker tab is opened or closed.
- Places each completed friend on a 10-minute cooldown, including friends with
  eggs that are all already turned. Expired cooldowns become eligible again.
- Optional turn delay from 0 to 30 seconds between eggs (default: 0).
- Configurable page-load delay from 0.25 to 10 seconds (default: 1.5), plus
  a wait for the real pet-page `Turn Egg` button before acting.
- Start and Stop controls.
- Remembers the selected delay locally in Chrome.
- Does not call OviPets APIs or send requests directly.
- Saves color tables from pet profiles into a local index.
- Uses one fixed strict target: Body 1 `#FFFFFF`, Body 2 `#FF0000`, Scales
  `#000000`, Extra 1 `#FF0000`, and Extra 2 `#000000`.
- Ranks visible breeding partners for pure-line progress. It first maximizes channels where
  both parents already equal the target, then exact target channels held by either parent,
  then reachable target channels; RGB distance is only the final tie-breaker.
  See `docs/pure-breeding-guide.md` for the underlying mechanics.
- Highlights the best indexed partner without clicking the final confirmation, and shows
  locked/exact-channel counts plus its estimated off-target distance.
- Warns (red outline + label) when a candidate partner shares a visible pedigree ancestor
  with the open parent — best-effort, based on a detected "Pedigree" section; absence of a
  warning is not a guarantee the pair is unrelated.
- Names pets from the three requested color slots as `BODY1-BODY2-SCALES`, for example
  `F5FCF1-F20019-130F3A`. The compact format is under OviPets' 25-character limit.
- **Full pet index**: scans every visible enclosure tab, then visits every pet profile to
  record ownership, cooldown, gender, species, Body/Scales/Extra colors, and visible
  pedigree. An optional checkbox applies the color-code name while each profile is open.
- **Database-first auto-breed campaign**: takes every blue-heart-free female from the seven
  dedicated pure-line enclosures or `Breeding Stock`, ranks cached pets in `Males`, and
  prefers a pair capable of reaching all 15 target RGB channels in the
  current generation. If none can, it selects the strongest unrelated improvement pair.
  It records father, mother, egg ID, purity metrics, estimated chance, and timestamp.
- **Automatic Hatchery hatchling processor**: on the owner's Hatchery, detects the live
  `size=120` hatchling cards (eggs are `size=80`), visits each profile, names it
  `BODY1-BODY2-SCALES`, and moves eligible females into one of seven pure enclosures.
- **Seven-enclosure sorter**: matching `FF` Body 1 pairs map to `FF ** **`, `** FF **`,
  `** ** FF`, `FF FF **`, `FF ** FF`, `** FF FF`, or `FF FF FF`. Because the fixed
  Body 1 target is white, `00` does not count as a matching Body 1 pair.
- **Males enclosure**: every indexed or newly hatched male is moved to `Males`; selection
  happens later from the live list of males compatible with each female.
- Opens the profile's complete Friends list, resolves numeric IDs from both
  profile links and avatar image URLs, and includes every friend found.
- Runs a finite, user-started sweep across the complete friend queue; friends
  still inside the 10-minute cooldown are skipped automatically.
- Scans the OviPets profile's Ninja Please post, expands recent comments when
  available, keeps unique unprocessed commenters from the last 24 hours, and sends
  queued friend requests directly by User ID with a delay and a Stop control.
- Automatically starts the egg scan whenever a Hatchery with turnable eggs is
  opened. During an active friend sweep, an empty friend Hatchery also triggers
  the zero-egg check.
- If a sweep is already active (e.g. the page was reloaded mid-sweep), opening
  any Friend Hatchery resumes it. A merely-scanned friend list with the sweep
  never started does **not** auto-activate — only pressing **Start full sweep**
  turns a scanned list into an active sweep, since that can trigger a real,
  permanent friend removal.
- Species verification waits for the actual confirmation to finish, accepts
  manual answers from button, label, or radio controls, and stores normalized
  image URLs plus a browser-side visual fingerprint.
- Species memory uses repeated votes and confidence; a single accidental answer
  is not enough for automatic reuse. The pet profile's visible Species field
  remains the strongest signal when available.

## Female-first Males breeding workflow

1. Keep the seven pure-line enclosure names exactly as listed above, plus `Males` and
   `Breeding Stock`.
2. Open your **Pets → Overview** page and press **Refresh pet index**. The extension scans
   the lightweight card catalog but visits only new, changed, incomplete, or wrongly named
   profiles. Leave **Rename as BODY1-BODY2-SCALES** enabled if desired.
3. Wait for the status to report that indexing is complete.
4. Press **Start database campaign**. It refreshes all enclosure cards once, builds the
   female list from blue-heart state, refreshes only missing metadata, and sends planned
   pair commands without opening every female.
5. Press **Stop campaign** at any time. Progress, attempted males, and breeding history
   are stored locally so duplicate pair attempts are avoided.

The displayed chance assumes each integer channel value inside the parents' range is
equally likely. It is a planning estimate, not a verified OviPets probability. Offspring can land within
the range between the parent channel values, and lineage/mutations can affect
the result. The pure-line lesson also recommends breeding lock groups together,
then interbreeding close offspring, and keeping unrelated visible pedigrees
separate where possible. Full mechanics notes: `docs/pure-breeding-guide.md`.

## Hatchery and enclosure workflow

1. Keep all seven pure enclosure names plus `Males` and `Breeding Stock` exactly as listed.
2. Open your own **Hatchery**. The processor starts automatically after turnable eggs are
   handled. **Process Hatchery now** forces an immediate fresh pass.
3. Every confirmed hatchling is named first. OviPets keeps the Enclosure dropdown disabled
   while a pet is `Unnamed`; after naming, the extension opens Edit and moves it.
4. Female pets with matching `FF` pairs are moved immediately. Near-target females without
   any tracked `FF`/`00` pair may enter `Breeding Stock`. All males move to `Males`.
5. **Sort Newborn females** remains available from Pets → Overview for a manual cleanup
   pass using the same seven-enclosure rules.

For example, `AAFFFE-B90012-590020` starts with `AA FF FE`, so it maps to `** FF **`.
`FFFFFF` maps to `FF FF FF`. `FF00AA` maps only to `FF ** **`, because `00` is not a
match for this project's white Body 1 target.

After indexing, **Copy lowest-ranked review** exports up to 25 lowest-ranked pets as CSV.
This is deliberately review-only: the extension never removes, releases, or discards a pet.

The built-in `PURE_COLORS` table (used by manual pure-color comparison) is the confirmed 47-color
Official list live from OviPets' own Help FAQ (see `docs/dom-audit-2026-09-17.md`). The
Unofficial pure-color list is still missing — reading it requires joining the game's forum
group, which was deliberately not done since it would modify the account.

## Friend Hatchery sweep

1. Open your profile and the visible **Friends** list.
2. Press **Scan friend list**. The extension opens the complete Friends list
   when necessary and records every friend it can resolve.
3. Press **Start full sweep**. The sweep uses the complete scanned queue;
   the old per-run friend limit is no longer used.
4. In each queued friend Hatchery, the extension collects every green-marked egg ID,
   sends the confirmed `pet_turn_egg` UI command for the batch, then refreshes the
   Hatchery once. If species verification appears, the queue reuses a confirmed learned
   answer or pauses for one manual answer before continuing.
5. After a friend is completed, it is skipped for 10 minutes so the next run
   can reach other friends; it becomes eligible again after the cooldown.
6. Press **Stop sweep** at any time. The sweep is finite and does not run forever.
   After starting a run, auto-turn remains enabled for that Hatchery so newly
   appearing green icons are picked up. Press **Stop** to disable it.

When **Remove friends with zero eggs** is enabled, the extension counts all
Hatchery egg cards, not only green turn icons. If the total is zero, it opens
the friend's main profile in exactly one background worker tab, uses
**Edit Friendship → Remove Friend**, confirms the dialog, closes that tab, and
continues to the next friend. A Hatchery containing only already-turned eggs
is not removed. Only one removal worker tab exists at a time — a duplicate
request while one is already open is ignored, both in the sweep logic and in
`background.js`, so this can never pile up multiple tabs.

Every friend removed for having zero eggs — and every queued friend found to
already not be a friend anymore (their profile shows "Send Friend Request"
instead of "Edit Friendship") — is added to a permanent local blacklist
(`owehFriendBlacklist` in `chrome.storage.local`). Blacklisted friends are
excluded from every future scan and sweep, so the same zero-egg accounts are
never re-selected. Press **Copy blacklist (CSV)** to copy the full blacklist
(user id, name if known, reason, timestamp) to the clipboard for pasting into
a spreadsheet — the blacklist itself lives only in the browser, not in any
external service.

Named friend links without a numeric user ID are skipped until they can be
resolved through the site's own profile navigation.

## Ninja Please friend requests

1. From anywhere in the game, press **Scan Ninja Please (24h)**. If you're not
   already on the OviPets profile page containing the **Ninja Please** post,
   the extension navigates there for you (`#!/OviPets`), then loads available
   previous comments, filters to the last 24 hours, removes duplicate
   commenters, and returns you to the page you started from.
2. Press **Send queued requests** to execute the game's confirmed `friend_request`
   UI action for each new User ID. No profile navigation is needed. Daily Maintenance
   performs both this scan and send step automatically.
3. Press **Stop requests** to stop the queue safely.

The auto-navigate step is skipped (with a status message) while a friend
sweep, breed campaign, pet index, or request queue is already running, so it
never yanks the page out from under another in-progress automation.

When a friend has no Hatchery cards at all during an active sweep, the helper executes
the confirmed `friend_remove` UI action directly by User ID, blacklists the removed ID,
and advances without opening or closing a separate profile tab.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `ovipets-turn-egg-extension`.
5. Open OviPets Hatchery and refresh the page.

## Use

Set the optional turn delay and page-load delay, then press **Open and turn eggs**. The extension stops
when no green turn icons remain. Press **Stop** to cancel the sequence. At the
default 0 seconds, it moves on as soon as the game's real Turn Egg button
disappears.

Use the extension only if it complies with OviPets rules and your account's
usage limits. It is intentionally user-started and uses a conservative delay.
