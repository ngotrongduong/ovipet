# OviPets Hatchery Helper

Chromium Manifest V3 extension for OviPets automation and breeding workflows, with Microsoft Edge as the primary Windows target.

Current release: **v5.4.1**

## Engineering objective

The project prioritizes long-running stability and recoverability, then incremental modularization and measured efficiency improvements.

Key goals:

- safe/recoverable background automation;
- no duplicate, stale or cross-tab worker actions;
- conservative confirmation of game mutations;
- efficient handling of large pet/friend sets;
- small modules with regression coverage;
- explicit live-DOM contracts.

## v5.4.1 Learn Species Shapes + tuned silhouette threshold

- Measured live on 129 Adoption Center pets (31 species): the nearest same-species silhouette is 64/114/217 of 1,024 pixels away (p10/p50/p90), other species 135/175/216. The v5.4.0 threshold of 44 almost never fired, so answers stayed mostly random. `MATCH_DISTANCE` is now 150 and up to 40 variants per species are kept (mutations change the outline); leave-one-out nearest-neighbour with 4 options reaches ~87% once a species is learned. A far-away known species still loses to an option never learned (exclusion).
- New **Learn Species Shapes** button (Hatchery & Eggs, `jobs/species-seed.js`): reads your saved pets and the Adoption Center list (species from each public profile), masks each normal pet image (same 500×500 frame as the challenge) and adds it to `owehSpeciesShapes`. Read-only, throttled, resumable (`owehSpeciesSeedSeen`), with its own Stop button.

## v5.4.0 Silhouette species solver + rolling Fast Sweep

- **Name the Species** now matches the challenge image by its silhouette. The image shows a random species with random colors and genes, so the old exact image hash almost never repeated (live: 336 correct of 4,617 detected). Each species keeps a fixed pose, so a 32×32 alpha mask identifies it: same-species masks differ by ~13–38 of 1,024 pixels, other species mostly by more than 50. `domain/species-shape.js` ranks the offered options (close match → answer; nothing close → an option never learned yet; otherwise the nearest). Every confirmed answer adds a silhouette to `owehSpeciesShapes` through the serialized `bg/species-shapes.js` writer, and answers confirmed before v5.4.0 are back-filled once from `owehSpeciesMemory`. Import/export carries the library; the stats line shows `shape X/Y`.
- **Start full sweep** keeps a rolling window of egg tabs: as soon as tabs of the running batch resolve, the coordinator hands the free slots to the next queued eggs (`eggBatchExtend`) instead of waiting for the slowest tab. Background stays authoritative (never more than the adaptive 10/12/15 unresolved tabs; a finished batch is never reopened), watchdogs count from the latest top-up, and adaptive speed judges a long batch per window. An older background falls back to plain batches.

## v5.3.17 Breeding dependency-wiring hotfix

Live v5.3.16 QA found an integration-only crash immediately after pedigree re-indexing completed: the breeding feature called `pedigree.pedigreeCompatibility(...)`, but `content.js` had not injected `OWEH.domain.pedigree` into the shared helper object. Feature-unit tests had mocked that dependency directly, so the missing real boot wiring escaped the previous suite.

- `content.js` now injects `pedigree: OWEH.domain.pedigree` alongside the other breeding-domain modules.
- `features/breeding.js` includes a manifest-order-backed global fallback plus an explicit dependency assertion, preventing a long indexing pass from ending in an undefined-module crash.
- A dedicated `content-domain-wiring.test.js` regression verifies manifest load order and the real `OWEH.boot(...)` helper wiring.
- `database-breeding.test.js` now also requires the exact pedigree injection contract.
- Pedigree safety behavior from v5.3.16 is unchanged: unverified/shared/direct ancestry remains fail-closed, and rejected males still fall through to the next safe candidate.

Verification: full suite **60/60 PASS**; focused wiring/pedigree/breeding soak **20 rounds × 8 files = 160 executions, 0 failures**. Final clean-ZIP hash is reported in the release handoff after packaging.

