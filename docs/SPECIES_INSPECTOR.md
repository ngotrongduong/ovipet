# Name the Species — Production Static Classifier

The old Inspector/learning pipeline is retired in the production runtime.

## Production model

The extension ships a compiled silhouette database in `data/species-static.js`.

Source:
- learning export: `2026-10-02T22:54:10.362Z`
- source extension: v5.10.2
- 31 species
- 721 retained silhouettes
- maximum 64 silhouettes per species

The source learning export contained 1,581 silhouette examples. The production build reduces each species to at most 64 diverse representatives with deterministic farthest-point selection. On the 110 recent retained quiz sessions with an authoritative confirmed answer, the reduced library scored 110/110 in the offline leave-one-out check used for this migration.

This validation describes that retained dataset; it is not a guarantee that OviPets can never introduce a new species, pose or rendering change.

## Runtime flow

For each real Name the Species dialog:

1. Open the real egg profile and click the real Turn Egg button.
2. Keep the real Name the Species dialog visible in the egg tab.
3. Read the challenge image silhouette.
4. Compare only the answer options currently offered by OviPets against the built-in static library.
5. Click the selected real option and real OK button.
6. Wait for the real OviPets result.
7. Persist only an aggregate `correct` or `wrong` counter.

A rejected choice is remembered only in RAM for that current egg so the immediate retry does not repeat the same answer. It is not written to storage.

## Persistent Species data

The production runtime stores only:

```json
{
  "owehSpeciesStats": {
    "correct": 0,
    "wrong": 0
  }
}
```

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
- raw correct/wrong mappings by image;
- egg/user IDs for Species learning;
- network traces;
- source-code hints;
- mutable silhouette examples;
- unresolved-question review data.

The old Inspector, Species Review, seed learner, mutable shape writer and MAIN-world Species network tracing are removed from the production package/runtime.

## Full Sweep performance

Lightweight Full Sweep tabs still block ordinary page images, media and fonts. A higher-priority tab-scoped allow rule permits only the `/credit-challenge` image needed by Name the Species.

The answerer uses the normal challenge image when available and falls back to the guarded Species image fetch only if the direct image cannot be read. No fetched challenge image is saved.

This keeps the real Name the Species step while removing the previous multi-tab storage writes, trace serialization, source inspection and repeated learning work.
