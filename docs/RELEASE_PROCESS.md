# Release process — Full Extension and Friend Sweep Lite

## Branches and pull requests

- Make changes on `feature/`, `fix/`, or `chore/` branches (existing `feat/` branches are also accepted).
- Keep PR descriptions current: actual manifest version, feature scope, automated CI, **which** live checks occurred and which remain.
- Merge only when GitHub's mergeability is clean, current-head checks are green and the change's applicable live gate is accepted.
- Preserve history with ordinary merges; avoid force-push to `main` and do not re-merge a PR already merged.

## Full Extension

1. Bump the full `manifest.json` version when users should load a newer build; update README notes and tests together.
2. Confirm `node scripts/verify-js.js`, `node scripts/verify-release.js` and `node --test tests/*.test.js` locally or in CI.
3. Validate affected OviPets behavior in Edge using a separate test installation, especially game-changing operations and worker recovery.
4. Merge to `main`, then confirm `Extension CI` passes for the merge commit.
5. Publish a GitHub Release with release notes, exact commit/tag and artifact(s) **only when explicitly approved**. Do not claim a Release was created merely because a manifest version exists.

## Full Extension automatic Windows updates

- The optional [Windows installer](WINDOWS_AUTO_UPDATE.md) polls `main` and checks a successful `Extension CI` run for the **exact commit SHA** before downloading a source archive pinned to that SHA.
- It updates the currently loaded **unpacked** extension folder only when Edge/Chrome/Brave processes have exited; never force an in-flight Full Sweep to update. `manifest.json` is written last after preparing the backup.
- The updater scripts themselves are **not** downloaded and replaced by the unattended task. The owner installs the ZIP kit once, and can disable the task or restore the previous version locally.
- Since the updater selects the HEAD of `main`, do not treat a draft PR, failed CI build, manifest version text alone or a successful PR check as an eligible automatic release. Confirm **main push CI** after merging.

## Friend Sweep Lite

1. Keep `friend-sweep-lite/` as a self-contained extension with its own `manifest.json` version and README.
2. When shared species implementation changes in Full, synchronize via `node scripts/sync-lite-species.js <full-extension-checkout>`; check `friend-sweep-lite/SHARED_FROM.txt` and run Lite contract tests.
3. Package the contents **inside** `friend-sweep-lite/`, so `manifest.json` is at ZIP root. The `Package Friend Sweep Lite` workflow produces an Actions artifact; an artifact is not a GitHub Release.
4. For machines with unattended Lite updates, pull only from stable `main` after the Lite PR has been accepted. Windows updater scripts are intentionally not replaced automatically.
5. Confirm Lite-only QA separately (tab management, 60-second watchdog, background recovery, wrong-answer pause/review and steady memory usage) before calling Lite production-validated.
6. The full extension and Lite should **not** both run against the same OviPets browser profile.

## Secrets and operational safety

- Never commit tokens or user database exports. Restrict GitHub Gist tokens to the minimum available scope and revoke any leaked token.
- Avoid changing automatic release/update behavior without verifying source branch, version bump, files packaged, and rollback method.
- Preserve the current user-confirmed Discard and Full Sweep behavior; re-run focused checks after changes to those paths.
