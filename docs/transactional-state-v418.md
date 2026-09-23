# Transactional state core (v4.18)

## Stores

`oweh-state-v1` contains four IndexedDB object stores owned by the extension service
worker: `pets`, `tasks`, `commands`, and `meta`.

Content scripts access these stores through extension messages. OviPets page code never
receives database access.

## Migration

On the first database read, the service worker copies every record in the legacy
`owehPets` object into `pets` in one transaction and records `legacyPetsMigrated` in
`meta`. The original object is retained as a rollback snapshot but is no longer updated.

## Task leases

A task claim records its owning Chrome Tab ID, heartbeat time, and a 45-second lease.
The owner renews active tasks every 15 seconds. A competing tab may claim a task only
after its lease expires. Normal completion and user stops release the lease immediately.

## Mutation journal

Before a breeding command is dispatched, the helper inserts a deterministic key of the
form `breed:<campaign-start>:<mother-id>:<father-id>`. Commands already recorded as
dispatched or confirmed are rejected as duplicates. Rejected commands remain eligible
for an intentional retry; confirmed commands do not.
