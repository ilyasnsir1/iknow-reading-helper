# Native playback, source Romaji and postponed Study prototype

`tests/test-native-audio-playback.cjs` runs the actual production extension in
an isolated Brave profile on a 200-row course fixture. Its native handler uses
the reused Audio / pause / src / play sequence found in the public iKnow bundle.
The test instruments the real platform calls without substituting media
playback. A short WAV response stands in for the remote MP3, so this checks
extension interference rather than real network latency.

It exercises 72 rapid speaker clicks across Follow-off/word-off,
Follow-off/word-on and Follow-on/word-on settings. Every click reaches platform
play synchronously, without waiting for a model or saved timings. No extension
pause interrupts those native calls. Follow-off emits no continuous native
clock. Preparing a word during a sentence no longer pauses it, invalidated word
results cannot take priority after a native click, and even a speaker nested
in a decorated word retains its click handler. The course uses raw source `ha`
despite an older stored pronunciation=true preference.

The test does not prove that every intermittent issue on the user's real
network has been resolved. It covers the identified interference paths and
guards against delaying, swallowing or interrupting the native player.

`tests/test-learning-workspace.cjs` verifies raw saved-source Romaji, no pitch
section or pitch/normalizer script, and continued listening, repetition,
recording, disposal and late microphone-permission cancellation. Shared
Discard/Reveal hover styling remains transparent and padded in all themes.
Theme and package/update checks run against canonical source or isolated
fixtures, never the registered application.

The 1.40.1 pitch source, reading normalizer and their tests were archived under
local work/postponed-study-pronunciation/1.40.1 for possible later review. They
are absent from the new shipped extension. The separate recognition lab is
also outside the package, with no model process started by this release.

The signed review package is applied only through the checked local managed
transaction, with idle guards and backup. Browser identity, native registration,
models, caches and the Desktop sharing copy are preserved. No publication is
performed without explicit human instruction.
