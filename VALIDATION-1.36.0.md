# Version 1.36.0 validation

Local review build only. No release publication or live installation replacement.
Helper 1.19.0 and all browser permissions remain unchanged.

## Update discovery and refresh

- `node tests/test-update-discovery.cjs`: 8 policy groups for startup/event
  registration, single-flight discovery, steady version-aware badge rendering,
  busy/offline handling and callback/promise action APIs.
- `node tests/test-update-presence.cjs`: visible-only low-frequency presence,
  hidden/page lifecycle handling and invalidated extension contexts.
- `node tests/test-update-refresh.cjs`: 14 groups for actual target and intent
  guards, exact HTTPS host scope, preparation/audio deferral including changes
  inside asynchronous storage checks, navigation/closure, persisted per-tab
  claims, partial failures, interrupted acknowledgements and manual retry.
- `node tests/test-proactive-updates.cjs`: 8 integrated groups loading all three
  production updater modules, including no-popup discovery, old error retry,
  persisted cooldown, explicit checks, presence authentication, legacy completed
  install migration and version handoff. Active refresh blocks check/install.
- `node tests/test-updates-policy.cjs`: existing update authorization, cooldown,
  failed response and interrupted installation checks.

## Actual isolated Brave

- `node tests/test-automatic-updates-browser.cjs`: real toolbar badge/title APIs
  show NEW before a popup is opened. Real `runtime.reload()` with a disk manifest
  version change starts the new worker and reloads both local iKnow website
  fixtures without reopening the popup. A second extension reload does not
  repeat page refreshes. An unrelated tab and storage sentinels are unchanged.
  Developer mode is enabled through the isolated browser's Extensions UI,
  matching the required unpacked installation. Native release replies and
  website responses are explicit fixtures; no real native host, user profile or
  live update network is used by this browser test.
- `node tests/test-extension-updates.cjs`: 6 production-popup groups, including
  explicit installation, preparation guard, signature errors, closed-popup
  continuation, restored progress and update completion. Distribution is
  disabled in a copied fixture before its worker starts, preventing any access
  to the actual registered native host before test stubs are installed.
- `node tests/test-diagnostics-page.cjs`: 3 actual UI groups for inert export,
  missing/older helpers, retries and narrow layout, with the same isolation.

## Regression and package validation

- `node tests/test-complete-diagnostics.cjs`: 5 groups.
- `node tests/test-series-queue-progress.cjs`: 7 groups.
- `python -B tools/publisher/test-publisher.py`: 10 tests passed.
- `git diff --check`: passed.
- Separate signed release build: 132 managed files, extension 1.36.0,
  helper 1.19.0. Publisher dry-run verified signature and exact archive.
- Local signed transport fixture upgraded the exact earlier 1.35.3 archive to
  the staged 1.36.0 package with the real native verifier and detached
  transaction runner. All 132 target files passed verification; saved settings,
  caches and unrelated files were preserved. Only the network download boundary
  was replaced with the local signed assets. This is not a live GitHub test.
- Frozen registered and Desktop installations matched their managed baselines
  before and after packaging. Their files were not copied over or installed.

Automatic discovery is activity-driven with a one-hour attempt cooldown, not a
promise of instant notifications while Brave is idle/closed. Pinning the icon
makes the toolbar notice visible. An older installed version obtains this
release through its existing update flow; new behavior starts after adoption.
