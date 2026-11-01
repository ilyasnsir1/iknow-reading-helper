# Changelog authoring

The extension's Changelog page is read-only on ordinary installations. The
maintainer can edit entries and upload raster images on the publisher's PC.
Authorization is checked by the native helper on every operation, using an
explicit local configuration and the private RSA key matching the public key
already pinned in the application. The key and configuration are never shipped
or sent to the browser. A browser role flag cannot grant permission.

Run `python tools/changelog/configure-authoring.py enable` once on that PC.
The command reuses the existing protected publisher directory; it never creates
or replaces the signing key. `status` checks the role without starting a model.

Edits are drafts in the publisher's local directory. They do not touch installed
managed files, translations, models, recordings, registrations or browser
settings. Saving does not publish anything. Concurrent windows use revision
checks; stale saves must reload the draft. Uploaded images are limited to PNG,
JPEG and WebP, 600 KB each. Removing a published image affects its draft
reference only; installed package images are never deleted by the editor.

Write public notes against the latest published version. Do not describe
internal fixes to unreleased features as separate public improvements. Keep
the notes short and add only screenshots that help explain the new behavior.

For the user review, show the intended publication layout rather than draft
labels. From this checkout run, for example:

```powershell
python tools/changelog/configure-authoring.py preview --output ../study-preview/extension --display-version 1.41.0 --display-date 2026-10-31
```

This read-only local view uses the actual Changelog renderer and intended
screenshots. It does not finalize the private draft, change the installed
version, export to source, sign or publish anything. Use the release's intended
version and date when refreshing that view; the example is not a publication.

When explicitly approved for publication, finalize the private draft's release
version, date and status, then run
`python tools/changelog/configure-authoring.py export` from the canonical source
checkout. It copies the draft and its referenced local uploads into source.
Review the diff and use the normal separately authorized release workflow.
The release builder rejects preview entries or a mismatched newest version.
Keeping the private draft finalized too prevents stale Preview labels after
adopting the released update. No editor action
commits, pushes, signs, installs or publishes an update.

Drafts retain the source fingerprint they were based on. If a newer release or
source edit changes the changelog, loading the draft marks `sourceChanged`
without writing anything. Export refuses to replace that newer history.
Review both versions, then explicitly run `rebase --reviewed` if the draft
should be retained: matching entry IDs keep the reviewed draft edits, while
new published entry IDs are appended. Review the resulting order/content
before exporting. No automatic merge or publication runs when opening a page.

The local authoring directory is not a multi-user server. Anyone controlling
the maintainer's Windows account or private key already controls publication;
other users may alter their own unpacked files but cannot change this project's
official signed releases without that publisher key and GitHub access.
