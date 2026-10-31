# Update validation for 1.41.0

Checked against the canonical source checkout, using disposable keys,
temporary applications/caches and isolated Brave profiles. The registered
installation, Desktop sharing copy, models and native registration were not
changed.

Passed:

- Publisher: 11 checks covering reproducible archives, signatures, finalized
  changelog/version matching, unsafe assets, destination checks and refusal to
  replace an existing release.
- Native updater: 12 checks covering signed manifests, path/archive validation,
  checked installation baselines, new managed files, transaction rollback,
  interrupted recovery, busy locks and permission changes.
- Cleanup: 5 checks covering bounded backups and preservation of active,
  unknown, linked and personal paths.
- Fast discovery: 11 checks covering trusted metadata/signature caching,
  stale metadata, exact URLs, bounded probes and 45-second discovery timing.
- Browser/background unit suites: popup installation restrictions, automatic
  discovery, update presence, persisted refresh intent, stopped audio and
  preparation guards, worker restarts and manual recovery.
- Actual isolated Brave: the NEW toolbar badge appears without a manual popup
  check; the visible-page heartbeat detects later releases; successful target
  reload refreshes matching iKnow tabs once while preserving unrelated tabs and
  saved data; offline worker restarts retain the verified notice.

The helper source is unchanged from the published 1.40.5 baseline. Its version
remains 1.22.0.

The actual signed 1.41.0 artifact passed `tests/test-release-update.py` against
a disposable copy of the published 1.40.5 package. All 193 managed files adopted
successfully using the old installation's pinned publisher key. A deliberate
mid-write failure also restored every previous application file. Model, course,
neural-audio and browser-settings sentinels remained unchanged in both cases;
the earlier public package itself remained unchanged. The helper remains
1.22.0 and no permission expansion was required.

Artifact inspection confirmed the finalized release notes match canonical
source, including one Added Study workspace entry and one Improved theme-menu
entry. Both intended new screenshots and the two historical screenshots are
included. No author configuration, private key, draft, diagnostics, models,
runtime, profile or download files are in the archive. The final one-pixel
Listening adjustment and result-filter arrows/tooltips change are included.

Verified archive SHA-256:

`d663012398599f95d807bdbc149372edbacee455ee81b7d5f23f2ada3e22a67d`