## v5.3.16 Pedigree Guard + male fallback

Breeding campaigns now fail closed on pedigree data and recover automatically when OviPets rejects a cached pair.

- Pedigree is treated as verified only after the lazy-loaded `section#pedigree fieldset.ancestors` payload is actually present and its ancestor ID signature remains stable for 300 ms.
- Cached records now require `pedigreeVerified=true` to be complete. Database schema metadata is bumped to **4**, so legacy v5.3.15 rows are refreshed before breeding.
- Unknown/partial pedigree no longer means unrelated: pair compatibility fails closed until both pets have verified pedigree payloads.
- Shared ancestors and direct ancestor relationships are rejected before any breeding UI command is sent.
- Each female queue row now retains the full ordered list of safe male candidates instead of only one chosen male.
- Immediately before dispatch, the runtime re-checks the female and male pedigree from the current database.
- If OviPets renders **Unable to breed pets.**, the MAIN-world bridge reports `unable-to-breed-pets` immediately, dismisses the dialog, marks that male rejected for the current female, and tries the next safe male. A legacy `command-timeout` also falls through to the next male rather than abandoning the female.
- Campaign mode is bumped to `database-direct-v2`; an in-progress older campaign stops safely and must be restarted after upgrading.

This hardening applies to both **Pure-line** and **Same-FF target** strategies.

Verification: full suite **59/59 PASS** before packaging; focused pedigree/breeding regression includes unverified-pedigree fail-closed, shared-ancestor exclusion, OviPets error-dialog detection, and alternate-male retry.

## v5.3.15 Same-FF target-improvement breeding strategy

Breeding Campaign now offers a second, independent strategy for improving a color line toward the fixed target without trying to combine different Body 1 FF pairs.

- **Pure-line campaign** remains unchanged and continues to seek complementary Body 1 FF pairs.
- **Same-FF target campaign** scans the complete enclosure snapshot, considers every owned/present female that is off cooldown and has complete color data, and evaluates all off-cooldown owned males of the same species across all enclosures.
- A male is eligible only when his exact Body 1 target-FF mask matches the female's mask. This keeps the pair on the same FF line instead of deliberately adding a different FF pair.
- Females with no exact Body 1 FF pair remain unpaired in this strategy.
- Related pairs are excluded with the existing pedigree/ancestor-overlap guard.
- Among the safe same-FF males, Body 2, Scales, Extra 1 and Extra 2 are measured independently against target. The male's primary score is the **single lowest** of those four distances.
- Example: secondary distances `20 / 14 / 40 / 25` score **14**; a safe same-FF male whose best slot is **12** wins.
- Equal best-slot scores prefer lower recent male usage, then lower lineage usage, then lower total secondary distance for deterministic target-focused tie-breaking.
- The strategy does not use the normal male shortlist: every safe same-FF male for that female is considered.

Verification: full suite **59/59 PASS** before packaging.

## v5.3.14 Breeding male diversity

Breeding Campaign no longer lets a tiny Body 1 advantage automatically collapse the whole program onto one male lineage.

- Male candidates with the same exact Body 1 endpoint mask (`FF`/`00` target channels) are treated as **near-equivalent** when every remaining non-exact Body 1 channel differs by at most **15 RGB points**.
- Example: `FF FF FA` and `FF FF FC` remain in the same eligible Body 1 pool instead of always preferring `FC` before other traits can be considered.
- Inside that near-equivalent pool, the planner scores **Body 2, Scales, Extra 1 and Extra 2 separately** against the target and takes the **single lowest slot distance** for each male. It is not a sum or average: `[20, 14, 40, 25]` scores **14**. A male whose best secondary slot is 12 therefore beats one whose best slot is 14.
- If that secondary score is tied, the existing recent-male-use and lineage-use tie-breaks remain active to spread ancestry where quality is otherwise equal.
- A genuinely different Body 1 endpoint mask, or a remaining Body 1 difference greater than 15, still uses the normal strict Body 1 ranking.
- Near-equivalent males are retained even when the normal shortlist limit would otherwise cut one just outside the shortlist.
- Queue diagnostics now record the chosen male's best secondary slot/distance and the size of the equivalent Body 1 pool.

