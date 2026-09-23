# v5.3.16 — Pedigree Guard + Male Fallback

Date: 2026-09-23

## Trigger

Live v5.3.15 breeding displayed OviPets `Error — Unable to breed pets.` while the extension later recorded `command-timeout`. The exported diagnostic also showed repeated direct-breeding rejections in the same campaign.

## Root cause

Pedigree is lazy-loaded. v5.3.15 activated the Pedigree tab, slept a fixed 350 ms, then cached the profile. An empty `ancestors` array was considered complete, while `ancestorsOverlap()` interpreted a missing/empty side as unrelated. A slow Pedigree response could therefore create a false-safe pair.

The bridge also waited only for the `ui_action_cmdExec` success callback. OviPets can instead render `Unable to breed pets.` without invoking that callback, so the real rejection was mislabeled as a timeout.

## Fix

- Pedigree verification requires the actual lazy payload and 300 ms stable ancestor signature.
- Database schema metadata is 4; old unverified records refresh once.
- Relationship checking is fail-closed.
- Planner stores the ordered safe male list for every female.
- Runtime revalidates pedigree immediately before dispatch.
- `Unable to breed pets.` is detected/dismissed and surfaced as `unable-to-breed-pets`.
- That male is rejected for the current female and the next safe candidate is tried.
- `command-timeout` also falls through to the next candidate as a compatibility safety net.
- Campaign execution format is `database-direct-v2`; older in-progress campaigns stop safely after upgrade.

## Required live gate

1. Start a fresh v5.3.16 campaign so legacy pedigree rows are refreshed.
2. Confirm no command is sent while a profile remains pedigree-unverified.
3. Confirm a server-rejected pair shows an alternate-male retry instead of skipping the female.
4. Confirm a successful alternate marks the female on cooldown and advances once.
