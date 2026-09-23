# v5.3.17 — Breeding Dependency-Wiring Hotfix

Date: 2026-09-23

## Live trigger

After v5.3.16 completed pedigree/profile refresh and entered `breeding 0/33`, runtime repeatedly threw `Cannot read properties of undefined (reading 'pedigreeCompatibility')` from `features/breeding.js`.

## Root cause

`domain/pedigree.js` was present and loaded before breeding, but the real `domain` helper object passed by `content.js` into `OWEH.boot(...)` omitted `pedigree: OWEH.domain.pedigree`. The feature-unit tests supplied a direct pedigree mock, so this integration omission escaped the previous 59-test suite.

## Fix

- Inject `OWEH.domain.pedigree` through the real content boot helper object.
- Add a global fallback in the breeding feature; manifest dependency order guarantees `domain/pedigree.js` is loaded first.
- Assert the required `pedigreeCompatibility` API during feature startup.
- Add `content-domain-wiring.test.js` to verify manifest order plus actual boot wiring.
- Strengthen `database-breeding.test.js` with the exact pedigree injection contract.

## Safety

No pedigree rule is relaxed. v5.3.16 fail-closed verification, direct/shared-ancestor rejection, pre-dispatch compatibility re-check, and alternate-male fallback remain unchanged.

## Verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: 60/60 PASS
- Focused wiring/pedigree/breeding soak: 20 rounds × 8 files = 160 executions, 0 failures
- Clean-extracted final ZIP: 60/60 PASS
- Final ZIP SHA-256: `df388ba98c7298e2a293d56623b090ce4c2d55db111e5a546ed370cb215b5df9`