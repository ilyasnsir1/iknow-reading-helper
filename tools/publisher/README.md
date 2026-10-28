# Publisher tools

These tools are for the maintainer. Users do not run them and do not need GitHub
accounts. The current public repository is `ilyasnsir1/iknow-reading-helper`.
No workflow changes GitHub until the explicit publishing command is run.

## Trust key

Run `create-signing-key.ps1` once in Windows PowerShell. It creates an RSA3072
signing key under `%LOCALAPPDATA%/iKnowReadingHelperPublisher`, protects that
directory for the current Windows user, and writes a separate public key.
An existing key is never replaced. Back up the private key securely outside Git
and shared folders. Losing it requires a deliberately distributed new trust key;
an ordinary update must not silently change it.

The extension and helper have identical `update-config.json` files containing
the public key, owner, repository, channel and schema. Public keys may be shared;
the private signing key and GitHub credentials must never be committed.

## Build

From the repository root, stage a new unpacked sharing folder outside the
checkout. Check that its extension version, helper version and notes are correct:

```powershell
python tools/publisher/stage-package.py --output ../iknow-reading-helper-share
python tools/publisher/build-release.py --package ../iknow-reading-helper-share --owner ilyasnsir1 --repository iknow-reading-helper --output ../release-build/1.34.0
```

Adjust the relative paths to your checkout and the new version. The builder
accepts only extension/helper files and root documentation, scans for credentials
and personal filesystem paths, rejects models, recordings, profile data, links,
unexpected files and an oversized package. It produces a deterministic ZIP,
`update-manifest.json`, its detached base64 `update-manifest.sig` signature, and
`SHA256SUMS.txt`. Every ZIP member is covered by the signed manifest. The ZIP has
the extension and helper folders directly at its root, without an extra folder.

Only the reviewed release folder is packaged. Tests, publisher tools, git
history, diagnostic exports and local model downloads are not included. The
shipped helper downloads its dependencies from their recorded upstream sources;
their licenses and notices remain in the package. Seeded alignment/translation
metadata and source audio links are part of the existing extension; original
iKnow MP3 recordings are not included. A packaging check is not a copyright
clearance or an assertion of permission to redistribute upstream course data.

## Verify and publish

Create a text file containing the exact release notes. Verify first:

```powershell
powershell.exe -NoProfile -File tools/publisher/publish-release.ps1 -ReleaseDirectory ../release-build/1.34.0 -PackageDirectory ../iknow-reading-helper-share -NotesFile ../release-notes.txt -DryRun
```

After reviewing the files and notes, run the same command without `-DryRun`.
It uses `gh`'s existing authentication, uploads a draft, and publishes only after
all assets have been uploaded. It refuses to replace an existing version.
Never put a maintainer token into the extension. Users access public downloads
without any token. The signed manifest protects installations even if an asset
is corrupted or a GitHub download is replaced without the signing key.

## Future organization distribution

The public repository is currently owned by the maintainer's personal account.
An organization can own a future public download repository while development
remains private. Hiding membership does not guarantee anonymity: personal
commits, release authors and public activity can reveal a connection. A GitHub
App with access only to the distribution repository can publish as a bot. Its
private key and installation token belong only in the publisher environment,
never in users' packages. A public workflow run can expose its triggering actor;
prefer publishing from private automation when profile separation matters.
Changing destinations or keys needs a planned update migration before the old
download location is retired.
