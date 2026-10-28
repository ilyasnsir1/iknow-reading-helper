# Export a troubleshooting report

1. Reproduce the problem if possible.
2. Open the extension popup and choose **Diagnostics** near the bottom. It remains available when the master switch is off.
3. Click **Export diagnostics**. The browser downloads an `iKnow-Reading-Helper-diagnostics-….json` file.
4. Use **View report** to inspect the contents. Share the file together with a short description of what you clicked and what happened.

The report is generated locally on demand. There is no automatic upload. It does not prepare courses, synthesize words, install components, repair the installation or start a language/voice model.

## Included information

- Extension/helper/Python versions and coarse operating-system/architecture information.
- A fixed subset of display, preparation and voice settings.
- Preparation status, public course IDs, phases/counts and available error codes. Raw course titles/messages/source data are not copied wholesale.
- Up to30 deduplicated course/word/word-preparation error codes from the current background session. These entries are in memory and do not constitute a complete persistent browser error history.
- Lightweight presence checks for known runtime/model files, installation markers, selected setup components and relevant installed package metadata. These checks do not hash or load model files and do not prove that every installed component works.
- Bounded recent diagnostic lines from fixed setup/course/voice logs, plus small persisted job-status summaries. Missing or unreadable logs are identified in the report.

No translation/alignment caches, generated audio, model contents, browser history or browser profiles are included. Known personal paths/user identifiers, URLs, credential-bearing lines, raw learning/request fields and Japanese learning text are omitted or redacted from helper diagnostics. Logs are filtered to relevant diagnostic lines and limited in size. Review the report before sharing it; it is a troubleshooting snapshot rather than a universal anonymization guarantee or a complete record of every error.

## Missing or older local helper

The download still works when the helper is missing, disconnected, too old or times out. The report marks helper information as incomplete, which itself helps identify the problem. The rest of the extension information remains available.

For an existing installation, keep the complete current application files together and run **helper/Setup.cmd → 3 — Check / repair** if the report indicates that the helper is missing or the registered helper still points to an old/moved folder. This updates/checks the existing connection and selected capabilities. A fresh PC still starts with **1 — Complete** or **2 — Voices only**. Compatible downloads and saved course data are retained.

Brave's own Errors view remains useful for JavaScript/extension failures. It does not replace this report for local setup/model/voice problems. The report likewise does not capture every browser console error or certify translations and meaning groups.
