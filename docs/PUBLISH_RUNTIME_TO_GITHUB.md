# Publish the Validated Runtime to GitHub

Issue: #2
Release candidate: v5.3.0

The GitHub repository currently contains the engineering control plane but not the complete validated runtime/test tree.

## Preferred method

Use the final RC on the authenticated Windows development machine and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github.ps1
```

The script:

1. verifies JavaScript syntax;
2. verifies release/source consistency;
3. runs all 50 Node test files;
4. clones the latest GitHub `main` into a temporary directory;
5. overlays only the validated runtime, tests, tooling and historical evidence;
6. preserves the current GitHub control-plane docs as authoritative;
7. reruns all gates in the clean clone;
8. creates a release branch without force-pushing;
9. pushes the branch and prints the PR URL.

If `release/v5.3.0-runtime-import` already exists, the script creates a timestamped branch instead of overwriting it.

## Merge gate

Do not merge the runtime-import PR until:

- GitHub Actions runs from the clean checkout;
- syntax passes;
- release consistency passes;
- all 50 tests pass;
- PR diff contains no local-only Claude/session files;
- final regression review finds no new P0/P1 issue.

After merge, update WORKING_STATE.md so GitHub becomes the authoritative runtime source and close Issue #2.

## Current RC evidence

The final automated RC was clean-extracted and reverified with 50/50 tests passing. Its checksum is recorded externally in Issues #2 and #7 rather than inside the archive, avoiding a self-referential package hash.
