# OviPets Extension — Working State

Last updated: 2026-09-20
Current release baseline: v5.3.5
Current repository phase: Phase 0 — runtime import/CI bootstrap remains open
Current local implementation status: Phases 1–5 plus current Phase 6 automated gates validated; live/manual gates remain.

## Current verification

- JavaScript syntax: PASS
- release consistency: PASS
- Node tests: **53/53 PASS**
- clean-extracted ZIP reproduces 53/53
- three consecutive full-suite rounds: 53/53 each
- focused Egg/Species/DB soak: **20 rounds × 8 files = 160 test-file executions, 0 failures**
- local-only Claude/session files absent from release package

## Validated architecture

Phases 1–5 remain validated: hardened worker lifecycle, deterministic domain modules, explicit core/DOM adapters, extracted feature/UI state machines, split background services and targeted database reads.

### v5.3.5 live-driven behavior

- Turn Egg is UI-only through extension-owned profile tabs.
- Continuous Full Sweep loops until Stop and honors friend cooldown.
- `The answer is incorrect, please try again.` is retryable: explicit negative evidence is stored, Error is dismissed, the same egg is retried, and that species is excluded.
- `The egg can no longer be turned.` is terminal: only then does the owned tab close as exhausted.
- Timeout, silence, navigation and selecting another option are **not** evidence of a wrong species.
- Species Inspector learns from real network outcomes and Answer IDs.
- A guarded background fetcher retrieves only OviPets credit-challenge images so the Inspector can compute a perceptual fingerprint; Species Answer uses the same identity.
- **Export Species DB / Import Species DB** provides portable learning persistence across reinstall/machines.
- Import is idempotent and merges with existing knowledge.
- Old full Inspector exports can be mined during import to recover trace-based outcomes/Answer IDs when old learned-memory fields were empty.

### v5.3.5 leftover-tab recovery

Live QA found `too-many-leftover-tabs` after Name-the-Species failures accumulated as kept-open leftovers. v5.3.5 removes the fixed 3-attempt stranding path, closes bounded species-UI failures as extension-owned `abandoned` results, and reconciles all older leftover registry entries before admitting a new batch. The safety rule remains: only a tab still on the exact owned OviPets egg page may be auto-closed; navigated-away tabs are only removed from ownership state.

Focused regression: 20 rounds × 6 egg/sweep/species files = 120 test-file executions, 0 failures. Clean ZIP still passes 53/53.

## Still open

- live v5.3.5 incorrect → different second guess on the same egg;
- live terminal no-longer-turnable → owned tab closes and batch continues;
- Export Species DB → clean/new Edge profile → Import → learned mapping restored;
- worker Start/Stop/reload recovery;
- multi-hour live-game soak;
- complete runtime/test tree imported to GitHub and clean-checkout CI green;
- friend-request state remains intentionally `dispatched` unless a reliable confirmation signal is observed.

## Invariants

- OviPets mutations use the real UI/dispatcher bridge.
- Only one shared worker lease may be active.
- Worker transitions are owner + generation + owning-tab scoped where applicable.
- Only extension-created tabs that still belong to OviPets may be auto-closed.
- Command dispatch is not the same as confirmed game mutation.
- Turn Egg must not use the extension's hidden game-command bridge.
- Species negative learning requires explicit incorrect Error/network evidence.

Every merged architectural/behavioral change must update this file.
