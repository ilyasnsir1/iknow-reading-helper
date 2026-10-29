# Validation: 1.37.1 (local, unpublished)

Extension 1.37.1; helper 1.21.0. No permission changes. The registered
1.37.0 installation, Desktop sharing copy, native registration and actual model/
learning caches were not changed. No commits or release assets were pushed.

## Automatic discovery

- `tests/test-update-background-discovery-browser.cjs`: real isolated Brave
  profile using production background, updater and visible-page heartbeat. The
  first check reports current; the remote fixture subsequently changes while
  the same course tab remains open. Before 45 seconds no check is allowed;
  afterwards NEW appears without a popup, manual check, navigation or tab
  activation. Ongoing preparation does not block metadata. Offline failure and
  a real worker reload retain the available notice. Native metadata and wall
  clock are fixtures; only the content heartbeat's wait is accelerated. No live
  browser profile, registry, native helper or website is accessed. A tab activity
  check shifting the due time is followed by an adapted five-second heartbeat,
  rather than an extra full interval.
- `tests/test-automatic-updates-browser.cjs`: real toolbar/title APIs, actual
  extension version reload and automatic iKnow tab refresh, once only. An
  unrelated tab and saved state remain unchanged.
- `tests/test-proactive-updates.cjs`: 45-second boundary, concurrent events,
  manual override, future clock timestamps, offline persisted/backoff policy,
  maximum one-hour error backoff, trusted course/series signals, preparation
  installation guard, deferred refresh plus a newer release, and native failure
  concurrent with successful refresh.
- `tests/test-updates-policy.cjs`, `tests/test-update-discovery.cjs`,
  `tests/test-update-presence.cjs`, `tests/test-update-refresh.cjs`: origin/action
  restrictions, native exception cleanup, unknown/unconfigured helpers, quiet
  failures, verified-only NEW, timer visibility lifecycle, tab eligibility,
  persisted claims, audio/preparation guards and available-notice preservation.
- `tests/test-extension-updates.cjs`: production popup and update handoff with
  bounded native fixtures, including install refusal during preparation and
  failed-signature handling. No public update is installed.
- `tests/test-complete-diagnostics.cjs`: the export retains discovery timing,
  outcome and error details while removing personal paths; existing history,
  fallback, bounded inventory and explicit-export restrictions still pass.

## Package and native update transaction

`tests/test-update-fast-discovery.py` verifies the fixed latest-manifest URL,
version-pinned signatures, real CNG verification even with cached signatures,
cache publisher/key/raw binding and bounded corrupt-cache recovery (including
deeply nested JSON), archive-version rules, revalidation headers and unchanged
REST membership checks for explicit installation. The 12 existing helper
security/transaction tests and eight integrated diagnostic tests pass.

Cold-process measurements using temporary application copies/caches and the
real public signed release: the new host took 0.89 seconds on the first check
and 0.50 seconds with its signature cache; each used 0.1875 seconds CPU and
about 29 MiB peak working set. Both processes exited. The unchanged response
body is about 15 KiB per 45-second check (about 1.2 MiB/hour plus HTTP overhead).
This is a local measurement, not a performance guarantee for every device.
No models or learning files are loaded by the metadata path. The 45-second
normal wake leaves room for Chromium's idle worker shutdown, rather than
keeping a permanent port or sub-30-second heartbeat running.

`work/build-local-release.py` produced a separate unpacked folder and signed
assets under `outputs/releases/1.37.1/`. Publisher verification/dry run passed:
146 managed files, pinned publisher signature, no upload.
Protected installed baselines verified before and after packaging.

`work/test-staged-github-update.py` exercised the exact signed published 1.37.0
archive to staged 1.37.1 in a temporary installation. Windows signature checking,
the original detached runner and all 146 installed file hashes passed. Existing
model/course/voice sentinels and user notes were retained; a subsequent metadata
check reports current. Only network transport was substituted. This is not a
test of an already-published 1.37.1 release.

Local evidence: `work/staged-update-evidence/` and
`tests/background-discovery-evidence/results.json` (ignored support artifacts).
Cold process evidence: `work/update-discovery-performance/20261029T012930Z/results.json`.

Automatic discovery remains activity-based: a visible iKnow course/series
normally detects a later release within about one minute when the
helper and network respond. Hidden/idle/closed browsers cannot guarantee instant
delivery. Repeated failures intentionally increase that interval. Install
remains explicit. Public publication requires the user's separate instruction.
