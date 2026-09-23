---
name: release-gate
description: Use before merging a runtime PR or releasing a new OviPets extension version.
---

# Release Gate

Run the automated gates:

- `node scripts/verify-js.js`
- `node scripts/verify-release.js`
- `node --test tests/*.test.js`

Then check the current `docs/RELEASE_CHECKLIST.md` and `docs/WORKING_STATE.md`.

Require relevant specialist review plus `oweh-regression-reviewer`, no local/session files, version consistency, owned-tab safety, generation-safe worker recovery and truthful mutation confirmation.

A green automated gate does not replace live OviPets verification. Do not call a release production-ready while required live/manual checks, repository clean-checkout CI, or P0/P1 issues remain open.
