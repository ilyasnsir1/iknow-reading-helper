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

The separate unpacked package and signed assets contain 146 managed files and
a 12,202,451-byte ZIP. Publisher signature/digest checks and source/package hash
comparison pass; browser permissions and extension identity match 1.37.0.
Staged native update tests from both exact earlier published archives (1.37.0
and 1.37.1) pass, retaining model/course/voice sentinels and user notes.

Published 2026-10-29T01:43:07Z after explicit user authorization. The real public
latest-metadata probe observed 1.37.2 on its first request in 1.297 seconds,
using the public time-bucket URL and pinned Windows CNG verification. Public
anonymous GitHub/native updates from 1.37.0 and 1.37.1 both pass: exact publisher
signature, ZIP, detached runner, all 146 installed file hashes, retained model/
course/voice sentinels and personal notes, then a second check reports current
with metadataVersion 1.37.2 and metadataStale false.

Local evidence (ignored, not distributed):

- `work/public-discovery-evidence/20261029T014310Z/results.json`
- `work/live-github-update-evidence/20261029T014309313819Z/results.json` (1.37.0)
- `work/live-github-update-evidence/20261029T014324959601Z/results.json` (1.37.1)

These public tests use disposable installations and actual network/native
transactions, not the user's browser profile/registration. Actual browser
runtime reload and automatic tab refresh are covered separately by the isolated
Brave fixtures. The registered 1.37.0 files, Desktop 1.34.1 sharing copy, native
registration, real model files and learning caches remained unchanged; protected
managed baselines were verified again after publication. No hard delivery
guarantee is claimed for GitHub/network delays or inactive browsers.
