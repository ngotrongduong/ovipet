# v5.3.17 — Breeding Dependency-Wiring Hotfix

Date: 2026-09-23

## Live trigger

After v5.3.16 completed its one-time pedigree/profile refresh and entered `breeding 0/33`, execution repeatedly threw `Cannot read properties of undefined (reading 'pedigreeCompatibility')` from `features/breeding.js`.

## Root cause

`domain/pedigree.js` was present and loaded before breeding, but the `domain` helper object created by `content.js` omitted `pedigree: OWEH.domain.pedigree`. Unit tests for the breeding feature supplied a direct pedigree mock, so they did not exercise the real content boot dependency graph.

## Fix

- Inject `OWEH.domain.pedigree` through the real `OWEH.boot(...)` helper object.
- Add a global fallback in the breeding feature, safe because manifest dependency order loads `domain/pedigree.js` first.
- Assert the required `pedigreeCompatibility` API during feature startup.
- Add a dedicated integration wiring regression and strengthen the database-breeding contract test.

## Safety

No pedigree rule is relaxed. v5.3.16 fail-closed verification, direct/shared-ancestor rejection, direct pre-dispatch revalidation, and alternate-male fallback remain unchanged.

## Verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: **60/60 PASS**
- Focused wiring/pedigree/breeding soak: **20 rounds × 8 files = 160 executions, 0 failures**
- Clean-extracted final ZIP: pending packaging gate

