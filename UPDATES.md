# Updates

Version 1.37.0 ships a signed in-app component catalogue and Models & voices
manager. After initial helper setup, supported optional models/runtimes can be
downloaded, paused, resumed or verified without rerunning a terminal. Programme
and catalogue changes arrive through the application update; large component
installation remains a separate explicit action. See [Models & voices](MODELS-AND-VOICES.md).

Version 1.36.0 checks for releases during browser startup and ordinary use. A
verified newer release shows **NEW** on the extension icon and its version in
the tooltip. Pin Reading Helper in Brave to keep this notice visible. The fox
notice remains at the top of the popup and leads to Install update.

Version 1.37.1 replaces the original one-hour cooldown with a persisted
45-second interval shared across worker restarts, popups and tab activity.
Visible iKnow courses and series align their next wake with the shared due time;
normally a new release is discovered within about one minute while a
page stays visible and the connection/helper are available. Hidden pages stop
their signal. These are activity-based checks, not a push subscription or a
guarantee of discovery while the browser is idle/closed. No model is started and
no browser permission is added. Metadata checks continue during preparation;
installation still requires an explicit click and paused preparation.

Discovery reads the small signed public latest-release manifest directly,
avoiding GitHub REST requests on every check. Unchanged metadata reuses only
cached signature bytes; Windows CNG verifies those bytes against the pinned
publisher key every time. New signatures use a version-pinned URL to avoid
pairing files from different releases. Explicit installation still checks
release asset membership through the REST API and verifies the full archive.
Helper 1.21.0 is included in the application update; no extra setup is required.

Repeated failed automatic attempts back off from one to two, four, eight and
at most sixty minutes. A verified available notice remains visible while
offline; explicit Check for updates can retry immediately. A successful check
restores the normal interval. Correcting the PC clock backwards cannot block
discovery until the old timestamp catches up. Export diagnostics includes the
attempt time, last result/error, retry interval and next eligible check, plus
bounded check-start/check-finish history. New releases discovered while the
previous install is waiting to refresh its pages retain their NEW notice while
that earlier refresh finishes once.

After successful installation, the extension reloads and the new worker checks
that its actual version matches the completed target. It then automatically
refreshes open pages on the three allowed iKnow hosts. Preparation and audible
iKnow playback defer the refresh; later browser/course activity retries it.
Unrelated websites are not reloaded. Per-tab claims/completion are persisted
before the side effect to avoid automatic duplicate reloads after a worker
interruption. If an acknowledgement is ambiguous or a page cannot reload, a
manual Refresh iKnow pages action remains available for unresolved pages.
A developer reload or failed installation does not trigger this flow.


Version 1.35.3 removes PowerShell from runtime update verification and support
exports. Windows CNG is called directly through its system library; the same
pinned RSA key, SHA-256 and PKCS#1 signature checks remain mandatory. No
antivirus exclusions or browser permission changes are required by the code.
Whether an endpoint security product accepts the new path must be tested on
the affected PC. An old verifier that is already blocked cannot install its
own replacement; use the reviewed one-time recovery at the existing folder.

Version 1.35.2 includes helper 1.18.0 and a comprehensive local diagnostic
export. The normal Export diagnostics action now gathers persistent project
history, installation checks and both Windows signature verifiers in one file.
No upload service is added. Update first to start recording the new history;
unrecorded failures from earlier installations cannot be recovered retroactively.

Version 1.35.1 uses Windows CNG for the same pinned RSA/SHA-256 publisher
signature. No legacy CSP key container is created. A real signature mismatch
still blocks installation; Windows verification/runtime failures have separate
messages and safe diagnostic evidence. The publisher key and signing algorithm
are unchanged. Helper 1.17.0 ships with this release.

Version 1.35.0 decorates available-update notices with the original pixel fox.
It moves between hiding places only while fully concealed behind the notice.
Move the mouse near an exposed fox to make it duck and return later. Clicking
the notice still opens the Updates section; it does not begin installation.
The notice also supports keyboard navigation and reduced motion. An older
installed version uses its existing notice when offering 1.35.0; the new fox
notice becomes available after installing this version.

The first installation still uses the unpacked extension and `helper/Setup.cmd`.
Keep the complete folder in a permanent location. Existing users need to adopt
the updater-enabled version once before in-app updates are available.

If Diagnostics shows helper 1.13.0 while the extension is 1.34.0 or later, the
browser is still connected to an older helper. Pause preparation, run
helper/Setup.cmd from the current application folder, choose **3: Check / repair**,
and reload Reading Helper and iKnow pages. If a native connection still uses the
old helper, close Brave fully and reopen it. The connected helper must be at
least 1.16.0 for this updater. The popup button alone does not confirm that the
helper has been updated. Existing compatible models are retained.

Open the extension popup and choose **Check for updates**. When a version is
available, choose **Install update**. Public release downloads require no GitHub
account. Updates are installed only after this explicit action. Complete or
pause course preparation and word-audio preparation first.

The manual Check for updates action remains available for an immediate check.
Neither automatic nor manual metadata checks download a model, prepare a
course or install an update. An older installed release retains its existing
check workflow until it adopts 1.36.0.

The local helper checks the release signature against the publisher key pinned
in the installed package, checks the archive and each managed file, and updates
the same installation folder. It keeps a backup and rolls back a failed file
transaction. Unexpected local modifications are preserved and reported instead
of silently overwritten. Settings, saved course additions and model downloads
remain in their existing locations.

After installation, the extension reloads and the verified new version refreshes
open iKnow pages automatically, with a manual retry if needed. If the helper is missing, run the existing setup. An update that
requires a supported runtime dependency or model offers its download through
Models & voices after first-time helper setup. Other setup changes are described
in that release's notes;
ordinary extension/helper updates do not download the existing models again.
An update that expands browser permissions requires manual installation so its
new access can be reviewed. Dependency/setup scripts are never run silently by
the updater.

If a download or verification fails, the current installation remains usable.
Retry from the popup. Never download a replacement from an unexpected address or
move the installation folder during an update. Diagnostics can help identify a
failed update without sending data automatically.

The project and public releases are currently published under
`ilyasnsir1/iknow-reading-helper`. Downloaded extension/helper files are
inspectable. The requested `ilyasnsir1` creator credit remains in the application.
Moving distribution to a separate organization later requires a reviewed update
configuration change; existing users should update before the old release
address is retired.
