# Name the Species — Production Static Classifier

The old Inspector/learning pipeline is retired in the production runtime.

## Production model

The extension ships a compiled silhouette database in `data/species-static.js`.

Source:
- learning export: `2026-10-02T22:54:10.362Z`
- source extension: v5.10.2
- 10 real Name-the-Species quiz species: Canis, Draconis, Equus, Feline, Gekko, Lupus, Mantis, Raptor, Slime, Vulpes
- 450 confirmed quiz silhouettes allocated by the observed per-species sample counts:
  - Canis 46
  - Draconis 30
  - Equus 49
  - Feline 45
  - Gekko 38
  - Lupus 40
  - Mantis 58
  - Raptor 55
  - Slime 45
  - Vulpes 44
- plus 1 additional Slime coverage silhouette selected because the 45-sample Slime set missed one retained leave-one-out case
- total production library: 451 silhouettes
- the other 21 species learned elsewhere are intentionally excluded because they have not appeared in the Name-the-Species option pool

The source learning export contained 1,581 silhouette examples across 31 species. The production build discards the 21 non-quiz species and does not divide the remaining capacity evenly: it follows the actual confirmed quiz sample distribution shown by the Species pool. This preserves more representatives for species with more confirmed variation, especially Mantis and Raptor. The resulting 451-silhouette library scored 110/110 on the 110 retained quiz sessions with an authoritative confirmed answer in the offline leave-one-out check used for this migration.

This validation describes that retained dataset; it is not a guarantee that OviPets can never introduce a new species, pose or rendering change.

## Runtime flow

For each real Name the Species dialog:

1. Open the real egg profile and click the real Turn Egg button.
2. Keep the real Name the Species dialog visible in the egg tab.
3. Read the challenge image silhouette.
4. Compare only the answer options currently offered by OviPets against the built-in static library.
5. Click the selected real option and real OK button.
6. Wait for the real OviPets result.
7. Persist the aggregate `correct` or `wrong` counter.
8. Only when OviPets explicitly rejects an answer, save one compact wrong-case record for later review. If a retry succeeds, update that same case with the confirmed correct species.

A rejected choice is remembered only in RAM for that current egg so the immediate retry does not repeat the same answer. It is not written to storage.

## Persistent Species data

The production runtime stores the aggregate totals plus a capped wrong-only review queue:

```json
{
  "owehSpeciesStats": {
    "correct": 0,
    "wrong": 0
  },
  "owehSpeciesWrongCases": [
    {
      "eggId": "…",
      "source": "…/credit-challenge",
      "shape": "<32x32 alpha mask>",
      "options": ["…"],
      "wrongSpecies": "…",
      "method": "shape-match",
      "distance": 0,
      "correctSpecies": "…"
    }
  ]
}
```

The wrong-case queue is deduplicated, capped at 250 records, and contains no image bytes or full quiz trace.

On the first production stats update, legacy learning keys are removed:

- `owehSpeciesMemory`
- `owehSpeciesAnswerIds`
- `owehSpeciesShapes`
- `owehSpeciesInspectorV1`
- `owehSpeciesSeedSeen`

Existing lifetime `correct` and `wrong` totals are preserved during this compaction.

## Data intentionally not stored anymore

The production runtime does not store or collect:

- challenge thumbnails;
- exact-image fingerprints/history;
- question HTML;
- Answer-ID history;
- full correct/wrong mappings for normal questions;
- egg/user IDs for Species learning;
- network traces;
- source-code hints;
- mutable silhouette examples;
- unresolved-question review data.

The old Inspector, Species Review, seed learner, mutable shape writer and MAIN-world Species network tracing are removed from the production package/runtime. A small **Export wrongs** action downloads only the retained rejected cases for targeted classifier improvement.

## Full Sweep performance

Lightweight Full Sweep tabs still block ordinary page images, media and fonts. A higher-priority tab-scoped allow rule permits only the `/credit-challenge` image needed by Name the Species.

The answerer uses the normal challenge image when available and falls back to the guarded Species image fetch only if the direct image cannot be read. No fetched challenge image is saved.

This keeps the real Name the Species step while removing the previous multi-tab storage writes, trace serialization, source inspection and repeated learning work.
