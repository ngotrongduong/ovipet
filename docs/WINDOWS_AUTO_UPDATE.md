# Windows / Edge Full Extension GitHub auto-update

This is the Windows updater for the Full OviPets Hatchery Helper, not Friend Sweep Lite. It installs into the existing unpacked extension folder. The existing in-extension self-update service already detects local manifest changes; this separate updater fetches and copies released source from GitHub.

## One-time installation

1. Find the directory originally chosen in Edge under Load unpacked. It contains manifest.json.
2. Download the **OviPets-Full-GitHub-AutoUpdater** ZIP from the GitHub Actions packaging workflow. Extract the five installer files next to manifest.json.
3. Double-click **Enable auto-update.bat** once. Windows Task Scheduler creates **OviPets Full Extension update**, checking every **30 minutes**. No admin privileges should be required when the unpacked folder belongs to your Windows account.
4. Review **auto-update-last-check.txt** (last status) and **auto-update.log** (last 150 log entries).

**Update now.bat** manually checks and applies when Edge is closed. It explicitly clears any hold recorded after rollback, so use it only when you intend to retry a blocked version. **Disable auto-update.bat** removes the scheduled task without deleting extension data. **Restore previous version.bat** restores the most recent backup, but only with the browsers fully closed.

## Verified-update security model

- GitHub source is hardcoded to repository **ngotrongduong/ovipet**, branch **main**; never a draft PR, fork or user-entered URL.
- A higher manifest version is required, plus a completed successful **Extension CI** push run for the EXACT current main commit SHA. This prevents a pending/failed build from being auto-installed.
- The archive is fetched by that immutable commit SHA; the updater validates extension identity, Manifest V3, imported scripts, content scripts, required assets and release-version markers before installing.
- Only allowlisted runtime files under known directories are copied. BAT/PowerShell scripts are **never** installed from downloaded source.
- Existing extension runtime files and manifest are backed up into **.oweh-full-update-backup**. Manifest is installed last; on a copy error the updater attempts rollback.
- The script uses an exclusive file lock to prevent simultaneous manual and scheduled updates. A failed network request leaves the previous extension intact.
- No personal data, pet database or Species records are uploaded to GitHub. Browser local storage and IndexedDB remain unchanged.

## Why the updater waits for Edge to close

The updater **will not overwrite JavaScript while Edge, Chrome or Brave is running**. This is intentional: Full Sweep and breeding may run for hours, and copying JavaScript files while a worker is alive risks mixed old/new runtime. The scheduled task records **waiting for Edge/Chrome to close** and retries at the next check; it never kills browser processes or interrupts a job. If Edge's Startup boost/background-running option leaves processes running after windows close, disable those Edge options to allow safe unattended updates.

After an update, reopening Edge loads the new unpacked extension automatically. The existing extension self-reload feature still handles other kinds of local version changes while the browser is open.

## Release behavior

The updater checks stable GitHub **main**; it cannot deliver the spreadsheet/discard-list v5.13.0 candidate while PR #39 remains unmerged. It will become eligible only after the code is merged, the manifest version rises, and the exact main merge SHA passes CI. It does not create Releases, support store-managed installations, or update the Lite extension.

The updater cannot update **its own installer scripts**. To upgrade those scripts, download the newer ZIP kit and replace them manually once. This is deliberate for task-scheduler security.

## Acceptance checks

- [x] Static updater contracts and existing JavaScript regression tests.
- [ ] Windows PowerShell 5.1 parse / package workflow passes.
- [ ] Task Scheduler activation verified on your Windows installation.
- [ ] First real Edge-closed update, reopen, and rollback verified by you.
