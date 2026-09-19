---
name: release-gate
description: Use before merging a runtime PR or releasing a new OviPets extension version.
---

# Release Gate

## Automated

- JavaScript syntax verification passes.
- Full Node suite passes.
- Manifest parses and referenced files exist.
- New regression tests cover fixed bugs.
- No local/session files or secrets are tracked.

## Review

- Relevant specialist review complete.
- oweh-regression-reviewer complete.
- WORKING_STATE reflects architecture/lifecycle changes.
- Version/changelog/docs agree when releasing.

## Manual when applicable

- Complete relevant LIVE_QA_CHECKLIST items.
- Verify Start/Stop/recovery.
- Verify owned tabs are the only tabs closed.
- Verify dispatched commands are not treated as confirmed without evidence.

Do not release with unresolved P0/P1 issues.
