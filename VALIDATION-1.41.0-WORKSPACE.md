# Study workspace validation for 1.41.0

2026-10-31: **19 of 19 active C1 checks passed** against the canonical source
and generated extension. These checks use isolated Brave profiles or local
fixtures; they do not read or modify the registered installation or personal
library, recordings, preparation jobs, models or caches.

## Library and saved data

- `tests/test-study-workspace-browser.cjs`: actual extension/CSP, live library,
  notes, delete, backup restore, durable grades and attempts, complete course.
- `tests/test-study-workspace-data.cjs`: validated data, storage subscriptions,
  preserved sources, settings, backups and failed-write behavior.
- `tests/test-study-workspace-inline-notes.cjs`: inline editing, per-entry
  drafts, live caret retention and save retries.
- `tests/test-study-workspace-selection-refresh.cjs`: retained selection,
  filters, collapsed library and per-tab isolation.
- `tests/test-study-workspace-performance.cjs`: a 2,000-entry library,
  unrelated setting changes and hidden/visible tab scheduling.
- `tests/test-study-saved-order.cjs`: new entries append, same-time ordering,
  note edits, filters, refresh and Next navigation.

## Practice, courses and Kana

- `tools/preview/test-study-focus-course-practice.cjs`: full-course pools of
  200 vocabulary, 200 sentences and 400 mixed records, order and shuffle.
- `tests/test-study-practice-refresh.cjs`: warm cache before first paint,
  retained setup, accurate counts and invalid/offline source handling.
- `tools/preview/test-study-focus-one-retry.cjs`: 22 answer/retry scenarios,
  submitted answer history, unfinished rounds and grading distinctions.
- `tests/test-study-workspace-steppers.cjs`: pointer/keyboard controls,
  course counts, loading guards and unchanged library dropdowns.
- `tests/test-study-kana-preference-refresh.cjs`: exact retained groups,
  characters, script, readings and order; Compact default.
- `tests/test-study-kana-selection-actions.cjs`: group/character toggles,
  disabled no-op actions and Clear.
- `tools/preview/test-study-focus-kana-session.cjs`: 1/46/104-character
  sessions, input guards, results, filtering and pagination.

## Playback, themes and results

- `tests/test-study-playback-volume.cjs`: original/take playback levels,
  recording, Listening, popup synchronization and persistent controls.
- `tests/test-audio-volume.cjs`: bounded independent channels, mute, rapid
  writes, live changes and failed-write rollback.
- `tests/test-native-audio-playback.cjs`: 72 rapid native speaker clicks,
  synchronous playback, missing timings and independent word volume.
- `tests/test-theme-control-parity.cjs`: actual Study, Changelog, Models,
  Queue and popup controls, palettes, checks and geometry in four themes.
- `tests/test-result-filter-arrows.cjs`: result arrows, keyboard focus,
  pagination/search, no native vocabulary tooltips and retained scores.
- `tools/preview/test-study-focus-map.cjs`: 200/400-answer reports,
  selected-answer retention, pagination, filtering and source lookup.

The relevant UI checks include all four themes and narrow-screen layouts.
The theme-parity test now waits for the workspace's durable theme/header
update before opening its menu; its original selection-marker assertions
remain intact. This fixes a test race without changing product behavior.

Course/network/audio responses are deterministic fixtures. These checks do
not benchmark local language-model throughput, validate a remote PC's GPU
drivers, or claim to reproduce the previously reported native tab-switch
delay. Signed-package and update-installation validation are separate release
checks.
