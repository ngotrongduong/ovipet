# Test Strategy

1. Fast static gate: JS syntax, manifest JSON, referenced files exist.
2. Pure unit tests: color/pedigree/scoring/queue/state helpers.
3. Worker state-machine tests: claim, ACK, deadline, heartbeat, Stop, stale generations, tab death, service-worker rehydrate.
4. Sanitized DOM fixture tests for eggs/hatchlings/species/profile/overview/friends/chat.
5. Background/storage tests for schema/migration/merge/journal/owned tabs.
6. Integration smoke tests by loading unpacked extension against local fixtures where practical.
7. Live OviPets manual QA for contracts CI cannot reproduce.

Bug rule: failing regression test -> smallest fix -> focused test -> full suite -> regression review.
Refactor rule: add characterization tests before moving poorly isolated behavior.
