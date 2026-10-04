# OviPets pure-breeding reference

Condensed from the community "Pure Line Making" lesson series (Google Doc, shared by the
project owner, 2026-09-17). This is domain knowledge for the breeding-rank feature in
`content.js` — read it before touching `pairScore`, `nearestPureColor`, or
`suggestedPetName`.

## Core vocabulary

- **Pure**: a pet bred to hit an exact Hex/RGB code recognized by Ovi (official, with a
  dot next to the gender icon) or by the community (unofficial, no dot).
- **Hex code**: read as three pairs `RR|GG|BB`, each ranging `00`–`FF` in the order
  `0123456789ABCDEF`. **RGB code**: same three channels, each `0`–`255`.
- **Lock** (in the in-game generator): forces one channel (R, G, or B) of a gen to an exact
  target value; the other channels land anywhere in range. Teal, Pink, Purple, Olive,
  Silver, and Grey each need only a single-channel lock; every other color (including the
  original 8 — white, black, red, yellow, green, blue, cyan, magenta) needs 2+ locks.
- **Lock group**: the set of gens produced under the same single-channel lock. Early
  breeding pairs pets *within* the same lock group; once those are as close as they'll get,
  breeders *cross-breed between different lock groups* (e.g. an R-locked line × a G-locked
  line) so each parent contributes the channel it's already strong on — this is what pulls
  every channel toward target at once instead of just one.
- **Off-pure / off-target distance**: sum of `|actual − target|` across the RGB channels of
  a color slot. Used both to name pets (e.g. hex `C0C6B0` vs. silver `C0C0C0` = 6 (G) + 16
  (B) = 22 off) and to judge which candidate partner to breed next.
- **A locked channel can only ever get as pure as the worst value that channel was ever
  genned with** — breeding can't invent a better value than what already exists in the
  gene pool for that channel.

## Why offspring land "between" the parents

The game's own breeding roll for each channel lands *somewhere between the two parents'
values for that channel* (not fixed at the midpoint — the parents just bound the range).
That means:

- If the target value for a channel falls **inside** `[min(parentA, parentB), max(...)]`,
  this pairing can reach target on that channel this generation.
- If the target falls **outside** that range, no roll from this pairing can reach it — the
  closest achievable value is whichever parent is already nearer to target, and future
  generations still can't do better than that parent's value for this pairing.

This is the basis for `pairScore` in `content.js`: score a channel as (near-)zero when
target is bracketed by the two parents, and as the *nearer parent's remaining distance*
when it isn't — not a plain midpoint-distance formula.

## Breeding workflow (single pure, e.g. Silver `C0C0C0` / `192,192,192`)

1. Pick one species you can sustain long-term and one beginner color (Silver, Grey,
   Purple, Teal, Olive, Pink) — not one of the original 8.
2. Gen a starter set (18–24 pets is enough for a single-lock color; ~54 for a multi-pure
   with several locks), split evenly across each needed lock.
3. Name pets by their hex or RGB code so off-target distance is visible at a glance.
4. Breed within each lock group first (temporary pairings only — nothing in a pure line is
   a permanent bond).
5. Once those offspring are as close as that group gets, cross-breed *between* lock groups,
   always picking the partner whose per-channel values best bracket the target with the
   current parent.
6. Repeat on hatched offspring, always breeding toward whichever candidate brackets the
   most channels / minimizes remaining distance on the rest.
7. On the first pure: DNA-check male/female. Then either (a) breed it into more
   near-target pets to slowly accumulate purs, or (b) "abuse breed" — get/splice a male
   pure and mass-breed it against many near-target females, keeping only pure or ≤5-off
   eggs.

## Inbreeding / pedigree check

Small starter sets mean pets end up related. Only pets in the **visible pedigree** count
as blocked relations — anything outside it (present in the full unseen pedigree) can still
breed. Community method to track this at scale: tattoo every ancestor in a pure's visible
pedigree with one distinct color per pure line; before breeding two candidate pures
together, check whether their visible pedigrees share a tattoo color (shared visible
ancestor → game will refuse the pairing). This is the model for the extension's ancestor-
overlap warning.

## Which pets and eggs are surplus (endpoint targets)

Every channel of the strict target (`FFFFFF · FF0000 · 000000 · FF0000 · 000000`) is an
endpoint, 00 or FF. Measured on the owner's 2,718 bred Draconis (40,770 channels, 2026-10-05):

- an offspring channel always lands inside the parents' `[min, max]` (0 exceptions);
- when both parents are exact on a channel the offspring is exact (1,451 of 1,451);
- when one parent is exact and the other is `d` away, the offspring is exact about 1 time in
  `d + 1` (1,347 hits against 1,372 predicted; a little better than that for `d ≤ 15`, a
  little worse beyond).

So what a pet can pass on in one channel is worth `1 / (d + 1)`: 100% when exact, 50% one
step off, 25% at 3, 10% at 9, under 5% from 19 on. `domain/surplus.js` compares pets on that
scale over all 15 channels of the five slots — not Body 1 alone, because the other slots
have to become pure later too.

A pet is **surplus** when at least `minReplacements` (panel: Spares, default 10) kept pets of
its own sex are worth as much in every channel, give or take 0.05. An exact channel can only
be replaced by an exact one; anything 19 or more off counts as equally far. Pets are judged
best first, so a replacement is always a pet that stays. Identical pets replace each other:
the first `minReplacements` copies stay, later copies can go. An **egg** has no sex yet, so it
needs that many replacements among the kept males and among the kept females.

On the 2026-10-05 stock (1,898 pets, 975 eggs) with 10 replacements this lists 426 females,
293 males and 316 eggs; removing them — and even the 3–9 tier — leaves the best mate of every
kept pet unchanged. The rule it replaces (at least as close on all 15 channels by exact
distance, two lineages) listed 1 egg.

Pedigree is deliberately not part of the rule (owner decision 2026-10-05): with ten
replacements a related pair always has an unrelated alternative. **Generated** pets (wand
icon), pets whose Generated flag was never read, and pets in a breeding plan are never listed.
Pets already in Males discard are reviewed but never count as a replacement.

Lock groups explain the stock: the 136 Generated founders are exact on one channel in all
five slots (R, G or B: 5 exact channels each). Progress means stacking exact channels from two
groups in the same pet, and that is what the surplus rule protects: a pet exact where few
others are is never replaceable, however far the rest of it is.

## Pricing / rules (context only, not implemented in the extension)

New single pures: 600–800c (pairs 1000c+). Multi-pure, popular species: ~750c
(pairs ~1500c). Pure eyes/extras: 300–500c (pairs 600–1000c). Never sell unfinished/off
pures — it undercuts the finished line. Keep rules minimal (no cloning, no free/paid
breeding) — heavy-handed rules or public confrontation hurt sales more than they protect
the line.

## Known gaps / needs live confirmation

**Resolved 2026-09-17** (see `docs/dom-audit-2026-09-17.md`): the two forum-thread hashes
originally given for the Official/Unofficial pure-color lists both redirect to the forum
group's Members page — reading them requires joining group 8966, which was deliberately
not done. Instead, the 47-color **Official** list was read live from OviPets' own Help FAQ
(`?src=help&sub=faq`, "What types of pure colors are there?") and is now the exact
`PURE_COLORS` table in `content.js`. The **Unofficial** list remains unavailable unless the
Game Owner decides joining that forum group is acceptable.
