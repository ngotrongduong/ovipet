# OviPets Friend Sweep Lite

Standalone low-resource extension whose only job is friend egg sweeping.

## Included
- scan the currently visible/expanded Friends list;
- visit each friend's Hatchery;
- open only turnable egg profiles;
- use the real Turn Egg UI;
- keep the real Name the Species dialog;
- static 10-species / 451-silhouette classifier;
- rolling low-resource egg-tab pool;
- one final friend Hatchery verification after a batch;
- automatic next sweep cycle after a cooldown;
- Start / Stop / compact progress UI;
- persistent Name the Species correct/wrong totals only.

## Deliberately excluded
Breeding, own-Hatchery automation, pet database, retention/culling, Ninja/Ads, friend removal, blacklist, Species learning/Inspector, review/export/import tools, large diagnostic logs, pet naming, feeding, enclosure management.

## Low-resource policy
Adaptive egg concurrency starts at 3, may promote to 4 then 6 after clean work, and demotes on timeout/failure. Ordinary images, media and fonts are blocked in extension-owned sweep tabs; the Name the Species credit-challenge image is explicitly allowed.

Do not enable Friend Sweep Lite and the full OviPets extension at the same time. Both can react to Name the Species.
