# Models & voices

After initial helper setup, open Reading Helper → **Models & voices**. Existing
compatible installations are detected without loading models or hashing large
files on every status poll. **Verify / repair** explicitly checks installed
files and replaces missing or invalid components.

The current catalogue offers the course language model, the sentence audio
timing model, and the Mao Plain / Nise voice bundle. Opening this page does not
start a download. Choose Download, Update component, or Verify / repair. Pause
course and word preparation first; model installation and application updates
cannot run together. The manager also waits for owned voice-engine shutdown.

Downloads use the source addresses and SHA-256 checksums shipped in the signed
application release. Browser requests select catalogue IDs; they cannot supply
arbitrary URLs, file paths or commands. Partial downloads are retained and use
HTTP range requests where supported. Download progress and estimates refer to
the labelled current file. Dependency installation, verification, extraction and
shared voice resources can take additional time and have an indeterminate bar.
The displayed download sizes are approximate and exclude existing reusable data.

Downloads can continue with this page closed. Pause waits for a safe checkpoint;
a blocked network read can take up to its timeout to return. After an interrupted
worker, Resume is explicit. Verified files and partial downloads can be reused.
Activation keeps a durable replacement journal and a previous-version backup.
Failed activation rolls back; a later explicit install recovers interrupted
replacements before proceeding. Completed plain model downloads do not retain a
second permanent copy of the weights. Personal course results, settings and
generated speech are outside the component replacement set.

## Future updates

Program code and the trusted component catalogue are delivered by the ordinary
application updater. A changed/new catalogue entry appears after installing the
app update. Its large model download is a separate explicit action in Models &
voices; it does not need another terminal command or a replacement application
folder. Initial native-helper installation/registration is still required once.

Developers adding a component must ship pinned artifact identities, bounded
sizes/paths, an appropriate activation/runtime hook and license notices. A new
voice also needs matching speaker/style choices in the runtime and extension;
metadata alone cannot implement a new inference architecture. Voice artifact
hash changes affect speech cache identity while unchanged current voices keep
their compatible WAV cache. Dependency versions, setup/audit expectations and
rollback behavior must be checked together. New browser permissions still
require reviewed manual adoption; this release adds none.

The component manager never uploads recordings, executes code supplied by a
course page, or skips publisher/package verification. Diagnostics includes
component state and bounded installation logs. It never exports model contents.
