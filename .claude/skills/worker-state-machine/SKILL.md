---
name: worker-state-machine
description: Use when implementing or reviewing OviPets worker claim/start/ACK/heartbeat/stop/complete/recovery logic under Chrome MV3.
---

# Worker State Machine

Model every operation with owner + generation.

Expected path:

idle -> claimed -> starting -> running -> stopping/completed/failed -> idle

## Required checks

- Claim is atomic.
- Start has a bounded deadline.
- Running requires explicit ACK.
- Heartbeat validates owner + generation.
- Stop/release validates owner + generation.
- Completion is idempotent.
- Stale messages are no-ops.
- Dead/missing tabs can still be cleaned from durable state.
- Service-worker restart can reconstruct the state.
- Only owned tabs are closed.

## Test matrix

At minimum test delayed start, missing ACK, duplicate ACK, stale Stop, stale heartbeat, generation rollover, tab death and service-worker rehydrate.
