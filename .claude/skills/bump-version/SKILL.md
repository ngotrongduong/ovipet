---
name: bump-version
description: Use when asked to bump, release, or tag a new version of the OviPets Hatchery Helper extension. Updates the canonical release-version markers and runs the release consistency gate.
---

# Bump Version

The canonical release version must agree in four current-state locations:

1. `manifest.json` — `"version": "X.Y.Z"`.
2. `ui/panel.js` — `<span class="oweh-version">vX.Y.Z</span>`.
3. `README.md` — `Current release: **vX.Y.Z**`.
4. `docs/WORKING_STATE.md` — `Current release baseline: vX.Y.Z`.

Historical/archive documents may intentionally contain older version strings and are not canonical.

## Procedure

1. Read all four canonical markers and stop if they do not already agree.
2. Update only those canonical version markers to the requested semantic version.
3. Run `node scripts/verify-release.js`.
4. Run `node scripts/verify-js.js` and `node --test tests/*.test.js` for a real release candidate.
5. Update release/changelog documentation if the version corresponds to a behavior change.
6. Do not modify unrelated number-like values such as pet IDs, delays, color values or historical version references.

Never grep/replace the old version blindly across `docs/archive/` or historical audit documents.
