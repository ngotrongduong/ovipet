# Test Strategy

The extension needs tests at several levels because Node tests alone cannot prove live OviPets DOM behavior.

## 1. Fast static gate

Run on every commit/PR:

- syntax-check every runtime/test JavaScript file;
- validate manifest JSON;
- verify every manifest-referenced local file exists.

This gate should fail in seconds.

## 2. Pure unit tests

Best for:

- color math;
- pedigree rules;
- breeding scoring;
- queue ordering;
- state transition helpers.

These tests should not require fake Chrome APIs or DOM.

## 3. State-machine tests

Highest priority for MV3 reliability.

Cover:

- worker claim;
- attach/start;
- ACK;
- heartbeat;
- stop;
- complete;
- deadline;
- service-worker rehydrate;
- stale generation messages;
- worker tab death.

Important cases:

- start message delayed;
- start ACK never arrives;
- Stop from generation N after generation N+1 exists;
- worker tab reloads during start;
- heartbeat from stale generation;
- duplicate completion;
- service worker restarts with durable active task.

## 4. DOM fixture tests

Store sanitized minimal HTML fixtures for OviPets structures that have been manually verified.

Fixtures should cover:

- own Hatchery egg;
- friend egg profile;
- hatchling;
- Name the Species prompt;
- wrong-answer state;
- pet profile/pedigree;
- overview row;
- friends hatchery;
- Ninja Please comment.

Selectors should be tested against fixtures rather than only source-string assertions.

## 5. Background/storage tests

Cover:

- IndexedDB schema/migration;
- pet merge semantics;
- command journal retention/recovery;
- owned-tab registry;
- generation-safe release.

## 6. Integration smoke tests

Where practical, load the unpacked extension in Chromium/Chrome against local fixture pages and confirm:

- manifest loads;
- content scripts initialize;
- panel renders once;
- bridge messaging works;
- stop/reset cleanup is idempotent.

Do not attempt to automate destructive actions against the live game in CI.

## 7. Live manual QA

Live OviPets checks remain required for contracts the repository cannot reproduce legally/reliably in fixtures.

Record date, Chrome version, OviPets page, observed DOM, expected outcome and pass/fail in LIVE_QA_CHECKLIST.md.

## Bug-fix rule

For a reproducible bug:

1. write a test that fails for the bug when practical;
2. verify the failure is specific;
3. implement the smallest fix;
4. verify the new test and full suite;
5. run regression review on the diff.

## Refactor rule

Refactor tests prove equivalence, not only that code executes. Add characterization tests before moving poorly isolated behavior.