Automated verification: full suite **59/59 PASS**; focused breeding/planner soak **20 rounds × 6 files = 120 executions, 0 failures**.

## v5.3.13 Own Hatchery Turn + Hatch

**Turn / Hatch available eggs** now handles both actionable egg states in the user's own Hatchery while keeping friend-egg safety unchanged.

- Hatchery cards with the green **Hatch Egg** action are detected separately from normal **Turn Egg** cards.
- Hatch-ready own eggs use the exact OviPets UI dispatcher command `pet_turn_egg` with `PetID=<id>` directly from Hatchery, avoiding a profile-tab round trip.
- This direct path is deliberately narrow: the MAIN-world bridge accepts it only when the current page is the user's own Hatchery, the request purpose is `own-hatch`, and the exact PetID currently has a visible `Hatch Egg` icon.
- Generic `pet_turn_egg` bridge calls remain blocked. Normal Turn Egg still opens extension-owned profile tabs so Name the Species can be observed and resolved before the tab closes.
- Friend Hatcheries never use the direct hatch path.
- Hatch commands are paced at 100 ms in bounded batches, followed by one Hatchery reload/recheck.
- The existing own-egg run tracks both confirmed turns and unique hatch-command dispatches.

Verification: full suite **59/59 PASS**; focused own-Hatchery/bridge soak **20 rounds × 7 files = 140 executions, 0 failures**.

## v5.3.12 Ninja + Ads friend discovery

The standalone Ninja friend-discovery scan now reads both official OviPets profile posts on `#!/OviPets`: **Ninja please** and **Ads post**. The posts are found by identity/title rather than vertical position, so it does not matter which one appears above the other.

- Both posts are expanded independently until the scan reaches the rolling 24-hour boundary.
- Candidate users are merged globally by stable OviPets User ID; repeated comments and the same user appearing in both posts produce only one queue entry.
- When the same ID appears more than once, the newest qualifying comment is retained.
- The existing `owehFriendRequestHistory` remains the single global do-not-resend history for both sources. No second Ads-specific history is introduced.
- Explicit “no friend requests” comments, the current account, comments older than 24 hours, future/invalid times, and IDs already in request history remain excluded.
- If either target post is unavailable, the other post is still scanned; the scan fails only when neither target can be found.
- **Scan Ninja + Ads** still only builds `owehChatQueue`; **Send friend requests** remains a separate action.

Regression coverage extends the chat DOM tests for reversed post order, cross-post ID dedupe, 24-hour filtering and shared request-history exclusion. Full suite: **59/59 PASS**; focused Ninja/chat soak: **20 rounds × 2 files = 40/40 PASS**.

## v5.3.11 Fast Sweep + Lightweight Tabs

Fast Sweep removes the largest throughput bottlenecks while keeping the existing 60-second per-tab watchdog, 120-second batch watchdog, protected coordinator and orphan self-healing behavior.

- One friend Hatchery is snapshotted once, then drained through back-to-back adaptive batches; only one final verification reload remains.
- Concurrency starts at 10, promotes to 12 and 15 after clean full-batch streaks, and now also backs off when batch latency itself becomes slow even before a watchdog timeout.
- Egg tabs stagger at 175 ms, close 250 ms after reporting, and batch completion is pushed event-first with 2-second polling only as recovery fallback.
- Friend page readiness uses stable-DOM detection rather than the old fixed empty-Hatchery wait.
- Name-the-Species confirmation/retry waits are condition-based/shortened.

**Lightweight owned tabs:** Full Sweep coordinator and sweep-created egg tabs are now created through a tab-scoped `declarativeNetRequest` session rule that blocks only `image`, `media` and `font` resources. HTML, JavaScript, CSS, forms, XHR/fetch and real buttons remain available. The Name-the-Species challenge image is still fetched by the guarded background image service for fingerprinting, so the solver does not depend on the page rendering that image. Rules are removed when owned tabs close.

