# Validation: 1.37.2

Follow-up to the 45-second discovery work in 1.37.1. A real public probe immediately
after publication observed the previous signed latest manifest for 33 seconds.
The isolated updater installed 1.37.1 successfully but its subsequent current
check rejected that older observed metadata. This release fixes that specific
discovery case without changing the explicit installer's downgrade protection.

`tests/test-update-fast-discovery.py` (11 tests) covers real Windows signature
verification, identical-raw cached signature revalidation, exact repository/path
and bounded time-bucket query validation, changed time buckets, invalid caches,
version-pinned signature URLs, the stale signed observation/current contract,
preservation of an already newer notice and unchanged REST membership checks
for explicit installation. An old candidate never becomes an install target.

`tests/test-proactive-updates.cjs` additionally verifies automatic and manual
stale responses preserve NEW and retain the observed version for diagnostics.
The existing 45-second boundary/aligned heartbeat, preparation, error backoff,
worker restart and post-install refresh tests remain applicable and pass.
`tests/test-updater-helper.py` retains the real Windows transaction, rollback,
cross-process locks, permission-boundary and explicit downgrade checks.

Build, signature verification and isolated staged/public native update results
are recorded after packaging/publication below. User installation paths, native
registration, model files and learning caches are not used by the test fixtures.
