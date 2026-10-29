# Version 1.37.0 validation

Local review build. Not published. Extension 1.37.0, helper 1.20.0; browser
permissions unchanged. Existing registered and Desktop copies remain frozen.

## Components

- `python -B tests/test-component-manager.py`: 15 isolated checks for cheap
  status, pinned verification, partial HTTP range resume, corrupt/truncated
  downloads, explicit actions, bounded paths/archive traversal, competing starts,
  shared activity locks, durable rollback/recovery including receipts, old voice
  cache compatibility and changed-model cache invalidation. A stale maintenance
  marker cannot stop the voice engine without a live installer owner.
- `node tests/test-components-source.cjs`: own-page authorization, explicit
  actions, idle startup, preparation guard, manual pause/start and busy cleanup.
- `node tests/test-components-native-browser.cjs`: actual Brave native-messaging
  broker and detached private-Python worker, with a unique temporary test host
  registration. Six MB of local fixture data is downloaded, paused, resumed,
  verified and activated after the management page/native port close. Only the
  download transport and test catalogue are fixtures; native framing, worker
  startup, locking, range/checksum handling and activation use production code.
  The unique test registration is removed afterward; the installed registration
  and application are not changed. This caught and fixed missing helper search
  paths in the embedded-Python detached worker.
- The real component libraries, full multi-GB public model downloads and every
  upstream engine configuration have not been freshly installed by these tests.
  They use the same pinned identities as existing setup, with new staging and
  lifecycle handling. No paid API or automatic pronunciation scoring is added.

## Study UI

- `node tests/test-study-store.cjs`: stable identity, text/URL validation,
  serialized concurrent mutations and preservation of unrecognized schema data.
- `node tests/test-learning-workspace.cjs`: actual isolated extension course
  bookmarks, direct study-tab navigation, per-word/all Romaji reveal, original
  repeat/pause/stop, local MediaRecorder take and cleanup, late microphone-grant
  cancellation and model-management UI start/pause/resume/completion. iKnow
  source/audio, native model replies and microphone hardware/permission are
  explicit fixtures; no personal Brave profile or installed helper is used.
- Desktop and 390px local web-preview screenshots were inspected. Both views
  rendered without overflow or page errors. The web preview clearly labels its
  simulated model downloads; original example recordings come from iKnow.

## Regression

- Automatic updater browser lifecycle, integrated proactive update policies and
  series-queue progress checks passed.
- Actual updater-popup and diagnostic-page UI checks passed.
- Complete diagnostics: 10 Python tests plus 5 browser-background groups passed.
- Preparation runtime: 9 tests passed.
- Updater security/transaction suite: 12 tests passed.
- Publisher packaging suite: 10 tests passed.
- `git diff --check` and Python/JavaScript syntax checks passed.

## Separate release build

The signed review package contains 146 managed files. Its source/package hashes
match, no bytecode or personal diagnostics/models are included, and the publisher
dry-run verifies signature and archive. A local signed transport fixture upgrades
the exact prior 1.36.0 archive to the staged 1.37.0 release with the real native
verifier/detached transaction runner; all 146 target hashes and saved-data
sentinels pass. This is not a live GitHub update test or publication.

No automatic pronunciation grade is inferred from speech recognition. The
record-and-compare workflow has no upload or stored microphone recordings.
Models are installed only by a separate explicit action after the app update.