**Long-run memory/I/O fix:** the Diagnostic Logbook previously rewrote the entire retained log (up to 5,000 entries) on every event. v5.3.11 stores new diagnostics in a fixed ring of small 200-entry chunks, preserving the same export/retention behavior while removing that progressively heavier storage write. Combined with resource-light tabs, this targets the main long-run Edge slowdown observed during sustained sweep runs.

Focused Fast Sweep/lightweight/recovery soak: **20 rounds × 8 files = 160 executions, 0 failures**. Full suite: **59/59 PASS**.

## v5.3.10 Self-healing Full Sweep coordinator

Diagnostic Logbook live data exposed an orphaned-sweep state: `owehSweep.active` could remain true after the protected coordinator tab disappeared and the shared-worker row was released. The dashboard therefore looked active while no worker existed to advance the friend cursor.

v5.3.10 adds automatic coordinator replacement:

- if Full Sweep is still active but no live sweep worker exists, the background reclaims the shared-worker slot automatically;
- a fresh inactive OviPets coordinator tab is created and receives `recoverSharedWorker`;
- recovery preserves the durable `cycle` / `index` cursor and reopens the current friend rather than resetting to pass 1;
- if the current protected coordinator disappears, the health check first tries an in-generation replacement and falls back to a fresh generation if required;
- the dashboard shows `recovering` instead of the misleading `this tab` while sweep state is active without a live worker;
- stale sweep notices now expire after 15 seconds instead of remaining visible for up to an hour.

This is specifically intended to keep Continuous Full Sweep moving after coordinator crashes, tab loss, failed recovery reloads, or similar browser/network faults.

Focused self-healing soak: **20 rounds × 7 files = 140 test-file executions, 0 failures**. Full suite: **59/59 PASS**.

## v5.3.9 Extension reload soft-shutdown

Reloading an unpacked Chromium/Edge extension invalidates the old content-script context that remains attached to already-open OviPets tabs. v5.3.9 treats that as an expected shutdown condition instead of an unhandled runtime failure.

- synchronous `chrome.runtime.sendMessage(...)` throws are caught;
- once invalidated, the old content script stops calling runtime/storage APIs;
- storage reads return fallback/default values and writes become no-ops;
- worker/species/relay messages use the same guarded runtime client;
- Diagnostic Log calls cannot recursively create `Uncaught (in promise)` noise;
- the stale heartbeat timer self-stops after invalidation is detected.

After pressing **Reload** in `edge://extensions`, refresh already-open OviPets pages once so Edge injects the new v5.3.9 content scripts.

## v5.3.8 Protected Full Sweep Coordinator

The Full Sweep worker tab is now a protected coordinator. A 45-second heartbeat lapse is treated as a recoverable infrastructure fault, not permission to close the tab. Background health checks revive the lease and ask the same coordinator tab to resume; if the content script does not answer, the same tab is reloaded in place and recovery is retried. Durable sweep pass/index state is preserved.

Egg-tab cleanup also has a hard guard: even corrupted/stale egg registry state cannot close the coordinator tab when its id matches `coordinatorTabId`.

Only explicit Stop, a valid generation-scoped worker completion, or startup failure before the coordinator becomes live may close the Full Sweep coordinator.

Focused worker/sweep/egg/diagnostic soak: **20 rounds × 7 files = 140 test-file executions, 0 failures**. Full suite: **55/55 PASS**.

## v5.3.7 Diagnostic Logbook

A persistent privacy-scoped black-box recorder now captures worker lifecycle, Full Sweep passes, egg batch/tab lifecycle, watchdog timeouts, fail-open recovery, runtime/module exceptions and important failure/stopped status messages. The panel can **Export Diagnostic Log** as JSON or clear only the retained diagnostic timeline.

