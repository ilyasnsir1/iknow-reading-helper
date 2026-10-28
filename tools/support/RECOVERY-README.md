# Offline updater recovery

This separate folder repairs the updater once when security software blocks the
old PowerShell signature check. The recovery verifies the publisher signature
through Windows cryptography directly. It uses the existing private Python
runtime and does not download or execute release code before verification.

The maintainer can prepare this folder for review before publishing its release.
**Do not run Recover-update.cmd until the maintainer has explicitly published the
matching version and told you to proceed.** Check-recovery.cmd is read only and
can be used to review the exact existing application folder and verified version.
It verifies all package files without writing an application, cache or report file.

After the matching release has been published and recovery is authorized:

1. Pause preparation in the extension. Wait for playback to finish.
2. Close Brave completely, including any background windows.
3. Extract the complete recovery folder. Keep updater.py, recover_update.py,
   both CMD files, and the release subfolder together.
4. Double-click **Recover-update.cmd**. Review the existing application folder
   and the exact version change displayed in the terminal.
5. Type **UPDATE** and press Enter to install. Any other answer cancels.
6. When installation finishes, reopen Brave and the extension popup, then choose
   **Refresh iKnow pages**. The restored preparation queue can then resume.

Recovery preserves the existing extension folder and browser registration,
downloaded models, learning caches and unmanaged personal files. It retains a
transaction backup in the existing learning cache. Locally changed managed files,
unexpected publisher keys, altered packages, added browser permissions, running
Brave or active preparation stop installation.

If recovery stops, keep its terminal message and folder for the maintainer.
Do not uninstall, clear caches, move the registered extension, or replace files
manually. Subsequent updates use the normal popup workflow: **Updates → Check
for updates → Install update**, reopen the popup, then **Refresh iKnow pages**.

Maintainer packaging: include the trusted development helper/updater.py as
updater.py beside this script. Put the matching signed update-manifest.json,
update-manifest.sig and ZIP in release/. The recovery carries only a publisher
public-key fingerprint; never include a private signing key or personal data.
