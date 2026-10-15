# OviPets Friend Sweep Lite

Standalone low-resource extension whose only job is friend egg sweeping.

## Included
- scan the currently visible/expanded Friends list;
- visit each friend's Hatchery;
- open only turnable egg profiles;
- use the real Turn Egg UI;
- keep the real Name the Species dialog;
- rolling low-resource egg-tab pool;
- one final friend Hatchery verification after a batch;
- automatic next sweep cycle after a cooldown;
- Start / Stop / compact progress UI;
- persistent Name the Species correct/wrong totals;
- compact wrong-only review queue (max 250 deduplicated cases) with an **Export wrongs** button; normal successful questions are never logged.

## Name the Species (0.2.0, shared with the full extension)

The quiz draws from about 39 species since 2026-10. Lite now carries the same files as the full extension (`SHARED_FROM.txt` names them and the commit they came from):

- **Built-in library**: 1,691 silhouettes in 39 species (was 451 in 10).
- **Learns while it runs**: when the game accepts an answer, that picture's silhouette is kept for a species the built-in library knows poorly, and for any species after a first wrong answer. Learned silhouettes are matched next to the built-in ones.
- **Safety pause**: after 3 wrong answers in a row, or more than 10 wrong within one hour, Lite stops the sweep and opens the review page. Look at the wrong answers, press **Resume** (panel or review page), then **Start** again. Start is refused while paused.
- **Review wrongs** (panel button): one card per missed picture with the real quiz picture, the answers the game rejected and the remaining options. Click the right species and Lite learns it at once. **Export wrongs** / **Export learned** on that page download the data for folding into the built-in library.

Totals and wrong cases saved by Lite 0.1 are kept (moved to the shared storage keys on first start). What the full extension learned on its own is not copied: Lite is a separate extension with its own storage and learns for itself.

## One database with the full extension (0.4.0)

Lite and the full extension, on any PC, share one list of Name-the-Species silhouettes: a public GitHub gist of the repository owner (masks only, no ids or pictures). Every install reads it every hour and takes what it lacks, so what one learns, all answer. To let this install also **send** what it learns (and what the game rejects), open **Review wrongs** → **Shared database** and save a GitHub token with only the `gist` permission — the box explains how. Without a token Lite still receives.

## Automatic updates (0.3.0)

Two parts, so that nothing has to be clicked after the first setup:

1. **The extension reloads itself.** Once a minute it looks at its own folder; when the `manifest.json` there carries another version than the one that is running, it reloads itself and refreshes the OviPets tabs. It does that only when no sweep is running, or in the wait between two passes (the sweep then simply carries on). While it waits, the panel shows a line such as "v0.3.1 is ready — waiting for the sweep".
2. **The folder is fed from GitHub.** Double-click **`Enable auto-update.bat`** once (in this folder). It creates one Windows scheduled task for your user account that runs `auto-update.ps1` every 30 minutes: the script compares this folder with the version on the stable `main` branch on GitHub and, if that is newer, copies the files in. The batch file starts the task once through the Task Scheduler and waits for the script's mark (`auto-update-last-check.txt`), so "Automatic updates are ON" means it really ran; it first tries a launcher that shows no window at all and falls back to the standard one (a window may flash for a moment) if that leaves no mark. **`Disable auto-update.bat`** removes the task again.

First setup on a PC: unzip this folder somewhere it can stay, load it once with **Load unpacked** on the browser's extensions page, then run `Enable auto-update.bat`.

What the updater will not do: it never deletes anything in this folder, it refuses to run in a folder that is not this extension, it never copies scripts (`.ps1`, `.bat`, …) from the download — so what the scheduled task runs can not be replaced from the internet — and it throws a download away unless it is a complete, newer release. `auto-update-last-check.txt` shows when it last ran and what it found; `auto-update.log` keeps the last 200 updates and failures.

## Deliberately excluded
Breeding, own-Hatchery automation, pet database, retention/culling, Ninja/Ads, friend removal, blacklist, the old Species Inspector/import tools, large diagnostic logs, pet naming, feeding, enclosure management, alert sound.

## Low-resource policy
Adaptive egg concurrency starts at 3, may promote to 4 then 6 after clean work, and demotes on timeout/failure. Ordinary images, media and fonts are blocked in extension-owned sweep tabs; the Name the Species credit-challenge image is explicitly allowed.

Do not enable Friend Sweep Lite and the full OviPets extension at the same time. Both can react to Name the Species.

## Releasing a change (for whoever edits this)
Shared files: from a checkout of the full extension's branch run `node scripts/sync-lite-species.js <path-to-that-checkout>`. Run `tests/friend-sweep-lite*.test.js`. Then raise `version` in `manifest.json`, validate CI and merge into `main`: the updater reads the stable `main` branch, not this development branch. The version is what both the updater script and the extension look at, so a merge without a version bump reaches nobody.