Retention is bounded to the newest 5,000 events and 14 days. Diagnostic/worker/sweep focused soak passed **20 rounds × 7 files = 140 test-file executions, 0 failures**. Export also includes a sanitized snapshot of current worker/sweep/egg/job state, making it possible to reconstruct why a long-running automation stopped or stalled.

## v5.3.6 fail-open watchdogs

Full Sweep now treats extension-created egg tabs as disposable workers rather than blockers. Each owned egg tab has a **60-second watchdog**. If no terminal result arrives, background marks it `timeout` and force-closes that owned tab. Each egg batch has a separate **120-second watchdog**; any unresolved owned tabs are force-closed, missing results become timeouts, and Full Sweep advances instead of stopping.

The background uses persisted deadlines plus Chrome Alarms, and every parent status poll re-checks the same deadlines, so MV3 service-worker sleep cannot turn a lost tab into an indefinite stall. Random batch-open/status/network/page errors are fail-open: the current friend is skipped safely (`skipRemoval`) and Continuous Full Sweep proceeds to the next friend. Only tabs present in the extension-owned egg registry are eligible for watchdog closure; user-opened tabs remain outside that registry.

## v5.3.5 species learning + continuous Full Sweep

### Leftover-tab recovery

Name-the-Species failures can no longer accumulate into a permanent `too-many-leftover-tabs` stop. Retryable incorrect answers keep using untried species choices; a blocking Error overlay exits as a bounded `abandoned` result; and every new egg batch reconciles old extension-owned leftovers before admission. Tabs the player navigated away are only forgotten, never auto-closed.


`Start full sweep` now loops continuously until **Stop**. After the last queued friend, the sweep wraps back to the first eligible friend and increments a durable pass counter. The existing 10-minute per-friend cooldown is preserved: if the next pass reaches the boundary before any friend is eligible, the worker remains active and waits until the earliest cooldown expires instead of reporting completion.

The dashboard shows `pass N`; Stop during a cooldown wait prevents the next pass from opening. A one-friend queue reloads the same Hatchery when its next pass begins so the SPA actually re-runs the scan.

## v5.3.5 species verification

Turn Egg remains real-UI-only. Live Edge data confirmed two distinct server outcomes:

- `The answer is incorrect, please try again.` is retryable. The wrong species is learned, the Error is dismissed, the same egg is turned again, and that species is excluded from the next guess.
- `The egg can no longer be turned.` is terminal. Only then is the extension-owned tab closed as exhausted.

The Species Inspector now learns directly from the real `pet_turn_egg` network result, captures Answer-ID mappings, and obtains a cross-origin-safe visual fingerprint through the guarded background image fetcher. This allows correct/wrong knowledge to transfer across different eggs when their challenge image matches.

The panel includes **Export Species DB** and **Import Species DB**. Backups merge idempotently, so knowledge can survive reinstall/update or move to another computer. Old Inspector exports can also be imported: v5.3.5 mines their recorded trace/network sessions to recover answer outcomes and Answer IDs even if the older `learnedMemory` was empty. **Export Species JSON** remains available for deeper offline analysis.

## Current status

See [docs/WORKING_STATE.md](docs/WORKING_STATE.md) for the authoritative current engineering state.

Phases 1–5 have been validated on the managed local runtime baseline. Phase 6 automated release gates are being completed. The two remaining live OviPets contracts still require manual verification before release.

The GitHub repository is not yet the authoritative runtime source: Issue #2 remains open until the complete source/test tree is imported and CI reproduces the same results from a clean checkout.

## Project docs

- [Working state](docs/WORKING_STATE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Refactor map](docs/REFACTOR_MAP.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Live QA checklist](docs/LIVE_QA_CHECKLIST.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Diagnostic Logbook](docs/DIAGNOSTIC_LOGBOOK.md)
- [Windows Edge QA](docs/WINDOWS_QA.md)
- [Agent workflow](docs/AGENT_WORKFLOW.md)
- [Agent/skill research](docs/AGENT_SKILL_RESEARCH.md)

Historical v5.3.0 README/CLAUDE material is retained under docs/archive/ for reference only.
