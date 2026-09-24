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

## Why dominated males are safe to cull (endpoint targets)

Every channel of the strict target (`FFFFFF · FF0000 · 000000 · FF0000 · 000000`) is an
endpoint, 00 or FF. An offspring channel lands inside the parents' `[min, max]`, so it can
only reach FF if one parent is FF there, and the chance shrinks as the other parent moves
away from FF. Take two males of the same species, N and M. If N is at least as close to the
target as M on all 15 channels, then for **any** female the pair (female, N) can reach every
channel (female, M) can, with an equal or better chance. M adds nothing except its pedigree,
because N may share an ancestor with some female and be refused. v5.6.0 **Plan cull**
(`domain/male-cull.js`) therefore marks M only when at least two kept males from different
lineages dominate it. Identical males count as dominating each other, so the first two copies
stay and later copies can go. **Confirm cull** moves the marked males to **Males discard**,
which is reversible, and it never deletes or sells a pet.

The same review reports **channel coverage**: target channels that no present male or female
hits exactly. Such a channel can never be bred pure from the current stock, however long the
campaign runs, so it needs a new pet (generated or bought) that is exact there.

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
