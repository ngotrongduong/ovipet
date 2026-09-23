# Scalable automation (v4.19)

## Pair planner

The planner first groups eligible pets by the focused species and filters males to the
`Males` enclosure. For each female it computes a cheap Body 1 complement score and keeps
at most 40 candidates. Only that shortlist receives the complete target-range,
probability, pedigree, and diversity calculation.

Ordering remains strict:

1. Body 1 pure is reachable this generation;
2. Body 1 probability and complementary FF coverage;
3. whole-target reachability and locked channels;
4. recent male usage and parent-line usage;
5. range width, target distance, and stable Pet ID tie-break.

Thus diversity can choose between equivalent-quality males but cannot replace a male
that creates genuinely better FF progress.

## Pedigree graph

OviPets exposes three visible ancestor generations. The extension stores the original
flat ancestor array for compatibility and adds `pedigree`, `parentIds`, generation, and
an `inferred` marker. Shared visible ancestors continue to block a planned pair.

## Enclosure snapshots

Each Overview enclosure receives a deterministic fingerprint built from Pet ID, image
modification marker, cooldown heart, and displayed name. An unchanged fingerprint reuses
the previous parsed records. DOM stability is measured from repeated identical card
signatures rather than one unconditional page-delay sleep.

## Reconciliation and health

The Database Health line reports stale or incomplete records, live/stale task leases,
and dispatched mutations with no callback. A later Overview scan reconciles breeding
commands against the mother's live blue-heart state. No destructive cleanup is performed
by the health check.
