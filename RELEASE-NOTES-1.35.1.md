Fix local preparation interruptions and improve Windows update verification.

- Keep local model traffic direct instead of inheriting Windows proxy settings.
- Allow bounded slower CPU inference, report liveness, and retain prompt cancellation.
- Interrupt series preparation at the current course when its shared model fails. Resume reuses validated checkpoints instead of cascading through later courses.
- Show the language phase after model startup, preserve real counts and error codes, and flush the last saved additions on a model failure.
- Verify the unchanged publisher signature with Windows CNG and distinguish actual mismatches from Windows verifier failures. Add safe verification evidence to Diagnostics.

Includes helper 1.17.0. Existing voices, models, settings and compatible course caches are retained. Pause preparation before installing, then reopen the popup and choose Refresh iKnow pages. This release does not require downloading models again.
