Verify signed updates directly with Windows cryptography, without PowerShell.

- Replace the encoded PowerShell subprocess with in-process Windows CNG using the same pinned RSA key, SHA-256 and PKCS#1 signature scheme.
- Keep signature validation mandatory. Modified metadata and incorrect keys remain rejected; Windows API failures have distinct diagnostic status codes.
- Remove legacy PowerShell probes from Export diagnostics so exporting cannot repeat the blocked command. Retained old evidence remains available and unused legacy checks are labelled explicitly.
- Include the preparation reliability and complete local support-export improvements prepared in 1.35.1 and 1.35.2.

Includes helper 1.19.0. Existing models, voices, saved courses and browser settings are retained. No browser permission is added and no antivirus setting is changed.

An installation already blocked before it can update needs the separately reviewed one-time recovery at its current application folder. Normal compatible updates continue through the popup. After installation reopen/reload Reading Helper and refresh iKnow pages.
