# 1.37.2

- Keep the 45-second automatic update checks introduced in 1.37.1, with no popup/manual check required on visible iKnow courses and series. Normal delivery is within about a minute when GitHub, the local helper and the connection respond.
- Refresh the moving latest-release request with a public time bucket. This avoids repeatedly reusing a stale redirect without adding a user identifier or consuming GitHub REST quota.
- Handle a previous signed release briefly served just after installation without a false downgrade error. Retain any already verified newer notice and expose the observed version/stale flag in diagnostic exports.
- Keep pinned publisher-signature checks, strict download URLs, full archive verification and the installer's downgrade protection unchanged.

Includes helper 1.21.1. Browser permissions, model files and course/voice caches are unchanged; no additional setup is needed. Existing installations need to adopt this release before the faster discovery applies to future updates. Network/GitHub delays and inactive browsers can delay notices.
