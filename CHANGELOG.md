# Changelog

Open **Changelog** in the popup's Updates section to read release notes.
The history starts with 1.40.4. Older releases are not backfilled.

Entries use short notes and optional screenshots. They follow the app theme.
Readers cannot save or upload changes through this page.

On the maintainer's configured PC, **Edit** opens the local editor. Titles,
notes, versions and screenshots can be changed, added or removed. **Save draft**
keeps a private local draft; it does not publish or install an update. Other
users receive the reviewed notes with the next signed application release.

The helper checks local maintainer authorization for every draft or image
request. The matching publisher key and the local editing configuration are
not part of the extension package. Editing the official distributed changelog
still requires the maintainer's release permissions and signing key.

Publisher instructions are in `tools/changelog/README.md`. Before a release,
export the intended draft to the canonical source checkout, review its text
and images, and finalize the next update's version, date and release status.
The ordinary preview, explicit publication and signed update workflow applies.
Do not add diagnostics, personal screenshots or author configuration to a
release package.
