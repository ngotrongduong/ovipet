# v5.3.16 — Pedigree Guard + Male Fallback

Date: 2026-09-23

## Live trigger

v5.3.15 displayed OviPets `Error — Unable to breed pets.` during direct breeding while the extension recorded repeated `command-timeout` rejections.

## Root cause

Pedigree is lazy-loaded. v5.3.15 activated the Pedigree tab, waited a fixed 350 ms, then read the profile. An empty `ancestors` array was accepted as a complete pet record, and the old overlap check failed open when either ancestor list was empty. A slow pedigree response could therefore make a related/unknown pair appear safe.

The page bridge also waited only for the success callback from `ui_action_cmdExec('pet_breed', ...)`. OviPets can render `Unable to breed pets.` without invoking that callback, causing a real server/UI rejection to be mislabeled as `command-timeout`.

## Fix

- Actual lazy Pedigree ancestor fieldset is required.
- Ancestor ID signature must remain stable for 300 ms; one bounded tab reopen is attempted.
- `pedigreeVerified=true` is required for a complete cached pet.
- Database metadata schema version is 4, forcing v5.3.15 pedigree rows to refresh.
- Pair compatibility fails closed on unverified pedigree.
- Direct ancestors/shared ancestors are rejected before dispatch.
- Both strategies persist the full ordered male candidate list for each female.
- Runtime revalidates pedigree immediately before dispatch.
- `Unable to breed pets.` is detected/dismissed and returned as `unable-to-breed-pets`.
- A rejected male is recorded for the current female and the next safe male is tried.
- `command-timeout` also falls back to the next male as a compatibility safety net.
- Campaign execution format is `database-direct-v2`; older in-progress campaigns stop safely after upgrade.

## Verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full suite: 59/59 PASS
- Focused pedigree/breeding soak: 20 rounds × 7 files = 140 executions, 0 failures
- Clean-extracted final ZIP: 59/59 PASS
- Final ZIP SHA-256: `d4fa19b3a8fc6caca656350aeca0b78078e54bf6639890d3a49e3d203d9d4860`

## Live gate

Start a fresh v5.3.16 campaign. Confirm legacy profiles are re-indexed, no unverified pedigree pair is dispatched, and any server-rejected pair retries an alternate male for the same female.