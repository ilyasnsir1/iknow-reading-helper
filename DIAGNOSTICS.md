# Export one support report

1. Reproduce the problem if possible.
2. Open the extension popup and choose **Diagnostics**.
3. Click **Export diagnostics** once. Collection and Windows verification can take up to 45 seconds.
4. Share the downloaded JSON. **View report** shows the same inert contents for review.

Nothing is uploaded. No external support platform, account, subscription or paid service is used. The explicit export can read public GitHub release metadata if it has no retained copy, but it never downloads application archives, installs an update, prepares a course or starts a model. Keeping the same application folder and Brave extension entry preserves the existing saved results.

## Evidence in the file

- Loaded extension ID/version, permissions, browser/OS information, relevant settings and coarse online status.
- Current series queue, selected modules, phase totals, per-course checkpoints, missing results and measured estimate scope.
- Persistent browser event history: phase/status changes, sampled progress, errors, project script frames and update transitions. It survives background/Brave restarts.
- Helper job history and a persistent journal of model startup, readiness, inference timing, failure/cancellation, process cleanup and word voice outcomes. Correlation references connect events from the same operation without exporting request payloads.
- Structured exception types, numeric Windows/HTTP causes and project frame locations, without stack locals or raw model requests.
- Setup capabilities, known package versions, configured component presence and sizes, application identity/version, native registration consistency and allowed-extension fingerprints.
- Available physical RAM and disk space, logical CPU count, configured thread/GPU limits and proxy-presence facts. Model contents and credentials are not read.
- Bounded managed-application file checks against the local release baseline. This is consistency evidence; authenticity is checked separately by the pinned publisher signature.
- The saved update state and direct native Windows CNG signature verification, including key/metadata/signature fingerprints and bounded Windows status codes. Legacy PowerShell probes are not run; this avoids repeating endpoint security alerts caused by encoded command lines. Retained public metadata supports offline verification. Missing network/metadata or an expired time budget is explicit.
- Technical log tails with nearby failure context, including the preceding model-start log, and a counts-only inventory of saved browser course packs.

Reports remain usable with a missing or unresponsive helper: browser evidence is exported, and a previous successful helper snapshot is included if available, labelled **stale** with its capture time. No missing current result is silently replaced with old evidence. An older helper is explicitly identified as using the older report format.

## Retention and limits

Browser history retains the latest 240 sampled events. Progress is sampled at phase changes, about five sentences or ten seconds; terminal errors and relevant transitions are persisted promptly. It does not continuously copy learning content or serialize full course packs.

The helper journal uses two rotating 256 KiB files and exports the most recent 160 structured events. Up to 100 job summaries and bounded fixed technical log tails are included. The helper report is capped at 512 KiB; omitted/truncated sections and scan limits are named. Application integrity checks have a byte/file/time budget and never hash multi-gigabyte models. Export does not clear histories or prepared results.

History starts after installing this version. Unrecorded older failures, a full OS crash before persistence, external application failures or data beyond retention cannot be reconstructed. A single report is intended to cover routine support needs; it is not a guarantee that every possible fault can be diagnosed without another reproduction.

## What stays out

Raw learning/translation/alignment caches, generated audio, model contents, other PC files, browsing history, raw command lines, private keys, credentials and personal paths are not included. Reports are generated from typed fields and redacted technical logs. Review before sharing; this is a bounded project support report rather than a universal anonymization guarantee.

The temporary **Check-update** folder was needed because earlier installed helpers could not run these checks. Once this diagnostic version is installed, the normal export includes the native checks without starting PowerShell. An installation that is still blocked on an earlier updater may need the one-time support/recovery path before it can acquire the new code.
