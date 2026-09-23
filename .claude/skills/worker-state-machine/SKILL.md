---
name: worker-state-machine
description: Use when implementing or reviewing OviPets worker claim/start/ACK/heartbeat/stop/complete/recovery logic under Chrome MV3.
---

Model idle -> claimed -> starting -> running -> stopping/completed/failed -> idle. Require atomic claim, owner+generation, start deadline+ACK, generation-checked heartbeat/Stop/release, idempotent completion, stale no-ops, durable rehydrate, dead-tab cleanup and owned-tab-only close. Test delayed/missing/duplicate ACK, stale Stop/heartbeat, rollover, tab death and restart.
