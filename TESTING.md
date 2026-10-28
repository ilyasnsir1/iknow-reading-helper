# Validation and maintainer checks

The 1.34.0 updater was checked in Windows 11 with the production helper and an
isolated Brave profile. These checks do not use the installed browser profile,
personal model cache, registry registration or saved courses.

- 12 helper cases: real Windows RSA signatures, bounded downloads and archives,
  Windows paths, local-edit protection, model/cache preservation, rollback,
  interrupted transactions, cross-process activity locks, detached native-host
  handoff and manual adoption for expanded browser permissions.
- 5 cleanup cases: bounded old-stage retention, live/foreign/recovery-stage
  preservation, and rejection of junctions outside the update directory.
- 6 service-worker policy groups: popup-only messages, daily silent checks,
  explicit installation, invalid replies, interrupted reloads and late recovery.
- 5 isolated Brave popup groups: current/available/error/busy states, progress,
  popup reopening during installation, native-port closure, settings retention,
  page refresh and a single reload handoff. Native responses and the final
  runtime.reload call are controlled fixtures in these browser checks.
- 10 publisher cases: deterministic archives, pinned-key signing, full-file
  checksums, unsafe files, unexpected models/credentials, tampered releases and
  the real PowerShell publication flow with a bounded fake GitHub CLI.

Run the checked-in focused tests from this repository with Python 3.11+ and
Node.js 18+; Windows PowerShell is required for the RSA/transaction cases:

```powershell
python tests/test-updater-helper.py
python tests/test-updater-cleanup.py
node tests/test-updates-policy.cjs
python tools/publisher/test-publisher.py
node tests/test-extension-updates.cjs
```

The last test also requires Playwright and Brave. Set IKNOW_PLAYWRIGHT to the
Playwright package location and IKNOW_BROWSER_PATH to Brave's executable when
they are not found by the test. It creates its own browser profile and evidence
under tests/extension-updates-evidence; do not commit those files.

The broader download, cancellation, diagnostics and settings regression checks
also passed in the development workspace. The public focused suite above is
limited to update distribution; it does not claim every course/model operation
can succeed without an internet connection or adequate memory. Model/dependency
installation remains an explicit Setup action when release notes require it.

After publication, an isolated real native-host test also installed the public
signed 1.34.0 release from GitHub without authentication. The actual detached
runner completed, all 123 installed file hashes matched the signed manifest,
and a fresh helper reported the current version. Existing model, prepared
course and word-audio cache sentinels and a personal file were retained. This
test used a normal Windows temporary path with Unicode folder names and did not
change browser registration or perform a real browser runtime.reload; those
browser interactions remain bounded fixtures in the separate Brave tests.

See tools/publisher/README.md for release staging, signing and publishing.

## Version 1.34.1 series progress

Six worker regression groups reproduce an eight-course queue starting with
119/196 sentences in its first course. They cover continuous phase fractions,
measured language estimates before audio has a rate, cached work, legacy 1.34.0
snapshots, pause/resume/restart, failed-course retries and zero-audio courses.
Seven isolated Brave groups exercise the production series and queue views,
including 119 to 165/196, phase/course boundaries, truthful partial estimates,
older snapshots, pause/reopen/resume and unrelated-series isolation.

```powershell
node tests/test-series-queue-progress.cjs
node tests/test-series-live-progress.cjs
```

The source-outage, saved-availability and update popup/policy regressions also
passed. Seven diagnostics groups in the development workspace check safe queue
counts, scope, fractional progress and bounded numeric timing fields. These
focused tests use controlled source, native and clock fixtures; they do not
claim a timed-out model on another PC is repaired until that PC uses the current
helper and is checked again.

After publication, the unchanged 1.34.0 installation ZIP was used as the actual
starting installation for a live anonymous GitHub update to 1.34.1. Its original
helper verified and installed the new release through the detached runner. A
fresh helper confirmed 1.34.1; all 123 installed file hashes matched the signed
release and cache/personal-file sentinels were retained. No browser registration
or personal installation was changed by this isolated test.

## Version 1.35.0 update notice

The popup's update notice uses the original four-pose fox atlas. Eight isolated
Brave checks cover concealed horizontal relocation, peeking from multiple
places, mouse catch/duck/return, unchanged banner layout, keyboard/pointer
navigation, reduced motion and lifecycle cleanup. The actual scene code runs
against locally fulfilled requests and a bounded Chrome transport fixture;
thousands of natural animation frames verify that horizontal travel happens
only when the whole actor is clipped behind the banner. No native helper,
installed extension or personal cache is used by these scene checks.

```powershell
node tests/test-fox-hide-seek.cjs
```

The existing six real-extension popup groups separately verify the new notice's
scroll/focus behavior and retained check/install/progress/reload workflow. Native
responses and runtime.reload remain explicit fixtures in that browser test.

After publication, a separate unchanged 1.34.1 release installation downloaded
and installed 1.35.0 from the public GitHub release through its real native
helper and detached runner. All 124 installed files matched the signed manifest;
cache and personal-file sentinels were retained, and a fresh check reported the
new current version. The user's own registered installation and Desktop copy
remained on their unchanged 1.34.1 files for explicit popup adoption.
